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
        this.heartbeatConfig = {
            enabled: true,
            interval: 30000, // 30 seconds
            timeout: 5000, // 5 seconds
        };
        this.validateAuthenticationConfig(config.authentication);
        this.port = config.port;
        this.path = config.path || "/ws";
        this.maxConnections = config.maxConnections || 1000;
        this.authConfig = config.authentication;
        this.heartbeatConfig = config.heartbeatConfig || this.heartbeatConfig;
        this.server = (0, http_1.createServer)();
        this.wss = new ws_1.Server({ noServer: true });
        if (this.authConfig.required || this.authConfig.allowAnonymous) {
            if (!this.authConfig.sessionStore) {
                throw new Error("Session store is required for both authenticated and anonymous connections");
            }
            if (this.authConfig.required && !this.authConfig.authProvider) {
                throw new Error("Authentication provider is required when authentication is required");
            }
            this.authenticationMiddleware =
                config.authentication.authenticationMiddleware ||
                    new WebSocketAuthenticationMiddleware_1.WebSocketAuthenticationMiddleware(this.authConfig.authProvider, this.authConfig.sessionStore);
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
            const connection = await this.handleAuthentication(request);
            if (!connection) {
                socket.write("HTTP/1.1 401 Unauthorized\r\n" +
                    "Connection: close\r\n" +
                    "Content-Type: text/plain\r\n\r\n" +
                    "Authentication failed\r\n");
                socket.end();
                return;
            }
            this.upgradeConnection(request, socket, head, connection);
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
                const connection = new WebsocketConnection_1.WebsocketConnection(this.handleMessage.bind(this), this.handleClose.bind(this), undefined, // default rate limit
                this.handleWsEvents(), ws, this.heartbeatConfig.interval, this.heartbeatConfig.timeout);
                this.connections.set(connection.getConnectionId(), connection);
            }
        });
    }
    validateAuthenticationConfig(config) {
        // Check for invalid configuration where no connections would be possible
        if (!config.required && !config.allowAnonymous) {
            throw new Error("Invalid authentication configuration: " +
                "When authentication is not required, you must either enable anonymous connections " +
                "or set required to true. Current configuration would prevent any connections.");
        }
        // Additional validation checks
        if (config.required && !config.authProvider) {
            throw new Error("Invalid authentication configuration: " +
                "Authentication provider is required when authentication is required");
        }
        if (config.allowAnonymous && !config.sessionStore) {
            throw new Error("Invalid authentication configuration: " +
                "Session store is required when anonymous connections are allowed");
        }
        // Validate anonymous config if anonymous connections are allowed
        if (config.allowAnonymous && config.anonymousConfig) {
            if (config.anonymousConfig.sessionDuration !== undefined &&
                config.anonymousConfig.sessionDuration <= 0) {
                throw new Error("Invalid anonymous session configuration: " +
                    "Session duration must be positive");
            }
        }
    }
    async handleAuthentication(request) {
        try {
            // First, try to authenticate if credentials are provided
            const connection = new WebsocketConnection_1.WebsocketConnection(this.handleMessage.bind(this), this.handleClose.bind(this));
            // Try token/credentials authentication first if middleware exists
            if (this.authenticationMiddleware) {
                try {
                    const authResult = await this.authenticationMiddleware.authenticateConnection(request, connection);
                    if (authResult.success) {
                        for (const [key, value] of Object.entries(authResult)) {
                            if (value)
                                connection.setMetadata(key, value);
                        }
                        return connection;
                    }
                }
                catch (error) {
                    // Authentication failed, but we might still allow anonymous access
                    if (this.authConfig.required) {
                        throw error;
                    }
                }
            }
            // If we reach here and anonymous access is allowed, create anonymous session
            if (this.authConfig.allowAnonymous) {
                await this.createAnonymousSession(connection, request);
                return connection;
            }
            // If we reach here, neither authentication succeeded nor anonymous access is allowed
            return null;
        }
        catch (error) {
            this.error("Authentication error:", error);
            return null;
        }
    }
    async createAnonymousSession(connection, request) {
        const config = this.authConfig.anonymousConfig || {
            enabled: true,
            sessionDuration: 24 * 60 * 60 * 1000, // 24 hours default
        };
        const deviceId = this.extractDeviceId(request);
        const sessionData = {
            sessionId: crypto.randomUUID(),
            userId: deviceId || crypto.randomUUID(), // Use device ID as userId if available
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + (config.sessionDuration || 24 * 60 * 60 * 1000)),
            lastAccessedAt: new Date(),
            metadata: {
                ...config.metadata,
                isAnonymous: true,
                deviceId,
            },
        };
        await this.authConfig.sessionStore.create(sessionData);
        connection.setMetadata("sessionId", sessionData.sessionId);
        connection.setMetadata("userId", sessionData.userId);
        connection.setMetadata("isAnonymous", true);
        connection.setAuthenticated(false);
    }
    extractDeviceId(request) {
        // Try to extract device ID from various sources
        const url = new URL(request.url, `http://${request.headers.host}`);
        // Check query parameters
        const deviceId = url.searchParams.get("deviceId");
        if (deviceId)
            return deviceId;
        // Check headers
        const deviceIdHeader = request.headers["x-device-id"];
        if (deviceIdHeader)
            return deviceIdHeader.toString();
        // Check cookies
        const cookies = request.headers.cookie
            ?.split(";")
            .map((cookie) => cookie.trim().split("="))
            .find(([key]) => key === "deviceId");
        return cookies ? cookies[1] : null;
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
        await connection.refreshSession(this.authConfig.sessionStore);
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
                if (response.requestHeader.requestType &&
                    response.requestHeader.recipientAddress &&
                    response.requestHeader.recipientAddress !=
                        response.responseHeader.responderAddress) {
                    await this.sendOneWayMessage(response.requestHeader.requestType, response.requestHeader.recipientAddress, JSON.stringify(response.body), response.requestHeader.requestId);
                }
                return;
            }
            if (detectionResult.payloadType == "IRequest") {
                const request = detectionResult.payload;
                // TODO: handle non-authenticated Requests
                // TODO: handle authorization
                let authMetadata = {};
                authMetadata.isAuthenticated = connection.isAuthenticated();
                if (connection.isAuthenticated()) {
                    authMetadata.sessionId = connection.getSessionId();
                    authMetadata.userId = connection.getMetadata("userId");
                    authMetadata.connectionId = connection.getConnectionId();
                }
                const response = await this.makeRequest({
                    to: request.header.recipientAddress || this.serviceId,
                    requestType: request.header.requestType || "unknown",
                    body: request.body,
                    headers: {
                        ...request.header,
                        requestId: request.header.requestId,
                        sessionId: connection.getSessionId(),
                        authMetadata,
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
    async handleClose(connectionId) {
        const connection = this.connections.get(connectionId);
        if (connection) {
            await connection.close(1000, "Connection closed");
            this.connections.delete(connectionId);
            const sessionId = connection.getSessionId();
            if (sessionId) {
                await this.authConfig.sessionStore.delete(sessionId);
            }
            this.info(`WebSocket connection closed: ${connectionId}`);
        }
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
        try {
            // First, stop accepting new connections
            this.server.close();
            // Close all active connections
            this.info("Closing all active WebSocket connections...");
            await Promise.all(Array.from(this.connections.values()).map((connection) => connection.close(1000, "Server shutting down")));
            // Wait for the WSS to close properly
            await new Promise((resolve, reject) => {
                // Set a timeout to prevent hanging
                const timeout = setTimeout(() => {
                    reject(new Error("WSS close timeout"));
                }, 5000);
                this.wss.close(() => {
                    clearTimeout(timeout);
                    this.info("WebSocket server stopped");
                    resolve();
                });
            });
        }
        catch (error) {
            this.error("Error during shutdown:", error);
            // Force close everything
            this.wss.clients.forEach((client) => {
                try {
                    client.terminate();
                }
                catch (e) {
                    // Ignore errors during force termination
                }
            });
            throw error; // Re-throw to indicate shutdown failure
        }
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
        return this.authConfig.sessionStore.get(sessionId);
    }
    async rawMessageHandler(message) {
        this.warn(`Received raw message`, message);
        return "ERROR: Raw messages not supported. Please use CommunicationsManager";
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
                "body" in parsed) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBSTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBd0R4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBZ0JDLFlBQVksT0FBaUIsRUFBRSxNQUE2QjtRQUMxRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBZGpCLGdCQUFXLEdBQXFDLElBQUksR0FBRyxFQUFFLENBQUM7UUFPMUQsb0JBQWUsR0FBb0I7WUFDekMsT0FBTyxFQUFFLElBQUk7WUFDYixRQUFRLEVBQUUsS0FBSyxFQUFFLGFBQWE7WUFDOUIsT0FBTyxFQUFFLElBQUksRUFBRSxZQUFZO1NBQzVCLENBQUM7UUFLQSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsTUFBTSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDO1FBQ3RFLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxD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RUFBRSxNQUE0QjtpQkFDdEMsQ0FBQztZQUNKLENBQUM7WUFFRCx3REFBd0Q7WUFDeEQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDO1FBQ3BELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YseUNBQXlDO1lBQ3pDLE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztRQUNyRCxDQUFDO0lBQ0gsQ0FBQztTQUFNLENBQUM7UUFDTixxREFBcUQ7UUFDckQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO0lBQ3JELENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmVyLCBEYXRhIH0gZnJvbSBcIndzXCI7XG5pbXBvcnQgeyBjcmVhdGVTZXJ2ZXIsIFNlcnZlciBhcyBIdHRwU2VydmVyLCBJbmNvbWluZ01lc3NhZ2UgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHsgRHVwbGV4IH0gZnJvbSBcInN0cmVhbVwiO1xuaW1wb3J0IHsgSUF1dGhlbnRpY2F0aW9uTWV0YWRhdGEsIElTZXNzaW9uRGF0YSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cbmltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbiAgU3RhdHVzVXBkYXRlLFxuICBSZXF1ZXN0SGFuZGxlcixcbn0gZnJvbSBcIi4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHtcbiAgSUJhY2tFbmQsXG4gIElSZXF1ZXN0LFxuICBJUmVzcG9uc2UsXG4gIElTZXNzaW9uU3RvcmUsXG4gIElBdXRoZW50aWNhdGlvblByb3ZpZGVyLFxufSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgV2Vic29ja2V0Q29ubmVjdGlvbiB9IGZyb20gXCIuL1dlYnNvY2tldENvbm5lY3Rpb25cIjtcbmltcG9ydCB7IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB9IGZyb20gXCIuL1dlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVwiO1xuXG50eXBlIFBheWxvYWRUeXBlID0gXCJvYmplY3RcIiB8IFwic3RyaW5nXCIgfCBcIklSZXF1ZXN0XCIgfCBcIklSZXNwb25zZVwiO1xuXG5pbnRlcmZhY2UgRGV0ZWN0aW9uUmVzdWx0PFQ+IHtcbiAgcGF5bG9hZFR5cGU6IFBheWxvYWRUeXBlO1xuICBwYXlsb2FkOiBUO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYXJ0YmVhdFJlcXVlc3Qge1xuICB0aW1lc3RhbXA6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZWFydGJlYXRSZXNwb25zZSB7XG4gIHJlcXVlc3RUaW1lc3RhbXA6IG51bWJlcjtcbiAgcmVzcG9uc2VUaW1lc3RhbXA6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZWFydGJlYXRDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBpbnRlcnZhbDogbnVtYmVyOyAvLyBIb3cgb2Z0ZW4gdG8gc2VuZCBoZWFydGJlYXRzIChtcylcbiAgdGltZW91dDogbnVtYmVyOyAvLyBIb3cgbG9uZyB0byB3YWl0IGZvciByZXNwb25zZSAobXMpXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5vbnltb3VzU2Vzc2lvbkNvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIHNlc3Npb25EdXJhdGlvbj86IG51bWJlcjsgLy8gRHVyYXRpb24gaW4gbWlsbGlzZWNvbmRzXG4gIHBlcnNpc3RlbnRJZGVudGl0eUVuYWJsZWQ/OiBib29sZWFuO1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEF1dGhlbnRpY2F0aW9uQ29uZmlnIHtcbiAgcmVxdWlyZWQ6IGJvb2xlYW47XG4gIGFsbG93QW5vbnltb3VzOiBib29sZWFuO1xuICBhbm9ueW1vdXNDb25maWc/OiBBbm9ueW1vdXNTZXNzaW9uQ29uZmlnO1xuICBhdXRoUHJvdmlkZXI/OiBJQXV0aGVudGljYXRpb25Qcm92aWRlcjtcbiAgc2Vzc2lvblN0b3JlOiBJU2Vzc2lvblN0b3JlO1xuICBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0U2VydmVyQ29uZmlnIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIHBvcnQ6IG51bWJlcjtcbiAgcGF0aD86IHN0cmluZztcbiAgbWF4Q29ubmVjdGlvbnM/OiBudW1iZXI7XG4gIGF1dGhlbnRpY2F0aW9uOiBBdXRoZW50aWNhdGlvbkNvbmZpZztcbiAgaGVhcnRiZWF0Q29uZmlnPzogSGVhcnRiZWF0Q29uZmlnO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRNZXNzYWdlID0ge1xuICB0eXBlOiBzdHJpbmc7XG4gIGRhdGE6IGFueTtcbiAgY29ubmVjdGlvbklkOiBzdHJpbmc7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFJlc3BvbnNlIHt9XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRTZXJ2ZXIgZXh0ZW5kcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFdlYlNvY2tldE1lc3NhZ2UsXG4gIFdlYlNvY2tldFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IEh0dHBTZXJ2ZXI7XG4gIHByaXZhdGUgd3NzOiBTZXJ2ZXI7XG4gIHByaXZhdGUgY29ubmVjdGlvbnM6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBwYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgbWF4Q29ubmVjdGlvbnM6IG51bWJlcjtcbiAgcHJpdmF0ZSBhdXRoQ29uZmlnOiBBdXRoZW50aWNhdGlvbkNvbmZpZztcbiAgcHJpdmF0ZSBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG5cbiAgcHJpdmF0ZSBoZWFydGJlYXRDb25maWc6IEhlYXJ0YmVhdENvbmZpZyA9IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIGludGVydmFsOiAzMDAwMCwgLy8gMzAgc2Vjb25kc1xuICAgIHRpbWVvdXQ6IDUwMDAsIC8vIDUgc2Vjb25kc1xuICB9O1xuXG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQ6IElCYWNrRW5kLCBjb25maWc6IFdlYlNvY2tldFNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKGJhY2tlbmQsIGNvbmZpZyk7XG5cbiAgICB0aGlzLnZhbGlkYXRlQXV0aGVudGljYXRpb25Db25maWcoY29uZmlnLmF1dGhlbnRpY2F0aW9uKTtcblxuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0O1xuICAgIHRoaXMucGF0aCA9IGNvbmZpZy5wYXRoIHx8IFwiL3dzXCI7XG4gICAgdGhpcy5tYXhDb25uZWN0aW9ucyA9IGNvbmZpZy5tYXhDb25uZWN0aW9ucyB8fCAxMDAwO1xuICAgIHRoaXMuYXV0aENvbmZpZyA9IGNvbmZpZy5hdXRoZW50aWNhdGlvbjtcbiAgICB0aGlzLmhlYXJ0YmVhdENvbmZpZyA9IGNvbmZpZy5oZWFydGJlYXRDb25maWcgfHwgdGhpcy5oZWFydGJlYXRDb25maWc7XG4gICAgdGhpcy5zZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoKTtcbiAgICB0aGlzLndzcyA9IG5ldyBTZXJ2ZXIoeyBub1NlcnZlcjogdHJ1ZSB9KTtcblxuICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQgfHwgdGhpcy5hdXRoQ29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICBpZiAoIXRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiU2Vzc2lvbiBzdG9yZSBpcyByZXF1aXJlZCBmb3IgYm90aCBhdXRoZW50aWNhdGVkIGFuZCBhbm9ueW1vdXMgY29ubmVjdGlvbnNcIlxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkICYmICF0aGlzLmF1dGhDb25maWcuYXV0aFByb3ZpZGVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIHByb3ZpZGVyIGlzIHJlcXVpcmVkIHdoZW4gYXV0aGVudGljYXRpb24gaXMgcmVxdWlyZWRcIlxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSA9XG4gICAgICAgIGNvbmZpZy5hdXRoZW50aWNhdGlvbi5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfHxcbiAgICAgICAgbmV3IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZShcbiAgICAgICAgICB0aGlzLmF1dGhDb25maWcuYXV0aFByb3ZpZGVyISxcbiAgICAgICAgICB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgdGhpcy5zZXR1cFdlYlNvY2tldFNlcnZlcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cFdlYlNvY2tldFNlcnZlcigpIHtcbiAgICB0aGlzLnNlcnZlci5vbihcbiAgICAgIFwidXBncmFkZVwiLFxuICAgICAgYXN5bmMgKHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSwgc29ja2V0OiBEdXBsZXgsIGhlYWQ6IEJ1ZmZlcikgPT4ge1xuICAgICAgICAvLyBQcmV2ZW50IG1lbW9yeSBsZWFrcyBieSBoYW5kbGluZyBzb2NrZXQgZXJyb3JzXG4gICAgICAgIHNvY2tldC5vbihcImVycm9yXCIsIChlcnIpID0+IHtcbiAgICAgICAgICB0aGlzLmVycm9yKFwiU29ja2V0IGVycm9yOlwiLCBlcnIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFBhcnNlIHRoZSBVUkwgdG8gZ2V0IGp1c3QgdGhlIHBhdGhuYW1lXG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG5cbiAgICAgICAgaWYgKHVybC5wYXRobmFtZSAhPT0gdGhpcy5wYXRoKSB7XG4gICAgICAgICAgc29ja2V0LndyaXRlKFwiSFRUUC8xLjEgNDA0IE5vdCBGb3VuZFxcclxcblxcclxcblwiKTtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICAgIHRoaXMud2FybihgSW52YWxpZCBwYXRoOiAke3JlcXVlc3QudXJsfWApO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmhhbmRsZUF1dGhlbnRpY2F0aW9uKHJlcXVlc3QpO1xuICAgICAgICBpZiAoIWNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXG4gICAgICAgICAgICBcIkhUVFAvMS4xIDQwMSBVbmF1dGhvcml6ZWRcXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQ29ubmVjdGlvbjogY2xvc2VcXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluXFxyXFxuXFxyXFxuXCIgK1xuICAgICAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIGZhaWxlZFxcclxcblwiXG4gICAgICAgICAgKTtcbiAgICAgICAgICBzb2NrZXQuZW5kKCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy51cGdyYWRlQ29ubmVjdGlvbihyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsIGNvbm5lY3Rpb24pO1xuICAgICAgfVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHVwZ3JhZGVDb25uZWN0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSxcbiAgICBzb2NrZXQ6IER1cGxleCxcbiAgICBoZWFkOiBCdWZmZXIsXG4gICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24/OiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICkge1xuICAgIHRoaXMud3NzLmhhbmRsZVVwZ3JhZGUocmVxdWVzdCwgc29ja2V0LCBoZWFkLCAod3MpID0+IHtcbiAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb25zLnNpemUgPj0gdGhpcy5tYXhDb25uZWN0aW9ucykge1xuICAgICAgICB3cy5jbG9zZSgxMDEzLCBcIk1heGltdW0gbnVtYmVyIG9mIGNvbm5lY3Rpb25zIHJlYWNoZWRcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uKSB7XG4gICAgICAgIC8vIFNldCB0aGUgV2ViU29ja2V0IGluc3RhbmNlIG9uIHRoZSBleGlzdGluZyBjb25uZWN0aW9uXG4gICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLnNldFdlYlNvY2tldCh3cyk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDcmVhdGUgbmV3IGNvbm5lY3Rpb24gd2l0aCBXZWJTb2NrZXQgaW5zdGFuY2VcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB1bmRlZmluZWQsIC8vIGRlZmF1bHQgcmF0ZSBsaW1pdFxuICAgICAgICAgIHRoaXMuaGFuZGxlV3NFdmVudHMoKSxcbiAgICAgICAgICB3cyxcbiAgICAgICAgICB0aGlzLmhlYXJ0YmVhdENvbmZpZy5pbnRlcnZhbCxcbiAgICAgICAgICB0aGlzLmhlYXJ0YmVhdENvbmZpZy50aW1lb3V0XG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksIGNvbm5lY3Rpb24pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUF1dGhlbnRpY2F0aW9uQ29uZmlnKGNvbmZpZzogQXV0aGVudGljYXRpb25Db25maWcpOiB2b2lkIHtcbiAgICAvLyBDaGVjayBmb3IgaW52YWxpZCBjb25maWd1cmF0aW9uIHdoZXJlIG5vIGNvbm5lY3Rpb25zIHdvdWxkIGJlIHBvc3NpYmxlXG4gICAgaWYgKCFjb25maWcucmVxdWlyZWQgJiYgIWNvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiV2hlbiBhdXRoZW50aWNhdGlvbiBpcyBub3QgcmVxdWlyZWQsIHlvdSBtdXN0IGVpdGhlciBlbmFibGUgYW5vbnltb3VzIGNvbm5lY3Rpb25zIFwiICtcbiAgICAgICAgICBcIm9yIHNldCByZXF1aXJlZCB0byB0cnVlLiBDdXJyZW50IGNvbmZpZ3VyYXRpb24gd291bGQgcHJldmVudCBhbnkgY29ubmVjdGlvbnMuXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gQWRkaXRpb25hbCB2YWxpZGF0aW9uIGNoZWNrc1xuICAgIGlmIChjb25maWcucmVxdWlyZWQgJiYgIWNvbmZpZy5hdXRoUHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIHByb3ZpZGVyIGlzIHJlcXVpcmVkIHdoZW4gYXV0aGVudGljYXRpb24gaXMgcmVxdWlyZWRcIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLmFsbG93QW5vbnltb3VzICYmICFjb25maWcuc2Vzc2lvblN0b3JlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJTZXNzaW9uIHN0b3JlIGlzIHJlcXVpcmVkIHdoZW4gYW5vbnltb3VzIGNvbm5lY3Rpb25zIGFyZSBhbGxvd2VkXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgYW5vbnltb3VzIGNvbmZpZyBpZiBhbm9ueW1vdXMgY29ubmVjdGlvbnMgYXJlIGFsbG93ZWRcbiAgICBpZiAoY29uZmlnLmFsbG93QW5vbnltb3VzICYmIGNvbmZpZy5hbm9ueW1vdXNDb25maWcpIHtcbiAgICAgIGlmIChcbiAgICAgICAgY29uZmlnLmFub255bW91c0NvbmZpZy5zZXNzaW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICBjb25maWcuYW5vbnltb3VzQ29uZmlnLnNlc3Npb25EdXJhdGlvbiA8PSAwXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiSW52YWxpZCBhbm9ueW1vdXMgc2Vzc2lvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgICBcIlNlc3Npb24gZHVyYXRpb24gbXVzdCBiZSBwb3NpdGl2ZVwiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVBdXRoZW50aWNhdGlvbihcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2VcbiAgKTogUHJvbWlzZTxXZWJzb2NrZXRDb25uZWN0aW9uIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBGaXJzdCwgdHJ5IHRvIGF1dGhlbnRpY2F0ZSBpZiBjcmVkZW50aWFscyBhcmUgcHJvdmlkZWRcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKVxuICAgICAgKTtcblxuICAgICAgLy8gVHJ5IHRva2VuL2NyZWRlbnRpYWxzIGF1dGhlbnRpY2F0aW9uIGZpcnN0IGlmIG1pZGRsZXdhcmUgZXhpc3RzXG4gICAgICBpZiAodGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBhdXRoUmVzdWx0ID1cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlLmF1dGhlbnRpY2F0ZUNvbm5lY3Rpb24oXG4gICAgICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICAgICAgIGNvbm5lY3Rpb25cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKGF1dGhSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXV0aFJlc3VsdCkpIHtcbiAgICAgICAgICAgICAgaWYgKHZhbHVlKSBjb25uZWN0aW9uLnNldE1ldGFkYXRhKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb247XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIC8vIEF1dGhlbnRpY2F0aW9uIGZhaWxlZCwgYnV0IHdlIG1pZ2h0IHN0aWxsIGFsbG93IGFub255bW91cyBhY2Nlc3NcbiAgICAgICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gSWYgd2UgcmVhY2ggaGVyZSBhbmQgYW5vbnltb3VzIGFjY2VzcyBpcyBhbGxvd2VkLCBjcmVhdGUgYW5vbnltb3VzIHNlc3Npb25cbiAgICAgIGlmICh0aGlzLmF1dGhDb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVBbm9ueW1vdXNTZXNzaW9uKGNvbm5lY3Rpb24sIHJlcXVlc3QpO1xuICAgICAgICByZXR1cm4gY29ubmVjdGlvbjtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgd2UgcmVhY2ggaGVyZSwgbmVpdGhlciBhdXRoZW50aWNhdGlvbiBzdWNjZWVkZWQgbm9yIGFub255bW91cyBhY2Nlc3MgaXMgYWxsb3dlZFxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihcIkF1dGhlbnRpY2F0aW9uIGVycm9yOlwiLCBlcnJvcik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZUFub255bW91c1Nlc3Npb24oXG4gICAgY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvbixcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2VcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5hdXRoQ29uZmlnLmFub255bW91c0NvbmZpZyB8fCB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgc2Vzc2lvbkR1cmF0aW9uOiAyNCAqIDYwICogNjAgKiAxMDAwLCAvLyAyNCBob3VycyBkZWZhdWx0XG4gICAgfTtcblxuICAgIGNvbnN0IGRldmljZUlkID0gdGhpcy5leHRyYWN0RGV2aWNlSWQocmVxdWVzdCk7XG5cbiAgICBjb25zdCBzZXNzaW9uRGF0YTogSVNlc3Npb25EYXRhID0ge1xuICAgICAgc2Vzc2lvbklkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxuICAgICAgdXNlcklkOiBkZXZpY2VJZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpLCAvLyBVc2UgZGV2aWNlIElEIGFzIHVzZXJJZCBpZiBhdmFpbGFibGVcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKSxcbiAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoXG4gICAgICAgIERhdGUubm93KCkgKyAoY29uZmlnLnNlc3Npb25EdXJhdGlvbiB8fCAyNCAqIDYwICogNjAgKiAxMDAwKVxuICAgICAgKSxcbiAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgLi4uY29uZmlnLm1ldGFkYXRhLFxuICAgICAgICBpc0Fub255bW91czogdHJ1ZSxcbiAgICAgICAgZGV2aWNlSWQsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBhd2FpdCB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlLmNyZWF0ZShzZXNzaW9uRGF0YSk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInNlc3Npb25JZFwiLCBzZXNzaW9uRGF0YS5zZXNzaW9uSWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJ1c2VySWRcIiwgc2Vzc2lvbkRhdGEudXNlcklkKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwiaXNBbm9ueW1vdXNcIiwgdHJ1ZSk7XG4gICAgY29ubmVjdGlvbi5zZXRBdXRoZW50aWNhdGVkKGZhbHNlKTtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdERldmljZUlkKHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIFRyeSB0byBleHRyYWN0IGRldmljZSBJRCBmcm9tIHZhcmlvdXMgc291cmNlc1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG5cbiAgICAvLyBDaGVjayBxdWVyeSBwYXJhbWV0ZXJzXG4gICAgY29uc3QgZGV2aWNlSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImRldmljZUlkXCIpO1xuICAgIGlmIChkZXZpY2VJZCkgcmV0dXJuIGRldmljZUlkO1xuXG4gICAgLy8gQ2hlY2sgaGVhZGVyc1xuICAgIGNvbnN0IGRldmljZUlkSGVhZGVyID0gcmVxdWVzdC5oZWFkZXJzW1wieC1kZXZpY2UtaWRcIl07XG4gICAgaWYgKGRldmljZUlkSGVhZGVyKSByZXR1cm4gZGV2aWNlSWRIZWFkZXIudG9TdHJpbmcoKTtcblxuICAgIC8vIENoZWNrIGNvb2tpZXNcbiAgICBjb25zdCBjb29raWVzID0gcmVxdWVzdC5oZWFkZXJzLmNvb2tpZVxuICAgICAgPy5zcGxpdChcIjtcIilcbiAgICAgIC5tYXAoKGNvb2tpZSkgPT4gY29va2llLnRyaW0oKS5zcGxpdChcIj1cIikpXG4gICAgICAuZmluZCgoW2tleV0pID0+IGtleSA9PT0gXCJkZXZpY2VJZFwiKTtcblxuICAgIHJldHVybiBjb29raWVzID8gY29va2llc1sxXSA6IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVdzRXZlbnRzKCkge1xuICAgIHJldHVybiB7XG4gICAgICBvblJhdGVMaW1pdDogKGNvbm5lY3Rpb25JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgUmF0ZSBsaW1pdCBleGNlZWRlZCBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlJhdGUgbGltaXQgZXhjZWVkZWRcIik7XG4gICAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uRXJyb3I6IChjb25uZWN0aW9uSWQ6IHN0cmluZywgZXJyb3I6IEVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgRXJyb3IgZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBjb25uZWN0aW9uIGVycm9zXG4gICAgICB9LFxuICAgICAgb25TZWN1cml0eVZpb2xhdGlvbjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCB2aW9sYXRpb246IHN0cmluZykgPT4ge1xuICAgICAgICB0aGlzLndhcm4oXG4gICAgICAgICAgYFNlY3VyaXR5IHZpb2xhdGlvbiBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7dmlvbGF0aW9ufWBcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlNlY3VyaXR5IHZpb2xhdGlvblwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBjb25uZWN0aW9uLnJlZnJlc2hTZXNzaW9uKHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKFxuICAgIGRhdGE6IERhdGEsXG4gICAgY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvblxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yZWZyZXNoU2Vzc2lvbihjb25uZWN0aW9uKTtcbiAgICAgIC8vIFRPRE86IGhhbmRsZSBleHBpcmVkIHNlc3Npb25zXG4gICAgICBjb25zdCBzdHJEYXRhID0gZGF0YS50b1N0cmluZygpO1xuICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2Uoc3RyRGF0YSk7XG4gICAgICBsZXQgcmVxdWVzdFR5cGU6IHN0cmluZyA9IFwiXCI7XG5cbiAgICAgIGlmIChcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwib2JqZWN0XCJcbiAgICAgICkge1xuICAgICAgICByZXF1ZXN0VHlwZSA9IFwicmF3XCI7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IFwicmF3XCIsXG4gICAgICAgICAgYm9keTogZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlc3BvbnNlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVzcG9uc2U8YW55PjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdFR5cGUgJiZcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgJiZcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgIT1cbiAgICAgICAgICAgIHJlc3BvbnNlLnJlc3BvbnNlSGVhZGVyLnJlc3BvbmRlckFkZHJlc3NcbiAgICAgICAgKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdFR5cGUsXG4gICAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgICAgICBKU09OLnN0cmluZ2lmeShyZXNwb25zZS5ib2R5KSxcbiAgICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdElkXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVxdWVzdFwiKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVxdWVzdDxhbnk+O1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgbm9uLWF1dGhlbnRpY2F0ZWQgUmVxdWVzdHNcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGF1dGhvcml6YXRpb25cblxuICAgICAgICBsZXQgYXV0aE1ldGFkYXRhOiBJQXV0aGVudGljYXRpb25NZXRhZGF0YSA9IHt9O1xuICAgICAgICBhdXRoTWV0YWRhdGEuaXNBdXRoZW50aWNhdGVkID0gY29ubmVjdGlvbi5pc0F1dGhlbnRpY2F0ZWQoKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24uaXNBdXRoZW50aWNhdGVkKCkpIHtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuc2Vzc2lvbklkID0gY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEudXNlcklkID0gY29ubmVjdGlvbi5nZXRNZXRhZGF0YShcInVzZXJJZFwiKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuY29ubmVjdGlvbklkID0gY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keTogcmVxdWVzdC5ib2R5LFxuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgIC4uLnJlcXVlc3QuaGVhZGVyLFxuICAgICAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCksXG4gICAgICAgICAgICBhdXRoTWV0YWRhdGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGU6IGFzeW5jIChcbiAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgICAgICAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICAgICAgICAgICkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhdHVzVXBkYXRlID0gTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlc3BvbnNlKFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgICAgICBzdGF0dXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoc3RhdHVzVXBkYXRlKSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgV2ViU29ja2V0IG1lc3NhZ2VgLCBlcnJvcik7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnZhbGlkIG1lc3NhZ2UgZm9ybWF0XCIgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ2xvc2UoY29ubmVjdGlvbklkOiBzdHJpbmcpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgxMDAwLCBcIkNvbm5lY3Rpb24gY2xvc2VkXCIpO1xuICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgIGNvbnN0IHNlc3Npb25JZCA9IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCk7XG4gICAgICBpZiAoc2Vzc2lvbklkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuZGVsZXRlKHNlc3Npb25JZCk7XG4gICAgICB9XG4gICAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBzZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgJHt0aGlzLnBvcnR9YCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEZpcnN0LCBzdG9wIGFjY2VwdGluZyBuZXcgY29ubmVjdGlvbnNcbiAgICAgIHRoaXMuc2VydmVyLmNsb3NlKCk7XG5cbiAgICAgIC8vIENsb3NlIGFsbCBhY3RpdmUgY29ubmVjdGlvbnNcbiAgICAgIHRoaXMuaW5mbyhcIkNsb3NpbmcgYWxsIGFjdGl2ZSBXZWJTb2NrZXQgY29ubmVjdGlvbnMuLi5cIik7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmNvbm5lY3Rpb25zLnZhbHVlcygpKS5tYXAoKGNvbm5lY3Rpb24pID0+XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDAwLCBcIlNlcnZlciBzaHV0dGluZyBkb3duXCIpXG4gICAgICAgIClcbiAgICAgICk7XG5cbiAgICAgIC8vIFdhaXQgZm9yIHRoZSBXU1MgdG8gY2xvc2UgcHJvcGVybHlcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgLy8gU2V0IGEgdGltZW91dCB0byBwcmV2ZW50IGhhbmdpbmdcbiAgICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJXU1MgY2xvc2UgdGltZW91dFwiKSk7XG4gICAgICAgIH0sIDUwMDApO1xuXG4gICAgICAgIHRoaXMud3NzLmNsb3NlKCgpID0+IHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgdGhpcy5pbmZvKFwiV2ViU29ja2V0IHNlcnZlciBzdG9wcGVkXCIpO1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKFwiRXJyb3IgZHVyaW5nIHNodXRkb3duOlwiLCBlcnJvcik7XG4gICAgICAvLyBGb3JjZSBjbG9zZSBldmVyeXRoaW5nXG4gICAgICB0aGlzLndzcy5jbGllbnRzLmZvckVhY2goKGNsaWVudCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNsaWVudC50ZXJtaW5hdGUoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIC8vIElnbm9yZSBlcnJvcnMgZHVyaW5nIGZvcmNlIHRlcm1pbmF0aW9uXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IHRvIGluZGljYXRlIHNodXRkb3duIGZhaWx1cmVcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFdlYlNvY2tldE1lc3NhZ2U+XG4gICk6IFByb21pc2U8V2ViU29ja2V0UmVzcG9uc2U+IHtcbiAgICB0aGlzLndhcm4oXG4gICAgICBgVW5oYW5kbGVkIFdlYlNvY2tldCBtZXNzYWdlIHR5cGU6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCxcbiAgICAgIHJlcXVlc3RcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGVycm9yOiBgXCJVbmhhbmRsZWQgbWVzc2FnZSB0eXBlXCIgJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0Q29ubmVjdGlvbnMoKTogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4ge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25zO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPik6IHZvaWQge1xuICAgIGNvbnN0IG1lc3NhZ2VTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmZvckVhY2goKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlU3RyaW5nKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzZW5kVG9Db25uZWN0aW9uKFxuICAgIGNvbm5lY3Rpb25JZDogc3RyaW5nLFxuICAgIG1lc3NhZ2U6IElSZXNwb25zZTxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBDb25uZWN0aW9uIG5vdCBmb3VuZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0U2Vzc2lvbkJ5SWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPElTZXNzaW9uRGF0YSB8IG51bGw+IHtcbiAgICByZXR1cm4gdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5nZXQoc2Vzc2lvbklkKTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxzdHJpbmc+KFwicmF3XCIpXG4gIHByb3RlY3RlZCBhc3luYyByYXdNZXNzYWdlSGFuZGxlcihtZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRoaXMud2FybihgUmVjZWl2ZWQgcmF3IG1lc3NhZ2VgLCBtZXNzYWdlKTtcbiAgICByZXR1cm4gXCJFUlJPUjogUmF3IG1lc3NhZ2VzIG5vdCBzdXBwb3J0ZWQuIFBsZWFzZSB1c2UgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCI7XG4gIH1cbn1cblxuZnVuY3Rpb24gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2UobWVzc2FnZTogc3RyaW5nKTogRGV0ZWN0aW9uUmVzdWx0PHVua25vd24+IHtcbiAgLy8gRmlyc3QsIGNoZWNrIGlmIHRoZSBtZXNzYWdlIGlzIGxpa2VseSBKU09OIG9yIGEgSmF2YVNjcmlwdC1saWtlIG9iamVjdFxuICBpZiAobWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIntcIikgfHwgbWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIltcIikpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShtZXNzYWdlKTtcblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlcXVlc3RcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJoZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuaGVhZGVyID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwidGltZXN0YW1wXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RJZFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0ZXJBZGRyZXNzXCIgaW4gcGFyc2VkLmhlYWRlclxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlcXVlc3RcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlcXVlc3Q8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXNwb25zZVxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcInJlcXVlc3RIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJyZXNwb25zZUhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWRcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXNwb25zZVwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVzcG9uc2U8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIElmIGl0J3MgYSBwYXJzZWQgb2JqZWN0IGJ1dCBub3QgSVJlcXVlc3Qgb3IgSVJlc3BvbnNlXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJvYmplY3RcIiwgcGF5bG9hZDogcGFyc2VkIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElmIHBhcnNpbmcgZmFpbHMsIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBpdCBkb2Vzbid0IGxvb2sgbGlrZSBKU09OLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gIH1cbn1cbiJdfQ==