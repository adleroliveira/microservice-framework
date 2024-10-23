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
                this.handleWsEvents(), ws);
                this.connections.set(connection.getConnectionId(), connection);
            }
        });
    }
    handleWsEvents() {
        return {
            onRateLimit: (connectionId) => {
                this.warn(`Rate limit exceeded for connection ${connectionId}`);
                const connection = this.connections.get(connectionId);
                if (connection) {
                    connection.close(1008, "Rate limit exceeded");
                    this.connections.delete(connectionId);
                }
            },
            onError: (connectionId, error) => {
                this.warn(`Error for connection ${connectionId}: ${error.message}`);
                // TODO: handle connection erros
            },
            onSecurityViolation: (connectionId, violation) => {
                this.warn(`Security violation for connection ${connectionId}: ${violation}`);
                const connection = this.connections.get(connectionId);
                if (connection) {
                    connection.close(1008, "Security violation");
                    this.connections.delete(connectionId);
                }
            },
        };
    }
    async refreshSession(connection) {
        if (this.requiresAuthentication) {
            await connection.refreshSession(this.sessionStore);
        }
    }
    async handleMessage(data, connection) {
        try {
            await this.refreshSession(connection);
            // TODO: handle expired sessions
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
                // TODO: handle non-authenticated Requests
                // TODO: handle authorization
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
                        sessionId: connection.getSessionId(),
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
        return new Promise(async (resolve) => {
            try {
                // Close all active connections and wait for them to complete
                this.info("Closing all active WebSocket connections...");
                await Promise.all(Array.from(this.connections.values()).map((connection) => connection.close(1000, "Server shutting down")));
                // Close the WebSocket server and HTTP server
                await new Promise((resolveWss) => {
                    this.wss.close(() => {
                        this.server.close(() => {
                            this.info("WebSocket server stopped");
                            resolveWss();
                        });
                    });
                });
                resolve();
            }
            catch (error) {
                this.error("Error during shutdown:", error);
                resolve(); // Still resolve to ensure shutdown completes
            }
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
    async getSessionById(sessionId) {
        return this.sessionStore ? this.sessionStore.get(sessionId) : null;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBSTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBMkJ4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBY0MsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFaakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVMxRCwyQkFBc0IsR0FBWSxLQUFLLENBQUM7UUFJOUMsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDO1FBQ3hCLElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksSUFBSSxLQUFLLENBQUM7UUFDakMsSUFBSSxDQUFDLGNBQWMsR0FBRyxNQUFNLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQztRQUVwRCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsbUJBQVksR0FBRSxDQUFDO1FBQzdCLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxXQUFNLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUM7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO1FBQ3hDLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxNQUFNLENBQUMsc0JBQXNCLElBQUksS0FBSyxDQUFDO1FBQ3JFLElBQUksSUFBSSxDQUFDLHNCQUFzQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3pDLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFB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S0FBSyxRQUFRO2dCQUMxQixNQUFNLEtBQUssSUFBSTtnQkFDZixlQUFlLElBQUksTUFBTTtnQkFDekIsZ0JBQWdCLElBQUksTUFBTTtnQkFDMUIsTUFBTSxJQUFJLE1BQU07Z0JBQ2hCLE9BQU8sTUFBTSxDQUFDLElBQUksS0FBSyxRQUFRO2dCQUMvQixNQUFNLElBQUksTUFBTSxDQUFDLElBQUk7Z0JBQ3JCLFNBQVMsSUFBSSxNQUFNLENBQUMsSUFBSTtnQkFDeEIsT0FBTyxJQUFJLE1BQU0sQ0FBQyxJQUFJLEVBQ3RCLENBQUM7Z0JBQ0QsT0FBTztvQkFDTCxXQUFXLEVBQUUsV0FBVztvQkFDeEIsT0FBTyxFQUFFLE1BQTRCO2lCQUN0QyxDQUFDO1lBQ0osQ0FBQztZQUVELHdEQUF3RDtZQUN4RCxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUM7UUFDcEQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZix5Q0FBeUM7WUFDekMsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO1FBQ3JELENBQUM7SUFDSCxDQUFDO1NBQU0sQ0FBQztRQUNOLHFEQUFxRDtRQUNyRCxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7SUFDckQsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZXJ2ZXIsIERhdGEgfSBmcm9tIFwid3NcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciwgU2VydmVyIGFzIEh0dHBTZXJ2ZXIsIEluY29taW5nTWVzc2FnZSB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQgeyBEdXBsZXggfSBmcm9tIFwic3RyZWFtXCI7XG5pbXBvcnQgeyBJU2Vzc2lvbkRhdGEgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuXG5pbXBvcnQge1xuICBNaWNyb3NlcnZpY2VGcmFtZXdvcmssXG4gIElTZXJ2ZXJDb25maWcsXG4gIFN0YXR1c1VwZGF0ZSxcbiAgUmVxdWVzdEhhbmRsZXIsXG59IGZyb20gXCIuLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7XG4gIElCYWNrRW5kLFxuICBJUmVxdWVzdCxcbiAgSVJlc3BvbnNlLFxuICBJU2Vzc2lvblN0b3JlLFxuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFdlYnNvY2tldENvbm5lY3Rpb24gfSBmcm9tIFwiLi9XZWJzb2NrZXRDb25uZWN0aW9uXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfSBmcm9tIFwiLi9XZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmVcIjtcblxudHlwZSBQYXlsb2FkVHlwZSA9IFwib2JqZWN0XCIgfCBcInN0cmluZ1wiIHwgXCJJUmVxdWVzdFwiIHwgXCJJUmVzcG9uc2VcIjtcblxuaW50ZXJmYWNlIERldGVjdGlvblJlc3VsdDxUPiB7XG4gIHBheWxvYWRUeXBlOiBQYXlsb2FkVHlwZTtcbiAgcGF5bG9hZDogVDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBwYXRoPzogc3RyaW5nO1xuICBtYXhDb25uZWN0aW9ucz86IG51bWJlcjtcbiAgcmVxdWlyZXNBdXRoZW50aWNhdGlvbj86IGJvb2xlYW47XG4gIGF1dGhQcm92aWRlcj86IElBdXRoZW50aWNhdGlvblByb3ZpZGVyO1xuICBzZXNzaW9uU3RvcmU/OiBJU2Vzc2lvblN0b3JlO1xuICBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldE1lc3NhZ2UgPSB7XG4gIHR5cGU6IHN0cmluZztcbiAgZGF0YTogYW55O1xuICBjb25uZWN0aW9uSWQ6IHN0cmluZztcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0UmVzcG9uc2Uge31cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgV2ViU29ja2V0TWVzc2FnZSxcbiAgV2ViU29ja2V0UmVzcG9uc2Vcbj4ge1xuICBwcml2YXRlIHNlcnZlcjogSHR0cFNlcnZlcjtcbiAgcHJpdmF0ZSB3c3M6IFNlcnZlcjtcbiAgcHJpdmF0ZSBjb25uZWN0aW9uczogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcG9ydDogbnVtYmVyO1xuICBwcml2YXRlIHBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBtYXhDb25uZWN0aW9uczogbnVtYmVyO1xuICBwcml2YXRlIGF1dGhQcm92aWRlcjogSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXIgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgc2Vzc2lvblN0b3JlOiBJU2Vzc2lvblN0b3JlIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTpcbiAgICB8IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVxuICAgIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHJlcXVpcmVzQXV0aGVudGljYXRpb246IGJvb2xlYW4gPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTb2NrZXRTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0O1xuICAgIHRoaXMucGF0aCA9IGNvbmZpZy5wYXRoIHx8IFwiL3dzXCI7XG4gICAgdGhpcy5tYXhDb25uZWN0aW9ucyA9IGNvbmZpZy5tYXhDb25uZWN0aW9ucyB8fCAxMDAwO1xuXG4gICAgdGhpcy5zZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoKTtcbiAgICB0aGlzLndzcyA9IG5ldyBTZXJ2ZXIoeyBub1NlcnZlcjogdHJ1ZSB9KTtcbiAgICB0aGlzLmF1dGhQcm92aWRlciA9IGNvbmZpZy5hdXRoUHJvdmlkZXI7XG4gICAgdGhpcy5zZXNzaW9uU3RvcmUgPSBjb25maWcuc2Vzc2lvblN0b3JlO1xuICAgIHRoaXMucmVxdWlyZXNBdXRoZW50aWNhdGlvbiA9IGNvbmZpZy5yZXF1aXJlc0F1dGhlbnRpY2F0aW9uIHx8IGZhbHNlO1xuICAgIGlmICh0aGlzLnJlcXVpcmVzQXV0aGVudGljYXRpb24gPT09IHRydWUpIHtcbiAgICAgIGlmICghdGhpcy5hdXRoUHJvdmlkZXIgfHwgIXRoaXMuc2Vzc2lvblN0b3JlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIGlzIHJlcXVpcmVkIGJ1dCBubyBhdXRoZW50aWNhdGlvbiBtaWRkbGV3YXJlIG9yIHNlc3Npb24gc3RvcmUgd2FzIHByb3ZpZGVkXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGF1dGhNaWRkbGV3YXJlID1cbiAgICAgICAgY29uZmlnLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB8fFxuICAgICAgICBuZXcgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlKFxuICAgICAgICAgIHRoaXMuYXV0aFByb3ZpZGVyLFxuICAgICAgICAgIHRoaXMuc2Vzc2lvblN0b3JlXG4gICAgICAgICk7XG4gICAgICB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSA9IGF1dGhNaWRkbGV3YXJlO1xuICAgIH1cbiAgICB0aGlzLnNldHVwV2ViU29ja2V0U2VydmVyKCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwV2ViU29ja2V0U2VydmVyKCkge1xuICAgIHRoaXMuc2VydmVyLm9uKFxuICAgICAgXCJ1cGdyYWRlXCIsXG4gICAgICBhc3luYyAocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLCBzb2NrZXQ6IER1cGxleCwgaGVhZDogQnVmZmVyKSA9PiB7XG4gICAgICAgIC8vIFByZXZlbnQgbWVtb3J5IGxlYWtzIGJ5IGhhbmRsaW5nIHNvY2tldCBlcnJvcnNcbiAgICAgICAgc29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycikgPT4ge1xuICAgICAgICAgIHRoaXMuZXJyb3IoXCJTb2NrZXQgZXJyb3I6XCIsIGVycik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHJlcXVlc3QudXJsICE9PSB0aGlzLnBhdGgpIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXCJIVFRQLzEuMSA0MDQgTm90IEZvdW5kXFxyXFxuXFxyXFxuXCIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSGFuZGxlIGF1dGhlbnRpY2F0aW9uIGJlZm9yZSB1cGdyYWRpbmcgdGhlIGNvbm5lY3Rpb25cbiAgICAgICAgaWYgKHRoaXMucmVxdWlyZXNBdXRoZW50aWNhdGlvbikge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBDcmVhdGUgYSB0ZW1wb3JhcnkgY29ubmVjdGlvbiBvYmplY3QgZm9yIGF1dGhlbnRpY2F0aW9uXG4gICAgICAgICAgICBjb25zdCB0ZW1wQ29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSEuYXV0aGVudGljYXRlQ29ubmVjdGlvbihcbiAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgdGVtcENvbm5lY3Rpb25cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIElmIGF1dGhlbnRpY2F0aW9uIHN1Y2NlZWRzLCBwcm9jZWVkIHdpdGggdGhlIHVwZ3JhZGVcbiAgICAgICAgICAgIHRoaXMudXBncmFkZUNvbm5lY3Rpb24ocmVxdWVzdCwgc29ja2V0LCBoZWFkLCB0ZW1wQ29ubmVjdGlvbik7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgICAgdGhpcy53YXJuKFwiQXV0aGVudGljYXRpb24gZXJyb3JcIiwgZXJyb3IpO1xuICAgICAgICAgICAgc29ja2V0LndyaXRlKFxuICAgICAgICAgICAgICBcIkhUVFAvMS4xIDQwMSBVbmF1dGhvcml6ZWRcXHJcXG5cIiArXG4gICAgICAgICAgICAgICAgXCJDb25uZWN0aW9uOiBjbG9zZVxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIkNvbnRlbnQtTGVuZ3RoOiAyMVxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpblxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIlxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIGZhaWxlZFxcclxcblwiXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBFbmQgdGhlIHNvY2tldCBhZnRlciB3cml0aW5nIHRoZSByZXNwb25zZVxuICAgICAgICAgICAgc29ja2V0LmVuZCgpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyBJZiBubyBhdXRoZW50aWNhdGlvbiByZXF1aXJlZCwgcHJvY2VlZCB3aXRoIHVwZ3JhZGUgZGlyZWN0bHlcbiAgICAgICAgICB0aGlzLnVwZ3JhZGVDb25uZWN0aW9uKHJlcXVlc3QsIHNvY2tldCwgaGVhZCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGdyYWRlQ29ubmVjdGlvbihcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UsXG4gICAgc29ja2V0OiBEdXBsZXgsXG4gICAgaGVhZDogQnVmZmVyLFxuICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uPzogV2Vic29ja2V0Q29ubmVjdGlvblxuICApIHtcbiAgICB0aGlzLndzcy5oYW5kbGVVcGdyYWRlKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgKHdzKSA9PiB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5zaXplID49IHRoaXMubWF4Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgd3MuY2xvc2UoMTAxMywgXCJNYXhpbXVtIG51bWJlciBvZiBjb25uZWN0aW9ucyByZWFjaGVkXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChhdXRoZW50aWNhdGVkQ29ubmVjdGlvbikge1xuICAgICAgICAvLyBTZXQgdGhlIFdlYlNvY2tldCBpbnN0YW5jZSBvbiB0aGUgZXhpc3RpbmcgY29ubmVjdGlvblxuICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5zZXRXZWJTb2NrZXQod3MpO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSxcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvblxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBjb25uZWN0aW9uIHdpdGggV2ViU29ja2V0IGluc3RhbmNlXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB0aGlzLmhhbmRsZUNsb3NlLmJpbmQodGhpcyksXG4gICAgICAgICAgdW5kZWZpbmVkLCAvLyBkZWZhdWx0IHRpbWVvdXRcbiAgICAgICAgICB1bmRlZmluZWQsIC8vIGRlZmF1bHQgcmF0ZSBsaW1pdFxuICAgICAgICAgIHRoaXMuaGFuZGxlV3NFdmVudHMoKSxcbiAgICAgICAgICB3c1xuICAgICAgICApO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLCBjb25uZWN0aW9uKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlV3NFdmVudHMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9uUmF0ZUxpbWl0OiAoY29ubmVjdGlvbklkOiBzdHJpbmcpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBSYXRlIGxpbWl0IGV4Y2VlZGVkIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfWApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiUmF0ZSBsaW1pdCBleGNlZWRlZFwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgb25FcnJvcjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCBlcnJvcjogRXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBFcnJvciBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGNvbm5lY3Rpb24gZXJyb3NcbiAgICAgIH0sXG4gICAgICBvblNlY3VyaXR5VmlvbGF0aW9uOiAoY29ubmVjdGlvbklkOiBzdHJpbmcsIHZpb2xhdGlvbjogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihcbiAgICAgICAgICBgU2VjdXJpdHkgdmlvbGF0aW9uIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfTogJHt2aW9sYXRpb259YFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiU2VjdXJpdHkgdmlvbGF0aW9uXCIpO1xuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaFNlc3Npb24oY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnJlcXVpcmVzQXV0aGVudGljYXRpb24pIHtcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVmcmVzaFNlc3Npb24odGhpcy5zZXNzaW9uU3RvcmUhKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZU1lc3NhZ2UoXG4gICAgZGF0YTogRGF0YSxcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb24pO1xuICAgICAgLy8gVE9ETzogaGFuZGxlIGV4cGlyZWQgc2Vzc2lvbnNcbiAgICAgIGNvbnN0IHN0ckRhdGEgPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBkZXRlY3Rpb25SZXN1bHQgPSBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShzdHJEYXRhKTtcbiAgICAgIGxldCByZXF1ZXN0VHlwZTogc3RyaW5nID0gXCJcIjtcblxuICAgICAgaWYgKFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJvYmplY3RcIlxuICAgICAgKSB7XG4gICAgICAgIHJlcXVlc3RUeXBlID0gXCJyYXdcIjtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PGFueT4oe1xuICAgICAgICAgIHRvOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogXCJyYXdcIixcbiAgICAgICAgICBib2R5OiBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVzcG9uc2VcIikge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXNwb25zZTxhbnk+O1xuICAgICAgICBhd2FpdCB0aGlzLnNlbmRPbmVXYXlNZXNzYWdlKFxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgICAgcmVzcG9uc2UuYm9keVxuICAgICAgICApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVxdWVzdFwiKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVxdWVzdDxhbnk+O1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgbm9uLWF1dGhlbnRpY2F0ZWQgUmVxdWVzdHNcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGF1dGhvcml6YXRpb25cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PGFueT4oe1xuICAgICAgICAgIHRvOiByZXF1ZXN0LmhlYWRlci5yZWNpcGllbnRBZGRyZXNzIHx8IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZSB8fCBcInVua25vd25cIixcbiAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICBjb25uZWN0aW9uSWQ6IGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksXG4gICAgICAgICAgICB0eXBlOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZSB8fCBcInVua25vd25cIixcbiAgICAgICAgICAgIGJvZHk6IHJlcXVlc3QuYm9keSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgIC4uLnJlcXVlc3QuaGVhZGVyLFxuICAgICAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGU6IGFzeW5jIChcbiAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgICAgICAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICAgICAgICAgICkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhdHVzVXBkYXRlID0gTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlc3BvbnNlKFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgICAgICBzdGF0dXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoc3RhdHVzVXBkYXRlKSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgV2ViU29ja2V0IG1lc3NhZ2VgLCBlcnJvcik7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnZhbGlkIG1lc3NhZ2UgZm9ybWF0XCIgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlQ2xvc2UoY29ubmVjdGlvbklkOiBzdHJpbmcpIHtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IGNvbm5lY3Rpb24gY2xvc2VkOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMuc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZvKGBXZWJTb2NrZXQgc2VydmVyIGxpc3RlbmluZyBvbiBwb3J0ICR7dGhpcy5wb3J0fWApO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdG9wRGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQ2xvc2UgYWxsIGFjdGl2ZSBjb25uZWN0aW9ucyBhbmQgd2FpdCBmb3IgdGhlbSB0byBjb21wbGV0ZVxuICAgICAgICB0aGlzLmluZm8oXCJDbG9zaW5nIGFsbCBhY3RpdmUgV2ViU29ja2V0IGNvbm5lY3Rpb25zLi4uXCIpO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgICBBcnJheS5mcm9tKHRoaXMuY29ubmVjdGlvbnMudmFsdWVzKCkpLm1hcCgoY29ubmVjdGlvbikgPT5cbiAgICAgICAgICAgIGNvbm5lY3Rpb24uY2xvc2UoMTAwMCwgXCJTZXJ2ZXIgc2h1dHRpbmcgZG93blwiKVxuICAgICAgICAgIClcbiAgICAgICAgKTtcblxuICAgICAgICAvLyBDbG9zZSB0aGUgV2ViU29ja2V0IHNlcnZlciBhbmQgSFRUUCBzZXJ2ZXJcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmVXc3MpID0+IHtcbiAgICAgICAgICB0aGlzLndzcy5jbG9zZSgoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnNlcnZlci5jbG9zZSgoKSA9PiB7XG4gICAgICAgICAgICAgIHRoaXMuaW5mbyhcIldlYlNvY2tldCBzZXJ2ZXIgc3RvcHBlZFwiKTtcbiAgICAgICAgICAgICAgcmVzb2x2ZVdzcygpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5lcnJvcihcIkVycm9yIGR1cmluZyBzaHV0ZG93bjpcIiwgZXJyb3IpO1xuICAgICAgICByZXNvbHZlKCk7IC8vIFN0aWxsIHJlc29sdmUgdG8gZW5zdXJlIHNodXRkb3duIGNvbXBsZXRlc1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlZmF1bHRNZXNzYWdlSGFuZGxlcihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiBQcm9taXNlPFdlYlNvY2tldFJlc3BvbnNlPiB7XG4gICAgdGhpcy53YXJuKFxuICAgICAgYFVuaGFuZGxlZCBXZWJTb2NrZXQgbWVzc2FnZSB0eXBlOiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgICByZXF1ZXN0XG4gICAgKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBlcnJvcjogYFwiVW5oYW5kbGVkIG1lc3NhZ2UgdHlwZVwiICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCxcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldENvbm5lY3Rpb25zKCk6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+IHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9ucztcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxzdHJpbmc+KFwicmF3XCIpXG4gIHByb3RlY3RlZCBhc3luYyByYXdNZXNzYWdlSGFuZGxlcihtZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRoaXMud2FybihgUmVjZWl2ZWQgcmF3IG1lc3NhZ2VgLCBtZXNzYWdlKTtcbiAgICByZXR1cm4gXCJFUlJPUjogUmF3IG1lc3NhZ2VzIG5vdCBzdXBwb3J0ZWQuIFBsZWFzZSB1c2UgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCI7XG4gIH1cblxuICBwdWJsaWMgYnJvYWRjYXN0KG1lc3NhZ2U6IElSZXF1ZXN0PFdlYlNvY2tldE1lc3NhZ2U+KTogdm9pZCB7XG4gICAgY29uc3QgbWVzc2FnZVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuICAgIHRoaXMuY29ubmVjdGlvbnMuZm9yRWFjaCgoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKG1lc3NhZ2VTdHJpbmcpO1xuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHNlbmRUb0Nvbm5lY3Rpb24oXG4gICAgY29ubmVjdGlvbklkOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogSVJlc3BvbnNlPFdlYlNvY2tldE1lc3NhZ2U+XG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkobWVzc2FnZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYENvbm5lY3Rpb24gbm90IGZvdW5kOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRTZXNzaW9uQnlJZChzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8SVNlc3Npb25EYXRhIHwgbnVsbD4ge1xuICAgIHJldHVybiB0aGlzLnNlc3Npb25TdG9yZSA/IHRoaXMuc2Vzc2lvblN0b3JlLmdldChzZXNzaW9uSWQpIDogbnVsbDtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShtZXNzYWdlOiBzdHJpbmcpOiBEZXRlY3Rpb25SZXN1bHQ8dW5rbm93bj4ge1xuICAvLyBGaXJzdCwgY2hlY2sgaWYgdGhlIG1lc3NhZ2UgaXMgbGlrZWx5IEpTT04gb3IgYSBKYXZhU2NyaXB0LWxpa2Ugb2JqZWN0XG4gIGlmIChtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwie1wiKSB8fCBtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwiW1wiKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG1lc3NhZ2UpO1xuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVxdWVzdFxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcImhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5oZWFkZXIgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJ0aW1lc3RhbXBcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdElkXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RlckFkZHJlc3NcIiBpbiBwYXJzZWQuaGVhZGVyXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVxdWVzdFwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVxdWVzdDx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlc3BvbnNlXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwicmVxdWVzdEhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmJvZHkgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJkYXRhXCIgaW4gcGFyc2VkLmJvZHkgJiZcbiAgICAgICAgXCJzdWNjZXNzXCIgaW4gcGFyc2VkLmJvZHkgJiZcbiAgICAgICAgXCJlcnJvclwiIGluIHBhcnNlZC5ib2R5XG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVzcG9uc2VcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlc3BvbnNlPHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBpdCdzIGEgcGFyc2VkIG9iamVjdCBidXQgbm90IElSZXF1ZXN0IG9yIElSZXNwb25zZVxuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwib2JqZWN0XCIsIHBheWxvYWQ6IHBhcnNlZCB9O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJZiBwYXJzaW5nIGZhaWxzLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgaXQgZG9lc24ndCBsb29rIGxpa2UgSlNPTiwgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICB9XG59XG4iXX0=