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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBS2M7QUFHZCxrQ0FBMEQ7QUFFMUQsb0VBS2tDO0FBUWxDLCtEQUE0RDtBQUM1RCwyRkFBd0Y7QUFDeEYsd0NBQTJDO0FBd0QzQyxNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBZ0JDLFlBQVksT0FBaUIsRUFBRSxNQUE2QjtRQUMxRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBZGpCLGdCQUFXLEdBQXFDLElBQUksR0FBRyxFQUFFLENBQUM7UUFPMUQsb0JBQWUsR0FBb0I7WUFDekMsT0FBTyxFQUFFLElBQUk7WUFDYixRQUFRLEVBQUUsS0FBSyxFQUFFLGFBQWE7WUFDOUIsT0FBTyxFQUFFLElBQUksRUFBRSxZQUFZO1NBQzVCLENBQUM7UUFLQSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO1FBQ3hDLElBQUksQ0FBQyxlQUFlLEdBQUcsTUFBTSxDQUFDLGVBQWUsSUFBSSxJQUFJLENBQUMsZUFBZSxDQUFDO1FBQ3RFLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFB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T0FBTyxFQUFFLE1BQTRCO2lCQUN0QyxDQUFDO1lBQ0osQ0FBQztZQUVELHdEQUF3RDtZQUN4RCxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLENBQUM7UUFDcEQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZix5Q0FBeUM7WUFDekMsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO1FBQ3JELENBQUM7SUFDSCxDQUFDO1NBQU0sQ0FBQztRQUNOLHFEQUFxRDtRQUNyRCxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7SUFDckQsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZXJ2ZXIsIERhdGEgfSBmcm9tIFwid3NcIjtcbmltcG9ydCB7XG4gIGNyZWF0ZVNlcnZlcixcbiAgU2VydmVyIGFzIEh0dHBTZXJ2ZXIsXG4gIEluY29taW5nTWVzc2FnZSxcbiAgcmVxdWVzdCxcbn0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB7IER1cGxleCB9IGZyb20gXCJzdHJlYW1cIjtcbmltcG9ydCB7IElBdXRoZW50aWNhdGlvbk1ldGFkYXRhLCBJU2Vzc2lvbkRhdGEgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgUmVxdWVzdEJ1aWxkZXIsIFJlc3BvbnNlQnVpbGRlciB9IGZyb20gXCIuLi9jb3JlXCI7XG5cbmltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbiAgU3RhdHVzVXBkYXRlLFxuICBSZXF1ZXN0SGFuZGxlcixcbn0gZnJvbSBcIi4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHtcbiAgSUJhY2tFbmQsXG4gIElSZXF1ZXN0LFxuICBJUmVzcG9uc2UsXG4gIElTZXNzaW9uU3RvcmUsXG4gIElBdXRoZW50aWNhdGlvblByb3ZpZGVyLFxufSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgV2Vic29ja2V0Q29ubmVjdGlvbiB9IGZyb20gXCIuL1dlYnNvY2tldENvbm5lY3Rpb25cIjtcbmltcG9ydCB7IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB9IGZyb20gXCIuL1dlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVwiO1xuaW1wb3J0IHsgTG9nZ2FibGVFcnJvciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5cbnR5cGUgUGF5bG9hZFR5cGUgPSBcIm9iamVjdFwiIHwgXCJzdHJpbmdcIiB8IFwiSVJlcXVlc3RcIiB8IFwiSVJlc3BvbnNlXCI7XG5cbmludGVyZmFjZSBEZXRlY3Rpb25SZXN1bHQ8VD4ge1xuICBwYXlsb2FkVHlwZTogUGF5bG9hZFR5cGU7XG4gIHBheWxvYWQ6IFQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGVhcnRiZWF0UmVxdWVzdCB7XG4gIHRpbWVzdGFtcDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYXJ0YmVhdFJlc3BvbnNlIHtcbiAgcmVxdWVzdFRpbWVzdGFtcDogbnVtYmVyO1xuICByZXNwb25zZVRpbWVzdGFtcDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYXJ0YmVhdENvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIGludGVydmFsOiBudW1iZXI7IC8vIEhvdyBvZnRlbiB0byBzZW5kIGhlYXJ0YmVhdHMgKG1zKVxuICB0aW1lb3V0OiBudW1iZXI7IC8vIEhvdyBsb25nIHRvIHdhaXQgZm9yIHJlc3BvbnNlIChtcylcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBbm9ueW1vdXNTZXNzaW9uQ29uZmlnIHtcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgc2Vzc2lvbkR1cmF0aW9uPzogbnVtYmVyOyAvLyBEdXJhdGlvbiBpbiBtaWxsaXNlY29uZHNcbiAgcGVyc2lzdGVudElkZW50aXR5RW5hYmxlZD86IGJvb2xlYW47XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aGVudGljYXRpb25Db25maWcge1xuICByZXF1aXJlZDogYm9vbGVhbjtcbiAgYWxsb3dBbm9ueW1vdXM6IGJvb2xlYW47XG4gIGFub255bW91c0NvbmZpZz86IEFub255bW91c1Nlc3Npb25Db25maWc7XG4gIGF1dGhQcm92aWRlcj86IElBdXRoZW50aWNhdGlvblByb3ZpZGVyO1xuICBzZXNzaW9uU3RvcmU6IElTZXNzaW9uU3RvcmU7XG4gIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZT86IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBwYXRoPzogc3RyaW5nO1xuICBtYXhDb25uZWN0aW9ucz86IG51bWJlcjtcbiAgYXV0aGVudGljYXRpb246IEF1dGhlbnRpY2F0aW9uQ29uZmlnO1xuICBoZWFydGJlYXRDb25maWc/OiBIZWFydGJlYXRDb25maWc7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldE1lc3NhZ2UgPSB7XG4gIHR5cGU6IHN0cmluZztcbiAgZGF0YTogYW55O1xuICBjb25uZWN0aW9uSWQ6IHN0cmluZztcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0UmVzcG9uc2Uge31cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgV2ViU29ja2V0TWVzc2FnZSxcbiAgV2ViU29ja2V0UmVzcG9uc2Vcbj4ge1xuICBwcml2YXRlIHNlcnZlcjogSHR0cFNlcnZlcjtcbiAgcHJpdmF0ZSB3c3M6IFNlcnZlcjtcbiAgcHJpdmF0ZSBjb25uZWN0aW9uczogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcG9ydDogbnVtYmVyO1xuICBwcml2YXRlIHBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBtYXhDb25uZWN0aW9uczogbnVtYmVyO1xuICBwcml2YXRlIGF1dGhDb25maWc6IEF1dGhlbnRpY2F0aW9uQ29uZmlnO1xuICBwcml2YXRlIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZT86IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTtcblxuICBwcml2YXRlIGhlYXJ0YmVhdENvbmZpZzogSGVhcnRiZWF0Q29uZmlnID0ge1xuICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgaW50ZXJ2YWw6IDMwMDAwLCAvLyAzMCBzZWNvbmRzXG4gICAgdGltZW91dDogNTAwMCwgLy8gNSBzZWNvbmRzXG4gIH07XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogV2ViU29ja2V0U2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcblxuICAgIHRoaXMudmFsaWRhdGVBdXRoZW50aWNhdGlvbkNvbmZpZyhjb25maWcuYXV0aGVudGljYXRpb24pO1xuXG4gICAgdGhpcy5wb3J0ID0gY29uZmlnLnBvcnQ7XG4gICAgdGhpcy5wYXRoID0gY29uZmlnLnBhdGggfHwgXCIvd3NcIjtcbiAgICB0aGlzLm1heENvbm5lY3Rpb25zID0gY29uZmlnLm1heENvbm5lY3Rpb25zIHx8IDEwMDA7XG4gICAgdGhpcy5hdXRoQ29uZmlnID0gY29uZmlnLmF1dGhlbnRpY2F0aW9uO1xuICAgIHRoaXMuaGVhcnRiZWF0Q29uZmlnID0gY29uZmlnLmhlYXJ0YmVhdENvbmZpZyB8fCB0aGlzLmhlYXJ0YmVhdENvbmZpZztcbiAgICB0aGlzLnNlcnZlciA9IGNyZWF0ZVNlcnZlcigpO1xuICAgIHRoaXMud3NzID0gbmV3IFNlcnZlcih7IG5vU2VydmVyOiB0cnVlIH0pO1xuXG4gICAgaWYgKHRoaXMuYXV0aENvbmZpZy5yZXF1aXJlZCB8fCB0aGlzLmF1dGhDb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgIGlmICghdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJTZXNzaW9uIHN0b3JlIGlzIHJlcXVpcmVkIGZvciBib3RoIGF1dGhlbnRpY2F0ZWQgYW5kIGFub255bW91cyBjb25uZWN0aW9uc1wiXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQgJiYgIXRoaXMuYXV0aENvbmZpZy5hdXRoUHJvdmlkZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gcHJvdmlkZXIgaXMgcmVxdWlyZWQgd2hlbiBhdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZFwiXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlID1cbiAgICAgICAgY29uZmlnLmF1dGhlbnRpY2F0aW9uLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB8fFxuICAgICAgICBuZXcgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlKFxuICAgICAgICAgIHRoaXMuYXV0aENvbmZpZy5hdXRoUHJvdmlkZXIhLFxuICAgICAgICAgIHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmVcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICB0aGlzLnNldHVwV2ViU29ja2V0U2VydmVyKCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwV2ViU29ja2V0U2VydmVyKCkge1xuICAgIHRoaXMuc2VydmVyLm9uKFxuICAgICAgXCJ1cGdyYWRlXCIsXG4gICAgICBhc3luYyAocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLCBzb2NrZXQ6IER1cGxleCwgaGVhZDogQnVmZmVyKSA9PiB7XG4gICAgICAgIC8vIFByZXZlbnQgbWVtb3J5IGxlYWtzIGJ5IGhhbmRsaW5nIHNvY2tldCBlcnJvcnNcbiAgICAgICAgc29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycikgPT4ge1xuICAgICAgICAgIHRoaXMuZXJyb3IoXCJTb2NrZXQgZXJyb3I6XCIsIGVycik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUGFyc2UgdGhlIFVSTCB0byBnZXQganVzdCB0aGUgcGF0aG5hbWVcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCEsIGBodHRwOi8vJHtyZXF1ZXN0LmhlYWRlcnMuaG9zdH1gKTtcblxuICAgICAgICBpZiAodXJsLnBhdGhuYW1lICE9PSB0aGlzLnBhdGgpIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXCJIVFRQLzEuMSA0MDQgTm90IEZvdW5kXFxyXFxuXFxyXFxuXCIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgICAgdGhpcy53YXJuKGBJbnZhbGlkIHBhdGg6ICR7cmVxdWVzdC51cmx9YCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuaGFuZGxlQXV0aGVudGljYXRpb24ocmVxdWVzdCk7XG4gICAgICAgIGlmICghY29ubmVjdGlvbikge1xuICAgICAgICAgIHNvY2tldC53cml0ZShcbiAgICAgICAgICAgIFwiSFRUUC8xLjEgNDAxIFVuYXV0aG9yaXplZFxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJDb25uZWN0aW9uOiBjbG9zZVxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW5cXHJcXG5cXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gZmFpbGVkXFxyXFxuXCJcbiAgICAgICAgICApO1xuICAgICAgICAgIHNvY2tldC5lbmQoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnVwZ3JhZGVDb25uZWN0aW9uKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBncmFkZUNvbm5lY3Rpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLFxuICAgIHNvY2tldDogRHVwbGV4LFxuICAgIGhlYWQ6IEJ1ZmZlcixcbiAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbj86IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKSB7XG4gICAgdGhpcy53c3MuaGFuZGxlVXBncmFkZShyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsICh3cykgPT4ge1xuICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbnMuc2l6ZSA+PSB0aGlzLm1heENvbm5lY3Rpb25zKSB7XG4gICAgICAgIHdzLmNsb3NlKDEwMTMsIFwiTWF4aW11bSBudW1iZXIgb2YgY29ubmVjdGlvbnMgcmVhY2hlZFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXV0aGVudGljYXRlZENvbm5lY3Rpb24pIHtcbiAgICAgICAgLy8gU2V0IHRoZSBXZWJTb2NrZXQgaW5zdGFuY2Ugb24gdGhlIGV4aXN0aW5nIGNvbm5lY3Rpb25cbiAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uc2V0V2ViU29ja2V0KHdzKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb25cbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENyZWF0ZSBuZXcgY29ubmVjdGlvbiB3aXRoIFdlYlNvY2tldCBpbnN0YW5jZVxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHVuZGVmaW5lZCwgLy8gZGVmYXVsdCByYXRlIGxpbWl0XG4gICAgICAgICAgdGhpcy5oYW5kbGVXc0V2ZW50cygpLFxuICAgICAgICAgIHdzLFxuICAgICAgICAgIHRoaXMuaGVhcnRiZWF0Q29uZmlnLmludGVydmFsLFxuICAgICAgICAgIHRoaXMuaGVhcnRiZWF0Q29uZmlnLnRpbWVvdXRcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlQXV0aGVudGljYXRpb25Db25maWcoY29uZmlnOiBBdXRoZW50aWNhdGlvbkNvbmZpZyk6IHZvaWQge1xuICAgIC8vIENoZWNrIGZvciBpbnZhbGlkIGNvbmZpZ3VyYXRpb24gd2hlcmUgbm8gY29ubmVjdGlvbnMgd291bGQgYmUgcG9zc2libGVcbiAgICBpZiAoIWNvbmZpZy5yZXF1aXJlZCAmJiAhY29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJXaGVuIGF1dGhlbnRpY2F0aW9uIGlzIG5vdCByZXF1aXJlZCwgeW91IG11c3QgZWl0aGVyIGVuYWJsZSBhbm9ueW1vdXMgY29ubmVjdGlvbnMgXCIgK1xuICAgICAgICAgIFwib3Igc2V0IHJlcXVpcmVkIHRvIHRydWUuIEN1cnJlbnQgY29uZmlndXJhdGlvbiB3b3VsZCBwcmV2ZW50IGFueSBjb25uZWN0aW9ucy5cIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBBZGRpdGlvbmFsIHZhbGlkYXRpb24gY2hlY2tzXG4gICAgaWYgKGNvbmZpZy5yZXF1aXJlZCAmJiAhY29uZmlnLmF1dGhQcm92aWRlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gcHJvdmlkZXIgaXMgcmVxdWlyZWQgd2hlbiBhdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZFwiXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcuYWxsb3dBbm9ueW1vdXMgJiYgIWNvbmZpZy5zZXNzaW9uU3RvcmUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIlNlc3Npb24gc3RvcmUgaXMgcmVxdWlyZWQgd2hlbiBhbm9ueW1vdXMgY29ubmVjdGlvbnMgYXJlIGFsbG93ZWRcIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBhbm9ueW1vdXMgY29uZmlnIGlmIGFub255bW91cyBjb25uZWN0aW9ucyBhcmUgYWxsb3dlZFxuICAgIGlmIChjb25maWcuYWxsb3dBbm9ueW1vdXMgJiYgY29uZmlnLmFub255bW91c0NvbmZpZykge1xuICAgICAgaWYgKFxuICAgICAgICBjb25maWcuYW5vbnltb3VzQ29uZmlnLnNlc3Npb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgIGNvbmZpZy5hbm9ueW1vdXNDb25maWcuc2Vzc2lvbkR1cmF0aW9uIDw9IDBcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJJbnZhbGlkIGFub255bW91cyBzZXNzaW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICAgIFwiU2Vzc2lvbiBkdXJhdGlvbiBtdXN0IGJlIHBvc2l0aXZlXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUF1dGhlbnRpY2F0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZVxuICApOiBQcm9taXNlPFdlYnNvY2tldENvbm5lY3Rpb24gfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEZpcnN0LCB0cnkgdG8gYXV0aGVudGljYXRlIGlmIGNyZWRlbnRpYWxzIGFyZSBwcm92aWRlZFxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpXG4gICAgICApO1xuXG4gICAgICAvLyBUcnkgdG9rZW4vY3JlZGVudGlhbHMgYXV0aGVudGljYXRpb24gZmlyc3QgaWYgbWlkZGxld2FyZSBleGlzdHNcbiAgICAgIGlmICh0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGF1dGhSZXN1bHQgPVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUuYXV0aGVudGljYXRlQ29ubmVjdGlvbihcbiAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgY29ubmVjdGlvblxuICAgICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoYXV0aFJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdXRoUmVzdWx0KSkge1xuICAgICAgICAgICAgICBpZiAodmFsdWUpIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdGlvbjtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgLy8gQXV0aGVudGljYXRpb24gZmFpbGVkLCBidXQgd2UgbWlnaHQgc3RpbGwgYWxsb3cgYW5vbnltb3VzIGFjY2Vzc1xuICAgICAgICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBJZiB3ZSByZWFjaCBoZXJlIGFuZCBhbm9ueW1vdXMgYWNjZXNzIGlzIGFsbG93ZWQsIGNyZWF0ZSBhbm9ueW1vdXMgc2Vzc2lvblxuICAgICAgaWYgKHRoaXMuYXV0aENvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZUFub255bW91c1Nlc3Npb24oY29ubmVjdGlvbiwgcmVxdWVzdCk7XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB3ZSByZWFjaCBoZXJlLCBuZWl0aGVyIGF1dGhlbnRpY2F0aW9uIHN1Y2NlZWRlZCBub3IgYW5vbnltb3VzIGFjY2VzcyBpcyBhbGxvd2VkXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKFwiQXV0aGVudGljYXRpb24gZXJyb3I6XCIsIGVycm9yKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY3JlYXRlQW5vbnltb3VzU2Vzc2lvbihcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uLFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmF1dGhDb25maWcuYW5vbnltb3VzQ29uZmlnIHx8IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uRHVyYXRpb246IDI0ICogNjAgKiA2MCAqIDEwMDAsIC8vIDI0IGhvdXJzIGRlZmF1bHRcbiAgICB9O1xuXG4gICAgY29uc3QgZGV2aWNlSWQgPSB0aGlzLmV4dHJhY3REZXZpY2VJZChyZXF1ZXN0KTtcblxuICAgIGNvbnN0IHNlc3Npb25EYXRhOiBJU2Vzc2lvbkRhdGEgPSB7XG4gICAgICBzZXNzaW9uSWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXG4gICAgICB1c2VySWQ6IGRldmljZUlkIHx8IGNyeXB0by5yYW5kb21VVUlEKCksIC8vIFVzZSBkZXZpY2UgSUQgYXMgdXNlcklkIGlmIGF2YWlsYWJsZVxuICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShcbiAgICAgICAgRGF0ZS5ub3coKSArIChjb25maWcuc2Vzc2lvbkR1cmF0aW9uIHx8IDI0ICogNjAgKiA2MCAqIDEwMDApXG4gICAgICApLFxuICAgICAgbGFzdEFjY2Vzc2VkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICAuLi5jb25maWcubWV0YWRhdGEsXG4gICAgICAgIGlzQW5vbnltb3VzOiB0cnVlLFxuICAgICAgICBkZXZpY2VJZCxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGF3YWl0IHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuY3JlYXRlKHNlc3Npb25EYXRhKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwic2Vzc2lvbklkXCIsIHNlc3Npb25EYXRhLnNlc3Npb25JZCk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInVzZXJJZFwiLCBzZXNzaW9uRGF0YS51c2VySWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJpc0Fub255bW91c1wiLCB0cnVlKTtcbiAgICBjb25uZWN0aW9uLnNldEF1dGhlbnRpY2F0ZWQoZmFsc2UpO1xuICB9XG5cbiAgcHJpdmF0ZSBleHRyYWN0RGV2aWNlSWQocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gVHJ5IHRvIGV4dHJhY3QgZGV2aWNlIElEIGZyb20gdmFyaW91cyBzb3VyY2VzXG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCEsIGBodHRwOi8vJHtyZXF1ZXN0LmhlYWRlcnMuaG9zdH1gKTtcblxuICAgIC8vIENoZWNrIHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICBjb25zdCBkZXZpY2VJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZGV2aWNlSWRcIik7XG4gICAgaWYgKGRldmljZUlkKSByZXR1cm4gZGV2aWNlSWQ7XG5cbiAgICAvLyBDaGVjayBoZWFkZXJzXG4gICAgY29uc3QgZGV2aWNlSWRIZWFkZXIgPSByZXF1ZXN0LmhlYWRlcnNbXCJ4LWRldmljZS1pZFwiXTtcbiAgICBpZiAoZGV2aWNlSWRIZWFkZXIpIHJldHVybiBkZXZpY2VJZEhlYWRlci50b1N0cmluZygpO1xuXG4gICAgLy8gQ2hlY2sgY29va2llc1xuICAgIGNvbnN0IGNvb2tpZXMgPSByZXF1ZXN0LmhlYWRlcnMuY29va2llXG4gICAgICA/LnNwbGl0KFwiO1wiKVxuICAgICAgLm1hcCgoY29va2llKSA9PiBjb29raWUudHJpbSgpLnNwbGl0KFwiPVwiKSlcbiAgICAgIC5maW5kKChba2V5XSkgPT4ga2V5ID09PSBcImRldmljZUlkXCIpO1xuXG4gICAgcmV0dXJuIGNvb2tpZXMgPyBjb29raWVzWzFdIDogbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlV3NFdmVudHMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9uUmF0ZUxpbWl0OiAoY29ubmVjdGlvbklkOiBzdHJpbmcpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBSYXRlIGxpbWl0IGV4Y2VlZGVkIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfWApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiUmF0ZSBsaW1pdCBleGNlZWRlZFwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgb25FcnJvcjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCBlcnJvcjogRXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBFcnJvciBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGNvbm5lY3Rpb24gZXJyb3NcbiAgICAgIH0sXG4gICAgICBvblNlY3VyaXR5VmlvbGF0aW9uOiAoY29ubmVjdGlvbklkOiBzdHJpbmcsIHZpb2xhdGlvbjogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihcbiAgICAgICAgICBgU2VjdXJpdHkgdmlvbGF0aW9uIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfTogJHt2aW9sYXRpb259YFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiU2VjdXJpdHkgdmlvbGF0aW9uXCIpO1xuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaFNlc3Npb24oY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVmcmVzaFNlc3Npb24odGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZU1lc3NhZ2UoXG4gICAgZGF0YTogRGF0YSxcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb24pO1xuICAgICAgLy8gVE9ETzogaGFuZGxlIGV4cGlyZWQgc2Vzc2lvbnNcbiAgICAgIGNvbnN0IHN0ckRhdGEgPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBkZXRlY3Rpb25SZXN1bHQgPSBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShzdHJEYXRhKTtcblxuICAgICAgaWYgKFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJvYmplY3RcIlxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IFwicmF3XCIsXG4gICAgICAgICAgYm9keTogZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlc3BvbnNlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVzcG9uc2U8YW55PjtcbiAgICAgICAgaWYgKFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdFR5cGUgJiZcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgJiZcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgIT1cbiAgICAgICAgICAgIHJlc3BvbnNlLnJlc3BvbnNlSGVhZGVyLnJlc3BvbmRlckFkZHJlc3NcbiAgICAgICAgKSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdFR5cGUsXG4gICAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgICAgICBKU09OLnN0cmluZ2lmeShyZXNwb25zZS5ib2R5KSxcbiAgICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdElkXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVxdWVzdFwiKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVxdWVzdDxhbnk+O1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgbm9uLWF1dGhlbnRpY2F0ZWQgUmVxdWVzdHNcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGF1dGhvcml6YXRpb25cblxuICAgICAgICBsZXQgYXV0aE1ldGFkYXRhOiBJQXV0aGVudGljYXRpb25NZXRhZGF0YSA9IHt9O1xuICAgICAgICBhdXRoTWV0YWRhdGEuaXNBdXRoZW50aWNhdGVkID0gY29ubmVjdGlvbi5pc0F1dGhlbnRpY2F0ZWQoKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24uaXNBdXRoZW50aWNhdGVkKCkpIHtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuc2Vzc2lvbklkID0gY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEudXNlcklkID0gY29ubmVjdGlvbi5nZXRNZXRhZGF0YShcInVzZXJJZFwiKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuY29ubmVjdGlvbklkID0gY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keTogcmVxdWVzdC5ib2R5LFxuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgIC4uLnJlcXVlc3QuaGVhZGVyLFxuICAgICAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCksXG4gICAgICAgICAgICBhdXRoTWV0YWRhdGEsXG4gICAgICAgICAgICByZWNpcGllbnRBZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGU6IGFzeW5jIChcbiAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgICAgICAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICAgICAgICAgICkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhdHVzVXBkYXRlID0gTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlc3BvbnNlKFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgICAgICBzdGF0dXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoc3RhdHVzVXBkYXRlKSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgV2ViU29ja2V0IG1lc3NhZ2VgLCBlcnJvcik7XG5cbiAgICAgIGNvbnN0IGVycm9yUmVzcG9uc2UgPSBuZXcgUmVzcG9uc2VCdWlsZGVyKFxuICAgICAgICBSZXF1ZXN0QnVpbGRlci5jcmVhdGVTaW1wbGUoXG4gICAgICAgICAgY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSxcbiAgICAgICAgICBcInVuZGVmaW5lZFwiLFxuICAgICAgICAgIHt9XG4gICAgICAgICksXG4gICAgICAgIHsgZGF0YSB9XG4gICAgICApLnNldEVycm9yKG5ldyBMb2dnYWJsZUVycm9yKFwiSW52YWxpZCBtZXNzYWdlIGZvcm1hdFwiKSk7XG5cbiAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlLmJ1aWxkKCkpKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUNsb3NlKGNvbm5lY3Rpb25JZDogc3RyaW5nKSB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgIGF3YWl0IGNvbm5lY3Rpb24uY2xvc2UoMTAwMCwgXCJDb25uZWN0aW9uIGNsb3NlZFwiKTtcbiAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgICBjb25zdCBzZXNzaW9uSWQgPSBjb25uZWN0aW9uLmdldFNlc3Npb25JZCgpO1xuICAgICAgaWYgKHNlc3Npb25JZCkge1xuICAgICAgICBhd2FpdCB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlLmRlbGV0ZShzZXNzaW9uSWQpO1xuICAgICAgfVxuICAgICAgdGhpcy5pbmZvKGBXZWJTb2NrZXQgY29ubmVjdGlvbiBjbG9zZWQ6ICR7Y29ubmVjdGlvbklkfWApO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMuc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZvKGBXZWJTb2NrZXQgc2VydmVyIGxpc3RlbmluZyBvbiBwb3J0ICR7dGhpcy5wb3J0fWApO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdG9wRGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBGaXJzdCwgc3RvcCBhY2NlcHRpbmcgbmV3IGNvbm5lY3Rpb25zXG4gICAgICB0aGlzLnNlcnZlci5jbG9zZSgpO1xuXG4gICAgICAvLyBDbG9zZSBhbGwgYWN0aXZlIGNvbm5lY3Rpb25zXG4gICAgICB0aGlzLmluZm8oXCJDbG9zaW5nIGFsbCBhY3RpdmUgV2ViU29ja2V0IGNvbm5lY3Rpb25zLi4uXCIpO1xuICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgIEFycmF5LmZyb20odGhpcy5jb25uZWN0aW9ucy52YWx1ZXMoKSkubWFwKChjb25uZWN0aW9uKSA9PlxuICAgICAgICAgIGNvbm5lY3Rpb24uY2xvc2UoMTAwMCwgXCJTZXJ2ZXIgc2h1dHRpbmcgZG93blwiKVxuICAgICAgICApXG4gICAgICApO1xuXG4gICAgICAvLyBXYWl0IGZvciB0aGUgV1NTIHRvIGNsb3NlIHByb3Blcmx5XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIC8vIFNldCBhIHRpbWVvdXQgdG8gcHJldmVudCBoYW5naW5nXG4gICAgICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICByZWplY3QobmV3IEVycm9yKFwiV1NTIGNsb3NlIHRpbWVvdXRcIikpO1xuICAgICAgICB9LCA1MDAwKTtcblxuICAgICAgICB0aGlzLndzcy5jbG9zZSgoKSA9PiB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgICAgIHRoaXMuaW5mbyhcIldlYlNvY2tldCBzZXJ2ZXIgc3RvcHBlZFwiKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihcIkVycm9yIGR1cmluZyBzaHV0ZG93bjpcIiwgZXJyb3IpO1xuICAgICAgLy8gRm9yY2UgY2xvc2UgZXZlcnl0aGluZ1xuICAgICAgdGhpcy53c3MuY2xpZW50cy5mb3JFYWNoKChjbGllbnQpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjbGllbnQudGVybWluYXRlKCk7XG4gICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAvLyBJZ25vcmUgZXJyb3JzIGR1cmluZyBmb3JjZSB0ZXJtaW5hdGlvblxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHRocm93IGVycm9yOyAvLyBSZS10aHJvdyB0byBpbmRpY2F0ZSBzaHV0ZG93biBmYWlsdXJlXG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlZmF1bHRNZXNzYWdlSGFuZGxlcihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiBQcm9taXNlPFdlYlNvY2tldFJlc3BvbnNlPiB7XG4gICAgdGhpcy53YXJuKFxuICAgICAgYFVuaGFuZGxlZCBXZWJTb2NrZXQgbWVzc2FnZSB0eXBlOiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgICByZXF1ZXN0XG4gICAgKTtcbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICBlcnJvcjogYFwiVW5oYW5kbGVkIG1lc3NhZ2UgdHlwZVwiICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCxcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldENvbm5lY3Rpb25zKCk6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+IHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9ucztcbiAgfVxuXG4gIHB1YmxpYyBicm9hZGNhc3QobWVzc2FnZTogSVJlcXVlc3Q8YW55Pik6IHZvaWQge1xuICAgIGNvbnN0IHJlcXVlc3QgPSBSZXF1ZXN0QnVpbGRlci5mcm9tKG1lc3NhZ2UpO1xuICAgIHJlcXVlc3Quc2V0UmVxdWlyZXNSZXNwb25zZShmYWxzZSk7XG4gICAgY29uc3QgbWVzc2FnZVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KHJlcXVlc3QuYnVpbGQoKSk7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5mb3JFYWNoKChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25uZWN0aW9uLnNlbmQobWVzc2FnZVN0cmluZyk7XG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBnZXRTZXNzaW9uQnlJZChzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8SVNlc3Npb25EYXRhIHwgbnVsbD4ge1xuICAgIHJldHVybiB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlLmdldChzZXNzaW9uSWQpO1xuICB9XG5cbiAgQFJlcXVlc3RIYW5kbGVyPHN0cmluZz4oXCJyYXdcIilcbiAgcHJvdGVjdGVkIGFzeW5jIHJhd01lc3NhZ2VIYW5kbGVyKG1lc3NhZ2U6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgdGhpcy53YXJuKGBSZWNlaXZlZCByYXcgbWVzc2FnZWAsIG1lc3NhZ2UpO1xuICAgIHJldHVybiBcIkVSUk9SOiBSYXcgbWVzc2FnZXMgbm90IHN1cHBvcnRlZC4gUGxlYXNlIHVzZSBDb21tdW5pY2F0aW9uc01hbmFnZXJcIjtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShtZXNzYWdlOiBzdHJpbmcpOiBEZXRlY3Rpb25SZXN1bHQ8dW5rbm93bj4ge1xuICAvLyBGaXJzdCwgY2hlY2sgaWYgdGhlIG1lc3NhZ2UgaXMgbGlrZWx5IEpTT04gb3IgYSBKYXZhU2NyaXB0LWxpa2Ugb2JqZWN0XG4gIGlmIChtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwie1wiKSB8fCBtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwiW1wiKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG1lc3NhZ2UpO1xuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVxdWVzdFxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcImhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5oZWFkZXIgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJ0aW1lc3RhbXBcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdElkXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RlckFkZHJlc3NcIiBpbiBwYXJzZWQuaGVhZGVyXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVxdWVzdFwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVxdWVzdDx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlc3BvbnNlXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwicmVxdWVzdEhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlc3BvbnNlXCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXNwb25zZTx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgaXQncyBhIHBhcnNlZCBvYmplY3QgYnV0IG5vdCBJUmVxdWVzdCBvciBJUmVzcG9uc2VcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcIm9iamVjdFwiLCBwYXlsb2FkOiBwYXJzZWQgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gSWYgcGFyc2luZyBmYWlscywgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIElmIGl0IGRvZXNuJ3QgbG9vayBsaWtlIEpTT04sIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgfVxufVxuIl19