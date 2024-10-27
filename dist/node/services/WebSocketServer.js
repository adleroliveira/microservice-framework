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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBUTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBd0N4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBVUMsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFSakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVVoRSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO1FBRXhDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRTFDLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUMvRCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxJQUFJLEtBQUssQ0FDYiw0RUFBNEUsQ0FDN0UsQ0FBQztZ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RSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7SUFDckQsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZXJ2ZXIsIERhdGEgfSBmcm9tIFwid3NcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciwgU2VydmVyIGFzIEh0dHBTZXJ2ZXIsIEluY29taW5nTWVzc2FnZSB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQgeyBEdXBsZXggfSBmcm9tIFwic3RyZWFtXCI7XG5pbXBvcnQge1xuICBJQXV0aGVudGljYXRpb25NZXRhZGF0YSxcbiAgSVJlcXVlc3RIZWFkZXIsXG4gIElTZXNzaW9uRGF0YSxcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuaW1wb3J0IHtcbiAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLFxuICBJU2VydmVyQ29uZmlnLFxuICBTdGF0dXNVcGRhdGUsXG4gIFJlcXVlc3RIYW5kbGVyLFxufSBmcm9tIFwiLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5pbXBvcnQge1xuICBJQmFja0VuZCxcbiAgSVJlcXVlc3QsXG4gIElSZXNwb25zZSxcbiAgSVNlc3Npb25TdG9yZSxcbiAgSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBXZWJzb2NrZXRDb25uZWN0aW9uIH0gZnJvbSBcIi4vV2Vic29ja2V0Q29ubmVjdGlvblwiO1xuaW1wb3J0IHsgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlIH0gZnJvbSBcIi4vV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlXCI7XG5cbnR5cGUgUGF5bG9hZFR5cGUgPSBcIm9iamVjdFwiIHwgXCJzdHJpbmdcIiB8IFwiSVJlcXVlc3RcIiB8IFwiSVJlc3BvbnNlXCI7XG5cbmludGVyZmFjZSBEZXRlY3Rpb25SZXN1bHQ8VD4ge1xuICBwYXlsb2FkVHlwZTogUGF5bG9hZFR5cGU7XG4gIHBheWxvYWQ6IFQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQW5vbnltb3VzU2Vzc2lvbkNvbmZpZyB7XG4gIGVuYWJsZWQ6IGJvb2xlYW47XG4gIHNlc3Npb25EdXJhdGlvbj86IG51bWJlcjsgLy8gRHVyYXRpb24gaW4gbWlsbGlzZWNvbmRzXG4gIHBlcnNpc3RlbnRJZGVudGl0eUVuYWJsZWQ/OiBib29sZWFuO1xuICBtZXRhZGF0YT86IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEF1dGhlbnRpY2F0aW9uQ29uZmlnIHtcbiAgcmVxdWlyZWQ6IGJvb2xlYW47XG4gIGFsbG93QW5vbnltb3VzOiBib29sZWFuO1xuICBhbm9ueW1vdXNDb25maWc/OiBBbm9ueW1vdXNTZXNzaW9uQ29uZmlnO1xuICBhdXRoUHJvdmlkZXI/OiBJQXV0aGVudGljYXRpb25Qcm92aWRlcjtcbiAgc2Vzc2lvblN0b3JlOiBJU2Vzc2lvblN0b3JlO1xuICBhdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU/OiBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmU7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0U2VydmVyQ29uZmlnIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIHBvcnQ6IG51bWJlcjtcbiAgcGF0aD86IHN0cmluZztcbiAgbWF4Q29ubmVjdGlvbnM/OiBudW1iZXI7XG4gIGF1dGhlbnRpY2F0aW9uOiBBdXRoZW50aWNhdGlvbkNvbmZpZztcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0TWVzc2FnZSA9IHtcbiAgdHlwZTogc3RyaW5nO1xuICBkYXRhOiBhbnk7XG4gIGNvbm5lY3Rpb25JZDogc3RyaW5nO1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRSZXNwb25zZSB7fVxuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0U2VydmVyIGV4dGVuZHMgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBXZWJTb2NrZXRNZXNzYWdlLFxuICBXZWJTb2NrZXRSZXNwb25zZVxuPiB7XG4gIHByaXZhdGUgc2VydmVyOiBIdHRwU2VydmVyO1xuICBwcml2YXRlIHdzczogU2VydmVyO1xuICBwcml2YXRlIGNvbm5lY3Rpb25zOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gIHByaXZhdGUgcGF0aDogc3RyaW5nO1xuICBwcml2YXRlIG1heENvbm5lY3Rpb25zOiBudW1iZXI7XG4gIHByaXZhdGUgYXV0aENvbmZpZzogQXV0aGVudGljYXRpb25Db25maWc7XG4gIHByaXZhdGUgYXV0aGVudGljYXRpb25NaWRkbGV3YXJlPzogV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlO1xuXG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQ6IElCYWNrRW5kLCBjb25maWc6IFdlYlNvY2tldFNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKGJhY2tlbmQsIGNvbmZpZyk7XG5cbiAgICB0aGlzLnZhbGlkYXRlQXV0aGVudGljYXRpb25Db25maWcoY29uZmlnLmF1dGhlbnRpY2F0aW9uKTtcblxuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0O1xuICAgIHRoaXMucGF0aCA9IGNvbmZpZy5wYXRoIHx8IFwiL3dzXCI7XG4gICAgdGhpcy5tYXhDb25uZWN0aW9ucyA9IGNvbmZpZy5tYXhDb25uZWN0aW9ucyB8fCAxMDAwO1xuICAgIHRoaXMuYXV0aENvbmZpZyA9IGNvbmZpZy5hdXRoZW50aWNhdGlvbjtcblxuICAgIHRoaXMuc2VydmVyID0gY3JlYXRlU2VydmVyKCk7XG4gICAgdGhpcy53c3MgPSBuZXcgU2VydmVyKHsgbm9TZXJ2ZXI6IHRydWUgfSk7XG5cbiAgICBpZiAodGhpcy5hdXRoQ29uZmlnLnJlcXVpcmVkIHx8IHRoaXMuYXV0aENvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgaWYgKCF0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIlNlc3Npb24gc3RvcmUgaXMgcmVxdWlyZWQgZm9yIGJvdGggYXV0aGVudGljYXRlZCBhbmQgYW5vbnltb3VzIGNvbm5lY3Rpb25zXCJcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuYXV0aENvbmZpZy5yZXF1aXJlZCAmJiAhdGhpcy5hdXRoQ29uZmlnLmF1dGhQcm92aWRlcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBwcm92aWRlciBpcyByZXF1aXJlZCB3aGVuIGF1dGhlbnRpY2F0aW9uIGlzIHJlcXVpcmVkXCJcbiAgICAgICAgKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgPVxuICAgICAgICBjb25maWcuYXV0aGVudGljYXRpb24uYXV0aGVudGljYXRpb25NaWRkbGV3YXJlIHx8XG4gICAgICAgIG5ldyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUoXG4gICAgICAgICAgdGhpcy5hdXRoQ29uZmlnLmF1dGhQcm92aWRlciEsXG4gICAgICAgICAgdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZVxuICAgICAgICApO1xuICAgIH1cblxuICAgIHRoaXMuc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKSB7XG4gICAgdGhpcy5zZXJ2ZXIub24oXG4gICAgICBcInVwZ3JhZGVcIixcbiAgICAgIGFzeW5jIChyZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UsIHNvY2tldDogRHVwbGV4LCBoZWFkOiBCdWZmZXIpID0+IHtcbiAgICAgICAgLy8gUHJldmVudCBtZW1vcnkgbGVha3MgYnkgaGFuZGxpbmcgc29ja2V0IGVycm9yc1xuICAgICAgICBzb2NrZXQub24oXCJlcnJvclwiLCAoZXJyKSA9PiB7XG4gICAgICAgICAgdGhpcy5lcnJvcihcIlNvY2tldCBlcnJvcjpcIiwgZXJyKTtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBQYXJzZSB0aGUgVVJMIHRvIGdldCBqdXN0IHRoZSBwYXRobmFtZVxuICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcXVlc3QudXJsISwgYGh0dHA6Ly8ke3JlcXVlc3QuaGVhZGVycy5ob3N0fWApO1xuXG4gICAgICAgIGlmICh1cmwucGF0aG5hbWUgIT09IHRoaXMucGF0aCkge1xuICAgICAgICAgIHNvY2tldC53cml0ZShcIkhUVFAvMS4xIDQwNCBOb3QgRm91bmRcXHJcXG5cXHJcXG5cIik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgICB0aGlzLndhcm4oYEludmFsaWQgcGF0aDogJHtyZXF1ZXN0LnVybH1gKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gYXdhaXQgdGhpcy5oYW5kbGVBdXRoZW50aWNhdGlvbihyZXF1ZXN0KTtcbiAgICAgICAgaWYgKCFjb25uZWN0aW9uKSB7XG4gICAgICAgICAgc29ja2V0LndyaXRlKFxuICAgICAgICAgICAgXCJIVFRQLzEuMSA0MDEgVW5hdXRob3JpemVkXFxyXFxuXCIgK1xuICAgICAgICAgICAgICBcIkNvbm5lY3Rpb246IGNsb3NlXFxyXFxuXCIgK1xuICAgICAgICAgICAgICBcIkNvbnRlbnQtVHlwZTogdGV4dC9wbGFpblxcclxcblxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBmYWlsZWRcXHJcXG5cIlxuICAgICAgICAgICk7XG4gICAgICAgICAgc29ja2V0LmVuZCgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMudXBncmFkZUNvbm5lY3Rpb24ocmVxdWVzdCwgc29ja2V0LCBoZWFkLCBjb25uZWN0aW9uKTtcbiAgICAgIH1cbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGdyYWRlQ29ubmVjdGlvbihcbiAgICByZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UsXG4gICAgc29ja2V0OiBEdXBsZXgsXG4gICAgaGVhZDogQnVmZmVyLFxuICAgIGF1dGhlbnRpY2F0ZWRDb25uZWN0aW9uPzogV2Vic29ja2V0Q29ubmVjdGlvblxuICApIHtcbiAgICB0aGlzLndzcy5oYW5kbGVVcGdyYWRlKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgKHdzKSA9PiB7XG4gICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5zaXplID49IHRoaXMubWF4Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgd3MuY2xvc2UoMTAxMywgXCJNYXhpbXVtIG51bWJlciBvZiBjb25uZWN0aW9ucyByZWFjaGVkXCIpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChhdXRoZW50aWNhdGVkQ29ubmVjdGlvbikge1xuICAgICAgICAvLyBTZXQgdGhlIFdlYlNvY2tldCBpbnN0YW5jZSBvbiB0aGUgZXhpc3RpbmcgY29ubmVjdGlvblxuICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5zZXRXZWJTb2NrZXQod3MpO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSxcbiAgICAgICAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvblxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gQ3JlYXRlIG5ldyBjb25uZWN0aW9uIHdpdGggV2ViU29ja2V0IGluc3RhbmNlXG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSBuZXcgV2Vic29ja2V0Q29ubmVjdGlvbihcbiAgICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgICB0aGlzLmhhbmRsZUNsb3NlLmJpbmQodGhpcyksXG4gICAgICAgICAgdW5kZWZpbmVkLCAvLyBkZWZhdWx0IHRpbWVvdXRcbiAgICAgICAgICB1bmRlZmluZWQsIC8vIGRlZmF1bHQgcmF0ZSBsaW1pdFxuICAgICAgICAgIHRoaXMuaGFuZGxlV3NFdmVudHMoKSxcbiAgICAgICAgICB3c1xuICAgICAgICApO1xuICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLCBjb25uZWN0aW9uKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgdmFsaWRhdGVBdXRoZW50aWNhdGlvbkNvbmZpZyhjb25maWc6IEF1dGhlbnRpY2F0aW9uQ29uZmlnKTogdm9pZCB7XG4gICAgLy8gQ2hlY2sgZm9yIGludmFsaWQgY29uZmlndXJhdGlvbiB3aGVyZSBubyBjb25uZWN0aW9ucyB3b3VsZCBiZSBwb3NzaWJsZVxuICAgIGlmICghY29uZmlnLnJlcXVpcmVkICYmICFjb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIldoZW4gYXV0aGVudGljYXRpb24gaXMgbm90IHJlcXVpcmVkLCB5b3UgbXVzdCBlaXRoZXIgZW5hYmxlIGFub255bW91cyBjb25uZWN0aW9ucyBcIiArXG4gICAgICAgICAgXCJvciBzZXQgcmVxdWlyZWQgdG8gdHJ1ZS4gQ3VycmVudCBjb25maWd1cmF0aW9uIHdvdWxkIHByZXZlbnQgYW55IGNvbm5lY3Rpb25zLlwiXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIEFkZGl0aW9uYWwgdmFsaWRhdGlvbiBjaGVja3NcbiAgICBpZiAoY29uZmlnLnJlcXVpcmVkICYmICFjb25maWcuYXV0aFByb3ZpZGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJBdXRoZW50aWNhdGlvbiBwcm92aWRlciBpcyByZXF1aXJlZCB3aGVuIGF1dGhlbnRpY2F0aW9uIGlzIHJlcXVpcmVkXCJcbiAgICAgICk7XG4gICAgfVxuXG4gICAgaWYgKGNvbmZpZy5hbGxvd0Fub255bW91cyAmJiAhY29uZmlnLnNlc3Npb25TdG9yZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiU2Vzc2lvbiBzdG9yZSBpcyByZXF1aXJlZCB3aGVuIGFub255bW91cyBjb25uZWN0aW9ucyBhcmUgYWxsb3dlZFwiXG4gICAgICApO1xuICAgIH1cblxuICAgIC8vIFZhbGlkYXRlIGFub255bW91cyBjb25maWcgaWYgYW5vbnltb3VzIGNvbm5lY3Rpb25zIGFyZSBhbGxvd2VkXG4gICAgaWYgKGNvbmZpZy5hbGxvd0Fub255bW91cyAmJiBjb25maWcuYW5vbnltb3VzQ29uZmlnKSB7XG4gICAgICBpZiAoXG4gICAgICAgIGNvbmZpZy5hbm9ueW1vdXNDb25maWcuc2Vzc2lvbkR1cmF0aW9uICE9PSB1bmRlZmluZWQgJiZcbiAgICAgICAgY29uZmlnLmFub255bW91c0NvbmZpZy5zZXNzaW9uRHVyYXRpb24gPD0gMFxuICAgICAgKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgICBcIkludmFsaWQgYW5vbnltb3VzIHNlc3Npb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgICAgXCJTZXNzaW9uIGR1cmF0aW9uIG11c3QgYmUgcG9zaXRpdmVcIlxuICAgICAgICApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQXV0aGVudGljYXRpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlXG4gICk6IFByb21pc2U8V2Vic29ja2V0Q29ubmVjdGlvbiB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgLy8gRmlyc3QsIHRyeSB0byBhdXRoZW50aWNhdGUgaWYgY3JlZGVudGlhbHMgYXJlIHByb3ZpZGVkXG4gICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICB0aGlzLmhhbmRsZUNsb3NlLmJpbmQodGhpcylcbiAgICAgICk7XG5cbiAgICAgIC8vIFRyeSB0b2tlbi9jcmVkZW50aWFscyBhdXRoZW50aWNhdGlvbiBmaXJzdCBpZiBtaWRkbGV3YXJlIGV4aXN0c1xuICAgICAgaWYgKHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgYXV0aFJlc3VsdCA9XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZS5hdXRoZW50aWNhdGVDb25uZWN0aW9uKFxuICAgICAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgICAgICBjb25uZWN0aW9uXG4gICAgICAgICAgICApO1xuICAgICAgICAgIGlmIChhdXRoUmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGF1dGhSZXN1bHQpKSB7XG4gICAgICAgICAgICAgIGlmICh2YWx1ZSkgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShrZXksIHZhbHVlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBjb25uZWN0aW9uO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAvLyBBdXRoZW50aWNhdGlvbiBmYWlsZWQsIGJ1dCB3ZSBtaWdodCBzdGlsbCBhbGxvdyBhbm9ueW1vdXMgYWNjZXNzXG4gICAgICAgICAgaWYgKHRoaXMuYXV0aENvbmZpZy5yZXF1aXJlZCkge1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHdlIHJlYWNoIGhlcmUgYW5kIGFub255bW91cyBhY2Nlc3MgaXMgYWxsb3dlZCwgY3JlYXRlIGFub255bW91cyBzZXNzaW9uXG4gICAgICBpZiAodGhpcy5hdXRoQ29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY3JlYXRlQW5vbnltb3VzU2Vzc2lvbihjb25uZWN0aW9uLCByZXF1ZXN0KTtcbiAgICAgICAgcmV0dXJuIGNvbm5lY3Rpb247XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHdlIHJlYWNoIGhlcmUsIG5laXRoZXIgYXV0aGVudGljYXRpb24gc3VjY2VlZGVkIG5vciBhbm9ueW1vdXMgYWNjZXNzIGlzIGFsbG93ZWRcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoXCJBdXRoZW50aWNhdGlvbiBlcnJvcjpcIiwgZXJyb3IpO1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjcmVhdGVBbm9ueW1vdXNTZXNzaW9uKFxuICAgIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24sXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuYXV0aENvbmZpZy5hbm9ueW1vdXNDb25maWcgfHwge1xuICAgICAgZW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNlc3Npb25EdXJhdGlvbjogMjQgKiA2MCAqIDYwICogMTAwMCwgLy8gMjQgaG91cnMgZGVmYXVsdFxuICAgIH07XG5cbiAgICBjb25zdCBkZXZpY2VJZCA9IHRoaXMuZXh0cmFjdERldmljZUlkKHJlcXVlc3QpO1xuXG4gICAgY29uc3Qgc2Vzc2lvbkRhdGE6IElTZXNzaW9uRGF0YSA9IHtcbiAgICAgIHNlc3Npb25JZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcbiAgICAgIHVzZXJJZDogZGV2aWNlSWQgfHwgY3J5cHRvLnJhbmRvbVVVSUQoKSwgLy8gVXNlIGRldmljZSBJRCBhcyB1c2VySWQgaWYgYXZhaWxhYmxlXG4gICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBleHBpcmVzQXQ6IG5ldyBEYXRlKFxuICAgICAgICBEYXRlLm5vdygpICsgKGNvbmZpZy5zZXNzaW9uRHVyYXRpb24gfHwgMjQgKiA2MCAqIDYwICogMTAwMClcbiAgICAgICksXG4gICAgICBsYXN0QWNjZXNzZWRBdDogbmV3IERhdGUoKSxcbiAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgIC4uLmNvbmZpZy5tZXRhZGF0YSxcbiAgICAgICAgaXNBbm9ueW1vdXM6IHRydWUsXG4gICAgICAgIGRldmljZUlkLFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgYXdhaXQgdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5jcmVhdGUoc2Vzc2lvbkRhdGEpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJzZXNzaW9uSWRcIiwgc2Vzc2lvbkRhdGEuc2Vzc2lvbklkKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwidXNlcklkXCIsIHNlc3Npb25EYXRhLnVzZXJJZCk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcImlzQW5vbnltb3VzXCIsIHRydWUpO1xuICAgIGNvbm5lY3Rpb24uc2V0QXV0aGVudGljYXRlZChmYWxzZSk7XG4gIH1cblxuICBwcml2YXRlIGV4dHJhY3REZXZpY2VJZChyZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBUcnkgdG8gZXh0cmFjdCBkZXZpY2UgSUQgZnJvbSB2YXJpb3VzIHNvdXJjZXNcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcXVlc3QudXJsISwgYGh0dHA6Ly8ke3JlcXVlc3QuaGVhZGVycy5ob3N0fWApO1xuXG4gICAgLy8gQ2hlY2sgcXVlcnkgcGFyYW1ldGVyc1xuICAgIGNvbnN0IGRldmljZUlkID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoXCJkZXZpY2VJZFwiKTtcbiAgICBpZiAoZGV2aWNlSWQpIHJldHVybiBkZXZpY2VJZDtcblxuICAgIC8vIENoZWNrIGhlYWRlcnNcbiAgICBjb25zdCBkZXZpY2VJZEhlYWRlciA9IHJlcXVlc3QuaGVhZGVyc1tcIngtZGV2aWNlLWlkXCJdO1xuICAgIGlmIChkZXZpY2VJZEhlYWRlcikgcmV0dXJuIGRldmljZUlkSGVhZGVyLnRvU3RyaW5nKCk7XG5cbiAgICAvLyBDaGVjayBjb29raWVzXG4gICAgY29uc3QgY29va2llcyA9IHJlcXVlc3QuaGVhZGVycy5jb29raWVcbiAgICAgID8uc3BsaXQoXCI7XCIpXG4gICAgICAubWFwKChjb29raWUpID0+IGNvb2tpZS50cmltKCkuc3BsaXQoXCI9XCIpKVxuICAgICAgLmZpbmQoKFtrZXldKSA9PiBrZXkgPT09IFwiZGV2aWNlSWRcIik7XG5cbiAgICByZXR1cm4gY29va2llcyA/IGNvb2tpZXNbMV0gOiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVXc0V2ZW50cygpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb25SYXRlTGltaXQ6IChjb25uZWN0aW9uSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICB0aGlzLndhcm4oYFJhdGUgbGltaXQgZXhjZWVkZWQgZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgICAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgICAgIGNvbm5lY3Rpb24uY2xvc2UoMTAwOCwgXCJSYXRlIGxpbWl0IGV4Y2VlZGVkXCIpO1xuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBvbkVycm9yOiAoY29ubmVjdGlvbklkOiBzdHJpbmcsIGVycm9yOiBFcnJvcikgPT4ge1xuICAgICAgICB0aGlzLndhcm4oYEVycm9yIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgY29ubmVjdGlvbiBlcnJvc1xuICAgICAgfSxcbiAgICAgIG9uU2VjdXJpdHlWaW9sYXRpb246IChjb25uZWN0aW9uSWQ6IHN0cmluZywgdmlvbGF0aW9uOiBzdHJpbmcpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKFxuICAgICAgICAgIGBTZWN1cml0eSB2aW9sYXRpb24gZm9yIGNvbm5lY3Rpb24gJHtjb25uZWN0aW9uSWR9OiAke3Zpb2xhdGlvbn1gXG4gICAgICAgICk7XG4gICAgICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgICAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgICAgIGNvbm5lY3Rpb24uY2xvc2UoMTAwOCwgXCJTZWN1cml0eSB2aW9sYXRpb25cIik7XG4gICAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoU2Vzc2lvbihjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgY29ubmVjdGlvbi5yZWZyZXNoU2Vzc2lvbih0aGlzLmF1dGhDb25maWcuc2Vzc2lvblN0b3JlKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlTWVzc2FnZShcbiAgICBkYXRhOiBEYXRhLFxuICAgIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMucmVmcmVzaFNlc3Npb24oY29ubmVjdGlvbik7XG4gICAgICAvLyBUT0RPOiBoYW5kbGUgZXhwaXJlZCBzZXNzaW9uc1xuICAgICAgY29uc3Qgc3RyRGF0YSA9IGRhdGEudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKHN0ckRhdGEpO1xuICAgICAgbGV0IHJlcXVlc3RUeXBlOiBzdHJpbmcgPSBcIlwiO1xuXG4gICAgICBpZiAoXG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIm9iamVjdFwiXG4gICAgICApIHtcbiAgICAgICAgcmVxdWVzdFR5cGUgPSBcInJhd1wiO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiBcInJhd1wiLFxuICAgICAgICAgIGJvZHk6IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkLFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXNwb25zZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlc3BvbnNlPGFueT47XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICByZXNwb25zZS5ib2R5XG4gICAgICAgICk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXF1ZXN0XCIpIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXF1ZXN0PGFueT47XG4gICAgICAgIC8vIFRPRE86IGhhbmRsZSBub24tYXV0aGVudGljYXRlZCBSZXF1ZXN0c1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgYXV0aG9yaXphdGlvblxuXG4gICAgICAgIGxldCBhdXRoTWV0YWRhdGE6IElBdXRoZW50aWNhdGlvbk1ldGFkYXRhID0ge307XG4gICAgICAgIGF1dGhNZXRhZGF0YS5pc0F1dGhlbnRpY2F0ZWQgPSBjb25uZWN0aW9uLmlzQXV0aGVudGljYXRlZCgpO1xuICAgICAgICBpZiAoY29ubmVjdGlvbi5pc0F1dGhlbnRpY2F0ZWQoKSkge1xuICAgICAgICAgIGF1dGhNZXRhZGF0YS5zZXNzaW9uSWQgPSBjb25uZWN0aW9uLmdldFNlc3Npb25JZCgpO1xuICAgICAgICAgIGF1dGhNZXRhZGF0YS51c2VySWQgPSBjb25uZWN0aW9uLmdldE1ldGFkYXRhKFwidXNlcklkXCIpO1xuICAgICAgICAgIGF1dGhNZXRhZGF0YS5jb25uZWN0aW9uSWQgPSBjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PGFueT4oe1xuICAgICAgICAgIHRvOiByZXF1ZXN0LmhlYWRlci5yZWNpcGllbnRBZGRyZXNzIHx8IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZSB8fCBcInVua25vd25cIixcbiAgICAgICAgICBib2R5OiByZXF1ZXN0LmJvZHksXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgLi4ucmVxdWVzdC5oZWFkZXIsXG4gICAgICAgICAgICByZXF1ZXN0SWQ6IHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCxcbiAgICAgICAgICAgIHNlc3Npb25JZDogY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKSxcbiAgICAgICAgICAgIGF1dGhNZXRhZGF0YSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTogYXN5bmMgKFxuICAgICAgICAgICAgdXBkYXRlUmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICAgICAgICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICAgICAgICAgKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGF0dXNVcGRhdGUgPSBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVzcG9uc2UoXG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QsXG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QuaGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgICAgICAgIHN0YXR1c1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShzdGF0dXNVcGRhdGUpKTtcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBXZWJTb2NrZXQgbWVzc2FnZWAsIGVycm9yKTtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIkludmFsaWQgbWVzc2FnZSBmb3JtYXRcIiB9KSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDbG9zZShjb25uZWN0aW9uSWQ6IHN0cmluZykge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICBhd2FpdCBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiQ29ubmVjdGlvbiBjbG9zZWRcIik7XG4gICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgY29uc3Qgc2Vzc2lvbklkID0gY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKTtcbiAgICAgIGlmIChzZXNzaW9uSWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5kZWxldGUoc2Vzc2lvbklkKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IGNvbm5lY3Rpb24gY2xvc2VkOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gRmlyc3QsIHN0b3AgYWNjZXB0aW5nIG5ldyBjb25uZWN0aW9uc1xuICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKTtcblxuICAgICAgLy8gQ2xvc2UgYWxsIGFjdGl2ZSBjb25uZWN0aW9uc1xuICAgICAgdGhpcy5pbmZvKFwiQ2xvc2luZyBhbGwgYWN0aXZlIFdlYlNvY2tldCBjb25uZWN0aW9ucy4uLlwiKTtcbiAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICBBcnJheS5mcm9tKHRoaXMuY29ubmVjdGlvbnMudmFsdWVzKCkpLm1hcCgoY29ubmVjdGlvbikgPT5cbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIilcbiAgICAgICAgKVxuICAgICAgKTtcblxuICAgICAgLy8gV2FpdCBmb3IgdGhlIFdTUyB0byBjbG9zZSBwcm9wZXJseVxuICAgICAgYXdhaXQgbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAvLyBTZXQgYSB0aW1lb3V0IHRvIHByZXZlbnQgaGFuZ2luZ1xuICAgICAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIldTUyBjbG9zZSB0aW1lb3V0XCIpKTtcbiAgICAgICAgfSwgNTAwMCk7XG5cbiAgICAgICAgdGhpcy53c3MuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoXCJFcnJvciBkdXJpbmcgc2h1dGRvd246XCIsIGVycm9yKTtcbiAgICAgIC8vIEZvcmNlIGNsb3NlIGV2ZXJ5dGhpbmdcbiAgICAgIHRoaXMud3NzLmNsaWVudHMuZm9yRWFjaCgoY2xpZW50KSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY2xpZW50LnRlcm1pbmF0ZSgpO1xuICAgICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgICAgLy8gSWdub3JlIGVycm9ycyBkdXJpbmcgZm9yY2UgdGVybWluYXRpb25cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICB0aHJvdyBlcnJvcjsgLy8gUmUtdGhyb3cgdG8gaW5kaWNhdGUgc2h1dGRvd24gZmFpbHVyZVxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb25uZWN0aW9ucygpOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnM7XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXI8c3RyaW5nPihcInJhd1wiKVxuICBwcm90ZWN0ZWQgYXN5bmMgcmF3TWVzc2FnZUhhbmRsZXIobWVzc2FnZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJhdyBtZXNzYWdlYCwgbWVzc2FnZSk7XG4gICAgcmV0dXJuIFwiRVJST1I6IFJhdyBtZXNzYWdlcyBub3Qgc3VwcG9ydGVkLiBQbGVhc2UgdXNlIENvbW11bmljYXRpb25zTWFuYWdlclwiO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPik6IHZvaWQge1xuICAgIGNvbnN0IG1lc3NhZ2VTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmZvckVhY2goKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlU3RyaW5nKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzZW5kVG9Db25uZWN0aW9uKFxuICAgIGNvbm5lY3Rpb25JZDogc3RyaW5nLFxuICAgIG1lc3NhZ2U6IElSZXNwb25zZTxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBDb25uZWN0aW9uIG5vdCBmb3VuZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0U2Vzc2lvbkJ5SWQoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPElTZXNzaW9uRGF0YSB8IG51bGw+IHtcbiAgICByZXR1cm4gdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZS5nZXQoc2Vzc2lvbklkKTtcbiAgfVxufVxuXG5mdW5jdGlvbiBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShtZXNzYWdlOiBzdHJpbmcpOiBEZXRlY3Rpb25SZXN1bHQ8dW5rbm93bj4ge1xuICAvLyBGaXJzdCwgY2hlY2sgaWYgdGhlIG1lc3NhZ2UgaXMgbGlrZWx5IEpTT04gb3IgYSBKYXZhU2NyaXB0LWxpa2Ugb2JqZWN0XG4gIGlmIChtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwie1wiKSB8fCBtZXNzYWdlLnRyaW0oKS5zdGFydHNXaXRoKFwiW1wiKSkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKG1lc3NhZ2UpO1xuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVxdWVzdFxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcImhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5oZWFkZXIgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJ0aW1lc3RhbXBcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdElkXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RlckFkZHJlc3NcIiBpbiBwYXJzZWQuaGVhZGVyXG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVxdWVzdFwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVxdWVzdDx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlc3BvbnNlXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwicmVxdWVzdEhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmJvZHkgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgXCJkYXRhXCIgaW4gcGFyc2VkLmJvZHkgJiZcbiAgICAgICAgXCJzdWNjZXNzXCIgaW4gcGFyc2VkLmJvZHkgJiZcbiAgICAgICAgXCJlcnJvclwiIGluIHBhcnNlZC5ib2R5XG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBwYXlsb2FkVHlwZTogXCJJUmVzcG9uc2VcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlc3BvbnNlPHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBJZiBpdCdzIGEgcGFyc2VkIG9iamVjdCBidXQgbm90IElSZXF1ZXN0IG9yIElSZXNwb25zZVxuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwib2JqZWN0XCIsIHBheWxvYWQ6IHBhcnNlZCB9O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBJZiBwYXJzaW5nIGZhaWxzLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgaXQgZG9lc24ndCBsb29rIGxpa2UgSlNPTiwgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICB9XG59XG4iXX0=