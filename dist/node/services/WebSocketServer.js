"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketServer = void 0;
const ws_1 = require("ws");
const http_1 = require("http");
const MicroserviceFramework_1 = require("../MicroserviceFramework");
const WebsocketConnection_1 = require("./WebsocketConnection");
const WebSocketAuthenticationMiddleware_1 = require("./WebSocketAuthenticationMiddleware");
class WebSocketServer extends MicroserviceFramework_1.MicroserviceFramework {
    constructor(backend, config) {
        super(backend, config);
        this.connections = new Map();
        this.requiresAuthentication = false;
        this.port = config.port;
        this.path = config.path || "/ws";
        this.maxConnections = config.maxConnections || 1000;
        this.server = (0, http_1.createServer)();
        this.wss = new ws_1.Server({ noServer: true });
        this.authProvider = config.authProvider;
        this.sessionStore = config.sessionStore;
        this.requiresAuthentication = config.requiresAuthentication || false;
        if (this.requiresAuthentication === true) {
            if (!this.authProvider || !this.sessionStore) {
                throw new Error("Authentication is required but no authentication middleware or session store was provided");
            }
            const authMiddleware = config.authenticationMiddleware ||
                new WebSocketAuthenticationMiddleware_1.WebSocketAuthenticationMiddleware(this.authProvider, this.sessionStore);
            this.authenticationMiddleware = authMiddleware;
        }
        this.setupWebSocketServer();
    }
    setupWebSocketServer() {
        this.server.on("upgrade", async (request, socket, head) => {
            // Prevent memory leaks by handling socket errors
            socket.on("error", (err) => {
                this.error("Socket error:", err);
                socket.destroy();
            });
            if (request.url !== this.path) {
                socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
                socket.destroy();
                return;
            }
            // Handle authentication before upgrading the connection
            if (this.requiresAuthentication) {
                try {
                    // Create a temporary connection object for authentication
                    const tempConnection = new WebsocketConnection_1.WebsocketConnection(this.handleMessage.bind(this), this.handleClose.bind(this));
                    await this.authenticationMiddleware.authenticateConnection(request, tempConnection);
                    // If authentication succeeds, proceed with the upgrade
                    this.upgradeConnection(request, socket, head, tempConnection);
                }
                catch (error) {
                    this.warn("Authentication error", error);
                    socket.write("HTTP/1.1 401 Unauthorized\r\n" +
                        "Connection: close\r\n" +
                        "Content-Length: 21\r\n" +
                        "Content-Type: text/plain\r\n" +
                        "\r\n" +
                        "Authentication failed\r\n");
                    // End the socket after writing the response
                    socket.end();
                    return;
                }
            }
            else {
                // If no authentication required, proceed with upgrade directly
                this.upgradeConnection(request, socket, head);
            }
        });
    }
    upgradeConnection(request, socket, head, authenticatedConnection) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
            if (this.connections.size >= this.maxConnections) {
                ws.close(1013, "Maximum number of connections reached");
                return;
            }
            if (authenticatedConnection) {
                // Set the WebSocket instance on the existing connection
                authenticatedConnection.setWebSocket(ws);
                this.connections.set(authenticatedConnection.getConnectionId(), authenticatedConnection);
            }
            else {
                // Create new connection with WebSocket instance
                const connection = new WebsocketConnection_1.WebsocketConnection(this.handleMessage.bind(this), this.handleClose.bind(this), undefined, // default timeout
                undefined, // default rate limit
                ws);
                this.connections.set(connection.getConnectionId(), connection);
            }
        });
    }
    async handleMessage(data, connection) {
        try {
            const strData = data.toString();
            const detectionResult = detectAndCategorizeMessage(strData);
            let requestType = "";
            if (detectionResult.payloadType == "string" ||
                detectionResult.payloadType == "object") {
                requestType = "raw";
                const response = await this.makeRequest({
                    to: this.serviceId,
                    requestType: "raw",
                    body: detectionResult.payload,
                });
                connection.send(JSON.stringify(response));
                return;
            }
            if (detectionResult.payloadType == "IResponse") {
                const response = detectionResult.payload;
                await this.sendOneWayMessage(JSON.stringify(response), response.requestHeader.requesterAddress, response.body);
                return;
            }
            if (detectionResult.payloadType == "IRequest") {
                const request = detectionResult.payload;
                const response = await this.makeRequest({
                    to: request.header.recipientAddress || this.serviceId,
                    requestType: request.header.requestType || "unknown",
                    body: {
                        connectionId: connection.getConnectionId(),
                        type: request.header.requestType || "unknown",
                        body: request.body,
                    },
                    headers: {
                        ...request.header,
                        requestId: request.header.requestId,
                    },
                    handleStatusUpdate: async (updateRequest, status) => {
                        const statusUpdate = MicroserviceFramework_1.MicroserviceFramework.createResponse(updateRequest, updateRequest.header.requesterAddress, status);
                        connection.send(JSON.stringify(statusUpdate));
                    },
                });
                connection.send(JSON.stringify(response));
            }
        }
        catch (error) {
            this.error(`Error processing WebSocket message`, error);
            connection.send(JSON.stringify({ error: "Invalid message format" }));
        }
    }
    handleClose(connectionId) {
        this.connections.delete(connectionId);
        this.info(`WebSocket connection closed: ${connectionId}`);
    }
    async startDependencies() {
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                this.info(`WebSocket server listening on port ${this.port}`);
                resolve();
            });
        });
    }
    async stopDependencies() {
        return new Promise((resolve) => {
            // Close all active connections
            this.info("Closing all active WebSocket connections...");
            for (const connection of this.connections.values()) {
                connection.close(1000, "Server shutting down");
            }
            // Wait for a short time to allow connections to close
            setTimeout(() => {
                // Close the WebSocket server
                this.wss.close(() => {
                    // Close the HTTP server
                    this.server.close(() => {
                        this.info("WebSocket server stopped");
                        resolve();
                    });
                });
            }, 1000); // Wait for 1 second before closing servers
        });
    }
    async defaultMessageHandler(request) {
        this.warn(`Unhandled WebSocket message type: ${request.header.requestType}`, request);
        return {
            success: false,
            error: `"Unhandled message type" ${request.header.requestType}`,
        };
    }
    getConnections() {
        return this.connections;
    }
    async rawMessageHandler(message) {
        this.warn(`Received raw message`, message);
        return "ERROR: Raw messages not supported. Please use CommunicationsManager";
    }
    broadcast(message) {
        const messageString = JSON.stringify(message);
        this.connections.forEach((connection) => {
            connection.send(messageString);
        });
    }
    sendToConnection(connectionId, message) {
        const connection = this.connections.get(connectionId);
        if (connection) {
            connection.send(JSON.stringify(message));
        }
        else {
            this.warn(`Connection not found: ${connectionId}`);
        }
    }
}
exports.WebSocketServer = WebSocketServer;
__decorate([
    (0, MicroserviceFramework_1.RequestHandler)("raw"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], WebSocketServer.prototype, "rawMessageHandler", null);
function detectAndCategorizeMessage(message) {
    // First, check if the message is likely JSON or a JavaScript-like object
    if (message.trim().startsWith("{") || message.trim().startsWith("[")) {
        try {
            const parsed = JSON.parse(message);
            // Check if it's likely an IRequest
            if (typeof parsed === "object" &&
                parsed !== null &&
                "header" in parsed &&
                "body" in parsed &&
                typeof parsed.header === "object" &&
                "timestamp" in parsed.header &&
                "requestId" in parsed.header &&
                "requesterAddress" in parsed.header) {
                return {
                    payloadType: "IRequest",
                    payload: parsed,
                };
            }
            // Check if it's likely an IResponse
            if (typeof parsed === "object" &&
                parsed !== null &&
                "requestHeader" in parsed &&
                "responseHeader" in parsed &&
                "body" in parsed &&
                typeof parsed.body === "object" &&
                "data" in parsed.body &&
                "success" in parsed.body &&
                "error" in parsed.body) {
                return {
                    payloadType: "IResponse",
                    payload: parsed,
                };
            }
            // If it's a parsed object but not IRequest or IResponse
            return { payloadType: "object", payload: parsed };
        }
        catch (error) {
            // If parsing fails, treat it as a string
            return { payloadType: "string", payload: message };
        }
    }
    else {
        // If it doesn't look like JSON, treat it as a string
        return { payloadType: "string", payload: message };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBRzNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBMkJ4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBY0MsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFaakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVMxRCwyQkFBc0IsR0FBWSxLQUFLLENBQUM7UUFJOUMsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDO1FBQ3hCLElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksSUFBSSxLQUFLLENBQUM7UUFDakMsSUFBSSxDQUFDLGNBQWMsR0FBRyxNQUFNLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQztRQUVwRCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsbUJBQVksR0FBRSxDQUFDO1FBQzdCLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxXQUFNLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUM7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO1FBQ3hDLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxNQUFNLENBQUMsc0JBQXNCLElBQUksS0FBSyxDQUFDO1FBQ3JFLElBQUksSUFBSSxDQUFDLHNCQUFzQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3pDLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFB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T0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO0lBQ3JELENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmVyLCBEYXRhIH0gZnJvbSBcIndzXCI7XG5pbXBvcnQgeyBjcmVhdGVTZXJ2ZXIsIFNlcnZlciBhcyBIdHRwU2VydmVyLCBJbmNvbWluZ01lc3NhZ2UgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHsgRHVwbGV4IH0gZnJvbSBcInN0cmVhbVwiO1xuXG5pbXBvcnQge1xuICBNaWNyb3NlcnZpY2VGcmFtZXdvcmssXG4gIElTZXJ2ZXJDb25maWcsXG4gIFN0YXR1c1VwZGF0ZSxcbiAgUmVxdWVzdEhhbmRsZXIsXG59IGZyb20gXCIuLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7XG4gIElCYWNrRW5kLFxuICBJUmVxdWVzdCxcbiAgSVJlc3BvbnNlLFxuICBJU2Vzc2lvblN0b3JlLFxuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFdlYnNvY2tldENvbm5lY3Rpb24gfSBmcm9tIFwiLi9XZWJzb2NrZXRDb25uZWN0aW9uXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfSBmcm9tIFwiLi9XZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmVcIjtcblxudHlwZSBQYXlsb2FkVHlwZSA9IFwib2JqZWN0XCIgfCBcInN0cmluZ1wiIHwgXCJJUmVxdWVzdFwiIHwgXCJJUmVzcG9uc2VcIjtcblxuaW50ZXJmYWNlIERldGVjdGlvblJlc3VsdDxUPiB7XG4gIHBheWxvYWRUeXBlOiBQYXlsb2FkVHlwZTtcbiAgcGF5bG9hZDogVDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBwYXRoPzogc3RyaW5nO1xuICBtYXhDb25uZWN0aW9ucz86IG51bWJlcjtcbiAgcmVxdWlyZXNBdXRoZW50aWNhdGlvbj86IGJvb2xlYW47XG4gIGF1dGhQcm92aWRlcj86IElBdXRoZW50aWNhdGlvblByb3ZpZGVyO1xuICBzZXNzaW9uU3RvcmU/OiBJU2Vzc2lvblN0b3JlO1xuICBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldE1lc3NhZ2UgPSB7XG4gIHR5cGU6IHN0cmluZztcbiAgZGF0YTogYW55O1xuICBjb25uZWN0aW9uSWQ6IHN0cmluZztcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0UmVzcG9uc2Uge31cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgV2ViU29ja2V0TWVzc2FnZSxcbiAgV2ViU29ja2V0UmVzcG9uc2Vcbj4ge1xuICBwcml2YXRlIHNlcnZlcjogSHR0cFNlcnZlcjtcbiAgcHJpdmF0ZSB3c3M6IFNlcnZlcjtcbiAgcHJpdmF0ZSBjb25uZWN0aW9uczogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcG9ydDogbnVtYmVyO1xuICBwcml2YXRlIHBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBtYXhDb25uZWN0aW9uczogbnVtYmVyO1xuICBwcml2YXRlIGF1dGhQcm92aWRlcjogSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXIgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgc2Vzc2lvblN0b3JlOiBJU2Vzc2lvblN0b3JlIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTpcbiAgICB8IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVxuICAgIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlcXVpcmVzQXV0aGVudGljYXRpb246IGJvb2xlYW4gPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTb2NrZXRTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0O1xuICAgIHRoaXMucGF0aCA9IGNvbmZpZy5wYXRoIHx8IFwiL3dzXCI7XG4gICAgdGhpcy5tYXhDb25uZWN0aW9ucyA9IGNvbmZpZy5tYXhDb25uZWN0aW9ucyB8fCAxMDAwO1xuXG4gICAgdGhpcy5zZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoKTtcbiAgICB0aGlzLndzcyA9IG5ldyBTZXJ2ZXIoeyBub1NlcnZlcjogdHJ1ZSB9KTtcbiAgICB0aGlzLmF1dGhQcm92aWRlciA9IGNvbmZpZy5hdXRoUHJvdmlkZXI7XG4gICAgdGhpcy5zZXNzaW9uU3RvcmUgPSBjb25maWcuc2Vzc2lvblN0b3JlO1xuICAgIHRoaXMucmVxdWlyZXNBdXRoZW50aWNhdGlvbiA9IGNvbmZpZy5yZXF1aXJlc0F1dGhlbnRpY2F0aW9uIHx8IGZhbHNlO1xuICAgIGlmICh0aGlzLnJlcXVpcmVzQXV0aGVudGljYXRpb24gPT09IHRydWUpIHtcbiAgICAgIGlmICghdGhpcy5hdXRoUHJvdmlkZXIgfHwgIXRoaXMuc2Vzc2lvblN0b3JlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIGlzIHJlcXVpcmVkIGJ1dCBubyBhdXRoZW50aWNhdGlvbiBtaWRkbGV3YXJlIG9yIHNlc3Npb24gc3RvcmUgd2FzIHByb3ZpZGVkXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGF1dGhNaWRkbGV3YXJlID1cbiAgICAgICAgY29uZmlnLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB8fFxuICAgICAgICBuZXcgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlKFxuICAgICAgICAgIHRoaXMuYXV0aFByb3ZpZGVyLFxuICAgICAgICAgIHRoaXMuc2Vzc2lvblN0b3JlXG4gICAgICAgICk7XG4gICAgICB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSA9IGF1dGhNaWRkbGV3YXJlO1xuICAgIH1cbiAgICB0aGlzLnNldHVwV2ViU29ja2V0U2VydmVyKCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwV2ViU29ja2V0U2VydmVyKCkge1xuICAgIHRoaXMuc2VydmVyLm9uKFxuICAgICAgXCJ1cGdyYWRlXCIsXG4gICAgICBhc3luYyAocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLCBzb2NrZXQ6IER1cGxleCwgaGVhZDogQnVmZmVyKSA9PiB7XG4gICAgICAgIC8vIFByZXZlbnQgbWVtb3J5IGxlYWtzIGJ5IGhhbmRsaW5nIHNvY2tldCBlcnJvcnNcbiAgICAgICAgc29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycikgPT4ge1xuICAgICAgICAgIHRoaXMuZXJyb3IoXCJTb2NrZXQgZXJyb3I6XCIsIGVycik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHJlcXVlc3QudXJsICE9PSB0aGlzLnBhdGgpIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXCJIVFRQLzEuMSA0MDQgTm90IEZvdW5kXFxyXFxuXFxyXFxuXCIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGF1dGhlbnRpY2F0aW9uIGJlZm9yZSB1cGdyYWRpbmcgdGhlIGNvbm5lY3Rpb25cbiAgICAgICAgaWYgKHRoaXMucmVxdWlyZXNBdXRoZW50aWNhdGlvbikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgY29ubmVjdGlvbiBvYmplY3QgZm9yIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgICAgICBjb25zdCB0ZW1wQ29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSEuYXV0aGVudGljYXRlQ29ubmVjdGlvbihcbiAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgdGVtcENvbm5lY3Rpb25cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIElmIGF1dGhlbnRpY2F0aW9uIHN1Y2NlZWRzLCBwcm9jZWVkIHdpdGggdGhlIHVwZ3JhZGVcbiAgICAgICAgICAgIHRoaXMudXBncmFkZUNvbm5lY3Rpb24ocmVxdWVzdCwgc29ja2V0LCBoZWFkLCB0ZW1wQ29ubmVjdGlvbik7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgdGhpcy53YXJuKFwiQXV0aGVudGljYXRpb24gZXJyb3JcIiwgZXJyb3IpO1xuICAgICAgICAgICAgc29ja2V0LndyaXRlKFxuICAgICAgICAgICAgICBcIkhUVFAvMS4xIDQwMSBVbmF1dGhvcml6ZWRcXHJcXG5cIiArXG4gICAgICAgICAgICAgICAgXCJDb25uZWN0aW9uOiBjbG9zZVxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIkNvbnRlbnQtTGVuZ3RoOiAyMVxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpblxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIlxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIGZhaWxlZFxcclxcblwiXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBFbmQgdGhlIHNvY2tldCBhZnRlciB3cml0aW5nIHRoZSByZXNwb25zZVxuICAgICAgICAgICAgc29ja2V0LmVuZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBJZiBubyBhdXRoZW50aWNhdGlvbiByZXF1aXJlZCwgcHJvY2VlZCB3aXRoIHVwZ3JhZGUgZGlyZWN0bHlcbiAgICAgICAgICB0aGlzLnVwZ3JhZGVDb25uZWN0aW9uKHJlcXVlc3QsIHNvY2tldCwgaGVhZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGdyYWRlQ29ubmVjdGlvbihcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UsXG4gICAgc29ja2V0OiBEdXBsZXgsXG4gICAgaGVhZDogQnVmZmVyLFxuICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uPzogV2Vic29ja2V0Q29ubmVjdGlvblxuICApIHtcbiAgICB0aGlzLndzcy5oYW5kbGVVcGdyYWRlKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgKHdzKSA9PiB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5zaXplID49IHRoaXMubWF4Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgd3MuY2xvc2UoMTAxMywgXCJNYXhpbXVtIG51bWJlciBvZiBjb25uZWN0aW9ucyByZWFjaGVkXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChhdXRoZW50aWNhdGVkQ29ubmVjdGlvbikge1xuICAgICAgICAvLyBTZXQgdGhlIFdlYlNvY2tldCBpbnN0YW5jZSBvbiB0aGUgZXhpc3RpbmcgY29ubmVjdGlvblxuICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5zZXRXZWJTb2NrZXQod3MpO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSxcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvblxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBjb25uZWN0aW9uIHdpdGggV2ViU29ja2V0IGluc3RhbmNlXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB0aGlzLmhhbmRsZUNsb3NlLmJpbmQodGhpcyksXG4gICAgICAgICAgdW5kZWZpbmVkLCAvLyBkZWZhdWx0IHRpbWVvdXRcbiAgICAgICAgICB1bmRlZmluZWQsIC8vIGRlZmF1bHQgcmF0ZSBsaW1pdFxuICAgICAgICAgIHdzXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksIGNvbm5lY3Rpb24pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKGRhdGE6IERhdGEsIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RyRGF0YSA9IGRhdGEudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKHN0ckRhdGEpO1xuICAgICAgbGV0IHJlcXVlc3RUeXBlOiBzdHJpbmcgPSBcIlwiO1xuXG4gICAgICBpZiAoXG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIm9iamVjdFwiXG4gICAgICApIHtcbiAgICAgICAgcmVxdWVzdFR5cGUgPSBcInJhd1wiO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiBcInJhd1wiLFxuICAgICAgICAgIGJvZHk6IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkLFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXNwb25zZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlc3BvbnNlPGFueT47XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICByZXNwb25zZS5ib2R5XG4gICAgICAgICk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXF1ZXN0XCIpIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXF1ZXN0PGFueT47XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgY29ubmVjdGlvbklkOiBjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgICAgdHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgICBib2R5OiByZXF1ZXN0LmJvZHksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOiBhc3luYyAoXG4gICAgICAgICAgICB1cGRhdGVSZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgICAgICAgICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgICAgICAgICApID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c1VwZGF0ZSA9IE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXNwb25zZShcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdCxcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICAgICAgc3RhdHVzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHN0YXR1c1VwZGF0ZSkpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFdlYlNvY2tldCBtZXNzYWdlYCwgZXJyb3IpO1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiSW52YWxpZCBtZXNzYWdlIGZvcm1hdFwiIH0pKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUNsb3NlKGNvbm5lY3Rpb25JZDogc3RyaW5nKSB7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8vIENsb3NlIGFsbCBhY3RpdmUgY29ubmVjdGlvbnNcbiAgICAgIHRoaXMuaW5mbyhcIkNsb3NpbmcgYWxsIGFjdGl2ZSBXZWJTb2NrZXQgY29ubmVjdGlvbnMuLi5cIik7XG4gICAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgdGhpcy5jb25uZWN0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIik7XG4gICAgICB9XG5cbiAgICAgIC8vIFdhaXQgZm9yIGEgc2hvcnQgdGltZSB0byBhbGxvdyBjb25uZWN0aW9ucyB0byBjbG9zZVxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIC8vIENsb3NlIHRoZSBXZWJTb2NrZXQgc2VydmVyXG4gICAgICAgIHRoaXMud3NzLmNsb3NlKCgpID0+IHtcbiAgICAgICAgICAvLyBDbG9zZSB0aGUgSFRUUCBzZXJ2ZXJcbiAgICAgICAgICB0aGlzLnNlcnZlci5jbG9zZSgoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSwgMTAwMCk7IC8vIFdhaXQgZm9yIDEgc2Vjb25kIGJlZm9yZSBjbG9zaW5nIHNlcnZlcnNcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb25uZWN0aW9ucygpOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnM7XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXI8c3RyaW5nPihcInJhd1wiKVxuICBwcm90ZWN0ZWQgYXN5bmMgcmF3TWVzc2FnZUhhbmRsZXIobWVzc2FnZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJhdyBtZXNzYWdlYCwgbWVzc2FnZSk7XG4gICAgcmV0dXJuIFwiRVJST1I6IFJhdyBtZXNzYWdlcyBub3Qgc3VwcG9ydGVkLiBQbGVhc2UgdXNlIENvbW11bmljYXRpb25zTWFuYWdlclwiO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPik6IHZvaWQge1xuICAgIGNvbnN0IG1lc3NhZ2VTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmZvckVhY2goKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlU3RyaW5nKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzZW5kVG9Db25uZWN0aW9uKFxuICAgIGNvbm5lY3Rpb25JZDogc3RyaW5nLFxuICAgIG1lc3NhZ2U6IElSZXNwb25zZTxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBDb25uZWN0aW9uIG5vdCBmb3VuZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKG1lc3NhZ2U6IHN0cmluZyk6IERldGVjdGlvblJlc3VsdDx1bmtub3duPiB7XG4gIC8vIEZpcnN0LCBjaGVjayBpZiB0aGUgbWVzc2FnZSBpcyBsaWtlbHkgSlNPTiBvciBhIEphdmFTY3JpcHQtbGlrZSBvYmplY3RcbiAgaWYgKG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJ7XCIpIHx8IG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJbXCIpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UobWVzc2FnZSk7XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXF1ZXN0XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwiaGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmhlYWRlciA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcInRpbWVzdGFtcFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0SWRcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdGVyQWRkcmVzc1wiIGluIHBhcnNlZC5oZWFkZXJcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXF1ZXN0XCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXF1ZXN0PHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVzcG9uc2VcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJyZXF1ZXN0SGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwicmVzcG9uc2VIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuYm9keSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcImRhdGFcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcInN1Y2Nlc3NcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcImVycm9yXCIgaW4gcGFyc2VkLmJvZHlcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXNwb25zZVwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVzcG9uc2U8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIElmIGl0J3MgYSBwYXJzZWQgb2JqZWN0IGJ1dCBub3QgSVJlcXVlc3Qgb3IgSVJlc3BvbnNlXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJvYmplY3RcIiwgcGF5bG9hZDogcGFyc2VkIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElmIHBhcnNpbmcgZmFpbHMsIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBpdCBkb2Vzbid0IGxvb2sgbGlrZSBKU09OLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gIH1cbn1cbiJdfQ==