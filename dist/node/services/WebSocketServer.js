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
                    body: {
                        connectionId: connection.getConnectionId(),
                        type: request.header.requestType || "unknown",
                        body: request.body,
                    },
                    headers: {
                        ...request.header,
                        requestId: request.header.requestId,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldFNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSwyQkFBa0M7QUFDbEMsK0JBQTBEO0FBQzFELG9FQUtrQztBQUVsQywrREFBNEQ7QUF1QjVELE1BQWEsZUFBZ0IsU0FBUSw2Q0FHcEM7SUFRQyxZQUFZLE9BQWlCLEVBQUUsTUFBNkI7UUFDMUQsS0FBSyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztRQU5qQixnQkFBVyxHQUFxQyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBT2hFLElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksQ0FBQztRQUN4QixJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLElBQUksS0FBSyxDQUFDO1FBQ2pDLElBQUksQ0FBQyxjQUFjLEdBQUcsTUFBTSxDQUFDLGNBQWMsSUFBSSxJQUFJLENBQUM7UUFFcEQsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFBLG1CQUFZLEdBQUUsQ0FBQztRQUM3QixJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksV0FBTSxDQUFDLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFFMUMsSUFBSSxDQUFDLG9CQUFvQixFQUFFLENBQUM7SUFDOUIsQ0FBQztJQUVPLG9CQUFvQjtRQUMxQixJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxFQUFFO1lBQ2xELElBQUksT0FBTyxDQUFDLEdBQUcsS0FBSyxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQzlCLElBQUksQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsRUFBRSxFQUFFLEVBQUU7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QU0sQ0FBQztRQUNOLHFEQUFxRDtRQUNyRCxPQUFPLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLENBQUM7SUFDckQsQ0FBQztBQUNILENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBTZXJ2ZXIsIERhdGEgfSBmcm9tIFwid3NcIjtcbmltcG9ydCB7IGNyZWF0ZVNlcnZlciwgU2VydmVyIGFzIEh0dHBTZXJ2ZXIgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHtcbiAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLFxuICBJU2VydmVyQ29uZmlnLFxuICBTdGF0dXNVcGRhdGUsXG4gIFJlcXVlc3RIYW5kbGVyLFxufSBmcm9tIFwiLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5pbXBvcnQgeyBJQmFja0VuZCwgSVJlcXVlc3QsIElSZXNwb25zZSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBXZWJzb2NrZXRDb25uZWN0aW9uIH0gZnJvbSBcIi4vV2Vic29ja2V0Q29ubmVjdGlvblwiO1xuXG50eXBlIFBheWxvYWRUeXBlID0gXCJvYmplY3RcIiB8IFwic3RyaW5nXCIgfCBcIklSZXF1ZXN0XCIgfCBcIklSZXNwb25zZVwiO1xuXG5pbnRlcmZhY2UgRGV0ZWN0aW9uUmVzdWx0PFQ+IHtcbiAgcGF5bG9hZFR5cGU6IFBheWxvYWRUeXBlO1xuICBwYXlsb2FkOiBUO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFNlcnZlckNvbmZpZyBleHRlbmRzIElTZXJ2ZXJDb25maWcge1xuICBwb3J0OiBudW1iZXI7XG4gIHBhdGg/OiBzdHJpbmc7XG4gIG1heENvbm5lY3Rpb25zPzogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRNZXNzYWdlID0ge1xuICB0eXBlOiBzdHJpbmc7XG4gIGRhdGE6IGFueTtcbiAgY29ubmVjdGlvbklkOiBzdHJpbmc7XG59O1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFJlc3BvbnNlIHt9XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRTZXJ2ZXIgZXh0ZW5kcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFdlYlNvY2tldE1lc3NhZ2UsXG4gIFdlYlNvY2tldFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IEh0dHBTZXJ2ZXI7XG4gIHByaXZhdGUgd3NzOiBTZXJ2ZXI7XG4gIHByaXZhdGUgY29ubmVjdGlvbnM6IE1hcDxzdHJpbmcsIFdlYnNvY2tldENvbm5lY3Rpb24+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBwYXRoOiBzdHJpbmc7XG4gIHByaXZhdGUgbWF4Q29ubmVjdGlvbnM6IG51bWJlcjtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTb2NrZXRTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0O1xuICAgIHRoaXMucGF0aCA9IGNvbmZpZy5wYXRoIHx8IFwiL3dzXCI7XG4gICAgdGhpcy5tYXhDb25uZWN0aW9ucyA9IGNvbmZpZy5tYXhDb25uZWN0aW9ucyB8fCAxMDAwO1xuXG4gICAgdGhpcy5zZXJ2ZXIgPSBjcmVhdGVTZXJ2ZXIoKTtcbiAgICB0aGlzLndzcyA9IG5ldyBTZXJ2ZXIoeyBub1NlcnZlcjogdHJ1ZSB9KTtcblxuICAgIHRoaXMuc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRTZXJ2ZXIoKSB7XG4gICAgdGhpcy5zZXJ2ZXIub24oXCJ1cGdyYWRlXCIsIChyZXF1ZXN0LCBzb2NrZXQsIGhlYWQpID0+IHtcbiAgICAgIGlmIChyZXF1ZXN0LnVybCA9PT0gdGhpcy5wYXRoKSB7XG4gICAgICAgIHRoaXMud3NzLmhhbmRsZVVwZ3JhZGUocmVxdWVzdCwgc29ja2V0LCBoZWFkLCAod3MpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5jb25uZWN0aW9ucy5zaXplID49IHRoaXMubWF4Q29ubmVjdGlvbnMpIHtcbiAgICAgICAgICAgIHdzLmNsb3NlKDEwMTMsIFwiTWF4aW11bSBudW1iZXIgb2YgY29ubmVjdGlvbnMgcmVhY2hlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBjb25zdCBjb25uZWN0aW9uID0gbmV3IFdlYnNvY2tldENvbm5lY3Rpb24oXG4gICAgICAgICAgICB3cyxcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpLFxuICAgICAgICAgICAgdGhpcy5oYW5kbGVDbG9zZS5iaW5kKHRoaXMpXG4gICAgICAgICAgKTtcblxuICAgICAgICAgIHRoaXMuY29ubmVjdGlvbnMuc2V0KGNvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCksIGNvbm5lY3Rpb24pO1xuICAgICAgICAgIHRoaXMuaW5mbyhcbiAgICAgICAgICAgIGBOZXcgV2ViU29ja2V0IGNvbm5lY3Rpb246ICR7Y29ubmVjdGlvbi5nZXRDb25uZWN0aW9uSWQoKX1gXG4gICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVNZXNzYWdlKGRhdGE6IERhdGEsIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24pIHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RyRGF0YSA9IGRhdGEudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IGRldGVjdGlvblJlc3VsdCA9IGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKHN0ckRhdGEpO1xuICAgICAgbGV0IHJlcXVlc3RUeXBlOiBzdHJpbmcgPSBcIlwiO1xuXG4gICAgICBpZiAoXG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcInN0cmluZ1wiIHx8XG4gICAgICAgIGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIm9iamVjdFwiXG4gICAgICApIHtcbiAgICAgICAgcmVxdWVzdFR5cGUgPSBcInJhd1wiO1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgICAgIHJlcXVlc3RUeXBlOiBcInJhd1wiLFxuICAgICAgICAgIGJvZHk6IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkLFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXNwb25zZVwiKSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gZGV0ZWN0aW9uUmVzdWx0LnBheWxvYWQgYXMgSVJlc3BvbnNlPGFueT47XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICAgICAgSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpLFxuICAgICAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICByZXNwb25zZS5ib2R5XG4gICAgICAgICk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKGRldGVjdGlvblJlc3VsdC5wYXlsb2FkVHlwZSA9PSBcIklSZXF1ZXN0XCIpIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXF1ZXN0PGFueT47XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxhbnk+KHtcbiAgICAgICAgICB0bzogcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyB8fCB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgY29ubmVjdGlvbklkOiBjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLFxuICAgICAgICAgICAgdHlwZTogcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGUgfHwgXCJ1bmtub3duXCIsXG4gICAgICAgICAgICBib2R5OiByZXF1ZXN0LmJvZHksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgICAgIHJlcXVlc3RJZDogcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOiBhc3luYyAoXG4gICAgICAgICAgICB1cGRhdGVSZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgICAgICAgICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgICAgICAgICApID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHN0YXR1c1VwZGF0ZSA9IE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXNwb25zZShcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdCxcbiAgICAgICAgICAgICAgdXBkYXRlUmVxdWVzdC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgICAgICAgc3RhdHVzXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHN0YXR1c1VwZGF0ZSkpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pO1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIFdlYlNvY2tldCBtZXNzYWdlYCwgZXJyb3IpO1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiSW52YWxpZCBtZXNzYWdlIGZvcm1hdFwiIH0pKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUNsb3NlKGNvbm5lY3Rpb25JZDogc3RyaW5nKSB7XG4gICAgdGhpcy5jb25uZWN0aW9ucy5kZWxldGUoY29ubmVjdGlvbklkKTtcbiAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBjb25uZWN0aW9uIGNsb3NlZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5saXN0ZW4odGhpcy5wb3J0LCAoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhgV2ViU29ja2V0IHNlcnZlciBsaXN0ZW5pbmcgb24gcG9ydCAke3RoaXMucG9ydH1gKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIC8vIENsb3NlIGFsbCBhY3RpdmUgY29ubmVjdGlvbnNcbiAgICAgIHRoaXMuaW5mbyhcIkNsb3NpbmcgYWxsIGFjdGl2ZSBXZWJTb2NrZXQgY29ubmVjdGlvbnMuLi5cIik7XG4gICAgICBmb3IgKGNvbnN0IGNvbm5lY3Rpb24gb2YgdGhpcy5jb25uZWN0aW9ucy52YWx1ZXMoKSkge1xuICAgICAgICBjb25uZWN0aW9uLmNsb3NlKDEwMDAsIFwiU2VydmVyIHNodXR0aW5nIGRvd25cIik7XG4gICAgICB9XG5cbiAgICAgIC8vIFdhaXQgZm9yIGEgc2hvcnQgdGltZSB0byBhbGxvdyBjb25uZWN0aW9ucyB0byBjbG9zZVxuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIC8vIENsb3NlIHRoZSBXZWJTb2NrZXQgc2VydmVyXG4gICAgICAgIHRoaXMud3NzLmNsb3NlKCgpID0+IHtcbiAgICAgICAgICAvLyBDbG9zZSB0aGUgSFRUUCBzZXJ2ZXJcbiAgICAgICAgICB0aGlzLnNlcnZlci5jbG9zZSgoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmluZm8oXCJXZWJTb2NrZXQgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgfSwgMTAwMCk7IC8vIFdhaXQgZm9yIDEgc2Vjb25kIGJlZm9yZSBjbG9zaW5nIHNlcnZlcnNcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8V2ViU29ja2V0TWVzc2FnZT5cbiAgKTogUHJvbWlzZTxXZWJTb2NrZXRSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihcbiAgICAgIGBVbmhhbmRsZWQgV2ViU29ja2V0IG1lc3NhZ2UgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgICAgcmVxdWVzdFxuICAgICk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBcIlVuaGFuZGxlZCBtZXNzYWdlIHR5cGVcIiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWAsXG4gICAgfTtcbiAgfVxuXG4gIHByb3RlY3RlZCBnZXRDb25uZWN0aW9ucygpOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiB7XG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvbnM7XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXI8c3RyaW5nPihcInJhd1wiKVxuICBwcm90ZWN0ZWQgYXN5bmMgcmF3TWVzc2FnZUhhbmRsZXIobWVzc2FnZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJhdyBtZXNzYWdlYCwgbWVzc2FnZSk7XG4gICAgcmV0dXJuIFwiRVJST1I6IFJhdyBtZXNzYWdlcyBub3Qgc3VwcG9ydGVkLiBQbGVhc2UgdXNlIENvbW11bmljYXRpb25zTWFuYWdlclwiO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBJUmVxdWVzdDxXZWJTb2NrZXRNZXNzYWdlPik6IHZvaWQge1xuICAgIGNvbnN0IG1lc3NhZ2VTdHJpbmcgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICB0aGlzLmNvbm5lY3Rpb25zLmZvckVhY2goKGNvbm5lY3Rpb24pID0+IHtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlU3RyaW5nKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBzZW5kVG9Db25uZWN0aW9uKFxuICAgIGNvbm5lY3Rpb25JZDogc3RyaW5nLFxuICAgIG1lc3NhZ2U6IElSZXNwb25zZTxXZWJTb2NrZXRNZXNzYWdlPlxuICApOiB2b2lkIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBDb25uZWN0aW9uIG5vdCBmb3VuZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKG1lc3NhZ2U6IHN0cmluZyk6IERldGVjdGlvblJlc3VsdDx1bmtub3duPiB7XG4gIC8vIEZpcnN0LCBjaGVjayBpZiB0aGUgbWVzc2FnZSBpcyBsaWtlbHkgSlNPTiBvciBhIEphdmFTY3JpcHQtbGlrZSBvYmplY3RcbiAgaWYgKG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJ7XCIpIHx8IG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJbXCIpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UobWVzc2FnZSk7XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXF1ZXN0XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwiaGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmhlYWRlciA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcInRpbWVzdGFtcFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0SWRcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdGVyQWRkcmVzc1wiIGluIHBhcnNlZC5oZWFkZXJcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXF1ZXN0XCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXF1ZXN0PHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVzcG9uc2VcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJyZXF1ZXN0SGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwicmVzcG9uc2VIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuYm9keSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcImRhdGFcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcInN1Y2Nlc3NcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcImVycm9yXCIgaW4gcGFyc2VkLmJvZHlcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXNwb25zZVwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVzcG9uc2U8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIElmIGl0J3MgYSBwYXJzZWQgb2JqZWN0IGJ1dCBub3QgSVJlcXVlc3Qgb3IgSVJlc3BvbnNlXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJvYmplY3RcIiwgcGF5bG9hZDogcGFyc2VkIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElmIHBhcnNpbmcgZmFpbHMsIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBpdCBkb2Vzbid0IGxvb2sgbGlrZSBKU09OLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gIH1cbn1cbiJdfQ==