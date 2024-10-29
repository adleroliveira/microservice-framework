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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBRzNFLGtDQUF5QztBQUV6QyxvRUFLa0M7QUFRbEMsK0RBQTREO0FBQzVELDJGQUF3RjtBQXdEeEYsTUFBYSxlQUFnQixTQUFRLDZDQUdwQztJQWdCQyxZQUFZLE9BQWlCLEVBQUUsTUFBNkI7UUFDMUQsS0FBSyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztRQWRqQixnQkFBVyxHQUFxQyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBTzFELG9CQUFlLEdBQW9CO1lBQ3pDLE9BQU8sRUFBRSxJQUFJO1lBQ2IsUUFBUSxFQUFFLEtBQUssRUFBRSxhQUFhO1lBQzlCLE9BQU8sRUFBRSxJQUFJLEVBQUUsWUFBWTtTQUM1QixDQUFDO1FBS0EsSUFBSSxDQUFDLDRCQUE0QixDQUFDLE1BQU0sQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUV6RCxJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUM7UUFDeEIsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxJQUFJLEtBQUssQ0FBQztRQUNqQyxJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDO1FBQ3BELElBQUksQ0FBQyxVQUFVLEdBQUcsTUFBTSxDQUFDLGNBQWMsQ0FBQztRQUN4QyxJQUFJLENBQUMsZUFBZSxHQUFHLE1BQU0sQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDLGVBQWUsQ0FBQztRQUN0RSxJQUFJLENBQUMsTUFBTSxHQUFHLElBQUEsbUJBQVksR0FBRSxDQUFDO1FBQzdCLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxXQUFNLENBQUMsRUFBRSxRQUFRLEVBQUUsSUFB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Q3JELENBQUM7SUFDSCxDQUFDO1NBQU0sQ0FBQztRQUNOLHFEQUFxRDtRQUNyRCxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7SUFDckQsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZXJ2ZXIsIERhdGEgfSBmcm9tIFwid3NcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciwgU2VydmVyIGFzIEh0dHBTZXJ2ZXIsIEluY29taW5nTWVzc2FnZSB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQgeyBEdXBsZXggfSBmcm9tIFwic3RyZWFtXCI7XG5pbXBvcnQgeyBJQXV0aGVudGljYXRpb25NZXRhZGF0YSwgSVNlc3Npb25EYXRhIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFJlcXVlc3RCdWlsZGVyIH0gZnJvbSBcIi4uL2NvcmVcIjtcblxuaW1wb3J0IHtcbiAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLFxuICBJU2VydmVyQ29uZmlnLFxuICBTdGF0dXNVcGRhdGUsXG4gIFJlcXVlc3RIYW5kbGVyLFxufSBmcm9tIFwiLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5pbXBvcnQge1xuICBJQmFja0VuZCxcbiAgSVJlcXVlc3QsXG4gIElSZXNwb25zZSxcbiAgSVNlc3Npb25TdG9yZSxcbiAgSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBXZWJzb2NrZXRDb25uZWN0aW9uIH0gZnJvbSBcIi4vV2Vic29ja2V0Q29ubmVjdGlvblwiO1xuaW1wb3J0IHsgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlIH0gZnJvbSBcIi4vV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlXCI7XG5cbnR5cGUgUGF5bG9hZFR5cGUgPSBcIm9iamVjdFwiIHwgXCJzdHJpbmdcIiB8IFwiSVJlcXVlc3RcIiB8IFwiSVJlc3BvbnNlXCI7XG5cbmludGVyZmFjZSBEZXRlY3Rpb25SZXN1bHQ8VD4ge1xuICBwYXlsb2FkVHlwZTogUGF5bG9hZFR5cGU7XG4gIHBheWxvYWQ6IFQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGVhcnRiZWF0UmVxdWVzdCB7XG4gIHRpbWVzdGFtcDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYXJ0YmVhdFJlc3BvbnNlIHtcbiAgcmVxdWVzdFRpbWVzdGFtcDogbnVtYmVyO1xuICByZXNwb25zZVRpbWVzdGFtcDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYXJ0YmVhdENvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIGludGVydmFsOiBudW1iZXI7IC8vIEhvdyBvZnRlbiB0byBzZW5kIGhlYXJ0YmVhdHMgKG1zKVxuICB0aW1lb3V0OiBudW1iZXI7IC8vIEhvdyBsb25nIHRvIHdhaXQgZm9yIHJlc3BvbnNlIChtcylcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBbm9ueW1vdXNTZXNzaW9uQ29uZmlnIHtcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgc2Vzc2lvbkR1cmF0aW9uPzogbnVtYmVyOyAvLyBEdXJhdGlvbiBpbiBtaWxsaXNlY29uZHNcbiAgcGVyc2lzdGVudElkZW50aXR5RW5hYmxlZD86IGJvb2xlYW47XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aGVudGljYXRpb25Db25maWcge1xuICByZXF1aXJlZDogYm9vbGVhbjtcbiAgYWxsb3dBbm9ueW1vdXM6IGJvb2xlYW47XG4gIGFub255bW91c0NvbmZpZz86IEFub255bW91c1Nlc3Npb25Db25maWc7XG4gIGF1dGhQcm92aWRlcj86IElBdXRoZW50aWNhdGlvblByb3ZpZGVyO1xuICBzZXNzaW9uU3RvcmU6IElTZXNzaW9uU3RvcmU7XG4gIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZT86IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBwYXRoPzogc3RyaW5nO1xuICBtYXhDb25uZWN0aW9ucz86IG51bWJlcjtcbiAgYXV0aGVudGljYXRpb246IEF1dGhlbnRpY2F0aW9uQ29uZmlnO1xuICBoZWFydGJlYXRDb25maWc/OiBIZWFydGJlYXRDb25maWc7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldE1lc3NhZ2UgPSB7XG4gIHR5cGU6IHN0cmluZztcbiAgZGF0YTogYW55O1xuICBjb25uZWN0aW9uSWQ6IHN0cmluZztcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0UmVzcG9uc2Uge31cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgV2ViU29ja2V0TWVzc2FnZSxcbiAgV2ViU29ja2V0UmVzcG9uc2Vcbj4ge1xuICBwcml2YXRlIHNlcnZlcjogSHR0cFNlcnZlcjtcbiAgcHJpdmF0ZSB3c3M6IFNlcnZlcjtcbiAgcHJpdmF0ZSBjb25uZWN0aW9uczogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcG9ydDogbnVtYmVyO1xuICBwcml2YXRlIHBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBtYXhDb25uZWN0aW9uczogbnVtYmVyO1xuICBwcml2YXRlIGF1dGhDb25maWc6IEF1dGhlbnRpY2F0aW9uQ29uZmlnO1xuICBwcml2YXRlIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZT86IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTtcblxuICBwcml2YXRlIGhlYXJ0YmVhdENvbmZpZzogSGVhcnRiZWF0Q29uZmlnID0ge1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgaW50ZXJ2YWw6IDMwMDAwLCAvLyAzMCBzZWNvbmRzXG4gICAgdGltZW91dDogNTAwMCwgLy8gNSBzZWNvbmRzXG4gIH07XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogV2ViU29ja2V0U2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcblxuICAgIHRoaXMudmFsaWRhdGVBdXRoZW50aWNhdGlvbkNvbmZpZyhjb25maWcuYXV0aGVudGljYXRpb24pO1xuXG4gICAgdGhpcy5wb3J0ID0gY29uZmlnLnBvcnQ7XG4gICAgdGhpcy5wYXRoID0gY29uZmlnLnBhdGggfHwgXCIvd3NcIjtcbiAgICB0aGlzLm1heENvbm5lY3Rpb25zID0gY29uZmlnLm1heENvbm5lY3Rpb25zIHx8IDEwMDA7XG4gICAgdGhpcy5hdXRoQ29uZmlnID0gY29uZmlnLmF1dGhlbnRpY2F0aW9uO1xuICAgIHRoaXMuaGVhcnRiZWF0Q29uZmlnID0gY29uZmlnLmhlYXJ0YmVhdENvbmZpZyB8fCB0aGlzLmhlYXJ0YmVhdENvbmZpZztcbiAgICB0aGlzLnNlcnZlciA9IGNyZWF0ZVNlcnZlcigpO1xuICAgIHRoaXMud3NzID0gbmV3IFNlcnZlcih7IG5vU2VydmVyOiB0cnVlIH0pO1xuXG4gICAgaWYgKHRoaXMuYXV0aENvbmZpZy5yZXF1aXJlZCB8fCB0aGlzLmF1dGhDb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgIGlmICghdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJTZXNzaW9uIHN0b3JlIGlzIHJlcXVpcmVkIGZvciBib3RoIGF1dGhlbnRpY2F0ZWQgYW5kIGFub255bW91cyBjb25uZWN0aW9uc1wiXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQgJiYgIXRoaXMuYXV0aENvbmZpZy5hdXRoUHJvdmlkZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gcHJvdmlkZXIgaXMgcmVxdWlyZWQgd2hlbiBhdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZFwiXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlID1cbiAgICAgICAgY29uZmlnLmF1dGhlbnRpY2F0aW9uLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB8fFxuICAgICAgICBuZXcgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlKFxuICAgICAgICAgIHRoaXMuYXV0aENvbmZpZy5hdXRoUHJvdmlkZXIhLFxuICAgICAgICAgIHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmVcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICB0aGlzLnNldHVwV2ViU29ja2V0U2VydmVyKCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwV2ViU29ja2V0U2VydmVyKCkge1xuICAgIHRoaXMuc2VydmVyLm9uKFxuICAgICAgXCJ1cGdyYWRlXCIsXG4gICAgICBhc3luYyAocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLCBzb2NrZXQ6IER1cGxleCwgaGVhZDogQnVmZmVyKSA9PiB7XG4gICAgICAgIC8vIFByZXZlbnQgbWVtb3J5IGxlYWtzIGJ5IGhhbmRsaW5nIHNvY2tldCBlcnJvcnNcbiAgICAgICAgc29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycikgPT4ge1xuICAgICAgICAgIHRoaXMuZXJyb3IoXCJTb2NrZXQgZXJyb3I6XCIsIGVycik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUGFyc2UgdGhlIFVSTCB0byBnZXQganVzdCB0aGUgcGF0aG5hbWVcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCEsIGBodHRwOi8vJHtyZXF1ZXN0LmhlYWRlcnMuaG9zdH1gKTtcblxuICAgICAgICBpZiAodXJsLnBhdGhuYW1lICE9PSB0aGlzLnBhdGgpIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXCJIVFRQLzEuMSA0MDQgTm90IEZvdW5kXFxyXFxuXFxyXFxuXCIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgICAgdGhpcy53YXJuKGBJbnZhbGlkIHBhdGg6ICR7cmVxdWVzdC51cmx9YCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuaGFuZGxlQXV0aGVudGljYXRpb24ocmVxdWVzdCk7XG4gICAgICAgIGlmICghY29ubmVjdGlvbikge1xuICAgICAgICAgIHNvY2tldC53cml0ZShcbiAgICAgICAgICAgIFwiSFRUUC8xLjEgNDAxIFVuYXV0aG9yaXplZFxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJDb25uZWN0aW9uOiBjbG9zZVxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW5cXHJcXG5cXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gZmFpbGVkXFxyXFxuXCJcbiAgICAgICAgICApO1xuICAgICAgICAgIHNvY2tldC5lbmQoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnVwZ3JhZGVDb25uZWN0aW9uKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBncmFkZUNvbm5lY3Rpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLFxuICAgIHNvY2tldDogRHVwbGV4LFxuICAgIGhlYWQ6IEJ1ZmZlcixcbiAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbj86IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKSB7XG4gICAgdGhpcy53c3MuaGFuZGxlVXBncmFkZShyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsICh3cykgPT4ge1xuICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbnMuc2l6ZSA+PSB0aGlzLm1heENvbm5lY3Rpb25zKSB7XG4gICAgICAgIHdzLmNsb3NlKDEwMTMsIFwiTWF4aW11bSBudW1iZXIgb2YgY29ubmVjdGlvbnMgcmVhY2hlZFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXV0aGVudGljYXRlZENvbm5lY3Rpb24pIHtcbiAgICAgICAgLy8gU2V0IHRoZSBXZWJTb2NrZXQgaW5zdGFuY2Ugb24gdGhlIGV4aXN0aW5nIGNvbm5lY3Rpb25cbiAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uc2V0V2ViU29ja2V0KHdzKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb25cbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENyZWF0ZSBuZXcgY29ubmVjdGlvbiB3aXRoIFdlYlNvY2tldCBpbnN0YW5jZVxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHVuZGVmaW5lZCwgLy8gZGVmYXVsdCByYXRlIGxpbWl0XG4gICAgICAgICAgdGhpcy5oYW5kbGVXc0V2ZW50cygpLFxuICAgICAgICAgIHdzLFxuICAgICAgICAgIHRoaXMuaGVhcnRiZWF0Q29uZmlnLmludGVydmFsLFxuICAgICAgICAgIHRoaXMuaGVhcnRiZWF0Q29uZmlnLnRpbWVvdXRcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlQXV0aGVudGljYXRpb25Db25maWcoY29uZmlnOiBBdXRoZW50aWNhdGlvbkNvbmZpZyk6IHZvaWQge1xuICAgIC8vIENoZWNrIGZvciBpbnZhbGlkIGNvbmZpZ3VyYXRpb24gd2hlcmUgbm8gY29ubmVjdGlvbnMgd291bGQgYmUgcG9zc2libGVcbiAgICBpZiAoIWNvbmZpZy5yZXF1aXJlZCAmJiAhY29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJXaGVuIGF1dGhlbnRpY2F0aW9uIGlzIG5vdCByZXF1aXJlZCwgeW91IG11c3QgZWl0aGVyIGVuYWJsZSBhbm9ueW1vdXMgY29ubmVjdGlvbnMgXCIgK1xuICAgICAgICAgIFwib3Igc2V0IHJlcXVpcmVkIHRvIHRydWUuIEN1cnJlbnQgY29uZmlndXJhdGlvbiB3b3VsZCBwcmV2ZW50IGFueSBjb25uZWN0aW9ucy5cIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBBZGRpdGlvbmFsIHZhbGlkYXRpb24gY2hlY2tzXG4gICAgaWYgKGNvbmZpZy5yZXF1aXJlZCAmJiAhY29uZmlnLmF1dGhQcm92aWRlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gcHJvdmlkZXIgaXMgcmVxdWlyZWQgd2hlbiBhdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZFwiXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcuYWxsb3dBbm9ueW1vdXMgJiYgIWNvbmZpZy5zZXNzaW9uU3RvcmUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIlNlc3Npb24gc3RvcmUgaXMgcmVxdWlyZWQgd2hlbiBhbm9ueW1vdXMgY29ubmVjdGlvbnMgYXJlIGFsbG93ZWRcIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBhbm9ueW1vdXMgY29uZmlnIGlmIGFub255bW91cyBjb25uZWN0aW9ucyBhcmUgYWxsb3dlZFxuICAgIGlmIChjb25maWcuYWxsb3dBbm9ueW1vdXMgJiYgY29uZmlnLmFub255bW91c0NvbmZpZykge1xuICAgICAgaWYgKFxuICAgICAgICBjb25maWcuYW5vbnltb3VzQ29uZmlnLnNlc3Npb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgIGNvbmZpZy5hbm9ueW1vdXNDb25maWcuc2Vzc2lvbkR1cmF0aW9uIDw9IDBcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJJbnZhbGlkIGFub255bW91cyBzZXNzaW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICAgIFwiU2Vzc2lvbiBkdXJhdGlvbiBtdXN0IGJlIHBvc2l0aXZlXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUF1dGhlbnRpY2F0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZVxuICApOiBQcm9taXNlPFdlYnNvY2tldENvbm5lY3Rpb24gfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEZpcnN0LCB0cnkgdG8gYXV0aGVudGljYXRlIGlmIGNyZWRlbnRpYWxzIGFyZSBwcm92aWRlZFxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpXG4gICAgICApO1xuXG4gICAgICAvLyBUcnkgdG9rZW4vY3JlZGVudGlhbHMgYXV0aGVudGljYXRpb24gZmlyc3QgaWYgbWlkZGxld2FyZSBleGlzdHNcbiAgICAgIGlmICh0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGF1dGhSZXN1bHQgPVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUuYXV0aGVudGljYXRlQ29ubmVjdGlvbihcbiAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgY29ubmVjdGlvblxuICAgICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoYXV0aFJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdXRoUmVzdWx0KSkge1xuICAgICAgICAgICAgICBpZiAodmFsdWUpIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdGlvbjtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgLy8gQXV0aGVudGljYXRpb24gZmFpbGVkLCBidXQgd2UgbWlnaHQgc3RpbGwgYWxsb3cgYW5vbnltb3VzIGFjY2Vzc1xuICAgICAgICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBJZiB3ZSByZWFjaCBoZXJlIGFuZCBhbm9ueW1vdXMgYWNjZXNzIGlzIGFsbG93ZWQsIGNyZWF0ZSBhbm9ueW1vdXMgc2Vzc2lvblxuICAgICAgaWYgKHRoaXMuYXV0aENvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZUFub255bW91c1Nlc3Npb24oY29ubmVjdGlvbiwgcmVxdWVzdCk7XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB3ZSByZWFjaCBoZXJlLCBuZWl0aGVyIGF1dGhlbnRpY2F0aW9uIHN1Y2NlZWRlZCBub3IgYW5vbnltb3VzIGFjY2VzcyBpcyBhbGxvd2VkXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKFwiQXV0aGVudGljYXRpb24gZXJyb3I6XCIsIGVycm9yKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY3JlYXRlQW5vbnltb3VzU2Vzc2lvbihcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uLFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmF1dGhDb25maWcuYW5vbnltb3VzQ29uZmlnIHx8IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uRHVyYXRpb246IDI0ICogNjAgKiA2MCAqIDEwMDAsIC8vIDI0IGhvdXJzIGRlZmF1bHRcbiAgICB9O1xuXG4gICAgY29uc3QgZGV2aWNlSWQgPSB0aGlzLmV4dHJhY3REZXZpY2VJZChyZXF1ZXN0KTtcblxuICAgIGNvbnN0IHNlc3Npb25EYXRhOiBJU2Vzc2lvbkRhdGEgPSB7XG4gICAgICBzZXNzaW9uSWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXG4gICAgICB1c2VySWQ6IGRldmljZUlkIHx8IGNyeXB0by5yYW5kb21VVUlEKCksIC8vIFVzZSBkZXZpY2UgSUQgYXMgdXNlcklkIGlmIGF2YWlsYWJsZVxuICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShcbiAgICAgICAgRGF0ZS5ub3coKSArIChjb25maWcuc2Vzc2lvbkR1cmF0aW9uIHx8IDI0ICogNjAgKiA2MCAqIDEwMDApXG4gICAgICApLFxuICAgICAgbGFzdEFjY2Vzc2VkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICAuLi5jb25maWcubWV0YWRhdGEsXG4gICAgICAgIGlzQW5vbnltb3VzOiB0cnVlLFxuICAgICAgICBkZXZpY2VJZCxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGF3YWl0IHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuY3JlYXRlKHNlc3Npb25EYXRhKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwic2Vzc2lvbklkXCIsIHNlc3Npb25EYXRhLnNlc3Npb25JZCk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInVzZXJJZFwiLCBzZXNzaW9uRGF0YS51c2VySWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJpc0Fub255bW91c1wiLCB0cnVlKTtcbiAgICBjb25uZWN0aW9uLnNldEF1dGhlbnRpY2F0ZWQoZmFsc2UpO1xuICB9XG5cbiAgcHJpdmF0ZSBleHRyYWN0RGV2aWNlSWQocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gVHJ5IHRvIGV4dHJhY3QgZGV2aWNlIElEIGZyb20gdmFyaW91cyBzb3VyY2VzXG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCEsIGBodHRwOi8vJHtyZXF1ZXN0LmhlYWRlcnMuaG9zdH1gKTtcblxuICAgIC8vIENoZWNrIHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICBjb25zdCBkZXZpY2VJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZGV2aWNlSWRcIik7XG4gICAgaWYgKGRldmljZUlkKSByZXR1cm4gZGV2aWNlSWQ7XG5cbiAgICAvLyBDaGVjayBoZWFkZXJzXG4gICAgY29uc3QgZGV2aWNlSWRIZWFkZXIgPSByZXF1ZXN0LmhlYWRlcnNbXCJ4LWRldmljZS1pZFwiXTtcbiAgICBpZiAoZGV2aWNlSWRIZWFkZXIpIHJldHVybiBkZXZpY2VJZEhlYWRlci50b1N0cmluZygpO1xuXG4gICAgLy8gQ2hlY2sgY29va2llc1xuICAgIGNvbnN0IGNvb2tpZXMgPSByZXF1ZXN0LmhlYWRlcnMuY29va2llXG4gICAgICA/LnNwbGl0KFwiO1wiKVxuICAgICAgLm1hcCgoY29va2llKSA9PiBjb29raWUudHJpbSgpLnNwbGl0KFwiPVwiKSlcbiAgICAgIC5maW5kKChba2V5XSkgPT4ga2V5ID09PSBcImRldmljZUlkXCIpO1xuXG4gICAgcmV0dXJuIGNvb2tpZXMgPyBjb29raWVzWzFdIDogbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlV3NFdmVudHMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9uUmF0ZUxpbWl0OiAoY29ubmVjdGlvbklkOiBzdHJpbmcpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBSYXRlIGxpbWl0IGV4Y2VlZGVkIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfWApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiUmF0ZSBsaW1pdCBleGNlZWRlZFwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgb25FcnJvcjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCBlcnJvcjogRXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBFcnJvciBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGNvbm5lY3Rpb24gZXJyb3NcbiAgICAgIH0sXG4gICAgICBvblNlY3VyaXR5VmlvbGF0aW9uOiAoY29ubmVjdGlvbklkOiBzdHJpbmcsIHZpb2xhdGlvbjogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihcbiAgICAgICAgICBgU2VjdXJpdHkgdmlvbGF0aW9uIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfTogJHt2aW9sYXRpb259YFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiU2VjdXJpdHkgdmlvbGF0aW9uXCIpO1xuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaFNlc3Npb24oY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVmcmVzaFNlc3Npb24odGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZU1lc3NhZ2UoXG4gICAgZGF0YTogRGF0YSxcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb24pO1xuICAgICAgLy8gVE9ETzogaGFuZGxlIGV4cGlyZWQgc2Vzc2lvbnNcbiAgICAgIGNvbnN0IHN0ckRhdGEgPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBkZXRlY3Rpb25SZXN1bHQgPSBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShzdHJEYXRhKTtcblxuICAgICAgaWYgKFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJvYmplY3RcIlxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IFwicmF3XCIsXG4gICAgICAgICAgYm9keTogZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlc3BvbnNlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVzcG9uc2U8YW55PjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdFR5cGUgJiZcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgJiZcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgIT1cbiAgICAgICAgICAgIHJlc3BvbnNlLnJlc3BvbnNlSGVhZGVyLnJlc3BvbmRlckFkZHJlc3NcbiAgICAgICAgKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdFR5cGUsXG4gICAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgICAgICBKU09OLnN0cmluZ2lmeShyZXNwb25zZS5ib2R5KSxcbiAgICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdElkXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVxdWVzdFwiKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVxdWVzdDxhbnk+O1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgbm9uLWF1dGhlbnRpY2F0ZWQgUmVxdWVzdHNcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGF1dGhvcml6YXRpb25cblxuICAgICAgICBsZXQgYXV0aE1ldGFkYXRhOiBJQXV0aGVudGljYXRpb25NZXRhZGF0YSA9IHt9O1xuICAgICAgICBhdXRoTWV0YWRhdGEuaXNBdXRoZW50aWNhdGVkID0gY29ubmVjdGlvbi5pc0F1dGhlbnRpY2F0ZWQoKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24uaXNBdXRoZW50aWNhdGVkKCkpIHtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuc2Vzc2lvbklkID0gY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEudXNlcklkID0gY29ubmVjdGlvbi5nZXRNZXRhZGF0YShcInVzZXJJZFwiKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuY29ubmVjdGlvbklkID0gY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keTogcmVxdWVzdC5ib2R5LFxuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgIC4uLnJlcXVlc3QuaGVhZGVyLFxuICAgICAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCksXG4gICAgICAgICAgICBhdXRoTWV0YWRhdGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGU6IGFzeW5jIChcbiAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgICAgICAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICAgICAgICAgICkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhdHVzVXBkYXRlID0gTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlc3BvbnNlKFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgICAgICBzdGF0dXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoc3RhdHVzVXBkYXRlKSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgV2ViU29ja2V0IG1lc3NhZ2VgLCBlcnJvcik7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnZhbGlkIG1lc3NhZ2UgZm9ybWF0XCIgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ2xvc2UoY29ubmVjdGlvbklkOiBzdHJpbmcpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgxMDAwLCBcIkNvbm5lY3Rpb24gY2xvc2VkXCIpO1xuICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgIGNvbnN0IHNlc3Npb25JZCA9IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCk7XG4gICAgICBpZiAoc2Vzc2lvbklkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuZGVsZXRlKHNlc3Npb25JZCk7XG4gICAgICB9XG4gICAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBzZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgJHt0aGlzLnBvcnR9YCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEZpcnN0LCBzdG9wIGFjY2VwdGluZyBuZXcgY29ubmVjdGlvbnNcbiAgICAgIHRoaXMuc2VydmVyLmNsb3NlKCk7XG5cbiAgICAgIC8vIENsb3NlIGFsbCBhY3RpdmUgY29ubmVjdGlvbnNcbiAgICAgIHRoaXMuaW5mbyhcIkNsb3NpbmcgYWxsIGFjdGl2ZSBXZWJTb2NrZXQgY29ubmVjdGlvbnMuLi5cIik7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmNvbm5lY3Rpb25zLnZhbHVlcygpKS5tYXAoKGNvbm5lY3Rpb24pID0+XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDAwLCBcIlNlcnZlciBzaHV0dGluZyBkb3duXCIpXG4gICAgICAgIClcbiAgICAgICk7XG5cbiAgICAgIC8vIFdhaXQgZm9yIHRoZSBXU1MgdG8gY2xvc2UgcHJvcGVybHlcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgLy8gU2V0IGEgdGltZW91dCB0byBwcmV2ZW50IGhhbmdpbmdcbiAgICAgICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJXU1MgY2xvc2UgdGltZW91dFwiKSk7XG4gICAgICAgIH0sIDUwMDApO1xuXG4gICAgICAgIHRoaXMud3NzLmNsb3NlKCgpID0+IHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgdGhpcy5pbmZvKFwiV2ViU29ja2V0IHNlcnZlciBzdG9wcGVkXCIpO1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKFwiRXJyb3IgZHVyaW5nIHNodXRkb3duOlwiLCBlcnJvcik7XG4gICAgICAvLyBGb3JjZSBjbG9zZSBldmVyeXRoaW5nXG4gICAgICB0aGlzLndzcy5jbGllbnRzLmZvckVhY2goKGNsaWVudCkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNsaWVudC50ZXJtaW5hdGUoKTtcbiAgICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAgIC8vIElnbm9yZSBlcnJvcnMgZHVyaW5nIGZvcmNlIHRlcm1pbmF0aW9uXG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgdGhyb3cgZXJyb3I7IC8vIFJlLXRocm93IHRvIGluZGljYXRlIHNodXRkb3duIGZhaWx1cmVcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFdlYlNvY2tldE1lc3NhZ2U+XG4gICk6IFByb21pc2U8V2ViU29ja2V0UmVzcG9uc2U+IHtcbiAgICB0aGlzLndhcm4oXG4gICAgICBgVW5oYW5kbGVkIFdlYlNvY2tldCBtZXNzYWdlIHR5cGU6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCxcbiAgICAgIHJlcXVlc3RcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGVycm9yOiBgXCJVbmhhbmRsZWQgbWVzc2FnZSB0eXBlXCIgJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0Q29ubmVjdGlvbnMoKTogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4ge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25zO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBJUmVxdWVzdDxhbnk+KTogdm9pZCB7XG4gICAgY29uc3QgcmVxdWVzdCA9IFJlcXVlc3RCdWlsZGVyLmZyb20obWVzc2FnZSk7XG4gICAgcmVxdWVzdC5zZXRSZXF1aXJlc1Jlc3BvbnNlKGZhbHNlKTtcbiAgICBjb25zdCBtZXNzYWdlU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkocmVxdWVzdC5idWlsZCgpKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmZvckVhY2goKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlU3RyaW5nKTtcbiAgICB9KTtcbiAgfVxuXG4gIGFzeW5jIGdldFNlc3Npb25CeUlkKHNlc3Npb25JZDogc3RyaW5nKTogUHJvbWlzZTxJU2Vzc2lvbkRhdGEgfCBudWxsPiB7XG4gICAgcmV0dXJuIHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuZ2V0KHNlc3Npb25JZCk7XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXI8c3RyaW5nPihcInJhd1wiKVxuICBwcm90ZWN0ZWQgYXN5bmMgcmF3TWVzc2FnZUhhbmRsZXIobWVzc2FnZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJhdyBtZXNzYWdlYCwgbWVzc2FnZSk7XG4gICAgcmV0dXJuIFwiRVJST1I6IFJhdyBtZXNzYWdlcyBub3Qgc3VwcG9ydGVkLiBQbGVhc2UgdXNlIENvbW11bmljYXRpb25zTWFuYWdlclwiO1xuICB9XG59XG5cbmZ1bmN0aW9uIGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKG1lc3NhZ2U6IHN0cmluZyk6IERldGVjdGlvblJlc3VsdDx1bmtub3duPiB7XG4gIC8vIEZpcnN0LCBjaGVjayBpZiB0aGUgbWVzc2FnZSBpcyBsaWtlbHkgSlNPTiBvciBhIEphdmFTY3JpcHQtbGlrZSBvYmplY3RcbiAgaWYgKG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJ7XCIpIHx8IG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJbXCIpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UobWVzc2FnZSk7XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXF1ZXN0XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwiaGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmhlYWRlciA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcInRpbWVzdGFtcFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0SWRcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdGVyQWRkcmVzc1wiIGluIHBhcnNlZC5oZWFkZXJcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXF1ZXN0XCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXF1ZXN0PHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVzcG9uc2VcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJyZXF1ZXN0SGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwicmVzcG9uc2VIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVzcG9uc2VcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlc3BvbnNlPHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBpdCdzIGEgcGFyc2VkIG9iamVjdCBidXQgbm90IElSZXF1ZXN0IG9yIElSZXNwb25zZVxuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwib2JqZWN0XCIsIHBheWxvYWQ6IHBhcnNlZCB9O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJZiBwYXJzaW5nIGZhaWxzLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgaXQgZG9lc24ndCBsb29rIGxpa2UgSlNPTiwgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICB9XG59XG4iXX0=