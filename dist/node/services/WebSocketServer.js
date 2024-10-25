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
        this.validateAuthenticationConfig(config.authentication);
        this.port = config.port;
        this.path = config.path || "/ws";
        this.maxConnections = config.maxConnections || 1000;
        this.authConfig = config.authentication;
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
                const connection = new WebsocketConnection_1.WebsocketConnection(this.handleMessage.bind(this), this.handleClose.bind(this), undefined, // default timeout
                undefined, // default rate limit
                this.handleWsEvents(), ws);
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
        return this.authConfig.sessionStore.get(sessionId);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBUTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBd0N4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBVUMsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFSakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVVoRSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO1FBRXhDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRTFDLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUMvRCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxJQUFJLEtBQUssQ0FDYiw0RUFBNEUsQ0FDN0UsQ0FBQztZ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O29CQUN4QixPQUFPLEVBQUUsTUFBNEI7aUJBQ3RDLENBQUM7WUFDSixDQUFDO1lBRUQsd0RBQXdEO1lBQ3hELE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxNQUFNLEVBQUUsQ0FBQztRQUNwRCxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLHlDQUF5QztZQUN6QyxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7UUFDckQsQ0FBQztJQUNILENBQUM7U0FBTSxDQUFDO1FBQ04scURBQXFEO1FBQ3JELE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztJQUNyRCxDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFNlcnZlciwgRGF0YSB9IGZyb20gXCJ3c1wiO1xuaW1wb3J0IHsgY3JlYXRlU2VydmVyLCBTZXJ2ZXIgYXMgSHR0cFNlcnZlciwgSW5jb21pbmdNZXNzYWdlIH0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB7IER1cGxleCB9IGZyb20gXCJzdHJlYW1cIjtcbmltcG9ydCB7XG4gIElBdXRoZW50aWNhdGlvbk1ldGFkYXRhLFxuICBJUmVxdWVzdEhlYWRlcixcbiAgSVNlc3Npb25EYXRhLFxufSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuXG5pbXBvcnQge1xuICBNaWNyb3NlcnZpY2VGcmFtZXdvcmssXG4gIElTZXJ2ZXJDb25maWcsXG4gIFN0YXR1c1VwZGF0ZSxcbiAgUmVxdWVzdEhhbmRsZXIsXG59IGZyb20gXCIuLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7XG4gIElCYWNrRW5kLFxuICBJUmVxdWVzdCxcbiAgSVJlc3BvbnNlLFxuICBJU2Vzc2lvblN0b3JlLFxuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFdlYnNvY2tldENvbm5lY3Rpb24gfSBmcm9tIFwiLi9XZWJzb2NrZXRDb25uZWN0aW9uXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfSBmcm9tIFwiLi9XZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmVcIjtcblxudHlwZSBQYXlsb2FkVHlwZSA9IFwib2JqZWN0XCIgfCBcInN0cmluZ1wiIHwgXCJJUmVxdWVzdFwiIHwgXCJJUmVzcG9uc2VcIjtcblxuaW50ZXJmYWNlIERldGVjdGlvblJlc3VsdDxUPiB7XG4gIHBheWxvYWRUeXBlOiBQYXlsb2FkVHlwZTtcbiAgcGF5bG9hZDogVDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBbm9ueW1vdXNTZXNzaW9uQ29uZmlnIHtcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgc2Vzc2lvbkR1cmF0aW9uPzogbnVtYmVyOyAvLyBEdXJhdGlvbiBpbiBtaWxsaXNlY29uZHNcbiAgcGVyc2lzdGVudElkZW50aXR5RW5hYmxlZD86IGJvb2xlYW47XG4gIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXV0aGVudGljYXRpb25Db25maWcge1xuICByZXF1aXJlZDogYm9vbGVhbjtcbiAgYWxsb3dBbm9ueW1vdXM6IGJvb2xlYW47XG4gIGFub255bW91c0NvbmZpZz86IEFub255bW91c1Nlc3Npb25Db25maWc7XG4gIGF1dGhQcm92aWRlcj86IElBdXRoZW50aWNhdGlvblByb3ZpZGVyO1xuICBzZXNzaW9uU3RvcmU6IElTZXNzaW9uU3RvcmU7XG4gIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZT86IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBwYXRoPzogc3RyaW5nO1xuICBtYXhDb25uZWN0aW9ucz86IG51bWJlcjtcbiAgYXV0aGVudGljYXRpb246IEF1dGhlbnRpY2F0aW9uQ29uZmlnO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRNZXNzYWdlID0ge1xuICB0eXBlOiBzdHJpbmc7XG4gIGRhdGE6IGFueTtcbiAgY29ubmVjdGlvbklkOiBzdHJpbmc7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFJlc3BvbnNlIHt9XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRTZXJ2ZXIgZXh0ZW5kcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFdlYlNvY2tldE1lc3NhZ2UsXG4gIFdlYlNvY2tldFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IEh0dHBTZXJ2ZXI7XG4gIHByaXZhdGUgd3NzOiBTZXJ2ZXI7XG4gIHByaXZhdGUgY29ubmVjdGlvbnM6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBwYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgbWF4Q29ubmVjdGlvbnM6IG51bWJlcjtcbiAgcHJpdmF0ZSBhdXRoQ29uZmlnOiBBdXRoZW50aWNhdGlvbkNvbmZpZztcbiAgcHJpdmF0ZSBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogV2ViU29ja2V0U2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcblxuICAgIHRoaXMudmFsaWRhdGVBdXRoZW50aWNhdGlvbkNvbmZpZyhjb25maWcuYXV0aGVudGljYXRpb24pO1xuXG4gICAgdGhpcy5wb3J0ID0gY29uZmlnLnBvcnQ7XG4gICAgdGhpcy5wYXRoID0gY29uZmlnLnBhdGggfHwgXCIvd3NcIjtcbiAgICB0aGlzLm1heENvbm5lY3Rpb25zID0gY29uZmlnLm1heENvbm5lY3Rpb25zIHx8IDEwMDA7XG4gICAgdGhpcy5hdXRoQ29uZmlnID0gY29uZmlnLmF1dGhlbnRpY2F0aW9uO1xuXG4gICAgdGhpcy5zZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoKTtcbiAgICB0aGlzLndzcyA9IG5ldyBTZXJ2ZXIoeyBub1NlcnZlcjogdHJ1ZSB9KTtcblxuICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQgfHwgdGhpcy5hdXRoQ29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICBpZiAoIXRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiU2Vzc2lvbiBzdG9yZSBpcyByZXF1aXJlZCBmb3IgYm90aCBhdXRoZW50aWNhdGVkIGFuZCBhbm9ueW1vdXMgY29ubmVjdGlvbnNcIlxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkICYmICF0aGlzLmF1dGhDb25maWcuYXV0aFByb3ZpZGVyKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIHByb3ZpZGVyIGlzIHJlcXVpcmVkIHdoZW4gYXV0aGVudGljYXRpb24gaXMgcmVxdWlyZWRcIlxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSA9XG4gICAgICAgIGNvbmZpZy5hdXRoZW50aWNhdGlvbi5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgfHxcbiAgICAgICAgbmV3IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZShcbiAgICAgICAgICB0aGlzLmF1dGhDb25maWcuYXV0aFByb3ZpZGVyISxcbiAgICAgICAgICB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgdGhpcy5zZXR1cFdlYlNvY2tldFNlcnZlcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cFdlYlNvY2tldFNlcnZlcigpIHtcbiAgICB0aGlzLnNlcnZlci5vbihcbiAgICAgIFwidXBncmFkZVwiLFxuICAgICAgYXN5bmMgKHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSwgc29ja2V0OiBEdXBsZXgsIGhlYWQ6IEJ1ZmZlcikgPT4ge1xuICAgICAgICAvLyBQcmV2ZW50IG1lbW9yeSBsZWFrcyBieSBoYW5kbGluZyBzb2NrZXQgZXJyb3JzXG4gICAgICAgIHNvY2tldC5vbihcImVycm9yXCIsIChlcnIpID0+IHtcbiAgICAgICAgICB0aGlzLmVycm9yKFwiU29ja2V0IGVycm9yOlwiLCBlcnIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFBhcnNlIHRoZSBVUkwgdG8gZ2V0IGp1c3QgdGhlIHBhdGhuYW1lXG4gICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG5cbiAgICAgICAgaWYgKHVybC5wYXRobmFtZSAhPT0gdGhpcy5wYXRoKSB7XG4gICAgICAgICAgc29ja2V0LndyaXRlKFwiSFRUUC8xLjEgNDA0IE5vdCBGb3VuZFxcclxcblxcclxcblwiKTtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICAgIHRoaXMud2FybihgSW52YWxpZCBwYXRoOiAke3JlcXVlc3QudXJsfWApO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBhd2FpdCB0aGlzLmhhbmRsZUF1dGhlbnRpY2F0aW9uKHJlcXVlc3QpO1xuICAgICAgICBpZiAoIWNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXG4gICAgICAgICAgICBcIkhUVFAvMS4xIDQwMSBVbmF1dGhvcml6ZWRcXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQ29ubmVjdGlvbjogY2xvc2VcXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQ29udGVudC1UeXBlOiB0ZXh0L3BsYWluXFxyXFxuXFxyXFxuXCIgK1xuICAgICAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIGZhaWxlZFxcclxcblwiXG4gICAgICAgICAgKTtcbiAgICAgICAgICBzb2NrZXQuZW5kKCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy51cGdyYWRlQ29ubmVjdGlvbihyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsIGNvbm5lY3Rpb24pO1xuICAgICAgfVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHVwZ3JhZGVDb25uZWN0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSxcbiAgICBzb2NrZXQ6IER1cGxleCxcbiAgICBoZWFkOiBCdWZmZXIsXG4gICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24/OiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICkge1xuICAgIHRoaXMud3NzLmhhbmRsZVVwZ3JhZGUocmVxdWVzdCwgc29ja2V0LCBoZWFkLCAod3MpID0+IHtcbiAgICAgIGlmICh0aGlzLmNvbm5lY3Rpb25zLnNpemUgPj0gdGhpcy5tYXhDb25uZWN0aW9ucykge1xuICAgICAgICB3cy5jbG9zZSgxMDEzLCBcIk1heGltdW0gbnVtYmVyIG9mIGNvbm5lY3Rpb25zIHJlYWNoZWRcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uKSB7XG4gICAgICAgIC8vIFNldCB0aGUgV2ViU29ja2V0IGluc3RhbmNlIG9uIHRoZSBleGlzdGluZyBjb25uZWN0aW9uXG4gICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLnNldFdlYlNvY2tldCh3cyk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uXG4gICAgICAgICk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBDcmVhdGUgbmV3IGNvbm5lY3Rpb24gd2l0aCBXZWJTb2NrZXQgaW5zdGFuY2VcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB1bmRlZmluZWQsIC8vIGRlZmF1bHQgdGltZW91dFxuICAgICAgICAgIHVuZGVmaW5lZCwgLy8gZGVmYXVsdCByYXRlIGxpbWl0XG4gICAgICAgICAgdGhpcy5oYW5kbGVXc0V2ZW50cygpLFxuICAgICAgICAgIHdzXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksIGNvbm5lY3Rpb24pO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUF1dGhlbnRpY2F0aW9uQ29uZmlnKGNvbmZpZzogQXV0aGVudGljYXRpb25Db25maWcpOiB2b2lkIHtcbiAgICAvLyBDaGVjayBmb3IgaW52YWxpZCBjb25maWd1cmF0aW9uIHdoZXJlIG5vIGNvbm5lY3Rpb25zIHdvdWxkIGJlIHBvc3NpYmxlXG4gICAgaWYgKCFjb25maWcucmVxdWlyZWQgJiYgIWNvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiV2hlbiBhdXRoZW50aWNhdGlvbiBpcyBub3QgcmVxdWlyZWQsIHlvdSBtdXN0IGVpdGhlciBlbmFibGUgYW5vbnltb3VzIGNvbm5lY3Rpb25zIFwiICtcbiAgICAgICAgICBcIm9yIHNldCByZXF1aXJlZCB0byB0cnVlLiBDdXJyZW50IGNvbmZpZ3VyYXRpb24gd291bGQgcHJldmVudCBhbnkgY29ubmVjdGlvbnMuXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gQWRkaXRpb25hbCB2YWxpZGF0aW9uIGNoZWNrc1xuICAgIGlmIChjb25maWcucmVxdWlyZWQgJiYgIWNvbmZpZy5hdXRoUHJvdmlkZXIpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIkF1dGhlbnRpY2F0aW9uIHByb3ZpZGVyIGlzIHJlcXVpcmVkIHdoZW4gYXV0aGVudGljYXRpb24gaXMgcmVxdWlyZWRcIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICBpZiAoY29uZmlnLmFsbG93QW5vbnltb3VzICYmICFjb25maWcuc2Vzc2lvblN0b3JlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJTZXNzaW9uIHN0b3JlIGlzIHJlcXVpcmVkIHdoZW4gYW5vbnltb3VzIGNvbm5lY3Rpb25zIGFyZSBhbGxvd2VkXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgLy8gVmFsaWRhdGUgYW5vbnltb3VzIGNvbmZpZyBpZiBhbm9ueW1vdXMgY29ubmVjdGlvbnMgYXJlIGFsbG93ZWRcbiAgICBpZiAoY29uZmlnLmFsbG93QW5vbnltb3VzICYmIGNvbmZpZy5hbm9ueW1vdXNDb25maWcpIHtcbiAgICAgIGlmIChcbiAgICAgICAgY29uZmlnLmFub255bW91c0NvbmZpZy5zZXNzaW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCAmJlxuICAgICAgICBjb25maWcuYW5vbnltb3VzQ29uZmlnLnNlc3Npb25EdXJhdGlvbiA8PSAwXG4gICAgICApIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiSW52YWxpZCBhbm9ueW1vdXMgc2Vzc2lvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgICBcIlNlc3Npb24gZHVyYXRpb24gbXVzdCBiZSBwb3NpdGl2ZVwiXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVBdXRoZW50aWNhdGlvbihcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2VcbiAgKTogUHJvbWlzZTxXZWJzb2NrZXRDb25uZWN0aW9uIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBGaXJzdCwgdHJ5IHRvIGF1dGhlbnRpY2F0ZSBpZiBjcmVkZW50aWFscyBhcmUgcHJvdmlkZWRcbiAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKVxuICAgICAgKTtcblxuICAgICAgLy8gVHJ5IHRva2VuL2NyZWRlbnRpYWxzIGF1dGhlbnRpY2F0aW9uIGZpcnN0IGlmIG1pZGRsZXdhcmUgZXhpc3RzXG4gICAgICBpZiAodGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBhdXRoUmVzdWx0ID1cbiAgICAgICAgICAgIGF3YWl0IHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlLmF1dGhlbnRpY2F0ZUNvbm5lY3Rpb24oXG4gICAgICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICAgICAgIGNvbm5lY3Rpb25cbiAgICAgICAgICAgICk7XG4gICAgICAgICAgaWYgKGF1dGhSZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgICAgZm9yIChjb25zdCBba2V5LCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoYXV0aFJlc3VsdCkpIHtcbiAgICAgICAgICAgICAgaWYgKHZhbHVlKSBjb25uZWN0aW9uLnNldE1ldGFkYXRhKGtleSwgdmFsdWUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb247XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIC8vIEF1dGhlbnRpY2F0aW9uIGZhaWxlZCwgYnV0IHdlIG1pZ2h0IHN0aWxsIGFsbG93IGFub255bW91cyBhY2Nlc3NcbiAgICAgICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkKSB7XG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gSWYgd2UgcmVhY2ggaGVyZSBhbmQgYW5vbnltb3VzIGFjY2VzcyBpcyBhbGxvd2VkLCBjcmVhdGUgYW5vbnltb3VzIHNlc3Npb25cbiAgICAgIGlmICh0aGlzLmF1dGhDb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jcmVhdGVBbm9ueW1vdXNTZXNzaW9uKGNvbm5lY3Rpb24sIHJlcXVlc3QpO1xuICAgICAgICByZXR1cm4gY29ubmVjdGlvbjtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgd2UgcmVhY2ggaGVyZSwgbmVpdGhlciBhdXRoZW50aWNhdGlvbiBzdWNjZWVkZWQgbm9yIGFub255bW91cyBhY2Nlc3MgaXMgYWxsb3dlZFxuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihcIkF1dGhlbnRpY2F0aW9uIGVycm9yOlwiLCBlcnJvcik7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNyZWF0ZUFub255bW91c1Nlc3Npb24oXG4gICAgY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvbixcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2VcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29uZmlnID0gdGhpcy5hdXRoQ29uZmlnLmFub255bW91c0NvbmZpZyB8fCB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgc2Vzc2lvbkR1cmF0aW9uOiAyNCAqIDYwICogNjAgKiAxMDAwLCAvLyAyNCBob3VycyBkZWZhdWx0XG4gICAgfTtcblxuICAgIGNvbnN0IGRldmljZUlkID0gdGhpcy5leHRyYWN0RGV2aWNlSWQocmVxdWVzdCk7XG5cbiAgICBjb25zdCBzZXNzaW9uRGF0YTogSVNlc3Npb25EYXRhID0ge1xuICAgICAgc2Vzc2lvbklkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxuICAgICAgdXNlcklkOiBkZXZpY2VJZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpLCAvLyBVc2UgZGV2aWNlIElEIGFzIHVzZXJJZCBpZiBhdmFpbGFibGVcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKSxcbiAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoXG4gICAgICAgIERhdGUubm93KCkgKyAoY29uZmlnLnNlc3Npb25EdXJhdGlvbiB8fCAyNCAqIDYwICogNjAgKiAxMDAwKVxuICAgICAgKSxcbiAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgLi4uY29uZmlnLm1ldGFkYXRhLFxuICAgICAgICBpc0Fub255bW91czogdHJ1ZSxcbiAgICAgICAgZGV2aWNlSWQsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBhd2FpdCB0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlLmNyZWF0ZShzZXNzaW9uRGF0YSk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInNlc3Npb25JZFwiLCBzZXNzaW9uRGF0YS5zZXNzaW9uSWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJ1c2VySWRcIiwgc2Vzc2lvbkRhdGEudXNlcklkKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwiaXNBbm9ueW1vdXNcIiwgdHJ1ZSk7XG4gICAgY29ubmVjdGlvbi5zZXRBdXRoZW50aWNhdGVkKGZhbHNlKTtcbiAgfVxuXG4gIHByaXZhdGUgZXh0cmFjdERldmljZUlkKHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIFRyeSB0byBleHRyYWN0IGRldmljZSBJRCBmcm9tIHZhcmlvdXMgc291cmNlc1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG5cbiAgICAvLyBDaGVjayBxdWVyeSBwYXJhbWV0ZXJzXG4gICAgY29uc3QgZGV2aWNlSWQgPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcImRldmljZUlkXCIpO1xuICAgIGlmIChkZXZpY2VJZCkgcmV0dXJuIGRldmljZUlkO1xuXG4gICAgLy8gQ2hlY2sgaGVhZGVyc1xuICAgIGNvbnN0IGRldmljZUlkSGVhZGVyID0gcmVxdWVzdC5oZWFkZXJzW1wieC1kZXZpY2UtaWRcIl07XG4gICAgaWYgKGRldmljZUlkSGVhZGVyKSByZXR1cm4gZGV2aWNlSWRIZWFkZXIudG9TdHJpbmcoKTtcblxuICAgIC8vIENoZWNrIGNvb2tpZXNcbiAgICBjb25zdCBjb29raWVzID0gcmVxdWVzdC5oZWFkZXJzLmNvb2tpZVxuICAgICAgPy5zcGxpdChcIjtcIilcbiAgICAgIC5tYXAoKGNvb2tpZSkgPT4gY29va2llLnRyaW0oKS5zcGxpdChcIj1cIikpXG4gICAgICAuZmluZCgoW2tleV0pID0+IGtleSA9PT0gXCJkZXZpY2VJZFwiKTtcblxuICAgIHJldHVybiBjb29raWVzID8gY29va2llc1sxXSA6IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVdzRXZlbnRzKCkge1xuICAgIHJldHVybiB7XG4gICAgICBvblJhdGVMaW1pdDogKGNvbm5lY3Rpb25JZDogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgUmF0ZSBsaW1pdCBleGNlZWRlZCBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlJhdGUgbGltaXQgZXhjZWVkZWRcIik7XG4gICAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIG9uRXJyb3I6IChjb25uZWN0aW9uSWQ6IHN0cmluZywgZXJyb3I6IEVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihgRXJyb3IgZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9OiAke2Vycm9yLm1lc3NhZ2V9YCk7XG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBjb25uZWN0aW9uIGVycm9zXG4gICAgICB9LFxuICAgICAgb25TZWN1cml0eVZpb2xhdGlvbjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCB2aW9sYXRpb246IHN0cmluZykgPT4ge1xuICAgICAgICB0aGlzLndhcm4oXG4gICAgICAgICAgYFNlY3VyaXR5IHZpb2xhdGlvbiBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7dmlvbGF0aW9ufWBcbiAgICAgICAgKTtcbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDA4LCBcIlNlY3VyaXR5IHZpb2xhdGlvblwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCBjb25uZWN0aW9uLnJlZnJlc2hTZXNzaW9uKHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKFxuICAgIGRhdGE6IERhdGEsXG4gICAgY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvblxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5yZWZyZXNoU2Vzc2lvbihjb25uZWN0aW9uKTtcbiAgICAgIC8vIFRPRE86IGhhbmRsZSBleHBpcmVkIHNlc3Npb25zXG4gICAgICBjb25zdCBzdHJEYXRhID0gZGF0YS50b1N0cmluZygpO1xuICAgICAgY29uc3QgZGV0ZWN0aW9uUmVzdWx0ID0gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2Uoc3RyRGF0YSk7XG4gICAgICBsZXQgcmVxdWVzdFR5cGU6IHN0cmluZyA9IFwiXCI7XG5cbiAgICAgIGlmIChcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwic3RyaW5nXCIgfHxcbiAgICAgICAgZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwib2JqZWN0XCJcbiAgICAgICkge1xuICAgICAgICByZXF1ZXN0VHlwZSA9IFwicmF3XCI7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IFwicmF3XCIsXG4gICAgICAgICAgYm9keTogZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlc3BvbnNlXCIpIHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVzcG9uc2U8YW55PjtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgICAgICBKU09OLnN0cmluZ2lmeShyZXNwb25zZSksXG4gICAgICAgICAgcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgIHJlc3BvbnNlLmJvZHlcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWRUeXBlID09IFwiSVJlcXVlc3RcIikge1xuICAgICAgICBjb25zdCByZXF1ZXN0ID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlcXVlc3Q8YW55PjtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIG5vbi1hdXRoZW50aWNhdGVkIFJlcXVlc3RzXG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBhdXRob3JpemF0aW9uXG5cbiAgICAgICAgbGV0IGF1dGhNZXRhZGF0YTogSUF1dGhlbnRpY2F0aW9uTWV0YWRhdGEgPSB7fTtcbiAgICAgICAgYXV0aE1ldGFkYXRhLmlzQXV0aGVudGljYXRlZCA9IGNvbm5lY3Rpb24uaXNBdXRoZW50aWNhdGVkKCk7XG4gICAgICAgIGlmIChjb25uZWN0aW9uLmlzQXV0aGVudGljYXRlZCgpKSB7XG4gICAgICAgICAgYXV0aE1ldGFkYXRhLnNlc3Npb25JZCA9IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCk7XG4gICAgICAgICAgYXV0aE1ldGFkYXRhLnVzZXJJZCA9IGNvbm5lY3Rpb24uZ2V0TWV0YWRhdGEoXCJ1c2VySWRcIik7XG4gICAgICAgICAgYXV0aE1ldGFkYXRhLmNvbm5lY3Rpb25JZCA9IGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCk7XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHJlcXVlc3QuaGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgfHwgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlIHx8IFwidW5rbm93blwiLFxuICAgICAgICAgIGJvZHk6IHJlcXVlc3QuYm9keSxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkLFxuICAgICAgICAgICAgc2Vzc2lvbklkOiBjb25uZWN0aW9uLmdldFNlc3Npb25JZCgpLFxuICAgICAgICAgICAgYXV0aE1ldGFkYXRhLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOiBhc3luYyAoXG4gICAgICAgICAgICB1cGRhdGVSZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgICAgICAgICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgICAgICAgICApID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c1VwZGF0ZSA9IE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXNwb25zZShcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdCxcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICAgICAgc3RhdHVzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHN0YXR1c1VwZGF0ZSkpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFdlYlNvY2tldCBtZXNzYWdlYCwgZXJyb3IpO1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiSW52YWxpZCBtZXNzYWdlIGZvcm1hdFwiIH0pKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUNsb3NlKGNvbm5lY3Rpb25JZDogc3RyaW5nKSB7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoYXN5bmMgKHJlc29sdmUpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIC8vIENsb3NlIGFsbCBhY3RpdmUgY29ubmVjdGlvbnMgYW5kIHdhaXQgZm9yIHRoZW0gdG8gY29tcGxldGVcbiAgICAgICAgdGhpcy5pbmZvKFwiQ2xvc2luZyBhbGwgYWN0aXZlIFdlYlNvY2tldCBjb25uZWN0aW9ucy4uLlwiKTtcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgQXJyYXkuZnJvbSh0aGlzLmNvbm5lY3Rpb25zLnZhbHVlcygpKS5tYXAoKGNvbm5lY3Rpb24pID0+XG4gICAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIilcbiAgICAgICAgICApXG4gICAgICAgICk7XG5cbiAgICAgICAgLy8gQ2xvc2UgdGhlIFdlYlNvY2tldCBzZXJ2ZXIgYW5kIEhUVFAgc2VydmVyXG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlV3NzKSA9PiB7XG4gICAgICAgICAgdGhpcy53c3MuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgICAgIHJlc29sdmVXc3MoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHRoaXMuZXJyb3IoXCJFcnJvciBkdXJpbmcgc2h1dGRvd246XCIsIGVycm9yKTtcbiAgICAgICAgcmVzb2x2ZSgpOyAvLyBTdGlsbCByZXNvbHZlIHRvIGVuc3VyZSBzaHV0ZG93biBjb21wbGV0ZXNcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb25uZWN0aW9ucygpOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnM7XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXI8c3RyaW5nPihcInJhd1wiKVxuICBwcm90ZWN0ZWQgYXN5bmMgcmF3TWVzc2FnZUhhbmRsZXIobWVzc2FnZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJhdyBtZXNzYWdlYCwgbWVzc2FnZSk7XG4gICAgcmV0dXJuIFwiRVJST1I6IFJhdyBtZXNzYWdlcyBub3Qgc3VwcG9ydGVkLiBQbGVhc2UgdXNlIENvbW11bmljYXRpb25zTWFuYWdlclwiO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPik6IHZvaWQge1xuICAgIGNvbnN0IG1lc3NhZ2VTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmZvckVhY2goKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlU3RyaW5nKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzZW5kVG9Db25uZWN0aW9uKFxuICAgIGNvbm5lY3Rpb25JZDogc3RyaW5nLFxuICAgIG1lc3NhZ2U6IElSZXNwb25zZTxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBDb25uZWN0aW9uIG5vdCBmb3VuZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0U2Vzc2lvbkJ5SWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPElTZXNzaW9uRGF0YSB8IG51bGw+IHtcbiAgICByZXR1cm4gdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5nZXQoc2Vzc2lvbklkKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShtZXNzYWdlOiBzdHJpbmcpOiBEZXRlY3Rpb25SZXN1bHQ8dW5rbm93bj4ge1xuICAvLyBGaXJzdCwgY2hlY2sgaWYgdGhlIG1lc3NhZ2UgaXMgbGlrZWx5IEpTT04gb3IgYSBKYXZhU2NyaXB0LWxpa2Ugb2JqZWN0XG4gIGlmIChtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwie1wiKSB8fCBtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwiW1wiKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG1lc3NhZ2UpO1xuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVxdWVzdFxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcImhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5oZWFkZXIgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJ0aW1lc3RhbXBcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdElkXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RlckFkZHJlc3NcIiBpbiBwYXJzZWQuaGVhZGVyXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVxdWVzdFwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVxdWVzdDx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlc3BvbnNlXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwicmVxdWVzdEhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmJvZHkgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJkYXRhXCIgaW4gcGFyc2VkLmJvZHkgJiZcbiAgICAgICAgXCJzdWNjZXNzXCIgaW4gcGFyc2VkLmJvZHkgJiZcbiAgICAgICAgXCJlcnJvclwiIGluIHBhcnNlZC5ib2R5XG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVzcG9uc2VcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlc3BvbnNlPHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBpdCdzIGEgcGFyc2VkIG9iamVjdCBidXQgbm90IElSZXF1ZXN0IG9yIElSZXNwb25zZVxuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwib2JqZWN0XCIsIHBheWxvYWQ6IHBhcnNlZCB9O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJZiBwYXJzaW5nIGZhaWxzLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgaXQgZG9lc24ndCBsb29rIGxpa2UgSlNPTiwgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICB9XG59XG4iXX0=