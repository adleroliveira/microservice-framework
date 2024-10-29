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
                await this.sendOneWayMessage(JSON.stringify(response), response.requestHeader.requesterAddress, response.body);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBSTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBd0R4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBZ0JDLFlBQVksT0FBaUIsRUFBRSxNQUE2QjtRQUMxRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBZGpCLGdCQUFXLEdBQXFDLElBQUksR0FBRyxFQUFFLENBQUM7UUFPMUQsb0JBQWUsR0FBb0I7WUFDekMsT0FBTyxFQUFFLElBQUk7WUFDYixRQUFRLEVBQUUsS0FBSyxFQUFFLGFBQWE7WUFDOUIsT0FBTyxFQUFFLElBQUksRUFBRSxZQUFZO1NBQzVCLENBQUM7UUFLQSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsTUFBTSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDO1FBQ3RFLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxD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QUM7UUFDckQsQ0FBQztJQUNILENBQUM7U0FBTSxDQUFDO1FBQ04scURBQXFEO1FBQ3JELE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztJQUNyRCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNlcnZlciwgRGF0YSB9IGZyb20gXCJ3c1wiO1xuaW1wb3J0IHsgY3JlYXRlU2VydmVyLCBTZXJ2ZXIgYXMgSHR0cFNlcnZlciwgSW5jb21pbmdNZXNzYWdlIH0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB7IER1cGxleCB9IGZyb20gXCJzdHJlYW1cIjtcbmltcG9ydCB7IElBdXRoZW50aWNhdGlvbk1ldGFkYXRhLCBJU2Vzc2lvbkRhdGEgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuXG5pbXBvcnQge1xuICBNaWNyb3NlcnZpY2VGcmFtZXdvcmssXG4gIElTZXJ2ZXJDb25maWcsXG4gIFN0YXR1c1VwZGF0ZSxcbiAgUmVxdWVzdEhhbmRsZXIsXG59IGZyb20gXCIuLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7XG4gIElCYWNrRW5kLFxuICBJUmVxdWVzdCxcbiAgSVJlc3BvbnNlLFxuICBJU2Vzc2lvblN0b3JlLFxuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFdlYnNvY2tldENvbm5lY3Rpb24gfSBmcm9tIFwiLi9XZWJzb2NrZXRDb25uZWN0aW9uXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfSBmcm9tIFwiLi9XZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmVcIjtcblxudHlwZSBQYXlsb2FkVHlwZSA9IFwib2JqZWN0XCIgfCBcInN0cmluZ1wiIHwgXCJJUmVxdWVzdFwiIHwgXCJJUmVzcG9uc2VcIjtcblxuaW50ZXJmYWNlIERldGVjdGlvblJlc3VsdDxUPiB7XG4gIHBheWxvYWRUeXBlOiBQYXlsb2FkVHlwZTtcbiAgcGF5bG9hZDogVDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZWFydGJlYXRSZXF1ZXN0IHtcbiAgdGltZXN0YW1wOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGVhcnRiZWF0UmVzcG9uc2Uge1xuICByZXF1ZXN0VGltZXN0YW1wOiBudW1iZXI7XG4gIHJlc3BvbnNlVGltZXN0YW1wOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGVhcnRiZWF0Q29uZmlnIHtcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgaW50ZXJ2YWw6IG51bWJlcjsgLy8gSG93IG9mdGVuIHRvIHNlbmQgaGVhcnRiZWF0cyAobXMpXG4gIHRpbWVvdXQ6IG51bWJlcjsgLy8gSG93IGxvbmcgdG8gd2FpdCBmb3IgcmVzcG9uc2UgKG1zKVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFub255bW91c1Nlc3Npb25Db25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBzZXNzaW9uRHVyYXRpb24/OiBudW1iZXI7IC8vIER1cmF0aW9uIGluIG1pbGxpc2Vjb25kc1xuICBwZXJzaXN0ZW50SWRlbnRpdHlFbmFibGVkPzogYm9vbGVhbjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBdXRoZW50aWNhdGlvbkNvbmZpZyB7XG4gIHJlcXVpcmVkOiBib29sZWFuO1xuICBhbGxvd0Fub255bW91czogYm9vbGVhbjtcbiAgYW5vbnltb3VzQ29uZmlnPzogQW5vbnltb3VzU2Vzc2lvbkNvbmZpZztcbiAgYXV0aFByb3ZpZGVyPzogSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXI7XG4gIHNlc3Npb25TdG9yZTogSVNlc3Npb25TdG9yZTtcbiAgYXV0aGVudGljYXRpb25NaWRkbGV3YXJlPzogV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFNlcnZlckNvbmZpZyBleHRlbmRzIElTZXJ2ZXJDb25maWcge1xuICBwb3J0OiBudW1iZXI7XG4gIHBhdGg/OiBzdHJpbmc7XG4gIG1heENvbm5lY3Rpb25zPzogbnVtYmVyO1xuICBhdXRoZW50aWNhdGlvbjogQXV0aGVudGljYXRpb25Db25maWc7XG4gIGhlYXJ0YmVhdENvbmZpZz86IEhlYXJ0YmVhdENvbmZpZztcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0TWVzc2FnZSA9IHtcbiAgdHlwZTogc3RyaW5nO1xuICBkYXRhOiBhbnk7XG4gIGNvbm5lY3Rpb25JZDogc3RyaW5nO1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRSZXNwb25zZSB7fVxuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0U2VydmVyIGV4dGVuZHMgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBXZWJTb2NrZXRNZXNzYWdlLFxuICBXZWJTb2NrZXRSZXNwb25zZVxuPiB7XG4gIHByaXZhdGUgc2VydmVyOiBIdHRwU2VydmVyO1xuICBwcml2YXRlIHdzczogU2VydmVyO1xuICBwcml2YXRlIGNvbm5lY3Rpb25zOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gIHByaXZhdGUgcGF0aDogc3RyaW5nO1xuICBwcml2YXRlIG1heENvbm5lY3Rpb25zOiBudW1iZXI7XG4gIHByaXZhdGUgYXV0aENvbmZpZzogQXV0aGVudGljYXRpb25Db25maWc7XG4gIHByaXZhdGUgYXV0aGVudGljYXRpb25NaWRkbGV3YXJlPzogV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlO1xuXG4gIHByaXZhdGUgaGVhcnRiZWF0Q29uZmlnOiBIZWFydGJlYXRDb25maWcgPSB7XG4gICAgZW5hYmxlZDogdHJ1ZSxcbiAgICBpbnRlcnZhbDogMzAwMDAsIC8vIDMwIHNlY29uZHNcbiAgICB0aW1lb3V0OiA1MDAwLCAvLyA1IHNlY29uZHNcbiAgfTtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTb2NrZXRTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuXG4gICAgdGhpcy52YWxpZGF0ZUF1dGhlbnRpY2F0aW9uQ29uZmlnKGNvbmZpZy5hdXRoZW50aWNhdGlvbik7XG5cbiAgICB0aGlzLnBvcnQgPSBjb25maWcucG9ydDtcbiAgICB0aGlzLnBhdGggPSBjb25maWcucGF0aCB8fCBcIi93c1wiO1xuICAgIHRoaXMubWF4Q29ubmVjdGlvbnMgPSBjb25maWcubWF4Q29ubmVjdGlvbnMgfHwgMTAwMDtcbiAgICB0aGlzLmF1dGhDb25maWcgPSBjb25maWcuYXV0aGVudGljYXRpb247XG4gICAgdGhpcy5oZWFydGJlYXRDb25maWcgPSBjb25maWcuaGVhcnRiZWF0Q29uZmlnIHx8IHRoaXMuaGVhcnRiZWF0Q29uZmlnO1xuICAgIHRoaXMuc2VydmVyID0gY3JlYXRlU2VydmVyKCk7XG4gICAgdGhpcy53c3MgPSBuZXcgU2VydmVyKHsgbm9TZXJ2ZXI6IHRydWUgfSk7XG5cbiAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkIHx8IHRoaXMuYXV0aENvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgaWYgKCF0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIlNlc3Npb24gc3RvcmUgaXMgcmVxdWlyZWQgZm9yIGJvdGggYXV0aGVudGljYXRlZCBhbmQgYW5vbnltb3VzIGNvbm5lY3Rpb25zXCJcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuYXV0aENvbmZpZy5yZXF1aXJlZCAmJiAhdGhpcy5hdXRoQ29uZmlnLmF1dGhQcm92aWRlcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBwcm92aWRlciBpcyByZXF1aXJlZCB3aGVuIGF1dGhlbnRpY2F0aW9uIGlzIHJlcXVpcmVkXCJcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgPVxuICAgICAgICBjb25maWcuYXV0aGVudGljYXRpb24uYXV0aGVudGljYXRpb25NaWRkbGV3YXJlIHx8XG4gICAgICAgIG5ldyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUoXG4gICAgICAgICAgdGhpcy5hdXRoQ29uZmlnLmF1dGhQcm92aWRlciEsXG4gICAgICAgICAgdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZVxuICAgICAgICApO1xuICAgIH1cblxuICAgIHRoaXMuc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKSB7XG4gICAgdGhpcy5zZXJ2ZXIub24oXG4gICAgICBcInVwZ3JhZGVcIixcbiAgICAgIGFzeW5jIChyZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UsIHNvY2tldDogRHVwbGV4LCBoZWFkOiBCdWZmZXIpID0+IHtcbiAgICAgICAgLy8gUHJldmVudCBtZW1vcnkgbGVha3MgYnkgaGFuZGxpbmcgc29ja2V0IGVycm9yc1xuICAgICAgICBzb2NrZXQub24oXCJlcnJvclwiLCAoZXJyKSA9PiB7XG4gICAgICAgICAgdGhpcy5lcnJvcihcIlNvY2tldCBlcnJvcjpcIiwgZXJyKTtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQYXJzZSB0aGUgVVJMIHRvIGdldCBqdXN0IHRoZSBwYXRobmFtZVxuICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcXVlc3QudXJsISwgYGh0dHA6Ly8ke3JlcXVlc3QuaGVhZGVycy5ob3N0fWApO1xuXG4gICAgICAgIGlmICh1cmwucGF0aG5hbWUgIT09IHRoaXMucGF0aCkge1xuICAgICAgICAgIHNvY2tldC53cml0ZShcIkhUVFAvMS4xIDQwNCBOb3QgRm91bmRcXHJcXG5cXHJcXG5cIik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgICB0aGlzLndhcm4oYEludmFsaWQgcGF0aDogJHtyZXF1ZXN0LnVybH1gKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5oYW5kbGVBdXRoZW50aWNhdGlvbihyZXF1ZXN0KTtcbiAgICAgICAgaWYgKCFjb25uZWN0aW9uKSB7XG4gICAgICAgICAgc29ja2V0LndyaXRlKFxuICAgICAgICAgICAgXCJIVFRQLzEuMSA0MDEgVW5hdXRob3JpemVkXFxyXFxuXCIgK1xuICAgICAgICAgICAgICBcIkNvbm5lY3Rpb246IGNsb3NlXFxyXFxuXCIgK1xuICAgICAgICAgICAgICBcIkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpblxcclxcblxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBmYWlsZWRcXHJcXG5cIlxuICAgICAgICAgICk7XG4gICAgICAgICAgc29ja2V0LmVuZCgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMudXBncmFkZUNvbm5lY3Rpb24ocmVxdWVzdCwgc29ja2V0LCBoZWFkLCBjb25uZWN0aW9uKTtcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGdyYWRlQ29ubmVjdGlvbihcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UsXG4gICAgc29ja2V0OiBEdXBsZXgsXG4gICAgaGVhZDogQnVmZmVyLFxuICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uPzogV2Vic29ja2V0Q29ubmVjdGlvblxuICApIHtcbiAgICB0aGlzLndzcy5oYW5kbGVVcGdyYWRlKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgKHdzKSA9PiB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5zaXplID49IHRoaXMubWF4Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgd3MuY2xvc2UoMTAxMywgXCJNYXhpbXVtIG51bWJlciBvZiBjb25uZWN0aW9ucyByZWFjaGVkXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChhdXRoZW50aWNhdGVkQ29ubmVjdGlvbikge1xuICAgICAgICAvLyBTZXQgdGhlIFdlYlNvY2tldCBpbnN0YW5jZSBvbiB0aGUgZXhpc3RpbmcgY29ubmVjdGlvblxuICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5zZXRXZWJTb2NrZXQod3MpO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSxcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvblxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBjb25uZWN0aW9uIHdpdGggV2ViU29ja2V0IGluc3RhbmNlXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB0aGlzLmhhbmRsZUNsb3NlLmJpbmQodGhpcyksXG4gICAgICAgICAgdW5kZWZpbmVkLCAvLyBkZWZhdWx0IHJhdGUgbGltaXRcbiAgICAgICAgICB0aGlzLmhhbmRsZVdzRXZlbnRzKCksXG4gICAgICAgICAgd3MsXG4gICAgICAgICAgdGhpcy5oZWFydGJlYXRDb25maWcuaW50ZXJ2YWwsXG4gICAgICAgICAgdGhpcy5oZWFydGJlYXRDb25maWcudGltZW91dFxuICAgICAgICApO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLCBjb25uZWN0aW9uKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVBdXRoZW50aWNhdGlvbkNvbmZpZyhjb25maWc6IEF1dGhlbnRpY2F0aW9uQ29uZmlnKTogdm9pZCB7XG4gICAgLy8gQ2hlY2sgZm9yIGludmFsaWQgY29uZmlndXJhdGlvbiB3aGVyZSBubyBjb25uZWN0aW9ucyB3b3VsZCBiZSBwb3NzaWJsZVxuICAgIGlmICghY29uZmlnLnJlcXVpcmVkICYmICFjb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIldoZW4gYXV0aGVudGljYXRpb24gaXMgbm90IHJlcXVpcmVkLCB5b3UgbXVzdCBlaXRoZXIgZW5hYmxlIGFub255bW91cyBjb25uZWN0aW9ucyBcIiArXG4gICAgICAgICAgXCJvciBzZXQgcmVxdWlyZWQgdG8gdHJ1ZS4gQ3VycmVudCBjb25maWd1cmF0aW9uIHdvdWxkIHByZXZlbnQgYW55IGNvbm5lY3Rpb25zLlwiXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIEFkZGl0aW9uYWwgdmFsaWRhdGlvbiBjaGVja3NcbiAgICBpZiAoY29uZmlnLnJlcXVpcmVkICYmICFjb25maWcuYXV0aFByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBwcm92aWRlciBpcyByZXF1aXJlZCB3aGVuIGF1dGhlbnRpY2F0aW9uIGlzIHJlcXVpcmVkXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy5hbGxvd0Fub255bW91cyAmJiAhY29uZmlnLnNlc3Npb25TdG9yZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiU2Vzc2lvbiBzdG9yZSBpcyByZXF1aXJlZCB3aGVuIGFub255bW91cyBjb25uZWN0aW9ucyBhcmUgYWxsb3dlZFwiXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIGFub255bW91cyBjb25maWcgaWYgYW5vbnltb3VzIGNvbm5lY3Rpb25zIGFyZSBhbGxvd2VkXG4gICAgaWYgKGNvbmZpZy5hbGxvd0Fub255bW91cyAmJiBjb25maWcuYW5vbnltb3VzQ29uZmlnKSB7XG4gICAgICBpZiAoXG4gICAgICAgIGNvbmZpZy5hbm9ueW1vdXNDb25maWcuc2Vzc2lvbkR1cmF0aW9uICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgY29uZmlnLmFub255bW91c0NvbmZpZy5zZXNzaW9uRHVyYXRpb24gPD0gMFxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIkludmFsaWQgYW5vbnltb3VzIHNlc3Npb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgICAgXCJTZXNzaW9uIGR1cmF0aW9uIG11c3QgYmUgcG9zaXRpdmVcIlxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQXV0aGVudGljYXRpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlXG4gICk6IFByb21pc2U8V2Vic29ja2V0Q29ubmVjdGlvbiB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgLy8gRmlyc3QsIHRyeSB0byBhdXRoZW50aWNhdGUgaWYgY3JlZGVudGlhbHMgYXJlIHByb3ZpZGVkXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLmhhbmRsZUNsb3NlLmJpbmQodGhpcylcbiAgICAgICk7XG5cbiAgICAgIC8vIFRyeSB0b2tlbi9jcmVkZW50aWFscyBhdXRoZW50aWNhdGlvbiBmaXJzdCBpZiBtaWRkbGV3YXJlIGV4aXN0c1xuICAgICAgaWYgKHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgYXV0aFJlc3VsdCA9XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZS5hdXRoZW50aWNhdGVDb25uZWN0aW9uKFxuICAgICAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgICAgICBjb25uZWN0aW9uXG4gICAgICAgICAgICApO1xuICAgICAgICAgIGlmIChhdXRoUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF1dGhSZXN1bHQpKSB7XG4gICAgICAgICAgICAgIGlmICh2YWx1ZSkgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBjb25uZWN0aW9uO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAvLyBBdXRoZW50aWNhdGlvbiBmYWlsZWQsIGJ1dCB3ZSBtaWdodCBzdGlsbCBhbGxvdyBhbm9ueW1vdXMgYWNjZXNzXG4gICAgICAgICAgaWYgKHRoaXMuYXV0aENvbmZpZy5yZXF1aXJlZCkge1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHdlIHJlYWNoIGhlcmUgYW5kIGFub255bW91cyBhY2Nlc3MgaXMgYWxsb3dlZCwgY3JlYXRlIGFub255bW91cyBzZXNzaW9uXG4gICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlQW5vbnltb3VzU2Vzc2lvbihjb25uZWN0aW9uLCByZXF1ZXN0KTtcbiAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb247XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHdlIHJlYWNoIGhlcmUsIG5laXRoZXIgYXV0aGVudGljYXRpb24gc3VjY2VlZGVkIG5vciBhbm9ueW1vdXMgYWNjZXNzIGlzIGFsbG93ZWRcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoXCJBdXRoZW50aWNhdGlvbiBlcnJvcjpcIiwgZXJyb3IpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjcmVhdGVBbm9ueW1vdXNTZXNzaW9uKFxuICAgIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24sXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuYXV0aENvbmZpZy5hbm9ueW1vdXNDb25maWcgfHwge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25EdXJhdGlvbjogMjQgKiA2MCAqIDYwICogMTAwMCwgLy8gMjQgaG91cnMgZGVmYXVsdFxuICAgIH07XG5cbiAgICBjb25zdCBkZXZpY2VJZCA9IHRoaXMuZXh0cmFjdERldmljZUlkKHJlcXVlc3QpO1xuXG4gICAgY29uc3Qgc2Vzc2lvbkRhdGE6IElTZXNzaW9uRGF0YSA9IHtcbiAgICAgIHNlc3Npb25JZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcbiAgICAgIHVzZXJJZDogZGV2aWNlSWQgfHwgY3J5cHRvLnJhbmRvbVVVSUQoKSwgLy8gVXNlIGRldmljZSBJRCBhcyB1c2VySWQgaWYgYXZhaWxhYmxlXG4gICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBleHBpcmVzQXQ6IG5ldyBEYXRlKFxuICAgICAgICBEYXRlLm5vdygpICsgKGNvbmZpZy5zZXNzaW9uRHVyYXRpb24gfHwgMjQgKiA2MCAqIDYwICogMTAwMClcbiAgICAgICksXG4gICAgICBsYXN0QWNjZXNzZWRBdDogbmV3IERhdGUoKSxcbiAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgIC4uLmNvbmZpZy5tZXRhZGF0YSxcbiAgICAgICAgaXNBbm9ueW1vdXM6IHRydWUsXG4gICAgICAgIGRldmljZUlkLFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgYXdhaXQgdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5jcmVhdGUoc2Vzc2lvbkRhdGEpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJzZXNzaW9uSWRcIiwgc2Vzc2lvbkRhdGEuc2Vzc2lvbklkKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwidXNlcklkXCIsIHNlc3Npb25EYXRhLnVzZXJJZCk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcImlzQW5vbnltb3VzXCIsIHRydWUpO1xuICAgIGNvbm5lY3Rpb24uc2V0QXV0aGVudGljYXRlZChmYWxzZSk7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3REZXZpY2VJZChyZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBUcnkgdG8gZXh0cmFjdCBkZXZpY2UgSUQgZnJvbSB2YXJpb3VzIHNvdXJjZXNcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcXVlc3QudXJsISwgYGh0dHA6Ly8ke3JlcXVlc3QuaGVhZGVycy5ob3N0fWApO1xuXG4gICAgLy8gQ2hlY2sgcXVlcnkgcGFyYW1ldGVyc1xuICAgIGNvbnN0IGRldmljZUlkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJkZXZpY2VJZFwiKTtcbiAgICBpZiAoZGV2aWNlSWQpIHJldHVybiBkZXZpY2VJZDtcblxuICAgIC8vIENoZWNrIGhlYWRlcnNcbiAgICBjb25zdCBkZXZpY2VJZEhlYWRlciA9IHJlcXVlc3QuaGVhZGVyc1tcIngtZGV2aWNlLWlkXCJdO1xuICAgIGlmIChkZXZpY2VJZEhlYWRlcikgcmV0dXJuIGRldmljZUlkSGVhZGVyLnRvU3RyaW5nKCk7XG5cbiAgICAvLyBDaGVjayBjb29raWVzXG4gICAgY29uc3QgY29va2llcyA9IHJlcXVlc3QuaGVhZGVycy5jb29raWVcbiAgICAgID8uc3BsaXQoXCI7XCIpXG4gICAgICAubWFwKChjb29raWUpID0+IGNvb2tpZS50cmltKCkuc3BsaXQoXCI9XCIpKVxuICAgICAgLmZpbmQoKFtrZXldKSA9PiBrZXkgPT09IFwiZGV2aWNlSWRcIik7XG5cbiAgICByZXR1cm4gY29va2llcyA/IGNvb2tpZXNbMV0gOiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVXc0V2ZW50cygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb25SYXRlTGltaXQ6IChjb25uZWN0aW9uSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICB0aGlzLndhcm4oYFJhdGUgbGltaXQgZXhjZWVkZWQgZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgICAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgICAgIGNvbm5lY3Rpb24uY2xvc2UoMTAwOCwgXCJSYXRlIGxpbWl0IGV4Y2VlZGVkXCIpO1xuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvbkVycm9yOiAoY29ubmVjdGlvbklkOiBzdHJpbmcsIGVycm9yOiBFcnJvcikgPT4ge1xuICAgICAgICB0aGlzLndhcm4oYEVycm9yIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgY29ubmVjdGlvbiBlcnJvc1xuICAgICAgfSxcbiAgICAgIG9uU2VjdXJpdHlWaW9sYXRpb246IChjb25uZWN0aW9uSWQ6IHN0cmluZywgdmlvbGF0aW9uOiBzdHJpbmcpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKFxuICAgICAgICAgIGBTZWN1cml0eSB2aW9sYXRpb24gZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9OiAke3Zpb2xhdGlvbn1gXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgICAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgICAgIGNvbm5lY3Rpb24uY2xvc2UoMTAwOCwgXCJTZWN1cml0eSB2aW9sYXRpb25cIik7XG4gICAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoU2Vzc2lvbihjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgY29ubmVjdGlvbi5yZWZyZXNoU2Vzc2lvbih0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlTWVzc2FnZShcbiAgICBkYXRhOiBEYXRhLFxuICAgIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucmVmcmVzaFNlc3Npb24oY29ubmVjdGlvbik7XG4gICAgICAvLyBUT0RPOiBoYW5kbGUgZXhwaXJlZCBzZXNzaW9uc1xuICAgICAgY29uc3Qgc3RyRGF0YSA9IGRhdGEudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKHN0ckRhdGEpO1xuICAgICAgbGV0IHJlcXVlc3RUeXBlOiBzdHJpbmcgPSBcIlwiO1xuXG4gICAgICBpZiAoXG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIm9iamVjdFwiXG4gICAgICApIHtcbiAgICAgICAgcmVxdWVzdFR5cGUgPSBcInJhd1wiO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiBcInJhd1wiLFxuICAgICAgICAgIGJvZHk6IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkLFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXNwb25zZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlc3BvbnNlPGFueT47XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICByZXNwb25zZS5ib2R5XG4gICAgICAgICk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXF1ZXN0XCIpIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXF1ZXN0PGFueT47XG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBub24tYXV0aGVudGljYXRlZCBSZXF1ZXN0c1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgYXV0aG9yaXphdGlvblxuXG4gICAgICAgIGxldCBhdXRoTWV0YWRhdGE6IElBdXRoZW50aWNhdGlvbk1ldGFkYXRhID0ge307XG4gICAgICAgIGF1dGhNZXRhZGF0YS5pc0F1dGhlbnRpY2F0ZWQgPSBjb25uZWN0aW9uLmlzQXV0aGVudGljYXRlZCgpO1xuICAgICAgICBpZiAoY29ubmVjdGlvbi5pc0F1dGhlbnRpY2F0ZWQoKSkge1xuICAgICAgICAgIGF1dGhNZXRhZGF0YS5zZXNzaW9uSWQgPSBjb25uZWN0aW9uLmdldFNlc3Npb25JZCgpO1xuICAgICAgICAgIGF1dGhNZXRhZGF0YS51c2VySWQgPSBjb25uZWN0aW9uLmdldE1ldGFkYXRhKFwidXNlcklkXCIpO1xuICAgICAgICAgIGF1dGhNZXRhZGF0YS5jb25uZWN0aW9uSWQgPSBjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PGFueT4oe1xuICAgICAgICAgIHRvOiByZXF1ZXN0LmhlYWRlci5yZWNpcGllbnRBZGRyZXNzIHx8IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZSB8fCBcInVua25vd25cIixcbiAgICAgICAgICBib2R5OiByZXF1ZXN0LmJvZHksXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgLi4ucmVxdWVzdC5oZWFkZXIsXG4gICAgICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCxcbiAgICAgICAgICAgIHNlc3Npb25JZDogY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKSxcbiAgICAgICAgICAgIGF1dGhNZXRhZGF0YSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTogYXN5bmMgKFxuICAgICAgICAgICAgdXBkYXRlUmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICAgICAgICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICAgICAgICAgKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGF0dXNVcGRhdGUgPSBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVzcG9uc2UoXG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QsXG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QuaGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgICAgICAgIHN0YXR1c1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShzdGF0dXNVcGRhdGUpKTtcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBXZWJTb2NrZXQgbWVzc2FnZWAsIGVycm9yKTtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIkludmFsaWQgbWVzc2FnZSBmb3JtYXRcIiB9KSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDbG9zZShjb25uZWN0aW9uSWQ6IHN0cmluZykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICBhd2FpdCBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiQ29ubmVjdGlvbiBjbG9zZWRcIik7XG4gICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgY29uc3Qgc2Vzc2lvbklkID0gY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKTtcbiAgICAgIGlmIChzZXNzaW9uSWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5kZWxldGUoc2Vzc2lvbklkKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IGNvbm5lY3Rpb24gY2xvc2VkOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gRmlyc3QsIHN0b3AgYWNjZXB0aW5nIG5ldyBjb25uZWN0aW9uc1xuICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKTtcblxuICAgICAgLy8gQ2xvc2UgYWxsIGFjdGl2ZSBjb25uZWN0aW9uc1xuICAgICAgdGhpcy5pbmZvKFwiQ2xvc2luZyBhbGwgYWN0aXZlIFdlYlNvY2tldCBjb25uZWN0aW9ucy4uLlwiKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICBBcnJheS5mcm9tKHRoaXMuY29ubmVjdGlvbnMudmFsdWVzKCkpLm1hcCgoY29ubmVjdGlvbikgPT5cbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIilcbiAgICAgICAgKVxuICAgICAgKTtcblxuICAgICAgLy8gV2FpdCBmb3IgdGhlIFdTUyB0byBjbG9zZSBwcm9wZXJseVxuICAgICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAvLyBTZXQgYSB0aW1lb3V0IHRvIHByZXZlbnQgaGFuZ2luZ1xuICAgICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIldTUyBjbG9zZSB0aW1lb3V0XCIpKTtcbiAgICAgICAgfSwgNTAwMCk7XG5cbiAgICAgICAgdGhpcy53c3MuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoXCJFcnJvciBkdXJpbmcgc2h1dGRvd246XCIsIGVycm9yKTtcbiAgICAgIC8vIEZvcmNlIGNsb3NlIGV2ZXJ5dGhpbmdcbiAgICAgIHRoaXMud3NzLmNsaWVudHMuZm9yRWFjaCgoY2xpZW50KSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY2xpZW50LnRlcm1pbmF0ZSgpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgLy8gSWdub3JlIGVycm9ycyBkdXJpbmcgZm9yY2UgdGVybWluYXRpb25cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgdG8gaW5kaWNhdGUgc2h1dGRvd24gZmFpbHVyZVxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb25uZWN0aW9ucygpOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnM7XG4gIH1cblxuICBwdWJsaWMgYnJvYWRjYXN0KG1lc3NhZ2U6IElSZXF1ZXN0PFdlYlNvY2tldE1lc3NhZ2U+KTogdm9pZCB7XG4gICAgY29uc3QgbWVzc2FnZVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuICAgIHRoaXMuY29ubmVjdGlvbnMuZm9yRWFjaCgoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKG1lc3NhZ2VTdHJpbmcpO1xuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHNlbmRUb0Nvbm5lY3Rpb24oXG4gICAgY29ubmVjdGlvbklkOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogSVJlc3BvbnNlPFdlYlNvY2tldE1lc3NhZ2U+XG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkobWVzc2FnZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYENvbm5lY3Rpb24gbm90IGZvdW5kOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRTZXNzaW9uQnlJZChzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8SVNlc3Npb25EYXRhIHwgbnVsbD4ge1xuICAgIHJldHVybiB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlLmdldChzZXNzaW9uSWQpO1xuICB9XG5cbiAgQFJlcXVlc3RIYW5kbGVyPHN0cmluZz4oXCJyYXdcIilcbiAgcHJvdGVjdGVkIGFzeW5jIHJhd01lc3NhZ2VIYW5kbGVyKG1lc3NhZ2U6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgdGhpcy53YXJuKGBSZWNlaXZlZCByYXcgbWVzc2FnZWAsIG1lc3NhZ2UpO1xuICAgIHJldHVybiBcIkVSUk9SOiBSYXcgbWVzc2FnZXMgbm90IHN1cHBvcnRlZC4gUGxlYXNlIHVzZSBDb21tdW5pY2F0aW9uc01hbmFnZXJcIjtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShtZXNzYWdlOiBzdHJpbmcpOiBEZXRlY3Rpb25SZXN1bHQ8dW5rbm93bj4ge1xuICAvLyBGaXJzdCwgY2hlY2sgaWYgdGhlIG1lc3NhZ2UgaXMgbGlrZWx5IEpTT04gb3IgYSBKYXZhU2NyaXB0LWxpa2Ugb2JqZWN0XG4gIGlmIChtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwie1wiKSB8fCBtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwiW1wiKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG1lc3NhZ2UpO1xuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVxdWVzdFxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcImhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5oZWFkZXIgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJ0aW1lc3RhbXBcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdElkXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RlckFkZHJlc3NcIiBpbiBwYXJzZWQuaGVhZGVyXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVxdWVzdFwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVxdWVzdDx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlc3BvbnNlXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwicmVxdWVzdEhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlc3BvbnNlXCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXNwb25zZTx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgaXQncyBhIHBhcnNlZCBvYmplY3QgYnV0IG5vdCBJUmVxdWVzdCBvciBJUmVzcG9uc2VcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcIm9iamVjdFwiLCBwYXlsb2FkOiBwYXJzZWQgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gSWYgcGFyc2luZyBmYWlscywgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIElmIGl0IGRvZXNuJ3QgbG9vayBsaWtlIEpTT04sIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgfVxufVxuIl19