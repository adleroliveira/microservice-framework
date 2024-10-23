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
                        sessionId: connection.getSessionId()
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
                await Promise.all(Array.from(this.connections.values()).map(connection => connection.close(1000, "Server shutting down")));
                // Close the WebSocket server and HTTP server
                await new Promise(resolveWss => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBSTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBMkJ4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBY0MsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFaakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVMxRCwyQkFBc0IsR0FBWSxLQUFLLENBQUM7UUFJOUMsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxDQUFDO1FBQ3hCLElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksSUFBSSxLQUFLLENBQUM7UUFDakMsSUFBSSxDQUFDLGNBQWMsR0FBRyxNQUFNLENBQUMsY0FBYyxJQUFJLElBQUksQ0FBQztRQUVwRCxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsbUJBQVksR0FBRSxDQUFDO1FBQzdCLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxXQUFNLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxZQUFZLENBQUM7UUFDeEMsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUMsWUFBWSxDQUFDO1FBQ3hDLElBQUksQ0FBQyxzQkFBc0IsR0FBRyxNQUFNLENBQUMsc0JBQXNCLElBQUksS0FBSyxDQUFDO1FBQ3JFLElBQUksSUFBSSxDQUFDLHNCQUFzQixLQUFLLElBQUksRUFBRSxDQUFDO1lBQ3pDLElBQUksQ0FBQyxJQUFJLENBQUMsWUFBWSxJQUFJLENBQUMsSUFB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QUVELG9DQUFvQztZQUNwQyxJQUNFLE9BQU8sTUFBTSxLQUFLLFFBQVE7Z0JBQzFCLE1BQU0sS0FBSyxJQUFJO2dCQUNmLGVBQWUsSUFBSSxNQUFNO2dCQUN6QixnQkFBZ0IsSUFBSSxNQUFNO2dCQUMxQixNQUFNLElBQUksTUFBTTtnQkFDaEIsT0FBTyxNQUFNLENBQUMsSUFBSSxLQUFLLFFBQVE7Z0JBQy9CLE1BQU0sSUFBSSxNQUFNLENBQUMsSUFBSTtnQkFDckIsU0FBUyxJQUFJLE1BQU0sQ0FBQyxJQUFJO2dCQUN4QixPQUFPLElBQUksTUFBTSxDQUFDLElBQUksRUFDdEIsQ0FBQztnQkFDRCxPQUFPO29CQUNMLFdBQVcsRUFBRSxXQUFXO29CQUN4QixPQUFPLEVBQUUsTUFBNEI7aUJBQ3RDLENBQUM7WUFDSixDQUFDO1lBRUQsd0RBQXdEO1lBQ3hELE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQztRQUNwRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLHlDQUF5QztZQUN6QyxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7UUFDckQsQ0FBQztJQUNILENBQUM7U0FBTSxDQUFDO1FBQ04scURBQXFEO1FBQ3JELE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztJQUNyRCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNlcnZlciwgRGF0YSB9IGZyb20gXCJ3c1wiO1xuaW1wb3J0IHsgY3JlYXRlU2VydmVyLCBTZXJ2ZXIgYXMgSHR0cFNlcnZlciwgSW5jb21pbmdNZXNzYWdlIH0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB7IER1cGxleCB9IGZyb20gXCJzdHJlYW1cIjtcbmltcG9ydCB7IElTZXNzaW9uRGF0YSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cbmltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbiAgU3RhdHVzVXBkYXRlLFxuICBSZXF1ZXN0SGFuZGxlcixcbn0gZnJvbSBcIi4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHtcbiAgSUJhY2tFbmQsXG4gIElSZXF1ZXN0LFxuICBJUmVzcG9uc2UsXG4gIElTZXNzaW9uU3RvcmUsXG4gIElBdXRoZW50aWNhdGlvblByb3ZpZGVyLFxufSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgV2Vic29ja2V0Q29ubmVjdGlvbiB9IGZyb20gXCIuL1dlYnNvY2tldENvbm5lY3Rpb25cIjtcbmltcG9ydCB7IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB9IGZyb20gXCIuL1dlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVwiO1xuXG50eXBlIFBheWxvYWRUeXBlID0gXCJvYmplY3RcIiB8IFwic3RyaW5nXCIgfCBcIklSZXF1ZXN0XCIgfCBcIklSZXNwb25zZVwiO1xuXG5pbnRlcmZhY2UgRGV0ZWN0aW9uUmVzdWx0PFQ+IHtcbiAgcGF5bG9hZFR5cGU6IFBheWxvYWRUeXBlO1xuICBwYXlsb2FkOiBUO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFNlcnZlckNvbmZpZyBleHRlbmRzIElTZXJ2ZXJDb25maWcge1xuICBwb3J0OiBudW1iZXI7XG4gIHBhdGg/OiBzdHJpbmc7XG4gIG1heENvbm5lY3Rpb25zPzogbnVtYmVyO1xuICByZXF1aXJlc0F1dGhlbnRpY2F0aW9uPzogYm9vbGVhbjtcbiAgYXV0aFByb3ZpZGVyPzogSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXI7XG4gIHNlc3Npb25TdG9yZT86IElTZXNzaW9uU3RvcmU7XG4gIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZT86IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTtcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0TWVzc2FnZSA9IHtcbiAgdHlwZTogc3RyaW5nO1xuICBkYXRhOiBhbnk7XG4gIGNvbm5lY3Rpb25JZDogc3RyaW5nO1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRSZXNwb25zZSB7fVxuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0U2VydmVyIGV4dGVuZHMgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBXZWJTb2NrZXRNZXNzYWdlLFxuICBXZWJTb2NrZXRSZXNwb25zZVxuPiB7XG4gIHByaXZhdGUgc2VydmVyOiBIdHRwU2VydmVyO1xuICBwcml2YXRlIHdzczogU2VydmVyO1xuICBwcml2YXRlIGNvbm5lY3Rpb25zOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gIHByaXZhdGUgcGF0aDogc3RyaW5nO1xuICBwcml2YXRlIG1heENvbm5lY3Rpb25zOiBudW1iZXI7XG4gIHByaXZhdGUgYXV0aFByb3ZpZGVyOiBJQXV0aGVudGljYXRpb25Qcm92aWRlciB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBzZXNzaW9uU3RvcmU6IElTZXNzaW9uU3RvcmUgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgYXV0aGVudGljYXRpb25NaWRkbGV3YXJlOlxuICAgIHwgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlXG4gICAgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgcmVxdWlyZXNBdXRoZW50aWNhdGlvbjogYm9vbGVhbiA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQ6IElCYWNrRW5kLCBjb25maWc6IFdlYlNvY2tldFNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKGJhY2tlbmQsIGNvbmZpZyk7XG4gICAgdGhpcy5wb3J0ID0gY29uZmlnLnBvcnQ7XG4gICAgdGhpcy5wYXRoID0gY29uZmlnLnBhdGggfHwgXCIvd3NcIjtcbiAgICB0aGlzLm1heENvbm5lY3Rpb25zID0gY29uZmlnLm1heENvbm5lY3Rpb25zIHx8IDEwMDA7XG5cbiAgICB0aGlzLnNlcnZlciA9IGNyZWF0ZVNlcnZlcigpO1xuICAgIHRoaXMud3NzID0gbmV3IFNlcnZlcih7IG5vU2VydmVyOiB0cnVlIH0pO1xuICAgIHRoaXMuYXV0aFByb3ZpZGVyID0gY29uZmlnLmF1dGhQcm92aWRlcjtcbiAgICB0aGlzLnNlc3Npb25TdG9yZSA9IGNvbmZpZy5zZXNzaW9uU3RvcmU7XG4gICAgdGhpcy5yZXF1aXJlc0F1dGhlbnRpY2F0aW9uID0gY29uZmlnLnJlcXVpcmVzQXV0aGVudGljYXRpb24gfHwgZmFsc2U7XG4gICAgaWYgKHRoaXMucmVxdWlyZXNBdXRoZW50aWNhdGlvbiA9PT0gdHJ1ZSkge1xuICAgICAgaWYgKCF0aGlzLmF1dGhQcm92aWRlciB8fCAhdGhpcy5zZXNzaW9uU3RvcmUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gaXMgcmVxdWlyZWQgYnV0IG5vIGF1dGhlbnRpY2F0aW9uIG1pZGRsZXdhcmUgb3Igc2Vzc2lvbiBzdG9yZSB3YXMgcHJvdmlkZWRcIlxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgY29uc3QgYXV0aE1pZGRsZXdhcmUgPVxuICAgICAgICBjb25maWcuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlIHx8XG4gICAgICAgIG5ldyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUoXG4gICAgICAgICAgdGhpcy5hdXRoUHJvdmlkZXIsXG4gICAgICAgICAgdGhpcy5zZXNzaW9uU3RvcmVcbiAgICAgICAgKTtcbiAgICAgIHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlID0gYXV0aE1pZGRsZXdhcmU7XG4gICAgfVxuICAgIHRoaXMuc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKSB7XG4gICAgdGhpcy5zZXJ2ZXIub24oXG4gICAgICBcInVwZ3JhZGVcIixcbiAgICAgIGFzeW5jIChyZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UsIHNvY2tldDogRHVwbGV4LCBoZWFkOiBCdWZmZXIpID0+IHtcbiAgICAgICAgLy8gUHJldmVudCBtZW1vcnkgbGVha3MgYnkgaGFuZGxpbmcgc29ja2V0IGVycm9yc1xuICAgICAgICBzb2NrZXQub24oXCJlcnJvclwiLCAoZXJyKSA9PiB7XG4gICAgICAgICAgdGhpcy5lcnJvcihcIlNvY2tldCBlcnJvcjpcIiwgZXJyKTtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICBpZiAocmVxdWVzdC51cmwgIT09IHRoaXMucGF0aCkge1xuICAgICAgICAgIHNvY2tldC53cml0ZShcIkhUVFAvMS4xIDQwNCBOb3QgRm91bmRcXHJcXG5cXHJcXG5cIik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgYXV0aGVudGljYXRpb24gYmVmb3JlIHVwZ3JhZGluZyB0aGUgY29ubmVjdGlvblxuICAgICAgICBpZiAodGhpcy5yZXF1aXJlc0F1dGhlbnRpY2F0aW9uKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIENyZWF0ZSBhIHRlbXBvcmFyeSBjb25uZWN0aW9uIG9iamVjdCBmb3IgYXV0aGVudGljYXRpb25cbiAgICAgICAgICAgIGNvbnN0IHRlbXBDb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICAgICAgICB0aGlzLmhhbmRsZUNsb3NlLmJpbmQodGhpcylcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlIS5hdXRoZW50aWNhdGVDb25uZWN0aW9uKFxuICAgICAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgICAgICB0ZW1wQ29ubmVjdGlvblxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gSWYgYXV0aGVudGljYXRpb24gc3VjY2VlZHMsIHByb2NlZWQgd2l0aCB0aGUgdXBncmFkZVxuICAgICAgICAgICAgdGhpcy51cGdyYWRlQ29ubmVjdGlvbihyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsIHRlbXBDb25uZWN0aW9uKTtcbiAgICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgICB0aGlzLndhcm4oXCJBdXRoZW50aWNhdGlvbiBlcnJvclwiLCBlcnJvcik7XG4gICAgICAgICAgICBzb2NrZXQud3JpdGUoXG4gICAgICAgICAgICAgIFwiSFRUUC8xLjEgNDAxIFVuYXV0aG9yaXplZFxcclxcblwiICtcbiAgICAgICAgICAgICAgICBcIkNvbm5lY3Rpb246IGNsb3NlXFxyXFxuXCIgK1xuICAgICAgICAgICAgICAgIFwiQ29udGVudC1MZW5ndGg6IDIxXFxyXFxuXCIgK1xuICAgICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluXFxyXFxuXCIgK1xuICAgICAgICAgICAgICAgIFwiXFxyXFxuXCIgK1xuICAgICAgICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gZmFpbGVkXFxyXFxuXCJcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIC8vIEVuZCB0aGUgc29ja2V0IGFmdGVyIHdyaXRpbmcgdGhlIHJlc3BvbnNlXG4gICAgICAgICAgICBzb2NrZXQuZW5kKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIElmIG5vIGF1dGhlbnRpY2F0aW9uIHJlcXVpcmVkLCBwcm9jZWVkIHdpdGggdXBncmFkZSBkaXJlY3RseVxuICAgICAgICAgIHRoaXMudXBncmFkZUNvbm5lY3Rpb24ocmVxdWVzdCwgc29ja2V0LCBoZWFkKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHVwZ3JhZGVDb25uZWN0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSxcbiAgICBzb2NrZXQ6IER1cGxleCxcbiAgICBoZWFkOiBCdWZmZXIsXG4gICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24/OiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICkge1xuICAgIHRoaXMud3NzLmhhbmRsZVVwZ3JhZGUocmVxdWVzdCwgc29ja2V0LCBoZWFkLCAod3MpID0+IHtcbiAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb25zLnNpemUgPj0gdGhpcy5tYXhDb25uZWN0aW9ucykge1xuICAgICAgICB3cy5jbG9zZSgxMDEzLCBcIk1heGltdW0gbnVtYmVyIG9mIGNvbm5lY3Rpb25zIHJlYWNoZWRcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uKSB7XG4gICAgICAgIC8vIFNldCB0aGUgV2ViU29ja2V0IGluc3RhbmNlIG9uIHRoZSBleGlzdGluZyBjb25uZWN0aW9uXG4gICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLnNldFdlYlNvY2tldCh3cyk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDcmVhdGUgbmV3IGNvbm5lY3Rpb24gd2l0aCBXZWJTb2NrZXQgaW5zdGFuY2VcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB1bmRlZmluZWQsIC8vIGRlZmF1bHQgdGltZW91dFxuICAgICAgICAgIHVuZGVmaW5lZCwgLy8gZGVmYXVsdCByYXRlIGxpbWl0XG4gICAgICAgICAgd3NcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5yZXF1aXJlc0F1dGhlbnRpY2F0aW9uKSB7XG4gICAgICBhd2FpdCBjb25uZWN0aW9uLnJlZnJlc2hTZXNzaW9uKHRoaXMuc2Vzc2lvblN0b3JlISk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKGRhdGE6IERhdGEsIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yZWZyZXNoU2Vzc2lvbihjb25uZWN0aW9uKTtcbiAgICAgIC8vIFRPRE86IGhhbmRsZSBleHBpcmVkIHNlc3Npb25zXG4gICAgICBjb25zdCBzdHJEYXRhID0gZGF0YS50b1N0cmluZygpO1xuICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2Uoc3RyRGF0YSk7XG4gICAgICBsZXQgcmVxdWVzdFR5cGU6IHN0cmluZyA9IFwiXCI7XG5cbiAgICAgIGlmIChcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwib2JqZWN0XCJcbiAgICAgICkge1xuICAgICAgICByZXF1ZXN0VHlwZSA9IFwicmF3XCI7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IFwicmF3XCIsXG4gICAgICAgICAgYm9keTogZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlc3BvbnNlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVzcG9uc2U8YW55PjtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXG4gICAgICAgICAgcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgIHJlc3BvbnNlLmJvZHlcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlcXVlc3RcIikge1xuICAgICAgICBjb25zdCByZXF1ZXN0ID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlcXVlc3Q8YW55PjtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIG5vbi1hdXRoZW50aWNhdGVkIFJlcXVlc3RzXG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBhdXRob3JpemF0aW9uXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgY29ubmVjdGlvbklkOiBjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgICAgdHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgICBib2R5OiByZXF1ZXN0LmJvZHksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBjb25uZWN0aW9uLmdldFNlc3Npb25JZCgpXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGU6IGFzeW5jIChcbiAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgICAgICAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICAgICAgICAgICkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhdHVzVXBkYXRlID0gTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlc3BvbnNlKFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgICAgICBzdGF0dXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoc3RhdHVzVXBkYXRlKSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgV2ViU29ja2V0IG1lc3NhZ2VgLCBlcnJvcik7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnZhbGlkIG1lc3NhZ2UgZm9ybWF0XCIgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlQ2xvc2UoY29ubmVjdGlvbklkOiBzdHJpbmcpIHtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IGNvbm5lY3Rpb24gY2xvc2VkOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMuc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZvKGBXZWJTb2NrZXQgc2VydmVyIGxpc3RlbmluZyBvbiBwb3J0ICR7dGhpcy5wb3J0fWApO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdG9wRGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gQ2xvc2UgYWxsIGFjdGl2ZSBjb25uZWN0aW9ucyBhbmQgd2FpdCBmb3IgdGhlbSB0byBjb21wbGV0ZVxuICAgICAgICB0aGlzLmluZm8oXCJDbG9zaW5nIGFsbCBhY3RpdmUgV2ViU29ja2V0IGNvbm5lY3Rpb25zLi4uXCIpO1xuICAgICAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgICBBcnJheS5mcm9tKHRoaXMuY29ubmVjdGlvbnMudmFsdWVzKCkpLm1hcChjb25uZWN0aW9uID0+XG4gICAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIilcbiAgICAgICAgICApXG4gICAgICAgICk7XG4gIFxuICAgICAgICAvLyBDbG9zZSB0aGUgV2ViU29ja2V0IHNlcnZlciBhbmQgSFRUUCBzZXJ2ZXJcbiAgICAgICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4ocmVzb2x2ZVdzcyA9PiB7XG4gICAgICAgICAgdGhpcy53c3MuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgICAgIHJlc29sdmVXc3MoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgXG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5lcnJvcihcIkVycm9yIGR1cmluZyBzaHV0ZG93bjpcIiwgZXJyb3IpO1xuICAgICAgICByZXNvbHZlKCk7IC8vIFN0aWxsIHJlc29sdmUgdG8gZW5zdXJlIHNodXRkb3duIGNvbXBsZXRlc1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlZmF1bHRNZXNzYWdlSGFuZGxlcihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiBQcm9taXNlPFdlYlNvY2tldFJlc3BvbnNlPiB7XG4gICAgdGhpcy53YXJuKFxuICAgICAgYFVuaGFuZGxlZCBXZWJTb2NrZXQgbWVzc2FnZSB0eXBlOiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgICByZXF1ZXN0XG4gICAgKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBlcnJvcjogYFwiVW5oYW5kbGVkIG1lc3NhZ2UgdHlwZVwiICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCxcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldENvbm5lY3Rpb25zKCk6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+IHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9ucztcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxzdHJpbmc+KFwicmF3XCIpXG4gIHByb3RlY3RlZCBhc3luYyByYXdNZXNzYWdlSGFuZGxlcihtZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRoaXMud2FybihgUmVjZWl2ZWQgcmF3IG1lc3NhZ2VgLCBtZXNzYWdlKTtcbiAgICByZXR1cm4gXCJFUlJPUjogUmF3IG1lc3NhZ2VzIG5vdCBzdXBwb3J0ZWQuIFBsZWFzZSB1c2UgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCI7XG4gIH1cblxuICBwdWJsaWMgYnJvYWRjYXN0KG1lc3NhZ2U6IElSZXF1ZXN0PFdlYlNvY2tldE1lc3NhZ2U+KTogdm9pZCB7XG4gICAgY29uc3QgbWVzc2FnZVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuICAgIHRoaXMuY29ubmVjdGlvbnMuZm9yRWFjaCgoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKG1lc3NhZ2VTdHJpbmcpO1xuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHNlbmRUb0Nvbm5lY3Rpb24oXG4gICAgY29ubmVjdGlvbklkOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogSVJlc3BvbnNlPFdlYlNvY2tldE1lc3NhZ2U+XG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkobWVzc2FnZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYENvbm5lY3Rpb24gbm90IGZvdW5kOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRTZXNzaW9uQnlJZChzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8SVNlc3Npb25EYXRhIHwgbnVsbD4ge1xuICAgIHJldHVybiB0aGlzLnNlc3Npb25TdG9yZT8gdGhpcy5zZXNzaW9uU3RvcmUuZ2V0KHNlc3Npb25JZCkgOiBudWxsO1xuICB9XG59XG5cbmZ1bmN0aW9uIGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKG1lc3NhZ2U6IHN0cmluZyk6IERldGVjdGlvblJlc3VsdDx1bmtub3duPiB7XG4gIC8vIEZpcnN0LCBjaGVjayBpZiB0aGUgbWVzc2FnZSBpcyBsaWtlbHkgSlNPTiBvciBhIEphdmFTY3JpcHQtbGlrZSBvYmplY3RcbiAgaWYgKG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJ7XCIpIHx8IG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJbXCIpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UobWVzc2FnZSk7XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXF1ZXN0XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwiaGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmhlYWRlciA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcInRpbWVzdGFtcFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0SWRcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdGVyQWRkcmVzc1wiIGluIHBhcnNlZC5oZWFkZXJcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXF1ZXN0XCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXF1ZXN0PHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVzcG9uc2VcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJyZXF1ZXN0SGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwicmVzcG9uc2VIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuYm9keSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcImRhdGFcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcInN1Y2Nlc3NcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcImVycm9yXCIgaW4gcGFyc2VkLmJvZHlcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXNwb25zZVwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVzcG9uc2U8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIElmIGl0J3MgYSBwYXJzZWQgb2JqZWN0IGJ1dCBub3QgSVJlcXVlc3Qgb3IgSVJlc3BvbnNlXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJvYmplY3RcIiwgcGF5bG9hZDogcGFyc2VkIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElmIHBhcnNpbmcgZmFpbHMsIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBpdCBkb2Vzbid0IGxvb2sgbGlrZSBKU09OLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gIH1cbn1cbiJdfQ==