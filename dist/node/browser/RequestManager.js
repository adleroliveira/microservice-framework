"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestManager = void 0;
const uuid_1 = require("uuid");
const eventemitter3_1 = __importDefault(require("eventemitter3"));
const BrowserConsoleStrategy_1 = require("./BrowserConsoleStrategy");
class RequestManager extends eventemitter3_1.default {
    constructor(props) {
        super();
        this.pendingRequests = new Map();
        this.requestHandlers = new Map();
        this.logger = new BrowserConsoleStrategy_1.BrowserConsoleStrategy();
        this.requestTimeout = props.requestTimeout || 30000;
        this.webSocketManager = props.webSocketManager;
        this.webSocketManager.on("message", this.handleMessage.bind(this));
    }
    async request(requestType, body, to) {
        return new Promise((resolve, reject) => {
            const request = this.createRequest(requestType, body, to);
            const timeoutId = setTimeout(() => {
                this.pendingRequests.delete(request.header.requestId);
                reject(new Error("Request timeout"));
            }, this.requestTimeout);
            const requestCallback = (response) => {
                clearTimeout(timeoutId);
                this.pendingRequests.delete(request.header.requestId);
                if (response.body.success) {
                    resolve(response.body);
                }
                else {
                    reject(response.body.error || response.body.data);
                }
            };
            this.pendingRequests.set(request.header.requestId, requestCallback);
            this.webSocketManager.send(JSON.stringify(request));
        });
    }
    createRequest(requestType, body, to) {
        return {
            header: {
                timestamp: Date.now(),
                requestId: `RM-${(0, uuid_1.v4)()}`,
                requesterAddress: "RequestManager",
                recipientAddress: to,
                requestType,
                authToken: this.authToken,
            },
            body,
        };
    }
    handleMessage(parsed) {
        try {
            if (parsed.header && parsed.header.requestType) {
                this.handleIncomingRequest(parsed);
            }
            else if (parsed.requestHeader) {
                this.handleResponse(parsed);
            }
            else {
                this.logger.warn("Received message with unknown structure:", parsed);
            }
        }
        catch (error) {
            this.logger.error("Error parsing message:", error);
        }
    }
    async handleIncomingRequest(request) {
        const { requestType } = request.header;
        if (!requestType) {
            this.logger.warn("Received request without requestType");
            return;
        }
        if (this.listenerCount(requestType) > 0) {
            // Pass both payload and header to ensure we can construct the response
            this.emit(requestType, request.body, request.header);
        }
        else {
            this.logger.warn(`No handlers registered for requestType: ${requestType}`);
            // Send error response for unhandled request types
            const errorResponse = {
                requestHeader: request.header,
                responseHeader: {
                    responderAddress: "RequestManager",
                    timestamp: Date.now(),
                },
                body: {
                    data: null,
                    success: false,
                    error: new Error(`No handler registered for requestType: ${requestType}`),
                },
            };
            this.webSocketManager.send(JSON.stringify(errorResponse));
        }
    }
    handleResponse(response) {
        const pendingRequest = this.pendingRequests.get(response.requestHeader.requestId);
        if (pendingRequest) {
            pendingRequest(response);
            this.pendingRequests.delete(response.requestHeader.requestId);
        }
    }
    // Method to register handlers for incoming requests
    registerHandler(requestType, handler) {
        if (this.requestHandlers.has(requestType)) {
            throw new Error(`Handler already registered for requestType: ${requestType}`);
        }
        this.requestHandlers.set(requestType, handler);
        // Set up the event listener that ensures responses go back through WebSocket
        this.on(requestType, async (payload, requestHeader) => {
            try {
                const result = await handler(payload, requestHeader);
                const response = {
                    requestHeader,
                    responseHeader: {
                        responderAddress: "RequestManager",
                        timestamp: Date.now(),
                    },
                    body: {
                        data: result,
                        success: true,
                        error: null,
                    },
                };
                this.webSocketManager.send(JSON.stringify(response));
            }
            catch (error) {
                const errorResponse = {
                    requestHeader,
                    responseHeader: {
                        responderAddress: "RequestManager",
                        timestamp: Date.now(),
                    },
                    body: {
                        data: null,
                        success: false,
                        error: error instanceof Error ? error : new Error(String(error)),
                    },
                };
                this.webSocketManager.send(JSON.stringify(errorResponse));
            }
        });
    }
    // Method to remove handlers
    removeHandler(requestType) {
        this.requestHandlers.delete(requestType);
        this.removeAllListeners(requestType);
    }
    setAuthToken(token) {
        this.authToken = token;
    }
    clearAuthToken() {
        this.authToken = undefined;
    }
    clearState() {
        // Clear pending requests but keep the manager alive
        for (const [requestId] of this.pendingRequests) {
            this.pendingRequests.delete(requestId);
        }
        this.clearAuthToken();
    }
    destroy() {
        // Clear timeout for any pending requests
        for (const [requestId] of this.pendingRequests) {
            this.pendingRequests.delete(requestId);
        }
        // Remove WebSocket message listener
        this.webSocketManager.removeListener("message", this.handleMessage.bind(this));
        // Clear all event listeners
        this.removeAllListeners();
        // Clear auth token
        this.clearAuthToken();
        // Clear references
        this.webSocketManager = null;
        this.logger = null;
        this.pendingRequests = null;
    }
}
exports.RequestManager = RequestManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmVxdWVzdE1hbmFnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYnJvd3Nlci9SZXF1ZXN0TWFuYWdlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSwrQkFBb0M7QUFPcEMsa0VBQXlDO0FBRXpDLHFFQUFrRTtBQVlsRSxNQUFhLGNBQWUsU0FBUSx1QkFBWTtJQVM5QyxZQUFZLEtBQTBCO1FBQ3BDLEtBQUssRUFBRSxDQUFDO1FBUkYsb0JBQWUsR0FDckIsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNKLG9CQUFlLEdBQTBDLElBQUksR0FBRyxFQUFFLENBQUM7UUFPekUsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLCtDQUFzQixFQUFFLENBQUM7UUFDM0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLENBQUMsY0FBYyxJQUFJLEtBQUssQ0FBQztRQUNwRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsS0FBSyxDQUFDLGdCQUFnQixDQUFDO1FBQy9DLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVNLEtBQUssQ0FBQyxPQUFPLENBQ2xCLFdBQW1CLEVBQ25CLElBQU8sRUFDUCxFQUFXO1FBRVgsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUNyQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFJLFdBQVcsRUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDN0QsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtnQkFDaEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDdEQsTUFBTSxDQUFDLElBQUksS0FB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Iiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSBcInV1aWRcIjtcbmltcG9ydCB7XG4gIElSZXF1ZXN0LFxuICBJUmVzcG9uc2UsXG4gIElSZXNwb25zZURhdGEsXG4gIElSZXF1ZXN0SGVhZGVyLFxufSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiZXZlbnRlbWl0dGVyM1wiO1xuaW1wb3J0IHsgV2ViU29ja2V0TWFuYWdlciB9IGZyb20gXCIuL1dlYlNvY2tldE1hbmFnZXJcIjtcbmltcG9ydCB7IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3kgfSBmcm9tIFwiLi9Ccm93c2VyQ29uc29sZVN0cmF0ZWd5XCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVxdWVzdE1hbmFnZXJQcm9wcyB7XG4gIHdlYlNvY2tldE1hbmFnZXI6IFdlYlNvY2tldE1hbmFnZXI7XG4gIHJlcXVlc3RUaW1lb3V0PzogbnVtYmVyO1xufVxuXG50eXBlIFJlcXVlc3RIYW5kbGVyPFQsIFI+ID0gKFxuICBwYXlsb2FkOiBULFxuICByZXF1ZXN0SGVhZGVyOiBJUmVxdWVzdEhlYWRlclxuKSA9PiBQcm9taXNlPFI+IHwgUjtcblxuZXhwb3J0IGNsYXNzIFJlcXVlc3RNYW5hZ2VyIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgcHJpdmF0ZSBsb2dnZXI6IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3k7XG4gIHByaXZhdGUgcGVuZGluZ1JlcXVlc3RzOiBNYXA8c3RyaW5nLCAocmVzcG9uc2U6IElSZXNwb25zZTxhbnk+KSA9PiB2b2lkPiA9XG4gICAgbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlcXVlc3RIYW5kbGVyczogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXI8YW55LCBhbnk+PiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSByZXF1ZXN0VGltZW91dDogbnVtYmVyO1xuICBwcml2YXRlIHdlYlNvY2tldE1hbmFnZXI6IFdlYlNvY2tldE1hbmFnZXI7XG4gIHByaXZhdGUgYXV0aFRva2VuOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IocHJvcHM6IFJlcXVlc3RNYW5hZ2VyUHJvcHMpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMubG9nZ2VyID0gbmV3IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3koKTtcbiAgICB0aGlzLnJlcXVlc3RUaW1lb3V0ID0gcHJvcHMucmVxdWVzdFRpbWVvdXQgfHwgMzAwMDA7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyID0gcHJvcHMud2ViU29ja2V0TWFuYWdlcjtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXCJtZXNzYWdlXCIsIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyByZXF1ZXN0PEksIE8+KFxuICAgIHJlcXVlc3RUeXBlOiBzdHJpbmcsXG4gICAgYm9keTogSSxcbiAgICB0bz86IHN0cmluZ1xuICApOiBQcm9taXNlPElSZXNwb25zZURhdGE8Tz4+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IHRoaXMuY3JlYXRlUmVxdWVzdDxJPihyZXF1ZXN0VHlwZSwgYm9keSwgdG8pO1xuICAgICAgY29uc3QgdGltZW91dElkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQpO1xuICAgICAgICByZWplY3QobmV3IEVycm9yKFwiUmVxdWVzdCB0aW1lb3V0XCIpKTtcbiAgICAgIH0sIHRoaXMucmVxdWVzdFRpbWVvdXQpO1xuXG4gICAgICBjb25zdCByZXF1ZXN0Q2FsbGJhY2sgPSAocmVzcG9uc2U6IElSZXNwb25zZTxPPikgPT4ge1xuICAgICAgICBjbGVhclRpbWVvdXQodGltZW91dElkKTtcbiAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCk7XG4gICAgICAgIGlmIChyZXNwb25zZS5ib2R5LnN1Y2Nlc3MpIHtcbiAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlLmJvZHkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlamVjdChyZXNwb25zZS5ib2R5LmVycm9yIHx8IHJlc3BvbnNlLmJvZHkuZGF0YSk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQsIHJlcXVlc3RDYWxsYmFjayk7XG4gICAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIuc2VuZChKU09OLnN0cmluZ2lmeShyZXF1ZXN0KSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGNyZWF0ZVJlcXVlc3Q8VD4oXG4gICAgcmVxdWVzdFR5cGU6IHN0cmluZyxcbiAgICBib2R5OiBULFxuICAgIHRvPzogc3RyaW5nXG4gICk6IElSZXF1ZXN0PFQ+IHtcbiAgICByZXR1cm4ge1xuICAgICAgaGVhZGVyOiB7XG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgcmVxdWVzdElkOiBgUk0tJHt1dWlkdjQoKX1gLFxuICAgICAgICByZXF1ZXN0ZXJBZGRyZXNzOiBcIlJlcXVlc3RNYW5hZ2VyXCIsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3M6IHRvLFxuICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgYXV0aFRva2VuOiB0aGlzLmF1dGhUb2tlbixcbiAgICAgIH0sXG4gICAgICBib2R5LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZU1lc3NhZ2UocGFyc2VkOiBhbnkpIHtcbiAgICB0cnkge1xuICAgICAgaWYgKHBhcnNlZC5oZWFkZXIgJiYgcGFyc2VkLmhlYWRlci5yZXF1ZXN0VHlwZSkge1xuICAgICAgICB0aGlzLmhhbmRsZUluY29taW5nUmVxdWVzdChwYXJzZWQpO1xuICAgICAgfSBlbHNlIGlmIChwYXJzZWQucmVxdWVzdEhlYWRlcikge1xuICAgICAgICB0aGlzLmhhbmRsZVJlc3BvbnNlKHBhcnNlZCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFwiUmVjZWl2ZWQgbWVzc2FnZSB3aXRoIHVua25vd24gc3RydWN0dXJlOlwiLCBwYXJzZWQpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkVycm9yIHBhcnNpbmcgbWVzc2FnZTpcIiwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlSW5jb21pbmdSZXF1ZXN0KHJlcXVlc3Q6IElSZXF1ZXN0PGFueT4pIHtcbiAgICBjb25zdCB7IHJlcXVlc3RUeXBlIH0gPSByZXF1ZXN0LmhlYWRlcjtcblxuICAgIGlmICghcmVxdWVzdFR5cGUpIHtcbiAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJSZWNlaXZlZCByZXF1ZXN0IHdpdGhvdXQgcmVxdWVzdFR5cGVcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGlzdGVuZXJDb3VudChyZXF1ZXN0VHlwZSkgPiAwKSB7XG4gICAgICAvLyBQYXNzIGJvdGggcGF5bG9hZCBhbmQgaGVhZGVyIHRvIGVuc3VyZSB3ZSBjYW4gY29uc3RydWN0IHRoZSByZXNwb25zZVxuICAgICAgdGhpcy5lbWl0KHJlcXVlc3RUeXBlLCByZXF1ZXN0LmJvZHksIHJlcXVlc3QuaGVhZGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcbiAgICAgICAgYE5vIGhhbmRsZXJzIHJlZ2lzdGVyZWQgZm9yIHJlcXVlc3RUeXBlOiAke3JlcXVlc3RUeXBlfWBcbiAgICAgICk7XG5cbiAgICAgIC8vIFNlbmQgZXJyb3IgcmVzcG9uc2UgZm9yIHVuaGFuZGxlZCByZXF1ZXN0IHR5cGVzXG4gICAgICBjb25zdCBlcnJvclJlc3BvbnNlOiBJUmVzcG9uc2U8bnVsbD4gPSB7XG4gICAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgICByZXNwb25zZUhlYWRlcjoge1xuICAgICAgICAgIHJlc3BvbmRlckFkZHJlc3M6IFwiUmVxdWVzdE1hbmFnZXJcIixcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIH0sXG4gICAgICAgIGJvZHk6IHtcbiAgICAgICAgICBkYXRhOiBudWxsLFxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgIGVycm9yOiBuZXcgRXJyb3IoXG4gICAgICAgICAgICBgTm8gaGFuZGxlciByZWdpc3RlcmVkIGZvciByZXF1ZXN0VHlwZTogJHtyZXF1ZXN0VHlwZX1gXG4gICAgICAgICAgKSxcbiAgICAgICAgfSxcbiAgICAgIH07XG4gICAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIuc2VuZChKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlKSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVSZXNwb25zZTxUPihyZXNwb25zZTogSVJlc3BvbnNlPFQ+KSB7XG4gICAgY29uc3QgcGVuZGluZ1JlcXVlc3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQoXG4gICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RJZFxuICAgICk7XG4gICAgaWYgKHBlbmRpbmdSZXF1ZXN0KSB7XG4gICAgICBwZW5kaW5nUmVxdWVzdChyZXNwb25zZSk7XG4gICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0SWQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIE1ldGhvZCB0byByZWdpc3RlciBoYW5kbGVycyBmb3IgaW5jb21pbmcgcmVxdWVzdHNcbiAgcHVibGljIHJlZ2lzdGVySGFuZGxlcjxULCBSPihcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGhhbmRsZXI6IChwYXlsb2FkOiBULCByZXF1ZXN0SGVhZGVyOiBJUmVxdWVzdEhlYWRlcikgPT4gUHJvbWlzZTxSPiB8IFJcbiAgKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVxdWVzdEhhbmRsZXJzLmhhcyhyZXF1ZXN0VHlwZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEhhbmRsZXIgYWxyZWFkeSByZWdpc3RlcmVkIGZvciByZXF1ZXN0VHlwZTogJHtyZXF1ZXN0VHlwZX1gXG4gICAgICApO1xuICAgIH1cblxuICAgIHRoaXMucmVxdWVzdEhhbmRsZXJzLnNldChyZXF1ZXN0VHlwZSwgaGFuZGxlcik7XG5cbiAgICAvLyBTZXQgdXAgdGhlIGV2ZW50IGxpc3RlbmVyIHRoYXQgZW5zdXJlcyByZXNwb25zZXMgZ28gYmFjayB0aHJvdWdoIFdlYlNvY2tldFxuICAgIHRoaXMub24ocmVxdWVzdFR5cGUsIGFzeW5jIChwYXlsb2FkOiBULCByZXF1ZXN0SGVhZGVyOiBJUmVxdWVzdEhlYWRlcikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihwYXlsb2FkLCByZXF1ZXN0SGVhZGVyKTtcbiAgICAgICAgY29uc3QgcmVzcG9uc2U6IElSZXNwb25zZTxSPiA9IHtcbiAgICAgICAgICByZXF1ZXN0SGVhZGVyLFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgICAgICByZXNwb25kZXJBZGRyZXNzOiBcIlJlcXVlc3RNYW5hZ2VyXCIsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICBkYXRhOiByZXN1bHQsXG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgZXJyb3I6IG51bGwsXG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IElSZXNwb25zZTxudWxsPiA9IHtcbiAgICAgICAgICByZXF1ZXN0SGVhZGVyLFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgICAgICByZXNwb25kZXJBZGRyZXNzOiBcIlJlcXVlc3RNYW5hZ2VyXCIsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICBkYXRhOiBudWxsLFxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgICBlcnJvcjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpLFxuICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5zZW5kKEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIE1ldGhvZCB0byByZW1vdmUgaGFuZGxlcnNcbiAgcHVibGljIHJlbW92ZUhhbmRsZXIocmVxdWVzdFR5cGU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMucmVxdWVzdEhhbmRsZXJzLmRlbGV0ZShyZXF1ZXN0VHlwZSk7XG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMocmVxdWVzdFR5cGUpO1xuICB9XG5cbiAgcHVibGljIHNldEF1dGhUb2tlbih0b2tlbjogc3RyaW5nKSB7XG4gICAgdGhpcy5hdXRoVG9rZW4gPSB0b2tlbjtcbiAgfVxuXG4gIHB1YmxpYyBjbGVhckF1dGhUb2tlbigpIHtcbiAgICB0aGlzLmF1dGhUb2tlbiA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIHB1YmxpYyBjbGVhclN0YXRlKCk6IHZvaWQge1xuICAgIC8vIENsZWFyIHBlbmRpbmcgcmVxdWVzdHMgYnV0IGtlZXAgdGhlIG1hbmFnZXIgYWxpdmVcbiAgICBmb3IgKGNvbnN0IFtyZXF1ZXN0SWRdIG9mIHRoaXMucGVuZGluZ1JlcXVlc3RzKSB7XG4gICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICB9XG4gICAgdGhpcy5jbGVhckF1dGhUb2tlbigpO1xuICB9XG5cbiAgcHVibGljIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgLy8gQ2xlYXIgdGltZW91dCBmb3IgYW55IHBlbmRpbmcgcmVxdWVzdHNcbiAgICBmb3IgKGNvbnN0IFtyZXF1ZXN0SWRdIG9mIHRoaXMucGVuZGluZ1JlcXVlc3RzKSB7XG4gICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgV2ViU29ja2V0IG1lc3NhZ2UgbGlzdGVuZXJcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIucmVtb3ZlTGlzdGVuZXIoXG4gICAgICBcIm1lc3NhZ2VcIixcbiAgICAgIHRoaXMuaGFuZGxlTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgKTtcblxuICAgIC8vIENsZWFyIGFsbCBldmVudCBsaXN0ZW5lcnNcbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygpO1xuXG4gICAgLy8gQ2xlYXIgYXV0aCB0b2tlblxuICAgIHRoaXMuY2xlYXJBdXRoVG9rZW4oKTtcblxuICAgIC8vIENsZWFyIHJlZmVyZW5jZXNcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIgPSBudWxsITtcbiAgICB0aGlzLmxvZ2dlciA9IG51bGwhO1xuICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzID0gbnVsbCE7XG4gIH1cbn1cbiJdfQ==