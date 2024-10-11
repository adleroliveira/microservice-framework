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
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0U2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlcnZpY2VzL3dlYi9XZWJTb2NrZXRTZXJ2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEsMkJBQWtDO0FBQ2xDLCtCQUEwRDtBQUMxRCx1RUFLcUM7QUFFckMsK0RBQTREO0FBc0I1RCxNQUFhLGVBQWdCLFNBQVEsNkNBR3BDO0lBUUMsWUFBWSxPQUFpQixFQUFFLE1BQTZCO1FBQzFELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFOakIsZ0JBQVcsR0FBcUMsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQU9oRSxJQUFJLENBQUMsSUFBSSxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUM7UUFDeEIsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxJQUFJLEtBQUssQ0FBQztRQUNqQyxJQUFJLENBQUMsY0FBYyxHQUFHLE1BQU0sQ0FBQyxjQUFjLElBQUksSUFBSSxDQUFDO1FBRXBELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBQSxtQkFBWSxHQUFFLENBQUM7UUFDN0IsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFdBQU0sQ0FBQyxFQUFFLFFBQVEsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO1FBRTFDLElBQUksQ0FBQyxvQkFBb0IsRUFBRSxDQUFDO0lBQzlCLENBQUM7SUFFTyxvQkFBb0I7UUFDMUIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLENBQUMsT0FBTyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsRUFBRTtZQUNsRCxJQUFJLE9BQU8sQ0FBQyxHQUFHLEtBQUssSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO2dCQUM5QixJQUFJLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLEVBQUUsRUFB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aW1wb3J0IHsgY3JlYXRlU2VydmVyLCBTZXJ2ZXIgYXMgSHR0cFNlcnZlciB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQge1xuICBNaWNyb3NlcnZpY2VGcmFtZXdvcmssXG4gIElTZXJ2ZXJDb25maWcsXG4gIFN0YXR1c1VwZGF0ZSxcbiAgUmVxdWVzdEhhbmRsZXIsXG59IGZyb20gXCIuLi8uLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7IElCYWNrRW5kLCBJUmVxdWVzdCwgSVJlc3BvbnNlIH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFdlYnNvY2tldENvbm5lY3Rpb24gfSBmcm9tIFwiLi9XZWJzb2NrZXRDb25uZWN0aW9uXCI7XG5cbnR5cGUgUGF5bG9hZFR5cGUgPSBcIm9iamVjdFwiIHwgXCJzdHJpbmdcIiB8IFwiSVJlcXVlc3RcIiB8IFwiSVJlc3BvbnNlXCI7XG5cbmludGVyZmFjZSBEZXRlY3Rpb25SZXN1bHQ8VD4ge1xuICBwYXlsb2FkVHlwZTogUGF5bG9hZFR5cGU7XG4gIHBheWxvYWQ6IFQ7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0U2VydmVyQ29uZmlnIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIHBvcnQ6IG51bWJlcjtcbiAgcGF0aD86IHN0cmluZztcbiAgbWF4Q29ubmVjdGlvbnM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldE1lc3NhZ2UgPSB7XG4gIHR5cGU6IHN0cmluZztcbiAgZGF0YTogYW55O1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRSZXNwb25zZSB7fVxuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0U2VydmVyIGV4dGVuZHMgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBXZWJTb2NrZXRNZXNzYWdlLFxuICBXZWJTb2NrZXRSZXNwb25zZVxuPiB7XG4gIHByaXZhdGUgc2VydmVyOiBIdHRwU2VydmVyO1xuICBwcml2YXRlIHdzczogU2VydmVyO1xuICBwcml2YXRlIGNvbm5lY3Rpb25zOiBNYXA8c3RyaW5nLCBXZWJzb2NrZXRDb25uZWN0aW9uPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gIHByaXZhdGUgcGF0aDogc3RyaW5nO1xuICBwcml2YXRlIG1heENvbm5lY3Rpb25zOiBudW1iZXI7XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogV2ViU29ja2V0U2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcbiAgICB0aGlzLnBvcnQgPSBjb25maWcucG9ydDtcbiAgICB0aGlzLnBhdGggPSBjb25maWcucGF0aCB8fCBcIi93c1wiO1xuICAgIHRoaXMubWF4Q29ubmVjdGlvbnMgPSBjb25maWcubWF4Q29ubmVjdGlvbnMgfHwgMTAwMDtcblxuICAgIHRoaXMuc2VydmVyID0gY3JlYXRlU2VydmVyKCk7XG4gICAgdGhpcy53c3MgPSBuZXcgU2VydmVyKHsgbm9TZXJ2ZXI6IHRydWUgfSk7XG5cbiAgICB0aGlzLnNldHVwV2ViU29ja2V0U2VydmVyKCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwV2ViU29ja2V0U2VydmVyKCkge1xuICAgIHRoaXMuc2VydmVyLm9uKFwidXBncmFkZVwiLCAocmVxdWVzdCwgc29ja2V0LCBoZWFkKSA9PiB7XG4gICAgICBpZiAocmVxdWVzdC51cmwgPT09IHRoaXMucGF0aCkge1xuICAgICAgICB0aGlzLndzcy5oYW5kbGVVcGdyYWRlKHJlcXVlc3QsIHNvY2tldCwgaGVhZCwgKHdzKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMuY29ubmVjdGlvbnMuc2l6ZSA+PSB0aGlzLm1heENvbm5lY3Rpb25zKSB7XG4gICAgICAgICAgICB3cy5jbG9zZSgxMDEzLCBcIk1heGltdW0gbnVtYmVyIG9mIGNvbm5lY3Rpb25zIHJlYWNoZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgY29uc3QgY29ubmVjdGlvbiA9IG5ldyBXZWJzb2NrZXRDb25uZWN0aW9uKFxuICAgICAgICAgICAgd3MsXG4gICAgICAgICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSxcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlQ2xvc2UuYmluZCh0aGlzKVxuICAgICAgICAgICk7XG5cbiAgICAgICAgICB0aGlzLmNvbm5lY3Rpb25zLnNldChjb25uZWN0aW9uLmdldENvbm5lY3Rpb25JZCgpLCBjb25uZWN0aW9uKTtcbiAgICAgICAgICB0aGlzLmluZm8oXG4gICAgICAgICAgICBgTmV3IFdlYlNvY2tldCBjb25uZWN0aW9uOiAke2Nvbm5lY3Rpb24uZ2V0Q29ubmVjdGlvbklkKCl9YFxuICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlTWVzc2FnZShkYXRhOiBEYXRhLCBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0ckRhdGEgPSBkYXRhLnRvU3RyaW5nKCk7XG4gICAgICBjb25zdCBkZXRlY3Rpb25SZXN1bHQgPSBkZXRlY3RBbmRDYXRlZ29yaXplTWVzc2FnZShzdHJEYXRhKTtcbiAgICAgIGxldCByZXF1ZXN0VHlwZTogc3RyaW5nID0gXCJcIjtcblxuICAgICAgaWYgKFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJzdHJpbmdcIiB8fFxuICAgICAgICBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJvYmplY3RcIlxuICAgICAgKSB7XG4gICAgICAgIHJlcXVlc3RUeXBlID0gXCJyYXdcIjtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PGFueT4oe1xuICAgICAgICAgIHRvOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZTogXCJyYXdcIixcbiAgICAgICAgICBib2R5OiBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVzcG9uc2VcIikge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGRldGVjdGlvblJlc3VsdC5wYXlsb2FkIGFzIElSZXNwb25zZTxhbnk+O1xuICAgICAgICBhd2FpdCB0aGlzLnNlbmRPbmVXYXlNZXNzYWdlKFxuICAgICAgICAgIEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSxcbiAgICAgICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgICAgcmVzcG9uc2UuYm9keVxuICAgICAgICApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmIChkZXRlY3Rpb25SZXN1bHQucGF5bG9hZFR5cGUgPT0gXCJJUmVxdWVzdFwiKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBkZXRlY3Rpb25SZXN1bHQucGF5bG9hZCBhcyBJUmVxdWVzdDxhbnk+O1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMubWFrZVJlcXVlc3Q8YW55Pih7XG4gICAgICAgICAgdG86IHJlcXVlc3QuaGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgfHwgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGU6IHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlIHx8IFwidW5rbm93blwiLFxuICAgICAgICAgIGJvZHk6IHJlcXVlc3QuYm9keSxcbiAgICAgICAgICBoZWFkZXJzOiB7IC4uLnJlcXVlc3QuaGVhZGVyLCByZXF1ZXN0SWQ6IHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCB9LFxuICAgICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTogYXN5bmMgKFxuICAgICAgICAgICAgdXBkYXRlUmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICAgICAgICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICAgICAgICAgKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBzdGF0dXNVcGRhdGUgPSBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVzcG9uc2UoXG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QsXG4gICAgICAgICAgICAgIHVwZGF0ZVJlcXVlc3QuaGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgICAgICAgIHN0YXR1c1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeShzdGF0dXNVcGRhdGUpKTtcbiAgICAgICAgICB9LFxuICAgICAgICB9KTtcbiAgICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyBXZWJTb2NrZXQgbWVzc2FnZWAsIGVycm9yKTtcbiAgICAgIGNvbm5lY3Rpb24uc2VuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIkludmFsaWQgbWVzc2FnZSBmb3JtYXRcIiB9KSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVDbG9zZShjb25uZWN0aW9uSWQ6IHN0cmluZykge1xuICAgIHRoaXMuY29ubmVjdGlvbnMuZGVsZXRlKGNvbm5lY3Rpb25JZCk7XG4gICAgdGhpcy5pbmZvKGBXZWJTb2NrZXQgY29ubmVjdGlvbiBjbG9zZWQ6ICR7Y29ubmVjdGlvbklkfWApO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oYFdlYlNvY2tldCBzZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgJHt0aGlzLnBvcnR9YCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICAvLyBDbG9zZSBhbGwgYWN0aXZlIGNvbm5lY3Rpb25zXG4gICAgICB0aGlzLmluZm8oXCJDbG9zaW5nIGFsbCBhY3RpdmUgV2ViU29ja2V0IGNvbm5lY3Rpb25zLi4uXCIpO1xuICAgICAgZm9yIChjb25zdCBjb25uZWN0aW9uIG9mIHRoaXMuY29ubmVjdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgICAgY29ubmVjdGlvbi5jbG9zZSgxMDAwLCBcIlNlcnZlciBzaHV0dGluZyBkb3duXCIpO1xuICAgICAgfVxuXG4gICAgICAvLyBXYWl0IGZvciBhIHNob3J0IHRpbWUgdG8gYWxsb3cgY29ubmVjdGlvbnMgdG8gY2xvc2VcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAvLyBDbG9zZSB0aGUgV2ViU29ja2V0IHNlcnZlclxuICAgICAgICB0aGlzLndzcy5jbG9zZSgoKSA9PiB7XG4gICAgICAgICAgLy8gQ2xvc2UgdGhlIEhUVFAgc2VydmVyXG4gICAgICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5pbmZvKFwiV2ViU29ja2V0IHNlcnZlciBzdG9wcGVkXCIpO1xuICAgICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH0sIDEwMDApOyAvLyBXYWl0IGZvciAxIHNlY29uZCBiZWZvcmUgY2xvc2luZyBzZXJ2ZXJzXG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFdlYlNvY2tldE1lc3NhZ2U+XG4gICk6IFByb21pc2U8V2ViU29ja2V0UmVzcG9uc2U+IHtcbiAgICB0aGlzLndhcm4oXG4gICAgICBgVW5oYW5kbGVkIFdlYlNvY2tldCBtZXNzYWdlIHR5cGU6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCxcbiAgICAgIHJlcXVlc3RcbiAgICApO1xuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgIGVycm9yOiBgXCJVbmhhbmRsZWQgbWVzc2FnZSB0eXBlXCIgJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gLFxuICAgIH07XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXI8c3RyaW5nPihcInJhd1wiKVxuICBwcm90ZWN0ZWQgYXN5bmMgcmF3TWVzc2FnZUhhbmRsZXIobWVzc2FnZTogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJhdyBtZXNzYWdlYCwgbWVzc2FnZSk7XG4gICAgcmV0dXJuIFwiRVJST1I6IFJhdyBtZXNzYWdlcyBub3Qgc3VwcG9ydGVkLiBQbGVhc2UgdXNlIENvbW11bmljYXRpb25zTWFuYWdlclwiO1xuICB9XG5cbiAgcHVibGljIGJyb2FkY2FzdChtZXNzYWdlOiBXZWJTb2NrZXRNZXNzYWdlKTogdm9pZCB7XG4gICAgY29uc3QgbWVzc2FnZVN0cmluZyA9IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuICAgIHRoaXMuY29ubmVjdGlvbnMuZm9yRWFjaCgoY29ubmVjdGlvbikgPT4ge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKG1lc3NhZ2VTdHJpbmcpO1xuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIHNlbmRUb0Nvbm5lY3Rpb24oXG4gICAgY29ubmVjdGlvbklkOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogV2ViU29ja2V0TWVzc2FnZVxuICApOiB2b2lkIHtcbiAgICBjb25zdCBjb25uZWN0aW9uID0gdGhpcy5jb25uZWN0aW9ucy5nZXQoY29ubmVjdGlvbklkKTtcbiAgICBpZiAoY29ubmVjdGlvbikge1xuICAgICAgY29ubmVjdGlvbi5zZW5kKEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBDb25uZWN0aW9uIG5vdCBmb3VuZDogJHtjb25uZWN0aW9uSWR9YCk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGRldGVjdEFuZENhdGVnb3JpemVNZXNzYWdlKG1lc3NhZ2U6IHN0cmluZyk6IERldGVjdGlvblJlc3VsdDx1bmtub3duPiB7XG4gIC8vIEZpcnN0LCBjaGVjayBpZiB0aGUgbWVzc2FnZSBpcyBsaWtlbHkgSlNPTiBvciBhIEphdmFTY3JpcHQtbGlrZSBvYmplY3RcbiAgaWYgKG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJ7XCIpIHx8IG1lc3NhZ2UudHJpbSgpLnN0YXJ0c1dpdGgoXCJbXCIpKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UobWVzc2FnZSk7XG5cbiAgICAgIC8vIENoZWNrIGlmIGl0J3MgbGlrZWx5IGFuIElSZXF1ZXN0XG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBwYXJzZWQgPT09IFwib2JqZWN0XCIgJiZcbiAgICAgICAgcGFyc2VkICE9PSBudWxsICYmXG4gICAgICAgIFwiaGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwiYm9keVwiIGluIHBhcnNlZCAmJlxuICAgICAgICB0eXBlb2YgcGFyc2VkLmhlYWRlciA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcInRpbWVzdGFtcFwiIGluIHBhcnNlZC5oZWFkZXIgJiZcbiAgICAgICAgXCJyZXF1ZXN0SWRcIiBpbiBwYXJzZWQuaGVhZGVyICYmXG4gICAgICAgIFwicmVxdWVzdGVyQWRkcmVzc1wiIGluIHBhcnNlZC5oZWFkZXJcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXF1ZXN0XCIsXG4gICAgICAgICAgcGF5bG9hZDogcGFyc2VkIGFzIElSZXF1ZXN0PHVua25vd24+LFxuICAgICAgICB9O1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiBpdCdzIGxpa2VseSBhbiBJUmVzcG9uc2VcbiAgICAgIGlmIChcbiAgICAgICAgdHlwZW9mIHBhcnNlZCA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBwYXJzZWQgIT09IG51bGwgJiZcbiAgICAgICAgXCJyZXF1ZXN0SGVhZGVyXCIgaW4gcGFyc2VkICYmXG4gICAgICAgIFwicmVzcG9uc2VIZWFkZXJcIiBpbiBwYXJzZWQgJiZcbiAgICAgICAgXCJib2R5XCIgaW4gcGFyc2VkICYmXG4gICAgICAgIHR5cGVvZiBwYXJzZWQuYm9keSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgICBcImRhdGFcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcInN1Y2Nlc3NcIiBpbiBwYXJzZWQuYm9keSAmJlxuICAgICAgICBcImVycm9yXCIgaW4gcGFyc2VkLmJvZHlcbiAgICAgICkge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHBheWxvYWRUeXBlOiBcIklSZXNwb25zZVwiLFxuICAgICAgICAgIHBheWxvYWQ6IHBhcnNlZCBhcyBJUmVzcG9uc2U8dW5rbm93bj4sXG4gICAgICAgIH07XG4gICAgICB9XG5cbiAgICAgIC8vIElmIGl0J3MgYSBwYXJzZWQgb2JqZWN0IGJ1dCBub3QgSVJlcXVlc3Qgb3IgSVJlc3BvbnNlXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJvYmplY3RcIiwgcGF5bG9hZDogcGFyc2VkIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIElmIHBhcnNpbmcgZmFpbHMsIHRyZWF0IGl0IGFzIGEgc3RyaW5nXG4gICAgICByZXR1cm4geyBwYXlsb2FkVHlwZTogXCJzdHJpbmdcIiwgcGF5bG9hZDogbWVzc2FnZSB9O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiBpdCBkb2Vzbid0IGxvb2sgbGlrZSBKU09OLCB0cmVhdCBpdCBhcyBhIHN0cmluZ1xuICAgIHJldHVybiB7IHBheWxvYWRUeXBlOiBcInN0cmluZ1wiLCBwYXlsb2FkOiBtZXNzYWdlIH07XG4gIH1cbn1cbiJdfQ==