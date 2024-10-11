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
class WebSocketServer extends MicroserviceFramework_1.MicroserviceFramework {
    constructor(backend, config) {
        super(backend, config);
        this.connections = new Map();
        this.port = config.port;
        this.path = config.path || "/ws";
        this.maxConnections = config.maxConnections || 1000;
        this.server = (0, http_1.createServer)();
        this.wss = new ws_1.Server({ noServer: true });
        this.setupWebSocketServer();
    }
    setupWebSocketServer() {
        this.server.on("upgrade", (request, socket, head) => {
            if (request.url === this.path) {
                this.wss.handleUpgrade(request, socket, head, (ws) => {
                    if (this.connections.size >= this.maxConnections) {
                        ws.close(1013, "Maximum number of connections reached");
                        return;
                    }
                    const connection = new WebsocketConnection_1.WebsocketConnection(ws, this.handleMessage.bind(this), this.handleClose.bind(this));
                    this.connections.set(connection.getConnectionId(), connection);
                    this.info(`New WebSocket connection: ${connection.getConnectionId()}`);
                });
            }
            else {
                socket.destroy();
            }
        });
    }
    async handleMessage(data, connection) {
        try {
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
                const response = await this.makeRequest({
                    to: request.header.recipientAddress || this.serviceId,
                    requestType: request.header.requestType || "unknown",
                    body: request.body,
                    headers: { ...request.header, requestId: request.header.requestId },
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
        return new Promise((resolve) => {
            // Close all active connections
            this.info("Closing all active WebSocket connections...");
            for (const connection of this.connections.values()) {
                connection.close(1000, "Server shutting down");
            }
            // Wait for a short time to allow connections to close
            setTimeout(() => {
                // Close the WebSocket server
                this.wss.close(() => {
                    // Close the HTTP server
                    this.server.close(() => {
                        this.info("WebSocket server stopped");
                        resolve();
                    });
                });
            }, 1000); // Wait for 1 second before closing servers
        });
    }
    async defaultMessageHandler(request) {
        this.warn(`Unhandled WebSocket message type: ${request.header.requestType}`, request);
        return {
            success: false,
            error: `"Unhandled message type" ${request.header.requestType}`,
        };
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTBEO0FBQzFELG9FQUtrQztBQUVsQywrREFBNEQ7QUFzQjVELE1BQWEsZUFBZ0IsU0FBUSw2Q0FHcEM7SUFRQyxZQUFZLE9BQWlCLEVBQUUsTUFBNkI7UUFDMUQsS0FBSyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztRQU5qQixnQkFBVyxHQUFxQyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBT2hFLElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFFcEQsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLG1CQUFZLEdBQUUsQ0FBQztRQUM3QixJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksV0FBTSxDQUFDLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFFMUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7SUFDOUIsQ0FBQztJQUVPLG9CQUFvQjtRQUMxQixJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxFQUFFO1lBQ2xELElBQUksT0FBTyxDQUFDLEdBQUcsS0FBSyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQzlCLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUU7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eyBjcmVhdGVTZXJ2ZXIsIFNlcnZlciBhcyBIdHRwU2VydmVyIH0gZnJvbSBcImh0dHBcIjtcbmltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbiAgU3RhdHVzVXBkYXRlLFxuICBSZXF1ZXN0SGFuZGxlcixcbn0gZnJvbSBcIi4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHsgSUJhY2tFbmQsIElSZXF1ZXN0LCBJUmVzcG9uc2UgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgV2Vic29ja2V0Q29ubmVjdGlvbiB9IGZyb20gXCIuL1dlYnNvY2tldENvbm5lY3Rpb25cIjtcblxudHlwZSBQYXlsb2FkVHlwZSA9IFwib2JqZWN0XCIgfCBcInN0cmluZ1wiIHwgXCJJUmVxdWVzdFwiIHwgXCJJUmVzcG9uc2VcIjtcblxuaW50ZXJmYWNlIERldGVjdGlvblJlc3VsdDxUPiB7XG4gIHBheWxvYWRUeXBlOiBQYXlsb2FkVHlwZTtcbiAgcGF5bG9hZDogVDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBwYXRoPzogc3RyaW5nO1xuICBtYXhDb25uZWN0aW9ucz86IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0TWVzc2FnZSA9IHtcbiAgdHlwZTogc3RyaW5nO1xuICBkYXRhOiBhbnk7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFJlc3BvbnNlIHt9XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRTZXJ2ZXIgZXh0ZW5kcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFdlYlNvY2tldE1lc3NhZ2UsXG4gIFdlYlNvY2tldFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IEh0dHBTZXJ2ZXI7XG4gIHByaXZhdGUgd3NzOiBTZXJ2ZXI7XG4gIHByaXZhdGUgY29ubmVjdGlvbnM6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBwYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgbWF4Q29ubmVjdGlvbnM6IG51bWJlcjtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTb2NrZXRTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0O1xuICAgIHRoaXMucGF0aCA9IGNvbmZpZy5wYXRoIHx8IFwiL3dzXCI7XG4gICAgdGhpcy5tYXhDb25uZWN0aW9ucyA9IGNvbmZpZy5tYXhDb25uZWN0aW9ucyB8fCAxMDAwO1xuXG4gICAgdGhpcy5zZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoKTtcbiAgICB0aGlzLndzcyA9IG5ldyBTZXJ2ZXIoeyBub1NlcnZlcjogdHJ1ZSB9KTtcblxuICAgIHRoaXMuc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKSB7XG4gICAgdGhpcy5zZXJ2ZXIub24oXCJ1cGdyYWRlXCIsIChyZXF1ZXN0LCBzb2NrZXQsIGhlYWQpID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0LnVybCA9PT0gdGhpcy5wYXRoKSB7XG4gICAgICAgIHRoaXMud3NzLmhhbmRsZVVwZ3JhZGUocmVxdWVzdCwgc29ja2V0LCBoZWFkLCAod3MpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5zaXplID49IHRoaXMubWF4Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgIHdzLmNsb3NlKDEwMTMsIFwiTWF4aW11bSBudW1iZXIgb2YgY29ubmVjdGlvbnMgcmVhY2hlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgICAgICB3cyxcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpXG4gICAgICAgICAgKTtcblxuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksIGNvbm5lY3Rpb24pO1xuICAgICAgICAgIHRoaXMuaW5mbyhcbiAgICAgICAgICAgIGBOZXcgV2ViU29ja2V0IGNvbm5lY3Rpb246ICR7Y29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKX1gXG4gICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKGRhdGE6IERhdGEsIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RyRGF0YSA9IGRhdGEudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKHN0ckRhdGEpO1xuICAgICAgbGV0IHJlcXVlc3RUeXBlOiBzdHJpbmcgPSBcIlwiO1xuXG4gICAgICBpZiAoXG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIm9iamVjdFwiXG4gICAgICApIHtcbiAgICAgICAgcmVxdWVzdFR5cGUgPSBcInJhd1wiO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiBcInJhd1wiLFxuICAgICAgICAgIGJvZHk6IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkLFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXNwb25zZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlc3BvbnNlPGFueT47XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICByZXNwb25zZS5ib2R5XG4gICAgICAgICk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXF1ZXN0XCIpIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXF1ZXN0PGFueT47XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keTogcmVxdWVzdC5ib2R5LFxuICAgICAgICAgIGhlYWRlcnM6IHsgLi4ucmVxdWVzdC5oZWFkZXIsIHJlcXVlc3RJZDogcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkIH0sXG4gICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOiBhc3luYyAoXG4gICAgICAgICAgICB1cGRhdGVSZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgICAgICAgICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgICAgICAgICApID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c1VwZGF0ZSA9IE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXNwb25zZShcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdCxcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICAgICAgc3RhdHVzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHN0YXR1c1VwZGF0ZSkpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFdlYlNvY2tldCBtZXNzYWdlYCwgZXJyb3IpO1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiSW52YWxpZCBtZXNzYWdlIGZvcm1hdFwiIH0pKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUNsb3NlKGNvbm5lY3Rpb25JZDogc3RyaW5nKSB7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8vIENsb3NlIGFsbCBhY3RpdmUgY29ubmVjdGlvbnNcbiAgICAgIHRoaXMuaW5mbyhcIkNsb3NpbmcgYWxsIGFjdGl2ZSBXZWJTb2NrZXQgY29ubmVjdGlvbnMuLi5cIik7XG4gICAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgdGhpcy5jb25uZWN0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIik7XG4gICAgICB9XG5cbiAgICAgIC8vIFdhaXQgZm9yIGEgc2hvcnQgdGltZSB0byBhbGxvdyBjb25uZWN0aW9ucyB0byBjbG9zZVxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIC8vIENsb3NlIHRoZSBXZWJTb2NrZXQgc2VydmVyXG4gICAgICAgIHRoaXMud3NzLmNsb3NlKCgpID0+IHtcbiAgICAgICAgICAvLyBDbG9zZSB0aGUgSFRUUCBzZXJ2ZXJcbiAgICAgICAgICB0aGlzLnNlcnZlci5jbG9zZSgoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSwgMTAwMCk7IC8vIFdhaXQgZm9yIDEgc2Vjb25kIGJlZm9yZSBjbG9zaW5nIHNlcnZlcnNcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxzdHJpbmc+KFwicmF3XCIpXG4gIHByb3RlY3RlZCBhc3luYyByYXdNZXNzYWdlSGFuZGxlcihtZXNzYWdlOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRoaXMud2FybihgUmVjZWl2ZWQgcmF3IG1lc3NhZ2VgLCBtZXNzYWdlKTtcbiAgICByZXR1cm4gXCJFUlJPUjogUmF3IG1lc3NhZ2VzIG5vdCBzdXBwb3J0ZWQuIFBsZWFzZSB1c2UgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCI7XG4gIH1cblxuICBwdWJsaWMgYnJvYWRjYXN0KG1lc3NhZ2U6IFdlYlNvY2tldE1lc3NhZ2UpOiB2b2lkIHtcbiAgICBjb25zdCBtZXNzYWdlU3RyaW5nID0gSlNPTi5zdHJpbmdpZnkobWVzc2FnZSk7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5mb3JFYWNoKChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBjb25uZWN0aW9uLnNlbmQobWVzc2FnZVN0cmluZyk7XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgc2VuZFRvQ29ubmVjdGlvbihcbiAgICBjb25uZWN0aW9uSWQ6IHN0cmluZyxcbiAgICBtZXNzYWdlOiBXZWJTb2NrZXRNZXNzYWdlXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGNvbm5lY3Rpb24gPSB0aGlzLmNvbm5lY3Rpb25zLmdldChjb25uZWN0aW9uSWQpO1xuICAgIGlmIChjb25uZWN0aW9uKSB7XG4gICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkobWVzc2FnZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYENvbm5lY3Rpb24gbm90IGZvdW5kOiAke2Nvbm5lY3Rpb25JZH1gKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZGV0ZWN0QW5kQ2F0ZWdvcml6ZU1lc3NhZ2UobWVzc2FnZTogc3RyaW5nKTogRGV0ZWN0aW9uUmVzdWx0PHVua25vd24+IHtcbiAgLy8gRmlyc3QsIGNoZWNrIGlmIHRoZSBtZXNzYWdlIGlzIGxpa2VseSBKU09OIG9yIGEgSmF2YVNjcmlwdC1saWtlIG9iamVjdFxuICBpZiAobWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIntcIikgfHwgbWVzc2FnZS50cmltKCkuc3RhcnRzV2l0aChcIltcIikpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShtZXNzYWdlKTtcblxuICAgICAgLy8gQ2hlY2sgaWYgaXQncyBsaWtlbHkgYW4gSVJlcXVlc3RcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJoZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuaGVhZGVyID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwidGltZXN0YW1wXCIgaW4gcGFyc2VkLmhlYWRlciAmJlxuICAgICAgICBcInJlcXVlc3RJZFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0ZXJBZGRyZXNzXCIgaW4gcGFyc2VkLmhlYWRlclxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlcXVlc3RcIixcbiAgICAgICAgICBwYXlsb2FkOiBwYXJzZWQgYXMgSVJlcXVlc3Q8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXNwb25zZVxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgcGFyc2VkID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIHBhcnNlZCAhPT0gbnVsbCAmJlxuICAgICAgICBcInJlcXVlc3RIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJyZXNwb25zZUhlYWRlclwiIGluIHBhcnNlZCAmJlxuICAgICAgICBcImJvZHlcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgdHlwZW9mIHBhcnNlZC5ib2R5ID09PSBcIm9iamVjdFwiICYmXG4gICAgICAgIFwiZGF0YVwiIGluIHBhcnNlZC5ib2R5ICYmXG4gICAgICAgIFwic3VjY2Vzc1wiIGluIHBhcnNlZC5ib2R5ICYmXG4gICAgICAgIFwiZXJyb3JcIiBpbiBwYXJzZWQuYm9keVxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgcGF5bG9hZFR5cGU6IFwiSVJlc3BvbnNlXCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXNwb25zZTx1bmtub3duPixcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgaXQncyBhIHBhcnNlZCBvYmplY3QgYnV0IG5vdCBJUmVxdWVzdCBvciBJUmVzcG9uc2VcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcIm9iamVjdFwiLCBwYXlsb2FkOiBwYXJzZWQgfTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gSWYgcGFyc2luZyBmYWlscywgdHJlYXQgaXQgYXMgYSBzdHJpbmdcbiAgICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIElmIGl0IGRvZXNuJ3QgbG9vayBsaWtlIEpTT04sIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgcmV0dXJuIHsgcGF5bG9hZFR5cGU6IFwic3RyaW5nXCIsIHBheWxvYWQ6IG1lc3NhZ2UgfTtcbiAgfVxufVxuIl19