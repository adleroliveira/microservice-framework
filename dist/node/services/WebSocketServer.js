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
const core_1 = require("../core");
const MicroserviceFramework_1 = require("../MicroserviceFramework");
const WebsocketConnection_1 = require("./WebsocketConnection");
const WebSocketAuthenticationMiddleware_1 = require("./WebSocketAuthenticationMiddleware");
const logging_1 = require("../logging");
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
            if (detectionResult.payloadType == "string" ||
                detectionResult.payloadType == "object") {
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
                        recipientAddress: this.address,
                        requesterAddress: this.address,
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
            const errorResponse = new core_1.ResponseBuilder(core_1.RequestBuilder.createSimple(connection.getConnectionId(), "undefined", {}), { data }).setError(new logging_1.LoggableError("Invalid message format"));
            connection.send(JSON.stringify(errorResponse.build()));
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
        const request = core_1.RequestBuilder.from(message);
        request.setRequiresResponse(false);
        const messageString = JSON.stringify(request.build());
        this.connections.forEach((connection) => {
            connection.send(messageString);
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBS2M7QUFHZCxrQ0FBMEQ7QUFFMUQsb0VBS2tDO0FBUWxDLCtEQUE0RDtBQUM1RCwyRkFBd0Y7QUFDeEYsd0NBQTJDO0FBd0QzQyxNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBZ0JDLFlBQVksT0FBaUIsRUFBRSxNQUE2QjtRQUMxRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBZGpCLGdCQUFXLEdBQXFDLElBQUksR0FBRyxFQUFFLENBQUM7UUFPMUQsb0JBQWUsR0FBb0I7WUFDekMsT0FBTyxFQUFFLElBQUk7WUFDYixRQUFRLEVBQUUsS0FBSyxFQUFFLGFBQWE7WUFDOUIsT0FBTyxFQUFFLElBQUksRUFBRSxZQUFZO1NBQzVCLENBQUM7UUFLQSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsTUFBTSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDO1FBQ3RFLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFB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LE9BQU87b0JBQ0wsV0FBVyxFQUFFLFdBQVc7b0JBQ3hCLE9BQU8sRUFBRSxNQUE0QjtpQkFDdEMsQ0FBQztZQUNKLENBQUM7WUFFRCx3REFBd0Q7WUFDeEQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDO1FBQ3BELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YseUNBQXlDO1lBQ3pDLE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztRQUNyRCxDQUFDO0lBQ0gsQ0FBQztTQUFNLENBQUM7UUFDTixxREFBcUQ7UUFDckQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO0lBQ3JELENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmVyLCBEYXRhIH0gZnJvbSBcIndzXCI7XG5pbXBvcnQge1xuICBjcmVhdGVTZXJ2ZXIsXG4gIFNlcnZlciBhcyBIdHRwU2VydmVyLFxuICBJbmNvbWluZ01lc3NhZ2UsXG4gIHJlcXVlc3QsXG59IGZyb20gXCJodHRwXCI7XG5pbXBvcnQgeyBEdXBsZXggfSBmcm9tIFwic3RyZWFtXCI7XG5pbXBvcnQgeyBJQXV0aGVudGljYXRpb25NZXRhZGF0YSwgSVNlc3Npb25EYXRhIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFJlcXVlc3RCdWlsZGVyLCBSZXNwb25zZUJ1aWxkZXIgfSBmcm9tIFwiLi4vY29yZVwiO1xuXG5pbXBvcnQge1xuICBNaWNyb3NlcnZpY2VGcmFtZXdvcmssXG4gIElTZXJ2ZXJDb25maWcsXG4gIFN0YXR1c1VwZGF0ZSxcbiAgUmVxdWVzdEhhbmRsZXIsXG59IGZyb20gXCIuLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7XG4gIElCYWNrRW5kLFxuICBJUmVxdWVzdCxcbiAgSVJlc3BvbnNlLFxuICBJU2Vzc2lvblN0b3JlLFxuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFdlYnNvY2tldENvbm5lY3Rpb24gfSBmcm9tIFwiLi9XZWJzb2NrZXRDb25uZWN0aW9uXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfSBmcm9tIFwiLi9XZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmVcIjtcbmltcG9ydCB7IExvZ2dhYmxlRXJyb3IgfSBmcm9tIFwiLi4vbG9nZ2luZ1wiO1xuXG50eXBlIFBheWxvYWRUeXBlID0gXCJvYmplY3RcIiB8IFwic3RyaW5nXCIgfCBcIklSZXF1ZXN0XCIgfCBcIklSZXNwb25zZVwiO1xuXG5pbnRlcmZhY2UgRGV0ZWN0aW9uUmVzdWx0PFQ+IHtcbiAgcGF5bG9hZFR5cGU6IFBheWxvYWRUeXBlO1xuICBwYXlsb2FkOiBUO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYXJ0YmVhdFJlcXVlc3Qge1xuICB0aW1lc3RhbXA6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZWFydGJlYXRSZXNwb25zZSB7XG4gIHJlcXVlc3RUaW1lc3RhbXA6IG51bWJlcjtcbiAgcmVzcG9uc2VUaW1lc3RhbXA6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZWFydGJlYXRDb25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBpbnRlcnZhbDogbnVtYmVyOyAvLyBIb3cgb2Z0ZW4gdG8gc2VuZCBoZWFydGJlYXRzIChtcylcbiAgdGltZW91dDogbnVtYmVyOyAvLyBIb3cgbG9uZyB0byB3YWl0IGZvciByZXNwb25zZSAobXMpXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5vbnltb3VzU2Vzc2lvbkNvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIHNlc3Npb25EdXJhdGlvbj86IG51bWJlcjsgLy8gRHVyYXRpb24gaW4gbWlsbGlzZWNvbmRzXG4gIHBlcnNpc3RlbnRJZGVudGl0eUVuYWJsZWQ/OiBib29sZWFuO1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEF1dGhlbnRpY2F0aW9uQ29uZmlnIHtcbiAgcmVxdWlyZWQ6IGJvb2xlYW47XG4gIGFsbG93QW5vbnltb3VzOiBib29sZWFuO1xuICBhbm9ueW1vdXNDb25maWc/OiBBbm9ueW1vdXNTZXNzaW9uQ29uZmlnO1xuICBhdXRoUHJvdmlkZXI/OiBJQXV0aGVudGljYXRpb25Qcm92aWRlcjtcbiAgc2Vzc2lvblN0b3JlOiBJU2Vzc2lvblN0b3JlO1xuICBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0U2VydmVyQ29uZmlnIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIHBvcnQ6IG51bWJlcjtcbiAgcGF0aD86IHN0cmluZztcbiAgbWF4Q29ubmVjdGlvbnM/OiBudW1iZXI7XG4gIGF1dGhlbnRpY2F0aW9uOiBBdXRoZW50aWNhdGlvbkNvbmZpZztcbiAgaGVhcnRiZWF0Q29uZmlnPzogSGVhcnRiZWF0Q29uZmlnO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRNZXNzYWdlID0ge1xuICB0eXBlOiBzdHJpbmc7XG4gIGRhdGE6IGFueTtcbiAgY29ubmVjdGlvbklkOiBzdHJpbmc7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFJlc3BvbnNlIHt9XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRTZXJ2ZXIgZXh0ZW5kcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFdlYlNvY2tldE1lc3NhZ2UsXG4gIFdlYlNvY2tldFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IEh0dHBTZXJ2ZXI7XG4gIHByaXZhdGUgd3NzOiBTZXJ2ZXI7XG4gIHByaXZhdGUgY29ubmVjdGlvbnM6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBwYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgbWF4Q29ubmVjdGlvbnM6IG51bWJlcjtcbiAgcHJpdmF0ZSBhdXRoQ29uZmlnOiBBdXRoZW50aWNhdGlvbkNvbmZpZztcbiAgcHJpdmF0ZSBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG5cbiAgcHJpdmF0ZSBoZWFydGJlYXRDb25maWc6IEhlYXJ0YmVhdENvbmZpZyA9IHtcbiAgICBlbmFibGVkOiB0cnVlLFxuICAgIGludGVydmFsOiAzMDAwMCwgLy8gMzAgc2Vjb25kc1xuICAgIHRpbWVvdXQ6IDUwMDAsIC8vIDUgc2Vjb25kc1xuICB9O1xuXG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQ6IElCYWNrRW5kLCBjb25maWc6IFdlYlNvY2tldFNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKGJhY2tlbmQsIGNvbmZpZyk7XG5cbiAgICB0aGlzLnZhbGlkYXRlQXV0aGVudGljYXRpb25Db25maWcoY29uZmlnLmF1dGhlbnRpY2F0aW9uKTtcblxuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0O1xuICAgIHRoaXMucGF0aCA9IGNvbmZpZy5wYXRoIHx8IFwiL3dzXCI7XG4gICAgdGhpcy5tYXhDb25uZWN0aW9ucyA9IGNvbmZpZy5tYXhDb25uZWN0aW9ucyB8fCAxMDAwO1xuICAgIHRoaXMuYXV0aENvbmZpZyA9IGNvbmZpZy5hdXRoZW50aWNhdGlvbjtcbiAgICB0aGlzLmhlYXJ0YmVhdENvbmZpZyA9IGNvbmZpZy5oZWFydGJlYXRDb25maWcgfHwgdGhpcy5oZWFydGJlYXRDb25maWc7XG4gICAgdGhpcy5zZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoKTtcbiAgICB0aGlzLndzcyA9IG5ldyBTZXJ2ZXIoeyBub1NlcnZlcjogdHJ1ZSB9KTtcblxuICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQgfHwgdGhpcy5hdXRoQ29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICBpZiAoIXRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiU2Vzc2lvbiBzdG9yZSBpcyByZXF1aXJlZCBmb3IgYm90aCBhdXRoZW50aWNhdGVkIGFuZCBhbm9ueW1vdXMgY29ubmVjdGlvbnNcIlxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkICYmICF0aGlzLmF1dGhDb25maWcuYXV0aFByb3ZpZGVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIHByb3ZpZGVyIGlzIHJlcXVpcmVkIHdoZW4gYXV0aGVudGljYXRpb24gaXMgcmVxdWlyZWRcIlxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSA9XG4gICAgICAgIGNvbmZpZy5hdXRoZW50aWNhdGlvbi5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfHxcbiAgICAgICAgbmV3IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZShcbiAgICAgICAgICB0aGlzLmF1dGhDb25maWcuYXV0aFByb3ZpZGVyISxcbiAgICAgICAgICB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgdGhpcy5zZXR1cFdlYlNvY2tldFNlcnZlcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cFdlYlNvY2tldFNlcnZlcigpIHtcbiAgICB0aGlzLnNlcnZlci5vbihcbiAgICAgIFwidXBncmFkZVwiLFxuICAgICAgYXN5bmMgKHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSwgc29ja2V0OiBEdXBsZXgsIGhlYWQ6IEJ1ZmZlcikgPT4ge1xuICAgICAgICAvLyBQcmV2ZW50IG1lbW9yeSBsZWFrcyBieSBoYW5kbGluZyBzb2NrZXQgZXJyb3JzXG4gICAgICAgIHNvY2tldC5vbihcImVycm9yXCIsIChlcnIpID0+IHtcbiAgICAgICAgICB0aGlzLmVycm9yKFwiU29ja2V0IGVycm9yOlwiLCBlcnIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFBhcnNlIHRoZSBVUkwgdG8gZ2V0IGp1c3QgdGhlIHBhdGhuYW1lXG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG5cbiAgICAgICAgaWYgKHVybC5wYXRobmFtZSAhPT0gdGhpcy5wYXRoKSB7XG4gICAgICAgICAgc29ja2V0LndyaXRlKFwiSFRUUC8xLjEgNDA0IE5vdCBGb3VuZFxcclxcblxcclxcblwiKTtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICAgIHRoaXMud2FybihgSW52YWxpZCBwYXRoOiAke3JlcXVlc3QudXJsfWApO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmhhbmRsZUF1dGhlbnRpY2F0aW9uKHJlcXVlc3QpO1xuICAgICAgICBpZiAoIWNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXG4gICAgICAgICAgICBcIkhUVFAvMS4xIDQwMSBVbmF1dGhvcml6ZWRcXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQ29ubmVjdGlvbjogY2xvc2VcXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluXFxyXFxuXFxyXFxuXCIgK1xuICAgICAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIGZhaWxlZFxcclxcblwiXG4gICAgICAgICAgKTtcbiAgICAgICAgICBzb2NrZXQuZW5kKCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy51cGdyYWRlQ29ubmVjdGlvbihyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsIGNvbm5lY3Rpb24pO1xuICAgICAgfVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHVwZ3JhZGVDb25uZWN0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSxcbiAgICBzb2NrZXQ6IER1cGxleCxcbiAgICBoZWFkOiBCdWZmZXIsXG4gICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24/OiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICkge1xuICAgIHRoaXMud3NzLmhhbmRsZVVwZ3JhZGUocmVxdWVzdCwgc29ja2V0LCBoZWFkLCAod3MpID0+IHtcbiAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb25zLnNpemUgPj0gdGhpcy5tYXhDb25uZWN0aW9ucykge1xuICAgICAgICB3cy5jbG9zZSgxMDEzLCBcIk1heGltdW0gbnVtYmVyIG9mIGNvbm5lY3Rpb25zIHJlYWNoZWRcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uKSB7XG4gICAgICAgIC8vIFNldCB0aGUgV2ViU29ja2V0IGluc3RhbmNlIG9uIHRoZSBleGlzdGluZyBjb25uZWN0aW9uXG4gICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLnNldFdlYlNvY2tldCh3cyk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDcmVhdGUgbmV3IGNvbm5lY3Rpb24gd2l0aCBXZWJTb2NrZXQgaW5zdGFuY2VcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB1bmRlZmluZWQsIC8vIGRlZmF1bHQgcmF0ZSBsaW1pdFxuICAgICAgICAgIHRoaXMuaGFuZGxlV3NFdmVudHMoKSxcbiAgICAgICAgICB3cyxcbiAgICAgICAgICB0aGlzLmhlYXJ0YmVhdENvbmZpZy5pbnRlcnZhbCxcbiAgICAgICAgICB0aGlzLmhlYXJ0YmVhdENvbmZpZy50aW1lb3V0XG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksIGNvbm5lY3Rpb24pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUF1dGhlbnRpY2F0aW9uQ29uZmlnKGNvbmZpZzogQXV0aGVudGljYXRpb25Db25maWcpOiB2b2lkIHtcbiAgICAvLyBDaGVjayBmb3IgaW52YWxpZCBjb25maWd1cmF0aW9uIHdoZXJlIG5vIGNvbm5lY3Rpb25zIHdvdWxkIGJlIHBvc3NpYmxlXG4gICAgaWYgKCFjb25maWcucmVxdWlyZWQgJiYgIWNvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiV2hlbiBhdXRoZW50aWNhdGlvbiBpcyBub3QgcmVxdWlyZWQsIHlvdSBtdXN0IGVpdGhlciBlbmFibGUgYW5vbnltb3VzIGNvbm5lY3Rpb25zIFwiICtcbiAgICAgICAgICBcIm9yIHNldCByZXF1aXJlZCB0byB0cnVlLiBDdXJyZW50IGNvbmZpZ3VyYXRpb24gd291bGQgcHJldmVudCBhbnkgY29ubmVjdGlvbnMuXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gQWRkaXRpb25hbCB2YWxpZGF0aW9uIGNoZWNrc1xuICAgIGlmIChjb25maWcucmVxdWlyZWQgJiYgIWNvbmZpZy5hdXRoUHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIHByb3ZpZGVyIGlzIHJlcXVpcmVkIHdoZW4gYXV0aGVudGljYXRpb24gaXMgcmVxdWlyZWRcIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLmFsbG93QW5vbnltb3VzICYmICFjb25maWcuc2Vzc2lvblN0b3JlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJTZXNzaW9uIHN0b3JlIGlzIHJlcXVpcmVkIHdoZW4gYW5vbnltb3VzIGNvbm5lY3Rpb25zIGFyZSBhbGxvd2VkXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgYW5vbnltb3VzIGNvbmZpZyBpZiBhbm9ueW1vdXMgY29ubmVjdGlvbnMgYXJlIGFsbG93ZWRcbiAgICBpZiAoY29uZmlnLmFsbG93QW5vbnltb3VzICYmIGNvbmZpZy5hbm9ueW1vdXNDb25maWcpIHtcbiAgICAgIGlmIChcbiAgICAgICAgY29uZmlnLmFub255bW91c0NvbmZpZy5zZXNzaW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICBjb25maWcuYW5vbnltb3VzQ29uZmlnLnNlc3Npb25EdXJhdGlvbiA8PSAwXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiSW52YWxpZCBhbm9ueW1vdXMgc2Vzc2lvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgICBcIlNlc3Npb24gZHVyYXRpb24gbXVzdCBiZSBwb3NpdGl2ZVwiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVBdXRoZW50aWNhdGlvbihcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2VcbiAgKTogUHJvbWlzZTxXZWJzb2NrZXRDb25uZWN0aW9uIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBGaXJzdCwgdHJ5IHRvIGF1dGhlbnRpY2F0ZSBpZiBjcmVkZW50aWFscyBhcmUgcHJvdmlkZWRcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKVxuICAgICAgKTtcblxuICAgICAgLy8gVHJ5IHRva2VuL2NyZWRlbnRpYWxzIGF1dGhlbnRpY2F0aW9uIGZpcnN0IGlmIG1pZGRsZXdhcmUgZXhpc3RzXG4gICAgICBpZiAodGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBhdXRoUmVzdWx0ID1cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlLmF1dGhlbnRpY2F0ZUNvbm5lY3Rpb24oXG4gICAgICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICAgICAgIGNvbm5lY3Rpb25cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKGF1dGhSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXV0aFJlc3VsdCkpIHtcbiAgICAgICAgICAgICAgaWYgKHZhbHVlKSBjb25uZWN0aW9uLnNldE1ldGFkYXRhKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb247XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIC8vIEF1dGhlbnRpY2F0aW9uIGZhaWxlZCwgYnV0IHdlIG1pZ2h0IHN0aWxsIGFsbG93IGFub255bW91cyBhY2Nlc3NcbiAgICAgICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gSWYgd2UgcmVhY2ggaGVyZSBhbmQgYW5vbnltb3VzIGFjY2VzcyBpcyBhbGxvd2VkLCBjcmVhdGUgYW5vbnltb3VzIHNlc3Npb25cbiAgICAgIGlmICh0aGlzLmF1dGhDb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVBbm9ueW1vdXNTZXNzaW9uKGNvbm5lY3Rpb24sIHJlcXVlc3QpO1xuICAgICAgICByZXR1cm4gY29ubmVjdGlvbjtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgd2UgcmVhY2ggaGVyZSwgbmVpdGhlciBhdXRoZW50aWNhdGlvbiBzdWNjZWVkZWQgbm9yIGFub255bW91cyBhY2Nlc3MgaXMgYWxsb3dlZFxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihcIkF1dGhlbnRpY2F0aW9uIGVycm9yOlwiLCBlcnJvcik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZUFub255bW91c1Nlc3Npb24oXG4gICAgY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvbixcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2VcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5hdXRoQ29uZmlnLmFub255bW91c0NvbmZpZyB8fCB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgc2Vzc2lvbkR1cmF0aW9uOiAyNCAqIDYwICogNjAgKiAxMDAwLCAvLyAyNCBob3VycyBkZWZhdWx0XG4gICAgfTtcblxuICAgIGNvbnN0IGRldmljZUlkID0gdGhpcy5leHRyYWN0RGV2aWNlSWQocmVxdWVzdCk7XG5cbiAgICBjb25zdCBzZXNzaW9uRGF0YTogSVNlc3Npb25EYXRhID0ge1xuICAgICAgc2Vzc2lvbklkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxuICAgICAgdXNlcklkOiBkZXZpY2VJZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpLCAvLyBVc2UgZGV2aWNlIElEIGFzIHVzZXJJZCBpZiBhdmFpbGFibGVcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKSxcbiAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoXG4gICAgICAgIERhdGUubm93KCkgKyAoY29uZmlnLnNlc3Npb25EdXJhdGlvbiB8fCAyNCAqIDYwICogNjAgKiAxMDAwKVxuICAgICAgKSxcbiAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgLi4uY29uZmlnLm1ldGFkYXRhLFxuICAgICAgICBpc0Fub255bW91czogdHJ1ZSxcbiAgICAgICAgZGV2aWNlSWQsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBhd2FpdCB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlLmNyZWF0ZShzZXNzaW9uRGF0YSk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInNlc3Npb25JZFwiLCBzZXNzaW9uRGF0YS5zZXNzaW9uSWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJ1c2VySWRcIiwgc2Vzc2lvbkRhdGEudXNlcklkKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwiaXNBbm9ueW1vdXNcIiwgdHJ1ZSk7XG4gICAgY29ubmVjdGlvbi5zZXRBdXRoZW50aWNhdGVkKGZhbHNlKTtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdERldmljZUlkKHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIFRyeSB0byBleHRyYWN0IGRldmljZSBJRCBmcm9tIHZhcmlvdXMgc291cmNlc1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG5cbiAgICAvLyBDaGVjayBxdWVyeSBwYXJhbWV0ZXJzXG4gICAgY29uc3QgZGV2aWNlSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImRldmljZUlkXCIpO1xuICAgIGlmIChkZXZpY2VJZCkgcmV0dXJuIGRldmljZUlkO1xuXG4gICAgLy8gQ2hlY2sgaGVhZGVyc1xuICAgIGNvbnN0IGRldmljZUlkSGVhZGVyID0gcmVxdWVzdC5oZWFkZXJzW1wieC1kZXZpY2UtaWRcIl07XG4gICAgaWYgKGRldmljZUlkSGVhZGVyKSByZXR1cm4gZGV2aWNlSWRIZWFkZXIudG9TdHJpbmcoKTtcblxuICAgIC8vIENoZWNrIGNvb2tpZXNcbiAgICBjb25zdCBjb29raWVzID0gcmVxdWVzdC5oZWFkZXJzLmNvb2tpZVxuICAgICAgPy5zcGxpdChcIjtcIilcbiAgICAgIC5tYXAoKGNvb2tpZSkgPT4gY29va2llLnRyaW0oKS5zcGxpdChcIj1cIikpXG4gICAgICAuZmluZCgoW2tleV0pID0+IGtleSA9PT0gXCJkZXZpY2VJZFwiKTtcblxuICAgIHJldHVybiBjb29raWVzID8gY29va2llc1sxXSA6IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVdzRXZlbnRzKCkge1xuICAgIHJldHVybiB7XG4gICAgICBvblJhdGVMaW1pdDogKGNvbm5lY3Rpb25JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgUmF0ZSBsaW1pdCBleGNlZWRlZCBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlJhdGUgbGltaXQgZXhjZWVkZWRcIik7XG4gICAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uRXJyb3I6IChjb25uZWN0aW9uSWQ6IHN0cmluZywgZXJyb3I6IEVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgRXJyb3IgZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBjb25uZWN0aW9uIGVycm9zXG4gICAgICB9LFxuICAgICAgb25TZWN1cml0eVZpb2xhdGlvbjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCB2aW9sYXRpb246IHN0cmluZykgPT4ge1xuICAgICAgICB0aGlzLndhcm4oXG4gICAgICAgICAgYFNlY3VyaXR5IHZpb2xhdGlvbiBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7dmlvbGF0aW9ufWBcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlNlY3VyaXR5IHZpb2xhdGlvblwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBjb25uZWN0aW9uLnJlZnJlc2hTZXNzaW9uKHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKFxuICAgIGRhdGE6IERhdGEsXG4gICAgY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvblxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yZWZyZXNoU2Vzc2lvbihjb25uZWN0aW9uKTtcbiAgICAgIC8vIFRPRE86IGhhbmRsZSBleHBpcmVkIHNlc3Npb25zXG4gICAgICBjb25zdCBzdHJEYXRhID0gZGF0YS50b1N0cmluZygpO1xuICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2Uoc3RyRGF0YSk7XG5cbiAgICAgIGlmIChcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwib2JqZWN0XCJcbiAgICAgICkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiBcInJhd1wiLFxuICAgICAgICAgIGJvZHk6IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkLFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXNwb25zZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlc3BvbnNlPGFueT47XG4gICAgICAgIGlmIChcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RUeXBlICYmXG4gICAgICAgICAgcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzICYmXG4gICAgICAgICAgcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzICE9XG4gICAgICAgICAgICByZXNwb25zZS5yZXNwb25zZUhlYWRlci5yZXNwb25kZXJBZGRyZXNzXG4gICAgICAgICkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RUeXBlLFxuICAgICAgICAgICAgcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzLFxuICAgICAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UuYm9keSksXG4gICAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RJZFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlcXVlc3RcIikge1xuICAgICAgICBjb25zdCByZXF1ZXN0ID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlcXVlc3Q8YW55PjtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIG5vbi1hdXRoZW50aWNhdGVkIFJlcXVlc3RzXG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBhdXRob3JpemF0aW9uXG5cbiAgICAgICAgbGV0IGF1dGhNZXRhZGF0YTogSUF1dGhlbnRpY2F0aW9uTWV0YWRhdGEgPSB7fTtcbiAgICAgICAgYXV0aE1ldGFkYXRhLmlzQXV0aGVudGljYXRlZCA9IGNvbm5lY3Rpb24uaXNBdXRoZW50aWNhdGVkKCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uLmlzQXV0aGVudGljYXRlZCgpKSB7XG4gICAgICAgICAgYXV0aE1ldGFkYXRhLnNlc3Npb25JZCA9IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCk7XG4gICAgICAgICAgYXV0aE1ldGFkYXRhLnVzZXJJZCA9IGNvbm5lY3Rpb24uZ2V0TWV0YWRhdGEoXCJ1c2VySWRcIik7XG4gICAgICAgICAgYXV0aE1ldGFkYXRhLmNvbm5lY3Rpb25JZCA9IGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHJlcXVlc3QuaGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgfHwgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlIHx8IFwidW5rbm93blwiLFxuICAgICAgICAgIGJvZHk6IHJlcXVlc3QuYm9keSxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBjb25uZWN0aW9uLmdldFNlc3Npb25JZCgpLFxuICAgICAgICAgICAgYXV0aE1ldGFkYXRhLFxuICAgICAgICAgICAgcmVjaXBpZW50QWRkcmVzczogdGhpcy5hZGRyZXNzLFxuICAgICAgICAgICAgcmVxdWVzdGVyQWRkcmVzczogdGhpcy5hZGRyZXNzLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOiBhc3luYyAoXG4gICAgICAgICAgICB1cGRhdGVSZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgICAgICAgICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgICAgICAgICApID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c1VwZGF0ZSA9IE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXNwb25zZShcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdCxcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICAgICAgc3RhdHVzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHN0YXR1c1VwZGF0ZSkpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFdlYlNvY2tldCBtZXNzYWdlYCwgZXJyb3IpO1xuXG4gICAgICBjb25zdCBlcnJvclJlc3BvbnNlID0gbmV3IFJlc3BvbnNlQnVpbGRlcihcbiAgICAgICAgUmVxdWVzdEJ1aWxkZXIuY3JlYXRlU2ltcGxlKFxuICAgICAgICAgIGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksXG4gICAgICAgICAgXCJ1bmRlZmluZWRcIixcbiAgICAgICAgICB7fVxuICAgICAgICApLFxuICAgICAgICB7IGRhdGEgfVxuICAgICAgKS5zZXRFcnJvcihuZXcgTG9nZ2FibGVFcnJvcihcIkludmFsaWQgbWVzc2FnZSBmb3JtYXRcIikpO1xuXG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoZXJyb3JSZXNwb25zZS5idWlsZCgpKSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDbG9zZShjb25uZWN0aW9uSWQ6IHN0cmluZykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICBhd2FpdCBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiQ29ubmVjdGlvbiBjbG9zZWRcIik7XG4gICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgY29uc3Qgc2Vzc2lvbklkID0gY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKTtcbiAgICAgIGlmIChzZXNzaW9uSWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5kZWxldGUoc2Vzc2lvbklkKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IGNvbm5lY3Rpb24gY2xvc2VkOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gRmlyc3QsIHN0b3AgYWNjZXB0aW5nIG5ldyBjb25uZWN0aW9uc1xuICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKTtcblxuICAgICAgLy8gQ2xvc2UgYWxsIGFjdGl2ZSBjb25uZWN0aW9uc1xuICAgICAgdGhpcy5pbmZvKFwiQ2xvc2luZyBhbGwgYWN0aXZlIFdlYlNvY2tldCBjb25uZWN0aW9ucy4uLlwiKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICBBcnJheS5mcm9tKHRoaXMuY29ubmVjdGlvbnMudmFsdWVzKCkpLm1hcCgoY29ubmVjdGlvbikgPT5cbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIilcbiAgICAgICAgKVxuICAgICAgKTtcblxuICAgICAgLy8gV2FpdCBmb3IgdGhlIFdTUyB0byBjbG9zZSBwcm9wZXJseVxuICAgICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAvLyBTZXQgYSB0aW1lb3V0IHRvIHByZXZlbnQgaGFuZ2luZ1xuICAgICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIldTUyBjbG9zZSB0aW1lb3V0XCIpKTtcbiAgICAgICAgfSwgNTAwMCk7XG5cbiAgICAgICAgdGhpcy53c3MuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoXCJFcnJvciBkdXJpbmcgc2h1dGRvd246XCIsIGVycm9yKTtcbiAgICAgIC8vIEZvcmNlIGNsb3NlIGV2ZXJ5dGhpbmdcbiAgICAgIHRoaXMud3NzLmNsaWVudHMuZm9yRWFjaCgoY2xpZW50KSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY2xpZW50LnRlcm1pbmF0ZSgpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgLy8gSWdub3JlIGVycm9ycyBkdXJpbmcgZm9yY2UgdGVybWluYXRpb25cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgdG8gaW5kaWNhdGUgc2h1dGRvd24gZmFpbHVyZVxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb25uZWN0aW9ucygpOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnM7XG4gIH1cblxuICBwdWJsaWMgYnJvYWRjYXN0KG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4pOiB2b2lkIHtcbiAgICBjb25zdCByZXF1ZXN0ID0gUmVxdWVzdEJ1aWxkZXIuZnJvbShtZXNzYWdlKTtcbiAgICByZXF1ZXN0LnNldFJlcXVpcmVzUmVzcG9uc2UoZmFsc2UpO1xuICAgIGNvbnN0IG1lc3NhZ2VTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShyZXF1ZXN0LmJ1aWxkKCkpO1xuICAgIHRoaXMuY29ubmVjdGlvbnMuZm9yRWFjaCgoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKG1lc3NhZ2VTdHJpbmcpO1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZ2V0U2Vzc2lvbkJ5SWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPElTZXNzaW9uRGF0YSB8IG51bGw+IHtcbiAgICByZXR1cm4gdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5nZXQoc2Vzc2lvbklkKTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxzdHJpbmc+KFwicmF3XCIpXG4gIHByb3RlY3RlZCBhc3luYyByYXdNZXNzYWdlSGFuZGxlcihtZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRoaXMud2FybihgUmVjZWl2ZWQgcmF3IG1lc3NhZ2VgLCBtZXNzYWdlKTtcbiAgICByZXR1cm4gXCJFUlJPUjogUmF3IG1lc3NhZ2VzIG5vdCBzdXBwb3J0ZWQuIFBsZWFzZSB1c2UgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCI7XG4gIH1cbn1cblxuZnVuY3Rpb24gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2UobWVzc2FnZTogc3RyaW5nKTogRGV0ZWN0aW9uUmVzdWx0PHVua25vd24+IHtcbiAgLy8gRmlyc3QsIGNoZWNrIGlmIHRoZSBtZXNzYWdlIGlzIGxpa2VseSBKU09OIG9yIGEgSmF2YVNjcmlwdC1saWtlIG9iamVjdFxuICBpZiAobWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIntcIikgfHwgbWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIltcIikpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShtZXNzYWdlKTtcblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlcXVlc3RcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJoZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuaGVhZGVyID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwidGltZXN0YW1wXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RJZFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0ZXJBZGRyZXNzXCIgaW4gcGFyc2VkLmhlYWRlclxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlcXVlc3RcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlcXVlc3Q8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXNwb25zZVxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcInJlcXVlc3RIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJyZXNwb25zZUhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWRcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXNwb25zZVwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVzcG9uc2U8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIElmIGl0J3MgYSBwYXJzZWQgb2JqZWN0IGJ1dCBub3QgSVJlcXVlc3Qgb3IgSVJlc3BvbnNlXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJvYmplY3RcIiwgcGF5bG9hZDogcGFyc2VkIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElmIHBhcnNpbmcgZmFpbHMsIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBpdCBkb2Vzbid0IGxvb2sgbGlrZSBKU09OLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gIH1cbn1cbiJdfQ==