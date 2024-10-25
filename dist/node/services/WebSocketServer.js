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
            // Parse the URL to get just the pathname
            const url = new URL(request.url, `http://${request.headers.host}`);
            if (url.pathname !== this.path) {
                socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
                socket.destroy();
                this.warn(`Invalid path: ${request.url}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBSTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBMkJ4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBY0MsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFaakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVMxRCwyQkFBc0IsR0FBWSxLQUFLLENBQUM7UUFJOUMsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDO1FBQ3hCLElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksSUFBSSxLQUFLLENBQUM7UUFDakMsSUFBSSxDQUFDLGNBQWMsR0FBRyxNQUFNLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQztRQUVwRCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsbUJBQVksR0FBRSxDQUFDO1FBQzdCLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxXQUFNLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUM7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO1FBQ3hDLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxNQUFNLENBQUMsc0JBQXNCLElBQUksS0FBSyxDQUFDO1FBQ3JFLElBQUksSUFBSSxDQUFDLHNCQUFzQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3pDLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFB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QVcsSUFBSSxNQUFNLENBQUMsTUFBTTtnQkFDNUIsa0JBQWtCLElBQUksTUFBTSxDQUFDLE1BQU0sRUFDbkMsQ0FBQztnQkFDRCxPQUFPO29CQUNMLFdBQVcsRUFBRSxVQUFVO29CQUN2QixPQUFPLEVBQUUsTUFBMkI7aUJBQ3JDLENBQUM7WUFDSixDQUFDO1lBRUQsb0NBQW9DO1lBQ3BDLElBQ0UsT0FBTyxNQUFNLEtBQUssUUFBUTtnQkFDMUIsTUFBTSxLQUFLLElBQUk7Z0JBQ2YsZUFBZSxJQUFJLE1BQU07Z0JBQ3pCLGdCQUFnQixJQUFJLE1BQU07Z0JBQzFCLE1BQU0sSUFBSSxNQUFNO2dCQUNoQixPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssUUFBUTtnQkFDL0IsTUFBTSxJQUFJLE1BQU0sQ0FBQyxJQUFJO2dCQUNyQixTQUFTLElBQUksTUFBTSxDQUFDLElBQUk7Z0JBQ3hCLE9BQU8sSUFBSSxNQUFNLENBQUMsSUFBSSxFQUN0QixDQUFDO2dCQUNELE9BQU87b0JBQ0wsV0FBVyxFQUFFLFdBQVc7b0JBQ3hCLE9BQU8sRUFBRSxNQUE0QjtpQkFDdEMsQ0FBQztZQUNKLENBQUM7WUFFRCx3REFBd0Q7WUFDeEQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDO1FBQ3BELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YseUNBQXlDO1lBQ3pDLE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztRQUNyRCxDQUFDO0lBQ0gsQ0FBQztTQUFNLENBQUM7UUFDTixxREFBcUQ7UUFDckQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO0lBQ3JELENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmVyLCBEYXRhIH0gZnJvbSBcIndzXCI7XG5pbXBvcnQgeyBjcmVhdGVTZXJ2ZXIsIFNlcnZlciBhcyBIdHRwU2VydmVyLCBJbmNvbWluZ01lc3NhZ2UgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHsgRHVwbGV4IH0gZnJvbSBcInN0cmVhbVwiO1xuaW1wb3J0IHsgSVNlc3Npb25EYXRhIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuaW1wb3J0IHtcbiAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLFxuICBJU2VydmVyQ29uZmlnLFxuICBTdGF0dXNVcGRhdGUsXG4gIFJlcXVlc3RIYW5kbGVyLFxufSBmcm9tIFwiLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5pbXBvcnQge1xuICBJQmFja0VuZCxcbiAgSVJlcXVlc3QsXG4gIElSZXNwb25zZSxcbiAgSVNlc3Npb25TdG9yZSxcbiAgSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBXZWJzb2NrZXRDb25uZWN0aW9uIH0gZnJvbSBcIi4vV2Vic29ja2V0Q29ubmVjdGlvblwiO1xuaW1wb3J0IHsgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlIH0gZnJvbSBcIi4vV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlXCI7XG5cbnR5cGUgUGF5bG9hZFR5cGUgPSBcIm9iamVjdFwiIHwgXCJzdHJpbmdcIiB8IFwiSVJlcXVlc3RcIiB8IFwiSVJlc3BvbnNlXCI7XG5cbmludGVyZmFjZSBEZXRlY3Rpb25SZXN1bHQ8VD4ge1xuICBwYXlsb2FkVHlwZTogUGF5bG9hZFR5cGU7XG4gIHBheWxvYWQ6IFQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0U2VydmVyQ29uZmlnIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIHBvcnQ6IG51bWJlcjtcbiAgcGF0aD86IHN0cmluZztcbiAgbWF4Q29ubmVjdGlvbnM/OiBudW1iZXI7XG4gIHJlcXVpcmVzQXV0aGVudGljYXRpb24/OiBib29sZWFuO1xuICBhdXRoUHJvdmlkZXI/OiBJQXV0aGVudGljYXRpb25Qcm92aWRlcjtcbiAgc2Vzc2lvblN0b3JlPzogSVNlc3Npb25TdG9yZTtcbiAgYXV0aGVudGljYXRpb25NaWRkbGV3YXJlPzogV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRNZXNzYWdlID0ge1xuICB0eXBlOiBzdHJpbmc7XG4gIGRhdGE6IGFueTtcbiAgY29ubmVjdGlvbklkOiBzdHJpbmc7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFJlc3BvbnNlIHt9XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRTZXJ2ZXIgZXh0ZW5kcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFdlYlNvY2tldE1lc3NhZ2UsXG4gIFdlYlNvY2tldFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IEh0dHBTZXJ2ZXI7XG4gIHByaXZhdGUgd3NzOiBTZXJ2ZXI7XG4gIHByaXZhdGUgY29ubmVjdGlvbnM6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBwYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgbWF4Q29ubmVjdGlvbnM6IG51bWJlcjtcbiAgcHJpdmF0ZSBhdXRoUHJvdmlkZXI6IElBdXRoZW50aWNhdGlvblByb3ZpZGVyIHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHNlc3Npb25TdG9yZTogSVNlc3Npb25TdG9yZSB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU6XG4gICAgfCBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmVcbiAgICB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSByZXF1aXJlc0F1dGhlbnRpY2F0aW9uOiBib29sZWFuID0gZmFsc2U7XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogV2ViU29ja2V0U2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcbiAgICB0aGlzLnBvcnQgPSBjb25maWcucG9ydDtcbiAgICB0aGlzLnBhdGggPSBjb25maWcucGF0aCB8fCBcIi93c1wiO1xuICAgIHRoaXMubWF4Q29ubmVjdGlvbnMgPSBjb25maWcubWF4Q29ubmVjdGlvbnMgfHwgMTAwMDtcblxuICAgIHRoaXMuc2VydmVyID0gY3JlYXRlU2VydmVyKCk7XG4gICAgdGhpcy53c3MgPSBuZXcgU2VydmVyKHsgbm9TZXJ2ZXI6IHRydWUgfSk7XG4gICAgdGhpcy5hdXRoUHJvdmlkZXIgPSBjb25maWcuYXV0aFByb3ZpZGVyO1xuICAgIHRoaXMuc2Vzc2lvblN0b3JlID0gY29uZmlnLnNlc3Npb25TdG9yZTtcbiAgICB0aGlzLnJlcXVpcmVzQXV0aGVudGljYXRpb24gPSBjb25maWcucmVxdWlyZXNBdXRoZW50aWNhdGlvbiB8fCBmYWxzZTtcbiAgICBpZiAodGhpcy5yZXF1aXJlc0F1dGhlbnRpY2F0aW9uID09PSB0cnVlKSB7XG4gICAgICBpZiAoIXRoaXMuYXV0aFByb3ZpZGVyIHx8ICF0aGlzLnNlc3Npb25TdG9yZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZCBidXQgbm8gYXV0aGVudGljYXRpb24gbWlkZGxld2FyZSBvciBzZXNzaW9uIHN0b3JlIHdhcyBwcm92aWRlZFwiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBjb25zdCBhdXRoTWlkZGxld2FyZSA9XG4gICAgICAgIGNvbmZpZy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfHxcbiAgICAgICAgbmV3IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZShcbiAgICAgICAgICB0aGlzLmF1dGhQcm92aWRlcixcbiAgICAgICAgICB0aGlzLnNlc3Npb25TdG9yZVxuICAgICAgICApO1xuICAgICAgdGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgPSBhdXRoTWlkZGxld2FyZTtcbiAgICB9XG4gICAgdGhpcy5zZXR1cFdlYlNvY2tldFNlcnZlcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cFdlYlNvY2tldFNlcnZlcigpIHtcbiAgICB0aGlzLnNlcnZlci5vbihcbiAgICAgIFwidXBncmFkZVwiLFxuICAgICAgYXN5bmMgKHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSwgc29ja2V0OiBEdXBsZXgsIGhlYWQ6IEJ1ZmZlcikgPT4ge1xuICAgICAgICAvLyBQcmV2ZW50IG1lbW9yeSBsZWFrcyBieSBoYW5kbGluZyBzb2NrZXQgZXJyb3JzXG4gICAgICAgIHNvY2tldC5vbihcImVycm9yXCIsIChlcnIpID0+IHtcbiAgICAgICAgICB0aGlzLmVycm9yKFwiU29ja2V0IGVycm9yOlwiLCBlcnIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFBhcnNlIHRoZSBVUkwgdG8gZ2V0IGp1c3QgdGhlIHBhdGhuYW1lXG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG5cbiAgICAgICAgaWYgKHVybC5wYXRobmFtZSAhPT0gdGhpcy5wYXRoKSB7XG4gICAgICAgICAgc29ja2V0LndyaXRlKFwiSFRUUC8xLjEgNDA0IE5vdCBGb3VuZFxcclxcblxcclxcblwiKTtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICAgIHRoaXMud2FybihgSW52YWxpZCBwYXRoOiAke3JlcXVlc3QudXJsfWApO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSBhdXRoZW50aWNhdGlvbiBiZWZvcmUgdXBncmFkaW5nIHRoZSBjb25uZWN0aW9uXG4gICAgICAgIGlmICh0aGlzLnJlcXVpcmVzQXV0aGVudGljYXRpb24pIHtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gQ3JlYXRlIGEgdGVtcG9yYXJ5IGNvbm5lY3Rpb24gb2JqZWN0IGZvciBhdXRoZW50aWNhdGlvblxuICAgICAgICAgICAgY29uc3QgdGVtcENvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgYXdhaXQgdGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUhLmF1dGhlbnRpY2F0ZUNvbm5lY3Rpb24oXG4gICAgICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICAgICAgIHRlbXBDb25uZWN0aW9uXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICAvLyBJZiBhdXRoZW50aWNhdGlvbiBzdWNjZWVkcywgcHJvY2VlZCB3aXRoIHRoZSB1cGdyYWRlXG4gICAgICAgICAgICB0aGlzLnVwZ3JhZGVDb25uZWN0aW9uKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgdGVtcENvbm5lY3Rpb24pO1xuICAgICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICAgIHRoaXMud2FybihcIkF1dGhlbnRpY2F0aW9uIGVycm9yXCIsIGVycm9yKTtcbiAgICAgICAgICAgIHNvY2tldC53cml0ZShcbiAgICAgICAgICAgICAgXCJIVFRQLzEuMSA0MDEgVW5hdXRob3JpemVkXFxyXFxuXCIgK1xuICAgICAgICAgICAgICAgIFwiQ29ubmVjdGlvbjogY2xvc2VcXHJcXG5cIiArXG4gICAgICAgICAgICAgICAgXCJDb250ZW50LUxlbmd0aDogMjFcXHJcXG5cIiArXG4gICAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW5cXHJcXG5cIiArXG4gICAgICAgICAgICAgICAgXCJcXHJcXG5cIiArXG4gICAgICAgICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBmYWlsZWRcXHJcXG5cIlxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gRW5kIHRoZSBzb2NrZXQgYWZ0ZXIgd3JpdGluZyB0aGUgcmVzcG9uc2VcbiAgICAgICAgICAgIHNvY2tldC5lbmQoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gSWYgbm8gYXV0aGVudGljYXRpb24gcmVxdWlyZWQsIHByb2NlZWQgd2l0aCB1cGdyYWRlIGRpcmVjdGx5XG4gICAgICAgICAgdGhpcy51cGdyYWRlQ29ubmVjdGlvbihyZXF1ZXN0LCBzb2NrZXQsIGhlYWQpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBncmFkZUNvbm5lY3Rpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLFxuICAgIHNvY2tldDogRHVwbGV4LFxuICAgIGhlYWQ6IEJ1ZmZlcixcbiAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbj86IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKSB7XG4gICAgdGhpcy53c3MuaGFuZGxlVXBncmFkZShyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsICh3cykgPT4ge1xuICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbnMuc2l6ZSA+PSB0aGlzLm1heENvbm5lY3Rpb25zKSB7XG4gICAgICAgIHdzLmNsb3NlKDEwMTMsIFwiTWF4aW11bSBudW1iZXIgb2YgY29ubmVjdGlvbnMgcmVhY2hlZFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXV0aGVudGljYXRlZENvbm5lY3Rpb24pIHtcbiAgICAgICAgLy8gU2V0IHRoZSBXZWJTb2NrZXQgaW5zdGFuY2Ugb24gdGhlIGV4aXN0aW5nIGNvbm5lY3Rpb25cbiAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uc2V0V2ViU29ja2V0KHdzKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb25cbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENyZWF0ZSBuZXcgY29ubmVjdGlvbiB3aXRoIFdlYlNvY2tldCBpbnN0YW5jZVxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHVuZGVmaW5lZCwgLy8gZGVmYXVsdCB0aW1lb3V0XG4gICAgICAgICAgdW5kZWZpbmVkLCAvLyBkZWZhdWx0IHJhdGUgbGltaXRcbiAgICAgICAgICB0aGlzLmhhbmRsZVdzRXZlbnRzKCksXG4gICAgICAgICAgd3NcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVdzRXZlbnRzKCkge1xuICAgIHJldHVybiB7XG4gICAgICBvblJhdGVMaW1pdDogKGNvbm5lY3Rpb25JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgUmF0ZSBsaW1pdCBleGNlZWRlZCBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlJhdGUgbGltaXQgZXhjZWVkZWRcIik7XG4gICAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uRXJyb3I6IChjb25uZWN0aW9uSWQ6IHN0cmluZywgZXJyb3I6IEVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgRXJyb3IgZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBjb25uZWN0aW9uIGVycm9zXG4gICAgICB9LFxuICAgICAgb25TZWN1cml0eVZpb2xhdGlvbjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCB2aW9sYXRpb246IHN0cmluZykgPT4ge1xuICAgICAgICB0aGlzLndhcm4oXG4gICAgICAgICAgYFNlY3VyaXR5IHZpb2xhdGlvbiBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7dmlvbGF0aW9ufWBcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlNlY3VyaXR5IHZpb2xhdGlvblwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5yZXF1aXJlc0F1dGhlbnRpY2F0aW9uKSB7XG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnJlZnJlc2hTZXNzaW9uKHRoaXMuc2Vzc2lvblN0b3JlISk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKFxuICAgIGRhdGE6IERhdGEsXG4gICAgY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvblxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yZWZyZXNoU2Vzc2lvbihjb25uZWN0aW9uKTtcbiAgICAgIC8vIFRPRE86IGhhbmRsZSBleHBpcmVkIHNlc3Npb25zXG4gICAgICBjb25zdCBzdHJEYXRhID0gZGF0YS50b1N0cmluZygpO1xuICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2Uoc3RyRGF0YSk7XG4gICAgICBsZXQgcmVxdWVzdFR5cGU6IHN0cmluZyA9IFwiXCI7XG5cbiAgICAgIGlmIChcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwib2JqZWN0XCJcbiAgICAgICkge1xuICAgICAgICByZXF1ZXN0VHlwZSA9IFwicmF3XCI7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IFwicmF3XCIsXG4gICAgICAgICAgYm9keTogZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlc3BvbnNlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVzcG9uc2U8YW55PjtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXG4gICAgICAgICAgcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgIHJlc3BvbnNlLmJvZHlcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlcXVlc3RcIikge1xuICAgICAgICBjb25zdCByZXF1ZXN0ID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlcXVlc3Q8YW55PjtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIG5vbi1hdXRoZW50aWNhdGVkIFJlcXVlc3RzXG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBhdXRob3JpemF0aW9uXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgY29ubmVjdGlvbklkOiBjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgICAgdHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgICBib2R5OiByZXF1ZXN0LmJvZHksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBjb25uZWN0aW9uLmdldFNlc3Npb25JZCgpLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOiBhc3luYyAoXG4gICAgICAgICAgICB1cGRhdGVSZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgICAgICAgICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgICAgICAgICApID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c1VwZGF0ZSA9IE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXNwb25zZShcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdCxcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICAgICAgc3RhdHVzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHN0YXR1c1VwZGF0ZSkpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFdlYlNvY2tldCBtZXNzYWdlYCwgZXJyb3IpO1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiSW52YWxpZCBtZXNzYWdlIGZvcm1hdFwiIH0pKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUNsb3NlKGNvbm5lY3Rpb25JZDogc3RyaW5nKSB7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoYXN5bmMgKHJlc29sdmUpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIENsb3NlIGFsbCBhY3RpdmUgY29ubmVjdGlvbnMgYW5kIHdhaXQgZm9yIHRoZW0gdG8gY29tcGxldGVcbiAgICAgICAgdGhpcy5pbmZvKFwiQ2xvc2luZyBhbGwgYWN0aXZlIFdlYlNvY2tldCBjb25uZWN0aW9ucy4uLlwiKTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmNvbm5lY3Rpb25zLnZhbHVlcygpKS5tYXAoKGNvbm5lY3Rpb24pID0+XG4gICAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIilcbiAgICAgICAgICApXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gQ2xvc2UgdGhlIFdlYlNvY2tldCBzZXJ2ZXIgYW5kIEhUVFAgc2VydmVyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlV3NzKSA9PiB7XG4gICAgICAgICAgdGhpcy53c3MuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgICAgIHJlc29sdmVXc3MoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHRoaXMuZXJyb3IoXCJFcnJvciBkdXJpbmcgc2h1dGRvd246XCIsIGVycm9yKTtcbiAgICAgICAgcmVzb2x2ZSgpOyAvLyBTdGlsbCByZXNvbHZlIHRvIGVuc3VyZSBzaHV0ZG93biBjb21wbGV0ZXNcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb25uZWN0aW9ucygpOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnM7XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXI8c3RyaW5nPihcInJhd1wiKVxuICBwcm90ZWN0ZWQgYXN5bmMgcmF3TWVzc2FnZUhhbmRsZXIobWVzc2FnZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJhdyBtZXNzYWdlYCwgbWVzc2FnZSk7XG4gICAgcmV0dXJuIFwiRVJST1I6IFJhdyBtZXNzYWdlcyBub3Qgc3VwcG9ydGVkLiBQbGVhc2UgdXNlIENvbW11bmljYXRpb25zTWFuYWdlclwiO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPik6IHZvaWQge1xuICAgIGNvbnN0IG1lc3NhZ2VTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmZvckVhY2goKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlU3RyaW5nKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzZW5kVG9Db25uZWN0aW9uKFxuICAgIGNvbm5lY3Rpb25JZDogc3RyaW5nLFxuICAgIG1lc3NhZ2U6IElSZXNwb25zZTxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBDb25uZWN0aW9uIG5vdCBmb3VuZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0U2Vzc2lvbkJ5SWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPElTZXNzaW9uRGF0YSB8IG51bGw+IHtcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9uU3RvcmUgPyB0aGlzLnNlc3Npb25TdG9yZS5nZXQoc2Vzc2lvbklkKSA6IG51bGw7XG4gIH1cbn1cblxuZnVuY3Rpb24gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2UobWVzc2FnZTogc3RyaW5nKTogRGV0ZWN0aW9uUmVzdWx0PHVua25vd24+IHtcbiAgLy8gRmlyc3QsIGNoZWNrIGlmIHRoZSBtZXNzYWdlIGlzIGxpa2VseSBKU09OIG9yIGEgSmF2YVNjcmlwdC1saWtlIG9iamVjdFxuICBpZiAobWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIntcIikgfHwgbWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIltcIikpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShtZXNzYWdlKTtcblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlcXVlc3RcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJoZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuaGVhZGVyID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwidGltZXN0YW1wXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RJZFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0ZXJBZGRyZXNzXCIgaW4gcGFyc2VkLmhlYWRlclxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlcXVlc3RcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlcXVlc3Q8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXNwb25zZVxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcInJlcXVlc3RIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJyZXNwb25zZUhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5ib2R5ID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwiZGF0YVwiIGluIHBhcnNlZC5ib2R5ICYmXG4gICAgICAgIFwic3VjY2Vzc1wiIGluIHBhcnNlZC5ib2R5ICYmXG4gICAgICAgIFwiZXJyb3JcIiBpbiBwYXJzZWQuYm9keVxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlc3BvbnNlXCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXNwb25zZTx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgaXQncyBhIHBhcnNlZCBvYmplY3QgYnV0IG5vdCBJUmVxdWVzdCBvciBJUmVzcG9uc2VcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcIm9iamVjdFwiLCBwYXlsb2FkOiBwYXJzZWQgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gSWYgcGFyc2luZyBmYWlscywgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIElmIGl0IGRvZXNuJ3QgbG9vayBsaWtlIEpTT04sIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgfVxufVxuIl19