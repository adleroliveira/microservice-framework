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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTJFO0FBUTNFLG9FQUtrQztBQVFsQywrREFBNEQ7QUFDNUQsMkZBQXdGO0FBd0N4RixNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBVUMsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFSakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQVVoRSxJQUFJLENBQUMsNEJBQTRCLENBQUMsTUFBTSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1FBRXpELElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFDcEQsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsY0FBYyxDQUFDO1FBRXhDLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRTFDLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxRQUFRLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxjQUFjLEVBQUUsQ0FBQztZQUMvRCxJQUFJLENBQUMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxZQUFZLEVBQUUsQ0FBQztnQkFDbEMsTUFBTSxJQUFJLEtBQUssQ0FDYiw0RUFBNEUsQ0FDN0UsQ0FBQztZ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WUFDSixDQUFDO1lBRUQsb0NBQW9DO1lBQ3BDLElBQ0UsT0FBTyxNQUFNLEtBQUssUUFBUTtnQkFDMUIsTUFBTSxLQUFLLElBQUk7Z0JBQ2YsZUFBZSxJQUFJLE1BQU07Z0JBQ3pCLGdCQUFnQixJQUFJLE1BQU07Z0JBQzFCLE1BQU0sSUFBSSxNQUFNO2dCQUNoQixPQUFPLE1BQU0sQ0FBQyxJQUFJLEtBQUssUUFBUTtnQkFDL0IsTUFBTSxJQUFJLE1BQU0sQ0FBQyxJQUFJO2dCQUNyQixTQUFTLElBQUksTUFBTSxDQUFDLElBQUk7Z0JBQ3hCLE9BQU8sSUFBSSxNQUFNLENBQUMsSUFBSSxFQUN0QixDQUFDO2dCQUNELE9BQU87b0JBQ0wsV0FBVyxFQUFFLFdBQVc7b0JBQ3hCLE9BQU8sRUFBRSxNQUE0QjtpQkFDdEMsQ0FBQztZQUNKLENBQUM7WUFFRCx3REFBd0Q7WUFDeEQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxDQUFDO1FBQ3BELENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YseUNBQXlDO1lBQ3pDLE9BQU8sRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsQ0FBQztRQUNyRCxDQUFDO0lBQ0gsQ0FBQztTQUFNLENBQUM7UUFDTixxREFBcUQ7UUFDckQsT0FBTyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLE9BQU8sRUFBRSxDQUFDO0lBQ3JELENBQUM7QUFDSCxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmVyLCBEYXRhIH0gZnJvbSBcIndzXCI7XG5pbXBvcnQgeyBjcmVhdGVTZXJ2ZXIsIFNlcnZlciBhcyBIdHRwU2VydmVyLCBJbmNvbWluZ01lc3NhZ2UgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHsgRHVwbGV4IH0gZnJvbSBcInN0cmVhbVwiO1xuaW1wb3J0IHtcbiAgSUF1dGhlbnRpY2F0aW9uTWV0YWRhdGEsXG4gIElSZXF1ZXN0SGVhZGVyLFxuICBJU2Vzc2lvbkRhdGEsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cbmltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbiAgU3RhdHVzVXBkYXRlLFxuICBSZXF1ZXN0SGFuZGxlcixcbn0gZnJvbSBcIi4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHtcbiAgSUJhY2tFbmQsXG4gIElSZXF1ZXN0LFxuICBJUmVzcG9uc2UsXG4gIElTZXNzaW9uU3RvcmUsXG4gIElBdXRoZW50aWNhdGlvblByb3ZpZGVyLFxufSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgV2Vic29ja2V0Q29ubmVjdGlvbiB9IGZyb20gXCIuL1dlYnNvY2tldENvbm5lY3Rpb25cIjtcbmltcG9ydCB7IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB9IGZyb20gXCIuL1dlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVwiO1xuXG50eXBlIFBheWxvYWRUeXBlID0gXCJvYmplY3RcIiB8IFwic3RyaW5nXCIgfCBcIklSZXF1ZXN0XCIgfCBcIklSZXNwb25zZVwiO1xuXG5pbnRlcmZhY2UgRGV0ZWN0aW9uUmVzdWx0PFQ+IHtcbiAgcGF5bG9hZFR5cGU6IFBheWxvYWRUeXBlO1xuICBwYXlsb2FkOiBUO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEFub255bW91c1Nlc3Npb25Db25maWcge1xuICBlbmFibGVkOiBib29sZWFuO1xuICBzZXNzaW9uRHVyYXRpb24/OiBudW1iZXI7IC8vIER1cmF0aW9uIGluIG1pbGxpc2Vjb25kc1xuICBwZXJzaXN0ZW50SWRlbnRpdHlFbmFibGVkPzogYm9vbGVhbjtcbiAgbWV0YWRhdGE/OiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBdXRoZW50aWNhdGlvbkNvbmZpZyB7XG4gIHJlcXVpcmVkOiBib29sZWFuO1xuICBhbGxvd0Fub255bW91czogYm9vbGVhbjtcbiAgYW5vbnltb3VzQ29uZmlnPzogQW5vbnltb3VzU2Vzc2lvbkNvbmZpZztcbiAgYXV0aFByb3ZpZGVyPzogSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXI7XG4gIHNlc3Npb25TdG9yZTogSVNlc3Npb25TdG9yZTtcbiAgYXV0aGVudGljYXRpb25NaWRkbGV3YXJlPzogV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFNlcnZlckNvbmZpZyBleHRlbmRzIElTZXJ2ZXJDb25maWcge1xuICBwb3J0OiBudW1iZXI7XG4gIHBhdGg/OiBzdHJpbmc7XG4gIG1heENvbm5lY3Rpb25zPzogbnVtYmVyO1xuICBhdXRoZW50aWNhdGlvbjogQXV0aGVudGljYXRpb25Db25maWc7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldE1lc3NhZ2UgPSB7XG4gIHR5cGU6IHN0cmluZztcbiAgZGF0YTogYW55O1xuICBjb25uZWN0aW9uSWQ6IHN0cmluZztcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0UmVzcG9uc2Uge31cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgV2ViU29ja2V0TWVzc2FnZSxcbiAgV2ViU29ja2V0UmVzcG9uc2Vcbj4ge1xuICBwcml2YXRlIHNlcnZlcjogSHR0cFNlcnZlcjtcbiAgcHJpdmF0ZSB3c3M6IFNlcnZlcjtcbiAgcHJpdmF0ZSBjb25uZWN0aW9uczogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcG9ydDogbnVtYmVyO1xuICBwcml2YXRlIHBhdGg6IHN0cmluZztcbiAgcHJpdmF0ZSBtYXhDb25uZWN0aW9uczogbnVtYmVyO1xuICBwcml2YXRlIGF1dGhDb25maWc6IEF1dGhlbnRpY2F0aW9uQ29uZmlnO1xuICBwcml2YXRlIGF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZT86IFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZTtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTb2NrZXRTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuXG4gICAgdGhpcy52YWxpZGF0ZUF1dGhlbnRpY2F0aW9uQ29uZmlnKGNvbmZpZy5hdXRoZW50aWNhdGlvbik7XG5cbiAgICB0aGlzLnBvcnQgPSBjb25maWcucG9ydDtcbiAgICB0aGlzLnBhdGggPSBjb25maWcucGF0aCB8fCBcIi93c1wiO1xuICAgIHRoaXMubWF4Q29ubmVjdGlvbnMgPSBjb25maWcubWF4Q29ubmVjdGlvbnMgfHwgMTAwMDtcbiAgICB0aGlzLmF1dGhDb25maWcgPSBjb25maWcuYXV0aGVudGljYXRpb247XG5cbiAgICB0aGlzLnNlcnZlciA9IGNyZWF0ZVNlcnZlcigpO1xuICAgIHRoaXMud3NzID0gbmV3IFNlcnZlcih7IG5vU2VydmVyOiB0cnVlIH0pO1xuXG4gICAgaWYgKHRoaXMuYXV0aENvbmZpZy5yZXF1aXJlZCB8fCB0aGlzLmF1dGhDb25maWcuYWxsb3dBbm9ueW1vdXMpIHtcbiAgICAgIGlmICghdGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJTZXNzaW9uIHN0b3JlIGlzIHJlcXVpcmVkIGZvciBib3RoIGF1dGhlbnRpY2F0ZWQgYW5kIGFub255bW91cyBjb25uZWN0aW9uc1wiXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQgJiYgIXRoaXMuYXV0aENvbmZpZy5hdXRoUHJvdmlkZXIpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gcHJvdmlkZXIgaXMgcmVxdWlyZWQgd2hlbiBhdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZFwiXG4gICAgICAgICk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuYXV0aGVudGljYXRpb25NaWRkbGV3YXJlID1cbiAgICAgICAgY29uZmlnLmF1dGhlbnRpY2F0aW9uLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB8fFxuICAgICAgICBuZXcgV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlKFxuICAgICAgICAgIHRoaXMuYXV0aENvbmZpZy5hdXRoUHJvdmlkZXIhLFxuICAgICAgICAgIHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmVcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICB0aGlzLnNldHVwV2ViU29ja2V0U2VydmVyKCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwV2ViU29ja2V0U2VydmVyKCkge1xuICAgIHRoaXMuc2VydmVyLm9uKFxuICAgICAgXCJ1cGdyYWRlXCIsXG4gICAgICBhc3luYyAocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLCBzb2NrZXQ6IER1cGxleCwgaGVhZDogQnVmZmVyKSA9PiB7XG4gICAgICAgIC8vIFByZXZlbnQgbWVtb3J5IGxlYWtzIGJ5IGhhbmRsaW5nIHNvY2tldCBlcnJvcnNcbiAgICAgICAgc29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycikgPT4ge1xuICAgICAgICAgIHRoaXMuZXJyb3IoXCJTb2NrZXQgZXJyb3I6XCIsIGVycik7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUGFyc2UgdGhlIFVSTCB0byBnZXQganVzdCB0aGUgcGF0aG5hbWVcbiAgICAgICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCEsIGBodHRwOi8vJHtyZXF1ZXN0LmhlYWRlcnMuaG9zdH1gKTtcblxuICAgICAgICBpZiAodXJsLnBhdGhuYW1lICE9PSB0aGlzLnBhdGgpIHtcbiAgICAgICAgICBzb2NrZXQud3JpdGUoXCJIVFRQLzEuMSA0MDQgTm90IEZvdW5kXFxyXFxuXFxyXFxuXCIpO1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgICAgdGhpcy53YXJuKGBJbnZhbGlkIHBhdGg6ICR7cmVxdWVzdC51cmx9YCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IGF3YWl0IHRoaXMuaGFuZGxlQXV0aGVudGljYXRpb24ocmVxdWVzdCk7XG4gICAgICAgIGlmICghY29ubmVjdGlvbikge1xuICAgICAgICAgIHNvY2tldC53cml0ZShcbiAgICAgICAgICAgIFwiSFRUUC8xLjEgNDAxIFVuYXV0aG9yaXplZFxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJDb25uZWN0aW9uOiBjbG9zZVxcclxcblwiICtcbiAgICAgICAgICAgICAgXCJDb250ZW50LVR5cGU6IHRleHQvcGxhaW5cXHJcXG5cXHJcXG5cIiArXG4gICAgICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gZmFpbGVkXFxyXFxuXCJcbiAgICAgICAgICApO1xuICAgICAgICAgIHNvY2tldC5lbmQoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLnVwZ3JhZGVDb25uZWN0aW9uKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBncmFkZUNvbm5lY3Rpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLFxuICAgIHNvY2tldDogRHVwbGV4LFxuICAgIGhlYWQ6IEJ1ZmZlcixcbiAgICBhdXRoZW50aWNhdGVkQ29ubmVjdGlvbj86IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKSB7XG4gICAgdGhpcy53c3MuaGFuZGxlVXBncmFkZShyZXF1ZXN0LCBzb2NrZXQsIGhlYWQsICh3cykgPT4ge1xuICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbnMuc2l6ZSA+PSB0aGlzLm1heENvbm5lY3Rpb25zKSB7XG4gICAgICAgIHdzLmNsb3NlKDEwMTMsIFwiTWF4aW11bSBudW1iZXIgb2YgY29ubmVjdGlvbnMgcmVhY2hlZFwiKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoYXV0aGVudGljYXRlZENvbm5lY3Rpb24pIHtcbiAgICAgICAgLy8gU2V0IHRoZSBXZWJTb2NrZXQgaW5zdGFuY2Ugb24gdGhlIGV4aXN0aW5nIGNvbm5lY3Rpb25cbiAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uc2V0V2ViU29ja2V0KHdzKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksXG4gICAgICAgICAgYXV0aGVudGljYXRlZENvbm5lY3Rpb25cbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIENyZWF0ZSBuZXcgY29ubmVjdGlvbiB3aXRoIFdlYlNvY2tldCBpbnN0YW5jZVxuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcyksXG4gICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpLFxuICAgICAgICAgIHVuZGVmaW5lZCwgLy8gZGVmYXVsdCB0aW1lb3V0XG4gICAgICAgICAgdW5kZWZpbmVkLCAvLyBkZWZhdWx0IHJhdGUgbGltaXRcbiAgICAgICAgICB0aGlzLmhhbmRsZVdzRXZlbnRzKCksXG4gICAgICAgICAgd3NcbiAgICAgICAgKTtcbiAgICAgICAgdGhpcy5jb25uZWN0aW9ucy5zZXQoY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKSwgY29ubmVjdGlvbik7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlQXV0aGVudGljYXRpb25Db25maWcoY29uZmlnOiBBdXRoZW50aWNhdGlvbkNvbmZpZyk6IHZvaWQge1xuICAgIC8vIENoZWNrIGZvciBpbnZhbGlkIGNvbmZpZ3VyYXRpb24gd2hlcmUgbm8gY29ubmVjdGlvbnMgd291bGQgYmUgcG9zc2libGVcbiAgICBpZiAoIWNvbmZpZy5yZXF1aXJlZCAmJiAhY29uZmlnLmFsbG93QW5vbnltb3VzKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIFwiSW52YWxpZCBhdXRoZW50aWNhdGlvbiBjb25maWd1cmF0aW9uOiBcIiArXG4gICAgICAgICAgXCJXaGVuIGF1dGhlbnRpY2F0aW9uIGlzIG5vdCByZXF1aXJlZCwgeW91IG11c3QgZWl0aGVyIGVuYWJsZSBhbm9ueW1vdXMgY29ubmVjdGlvbnMgXCIgK1xuICAgICAgICAgIFwib3Igc2V0IHJlcXVpcmVkIHRvIHRydWUuIEN1cnJlbnQgY29uZmlndXJhdGlvbiB3b3VsZCBwcmV2ZW50IGFueSBjb25uZWN0aW9ucy5cIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBBZGRpdGlvbmFsIHZhbGlkYXRpb24gY2hlY2tzXG4gICAgaWYgKGNvbmZpZy5yZXF1aXJlZCAmJiAhY29uZmlnLmF1dGhQcm92aWRlcikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBcIkludmFsaWQgYXV0aGVudGljYXRpb24gY29uZmlndXJhdGlvbjogXCIgK1xuICAgICAgICAgIFwiQXV0aGVudGljYXRpb24gcHJvdmlkZXIgaXMgcmVxdWlyZWQgd2hlbiBhdXRoZW50aWNhdGlvbiBpcyByZXF1aXJlZFwiXG4gICAgICApO1xuICAgIH1cblxuICAgIGlmIChjb25maWcuYWxsb3dBbm9ueW1vdXMgJiYgIWNvbmZpZy5zZXNzaW9uU3RvcmUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgXCJJbnZhbGlkIGF1dGhlbnRpY2F0aW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICBcIlNlc3Npb24gc3RvcmUgaXMgcmVxdWlyZWQgd2hlbiBhbm9ueW1vdXMgY29ubmVjdGlvbnMgYXJlIGFsbG93ZWRcIlxuICAgICAgKTtcbiAgICB9XG5cbiAgICAvLyBWYWxpZGF0ZSBhbm9ueW1vdXMgY29uZmlnIGlmIGFub255bW91cyBjb25uZWN0aW9ucyBhcmUgYWxsb3dlZFxuICAgIGlmIChjb25maWcuYWxsb3dBbm9ueW1vdXMgJiYgY29uZmlnLmFub255bW91c0NvbmZpZykge1xuICAgICAgaWYgKFxuICAgICAgICBjb25maWcuYW5vbnltb3VzQ29uZmlnLnNlc3Npb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkICYmXG4gICAgICAgIGNvbmZpZy5hbm9ueW1vdXNDb25maWcuc2Vzc2lvbkR1cmF0aW9uIDw9IDBcbiAgICAgICkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgXCJJbnZhbGlkIGFub255bW91cyBzZXNzaW9uIGNvbmZpZ3VyYXRpb246IFwiICtcbiAgICAgICAgICAgIFwiU2Vzc2lvbiBkdXJhdGlvbiBtdXN0IGJlIHBvc2l0aXZlXCJcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUF1dGhlbnRpY2F0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZVxuICApOiBQcm9taXNlPFdlYnNvY2tldENvbm5lY3Rpb24gfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIEZpcnN0LCB0cnkgdG8gYXV0aGVudGljYXRlIGlmIGNyZWRlbnRpYWxzIGFyZSBwcm92aWRlZFxuICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpXG4gICAgICApO1xuXG4gICAgICAvLyBUcnkgdG9rZW4vY3JlZGVudGlhbHMgYXV0aGVudGljYXRpb24gZmlyc3QgaWYgbWlkZGxld2FyZSBleGlzdHNcbiAgICAgIGlmICh0aGlzLmF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGF1dGhSZXN1bHQgPVxuICAgICAgICAgICAgYXdhaXQgdGhpcy5hdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUuYXV0aGVudGljYXRlQ29ubmVjdGlvbihcbiAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgY29ubmVjdGlvblxuICAgICAgICAgICAgKTtcbiAgICAgICAgICBpZiAoYXV0aFJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdXRoUmVzdWx0KSkge1xuICAgICAgICAgICAgICBpZiAodmFsdWUpIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoa2V5LCB2YWx1ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdGlvbjtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgLy8gQXV0aGVudGljYXRpb24gZmFpbGVkLCBidXQgd2UgbWlnaHQgc3RpbGwgYWxsb3cgYW5vbnltb3VzIGFjY2Vzc1xuICAgICAgICAgIGlmICh0aGlzLmF1dGhDb25maWcucmVxdWlyZWQpIHtcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICAvLyBJZiB3ZSByZWFjaCBoZXJlIGFuZCBhbm9ueW1vdXMgYWNjZXNzIGlzIGFsbG93ZWQsIGNyZWF0ZSBhbm9ueW1vdXMgc2Vzc2lvblxuICAgICAgaWYgKHRoaXMuYXV0aENvbmZpZy5hbGxvd0Fub255bW91cykge1xuICAgICAgICBhd2FpdCB0aGlzLmNyZWF0ZUFub255bW91c1Nlc3Npb24oY29ubmVjdGlvbiwgcmVxdWVzdCk7XG4gICAgICAgIHJldHVybiBjb25uZWN0aW9uO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB3ZSByZWFjaCBoZXJlLCBuZWl0aGVyIGF1dGhlbnRpY2F0aW9uIHN1Y2NlZWRlZCBub3IgYW5vbnltb3VzIGFjY2VzcyBpcyBhbGxvd2VkXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKFwiQXV0aGVudGljYXRpb24gZXJyb3I6XCIsIGVycm9yKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY3JlYXRlQW5vbnltb3VzU2Vzc2lvbihcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uLFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBjb25maWcgPSB0aGlzLmF1dGhDb25maWcuYW5vbnltb3VzQ29uZmlnIHx8IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uRHVyYXRpb246IDI0ICogNjAgKiA2MCAqIDEwMDAsIC8vIDI0IGhvdXJzIGRlZmF1bHRcbiAgICB9O1xuXG4gICAgY29uc3QgZGV2aWNlSWQgPSB0aGlzLmV4dHJhY3REZXZpY2VJZChyZXF1ZXN0KTtcblxuICAgIGNvbnN0IHNlc3Npb25EYXRhOiBJU2Vzc2lvbkRhdGEgPSB7XG4gICAgICBzZXNzaW9uSWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXG4gICAgICB1c2VySWQ6IGRldmljZUlkIHx8IGNyeXB0by5yYW5kb21VVUlEKCksIC8vIFVzZSBkZXZpY2UgSUQgYXMgdXNlcklkIGlmIGF2YWlsYWJsZVxuICAgICAgY3JlYXRlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgZXhwaXJlc0F0OiBuZXcgRGF0ZShcbiAgICAgICAgRGF0ZS5ub3coKSArIChjb25maWcuc2Vzc2lvbkR1cmF0aW9uIHx8IDI0ICogNjAgKiA2MCAqIDEwMDApXG4gICAgICApLFxuICAgICAgbGFzdEFjY2Vzc2VkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBtZXRhZGF0YToge1xuICAgICAgICAuLi5jb25maWcubWV0YWRhdGEsXG4gICAgICAgIGlzQW5vbnltb3VzOiB0cnVlLFxuICAgICAgICBkZXZpY2VJZCxcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGF3YWl0IHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuY3JlYXRlKHNlc3Npb25EYXRhKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwic2Vzc2lvbklkXCIsIHNlc3Npb25EYXRhLnNlc3Npb25JZCk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInVzZXJJZFwiLCBzZXNzaW9uRGF0YS51c2VySWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJpc0Fub255bW91c1wiLCB0cnVlKTtcbiAgICBjb25uZWN0aW9uLnNldEF1dGhlbnRpY2F0ZWQoZmFsc2UpO1xuICB9XG5cbiAgcHJpdmF0ZSBleHRyYWN0RGV2aWNlSWQocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgLy8gVHJ5IHRvIGV4dHJhY3QgZGV2aWNlIElEIGZyb20gdmFyaW91cyBzb3VyY2VzXG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChyZXF1ZXN0LnVybCEsIGBodHRwOi8vJHtyZXF1ZXN0LmhlYWRlcnMuaG9zdH1gKTtcblxuICAgIC8vIENoZWNrIHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICBjb25zdCBkZXZpY2VJZCA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwiZGV2aWNlSWRcIik7XG4gICAgaWYgKGRldmljZUlkKSByZXR1cm4gZGV2aWNlSWQ7XG5cbiAgICAvLyBDaGVjayBoZWFkZXJzXG4gICAgY29uc3QgZGV2aWNlSWRIZWFkZXIgPSByZXF1ZXN0LmhlYWRlcnNbXCJ4LWRldmljZS1pZFwiXTtcbiAgICBpZiAoZGV2aWNlSWRIZWFkZXIpIHJldHVybiBkZXZpY2VJZEhlYWRlci50b1N0cmluZygpO1xuXG4gICAgLy8gQ2hlY2sgY29va2llc1xuICAgIGNvbnN0IGNvb2tpZXMgPSByZXF1ZXN0LmhlYWRlcnMuY29va2llXG4gICAgICA/LnNwbGl0KFwiO1wiKVxuICAgICAgLm1hcCgoY29va2llKSA9PiBjb29raWUudHJpbSgpLnNwbGl0KFwiPVwiKSlcbiAgICAgIC5maW5kKChba2V5XSkgPT4ga2V5ID09PSBcImRldmljZUlkXCIpO1xuXG4gICAgcmV0dXJuIGNvb2tpZXMgPyBjb29raWVzWzFdIDogbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlV3NFdmVudHMoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9uUmF0ZUxpbWl0OiAoY29ubmVjdGlvbklkOiBzdHJpbmcpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBSYXRlIGxpbWl0IGV4Y2VlZGVkIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfWApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiUmF0ZSBsaW1pdCBleGNlZWRlZFwiKTtcbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLmRlbGV0ZShjb25uZWN0aW9uSWQpO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgb25FcnJvcjogKGNvbm5lY3Rpb25JZDogc3RyaW5nLCBlcnJvcjogRXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy53YXJuKGBFcnJvciBmb3IgY29ubmVjdGlvbiAke2Nvbm5lY3Rpb25JZH06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGNvbm5lY3Rpb24gZXJyb3NcbiAgICAgIH0sXG4gICAgICBvblNlY3VyaXR5VmlvbGF0aW9uOiAoY29ubmVjdGlvbklkOiBzdHJpbmcsIHZpb2xhdGlvbjogc3RyaW5nKSA9PiB7XG4gICAgICAgIHRoaXMud2FybihcbiAgICAgICAgICBgU2VjdXJpdHkgdmlvbGF0aW9uIGZvciBjb25uZWN0aW9uICR7Y29ubmVjdGlvbklkfTogJHt2aW9sYXRpb259YFxuICAgICAgICApO1xuICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDgsIFwiU2VjdXJpdHkgdmlvbGF0aW9uXCIpO1xuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaFNlc3Npb24oY29ubmVjdGlvbjogV2Vic29ja2V0Q29ubmVjdGlvbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IGNvbm5lY3Rpb24ucmVmcmVzaFNlc3Npb24odGhpcy5hdXRoQ29uZmlnLnNlc3Npb25TdG9yZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZU1lc3NhZ2UoXG4gICAgZGF0YTogRGF0YSxcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlZnJlc2hTZXNzaW9uKGNvbm5lY3Rpb24pO1xuICAgICAgLy8gVE9ETzogaGFuZGxlIGV4cGlyZWQgc2Vzc2lvbnNcbiAgICAgIGNvbnN0IHN0ckRhdGEgPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBkZXRlY3Rpb25SZXN1bHQgPSBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShzdHJEYXRhKTtcbiAgICAgIGxldCByZXF1ZXN0VHlwZTogc3RyaW5nID0gXCJcIjtcblxuICAgICAgaWYgKFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJvYmplY3RcIlxuICAgICAgKSB7XG4gICAgICAgIHJlcXVlc3RUeXBlID0gXCJyYXdcIjtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PGFueT4oe1xuICAgICAgICAgIHRvOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogXCJyYXdcIixcbiAgICAgICAgICBib2R5OiBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVzcG9uc2VcIikge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXNwb25zZTxhbnk+O1xuICAgICAgICBhd2FpdCB0aGlzLnNlbmRPbmVXYXlNZXNzYWdlKFxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgICAgcmVzcG9uc2UuYm9keVxuICAgICAgICApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVxdWVzdFwiKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVxdWVzdDxhbnk+O1xuICAgICAgICAvLyBUT0RPOiBoYW5kbGUgbm9uLWF1dGhlbnRpY2F0ZWQgUmVxdWVzdHNcbiAgICAgICAgLy8gVE9ETzogaGFuZGxlIGF1dGhvcml6YXRpb25cblxuICAgICAgICBsZXQgYXV0aE1ldGFkYXRhOiBJQXV0aGVudGljYXRpb25NZXRhZGF0YSA9IHt9O1xuICAgICAgICBhdXRoTWV0YWRhdGEuaXNBdXRoZW50aWNhdGVkID0gY29ubmVjdGlvbi5pc0F1dGhlbnRpY2F0ZWQoKTtcbiAgICAgICAgaWYgKGNvbm5lY3Rpb24uaXNBdXRoZW50aWNhdGVkKCkpIHtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuc2Vzc2lvbklkID0gY29ubmVjdGlvbi5nZXRTZXNzaW9uSWQoKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEudXNlcklkID0gY29ubmVjdGlvbi5nZXRNZXRhZGF0YShcInVzZXJJZFwiKTtcbiAgICAgICAgICBhdXRoTWV0YWRhdGEuY29ubmVjdGlvbklkID0gY29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keTogcmVxdWVzdC5ib2R5LFxuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgIC4uLnJlcXVlc3QuaGVhZGVyLFxuICAgICAgICAgICAgcmVxdWVzdElkOiByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQsXG4gICAgICAgICAgICBzZXNzaW9uSWQ6IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCksXG4gICAgICAgICAgICBhdXRoTWV0YWRhdGEsXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGU6IGFzeW5jIChcbiAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgICAgICAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICAgICAgICAgICkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgc3RhdHVzVXBkYXRlID0gTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlc3BvbnNlKFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LFxuICAgICAgICAgICAgICB1cGRhdGVSZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICAgICAgICBzdGF0dXNcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoc3RhdHVzVXBkYXRlKSk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgV2ViU29ja2V0IG1lc3NhZ2VgLCBlcnJvcik7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnZhbGlkIG1lc3NhZ2UgZm9ybWF0XCIgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ2xvc2UoY29ubmVjdGlvbklkOiBzdHJpbmcpIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgYXdhaXQgY29ubmVjdGlvbi5jbG9zZSgxMDAwLCBcIkNvbm5lY3Rpb24gY2xvc2VkXCIpO1xuICAgICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICAgIGNvbnN0IHNlc3Npb25JZCA9IGNvbm5lY3Rpb24uZ2V0U2Vzc2lvbklkKCk7XG4gICAgICBpZiAoc2Vzc2lvbklkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuZGVsZXRlKHNlc3Npb25JZCk7XG4gICAgICB9XG4gICAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBzZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgJHt0aGlzLnBvcnR9YCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBDbG9zZSBhbGwgYWN0aXZlIGNvbm5lY3Rpb25zIGFuZCB3YWl0IGZvciB0aGVtIHRvIGNvbXBsZXRlXG4gICAgICAgIHRoaXMuaW5mbyhcIkNsb3NpbmcgYWxsIGFjdGl2ZSBXZWJTb2NrZXQgY29ubmVjdGlvbnMuLi5cIik7XG4gICAgICAgIGF3YWl0IFByb21pc2UuYWxsKFxuICAgICAgICAgIEFycmF5LmZyb20odGhpcy5jb25uZWN0aW9ucy52YWx1ZXMoKSkubWFwKChjb25uZWN0aW9uKSA9PlxuICAgICAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDAwLCBcIlNlcnZlciBzaHV0dGluZyBkb3duXCIpXG4gICAgICAgICAgKVxuICAgICAgICApO1xuXG4gICAgICAgIC8vIENsb3NlIHRoZSBXZWJTb2NrZXQgc2VydmVyIGFuZCBIVFRQIHNlcnZlclxuICAgICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZVdzcykgPT4ge1xuICAgICAgICAgIHRoaXMud3NzLmNsb3NlKCgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc2VydmVyLmNsb3NlKCgpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5pbmZvKFwiV2ViU29ja2V0IHNlcnZlciBzdG9wcGVkXCIpO1xuICAgICAgICAgICAgICByZXNvbHZlV3NzKCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICB0aGlzLmVycm9yKFwiRXJyb3IgZHVyaW5nIHNodXRkb3duOlwiLCBlcnJvcik7XG4gICAgICAgIHJlc29sdmUoKTsgLy8gU3RpbGwgcmVzb2x2ZSB0byBlbnN1cmUgc2h1dGRvd24gY29tcGxldGVzXG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFdlYlNvY2tldE1lc3NhZ2U+XG4gICk6IFByb21pc2U8V2ViU29ja2V0UmVzcG9uc2U+IHtcbiAgICB0aGlzLndhcm4oXG4gICAgICBgVW5oYW5kbGVkIFdlYlNvY2tldCBtZXNzYWdlIHR5cGU6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCxcbiAgICAgIHJlcXVlc3RcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGVycm9yOiBgXCJVbmhhbmRsZWQgbWVzc2FnZSB0eXBlXCIgJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0Q29ubmVjdGlvbnMoKTogTWFwPHN0cmluZywgV2Vic29ja2V0Q29ubmVjdGlvbj4ge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25zO1xuICB9XG5cbiAgQFJlcXVlc3RIYW5kbGVyPHN0cmluZz4oXCJyYXdcIilcbiAgcHJvdGVjdGVkIGFzeW5jIHJhd01lc3NhZ2VIYW5kbGVyKG1lc3NhZ2U6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgdGhpcy53YXJuKGBSZWNlaXZlZCByYXcgbWVzc2FnZWAsIG1lc3NhZ2UpO1xuICAgIHJldHVybiBcIkVSUk9SOiBSYXcgbWVzc2FnZXMgbm90IHN1cHBvcnRlZC4gUGxlYXNlIHVzZSBDb21tdW5pY2F0aW9uc01hbmFnZXJcIjtcbiAgfVxuXG4gIHB1YmxpYyBicm9hZGNhc3QobWVzc2FnZTogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT4pOiB2b2lkIHtcbiAgICBjb25zdCBtZXNzYWdlU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkobWVzc2FnZSk7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5mb3JFYWNoKChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25uZWN0aW9uLnNlbmQobWVzc2FnZVN0cmluZyk7XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgc2VuZFRvQ29ubmVjdGlvbihcbiAgICBjb25uZWN0aW9uSWQ6IHN0cmluZyxcbiAgICBtZXNzYWdlOiBJUmVzcG9uc2U8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogdm9pZCB7XG4gICAgY29uc3QgY29ubmVjdGlvbiA9IHRoaXMuY29ubmVjdGlvbnMuZ2V0KGNvbm5lY3Rpb25JZCk7XG4gICAgaWYgKGNvbm5lY3Rpb24pIHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShtZXNzYWdlKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMud2FybihgQ29ubmVjdGlvbiBub3QgZm91bmQ6ICR7Y29ubmVjdGlvbklkfWApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldFNlc3Npb25CeUlkKHNlc3Npb25JZDogc3RyaW5nKTogUHJvbWlzZTxJU2Vzc2lvbkRhdGEgfCBudWxsPiB7XG4gICAgcmV0dXJuIHRoaXMuYXV0aENvbmZpZy5zZXNzaW9uU3RvcmUuZ2V0KHNlc3Npb25JZCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2UobWVzc2FnZTogc3RyaW5nKTogRGV0ZWN0aW9uUmVzdWx0PHVua25vd24+IHtcbiAgLy8gRmlyc3QsIGNoZWNrIGlmIHRoZSBtZXNzYWdlIGlzIGxpa2VseSBKU09OIG9yIGEgSmF2YVNjcmlwdC1saWtlIG9iamVjdFxuICBpZiAobWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIntcIikgfHwgbWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIltcIikpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShtZXNzYWdlKTtcblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlcXVlc3RcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJoZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuaGVhZGVyID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwidGltZXN0YW1wXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RJZFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0ZXJBZGRyZXNzXCIgaW4gcGFyc2VkLmhlYWRlclxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlcXVlc3RcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlcXVlc3Q8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXNwb25zZVxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcInJlcXVlc3RIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJyZXNwb25zZUhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5ib2R5ID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwiZGF0YVwiIGluIHBhcnNlZC5ib2R5ICYmXG4gICAgICAgIFwic3VjY2Vzc1wiIGluIHBhcnNlZC5ib2R5ICYmXG4gICAgICAgIFwiZXJyb3JcIiBpbiBwYXJzZWQuYm9keVxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlc3BvbnNlXCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXNwb25zZTx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgaXQncyBhIHBhcnNlZCBvYmplY3QgYnV0IG5vdCBJUmVxdWVzdCBvciBJUmVzcG9uc2VcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcIm9iamVjdFwiLCBwYXlsb2FkOiBwYXJzZWQgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gSWYgcGFyc2luZyBmYWlscywgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIElmIGl0IGRvZXNuJ3QgbG9vayBsaWtlIEpTT04sIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgfVxufVxuIl19