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
                if (!requestHeader.requiresResponse) {
                    return;
                }
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
                if (!requestHeader.requiresResponse) {
                    this.logger.warn(`Request error not sent. No response required for requestType: ${requestType}`, error);
                    return;
                }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmVxdWVzdE1hbmFnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYnJvd3Nlci9SZXF1ZXN0TWFuYWdlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSwrQkFBb0M7QUFPcEMsa0VBQXlDO0FBRXpDLHFFQUFrRTtBQVlsRSxNQUFhLGNBQWUsU0FBUSx1QkFBWTtJQVM5QyxZQUFZLEtBQTBCO1FBQ3BDLEtBQUssRUFBRSxDQUFDO1FBUkYsb0JBQWUsR0FDckIsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNKLG9CQUFlLEdBQTBDLElBQUksR0FBRyxFQUFFLENBQUM7UUFPekUsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLCtDQUFzQixFQUFFLENBQUM7UUFDM0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLENBQUMsY0FBYyxJQUFJLEtBQUssQ0FBQztRQUNwRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsS0FBSyxDQUFDLGdCQUFnQixDQUFDO1FBQy9DLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVNLEtBQUssQ0FBQyxPQUFPLENBQ2xCLFdBQW1CLEVBQ25CLElBQU8sRUFDUCxFQUFXO1FBRVgsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUNyQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFJLFdBQVcsRUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDN0QsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtnQkFDaEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDdEQsTUFBTSxDQUFDLElBQUksS0FB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LEVBQUUsQ0FBQztRQUUxQixtQkFBbUI7UUFDbkIsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBRXRCLG1CQUFtQjtRQUNuQixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSyxDQUFDO1FBQzlCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSyxDQUFDO1FBQ3BCLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSyxDQUFDO0lBQy9CLENBQUM7Q0FDRjtBQWhPRCx3Q0FnT0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuaW1wb3J0IHtcbiAgSVJlcXVlc3QsXG4gIElSZXNwb25zZSxcbiAgSVJlc3BvbnNlRGF0YSxcbiAgSVJlcXVlc3RIZWFkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCJldmVudGVtaXR0ZXIzXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRNYW5hZ2VyIH0gZnJvbSBcIi4vV2ViU29ja2V0TWFuYWdlclwiO1xuaW1wb3J0IHsgQnJvd3NlckNvbnNvbGVTdHJhdGVneSB9IGZyb20gXCIuL0Jyb3dzZXJDb25zb2xlU3RyYXRlZ3lcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSZXF1ZXN0TWFuYWdlclByb3BzIHtcbiAgd2ViU29ja2V0TWFuYWdlcjogV2ViU29ja2V0TWFuYWdlcjtcbiAgcmVxdWVzdFRpbWVvdXQ/OiBudW1iZXI7XG59XG5cbnR5cGUgUmVxdWVzdEhhbmRsZXI8VCwgUj4gPSAoXG4gIHBheWxvYWQ6IFQsXG4gIHJlcXVlc3RIZWFkZXI6IElSZXF1ZXN0SGVhZGVyXG4pID0+IFByb21pc2U8Uj4gfCBSO1xuXG5leHBvcnQgY2xhc3MgUmVxdWVzdE1hbmFnZXIgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBwcml2YXRlIGxvZ2dlcjogQnJvd3NlckNvbnNvbGVTdHJhdGVneTtcbiAgcHJpdmF0ZSBwZW5kaW5nUmVxdWVzdHM6IE1hcDxzdHJpbmcsIChyZXNwb25zZTogSVJlc3BvbnNlPGFueT4pID0+IHZvaWQ+ID1cbiAgICBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcmVxdWVzdEhhbmRsZXJzOiBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlcjxhbnksIGFueT4+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlcXVlc3RUaW1lb3V0OiBudW1iZXI7XG4gIHByaXZhdGUgd2ViU29ja2V0TWFuYWdlcjogV2ViU29ja2V0TWFuYWdlcjtcbiAgcHJpdmF0ZSBhdXRoVG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3Rvcihwcm9wczogUmVxdWVzdE1hbmFnZXJQcm9wcykge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgQnJvd3NlckNvbnNvbGVTdHJhdGVneSgpO1xuICAgIHRoaXMucmVxdWVzdFRpbWVvdXQgPSBwcm9wcy5yZXF1ZXN0VGltZW91dCB8fCAzMDAwMDtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIgPSBwcm9wcy53ZWJTb2NrZXRNYW5hZ2VyO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcIm1lc3NhZ2VcIiwgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcykpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJlcXVlc3Q8SSwgTz4oXG4gICAgcmVxdWVzdFR5cGU6IHN0cmluZyxcbiAgICBib2R5OiBJLFxuICAgIHRvPzogc3RyaW5nXG4gICk6IFByb21pc2U8SVJlc3BvbnNlRGF0YTxPPj4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gdGhpcy5jcmVhdGVSZXF1ZXN0PEk+KHJlcXVlc3RUeXBlLCBib2R5LCB0byk7XG4gICAgICBjb25zdCB0aW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCk7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJSZXF1ZXN0IHRpbWVvdXRcIikpO1xuICAgICAgfSwgdGhpcy5yZXF1ZXN0VGltZW91dCk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3RDYWxsYmFjayA9IChyZXNwb25zZTogSVJlc3BvbnNlPE8+KSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpO1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdC5oZWFkZXIucmVxdWVzdElkKTtcbiAgICAgICAgaWYgKHJlc3BvbnNlLmJvZHkuc3VjY2Vzcykge1xuICAgICAgICAgIHJlc29sdmUocmVzcG9uc2UuYm9keSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVqZWN0KHJlc3BvbnNlLmJvZHkuZXJyb3IgfHwgcmVzcG9uc2UuYm9keS5kYXRhKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCwgcmVxdWVzdENhbGxiYWNrKTtcbiAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5zZW5kKEpTT04uc3RyaW5naWZ5KHJlcXVlc3QpKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlUmVxdWVzdDxUPihcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IFQsXG4gICAgdG8/OiBzdHJpbmdcbiAgKTogSVJlcXVlc3Q8VD4ge1xuICAgIHJldHVybiB7XG4gICAgICBoZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQ6IGBSTS0ke3V1aWR2NCgpfWAsXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3M6IFwiUmVxdWVzdE1hbmFnZXJcIixcbiAgICAgICAgcmVjaXBpZW50QWRkcmVzczogdG8sXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICBhdXRoVG9rZW46IHRoaXMuYXV0aFRva2VuLFxuICAgICAgfSxcbiAgICAgIGJvZHksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlTWVzc2FnZShwYXJzZWQ6IGFueSkge1xuICAgIHRyeSB7XG4gICAgICBpZiAocGFyc2VkLmhlYWRlciAmJiBwYXJzZWQuaGVhZGVyLnJlcXVlc3RUeXBlKSB7XG4gICAgICAgIHRoaXMuaGFuZGxlSW5jb21pbmdSZXF1ZXN0KHBhcnNlZCk7XG4gICAgICB9IGVsc2UgaWYgKHBhcnNlZC5yZXF1ZXN0SGVhZGVyKSB7XG4gICAgICAgIHRoaXMuaGFuZGxlUmVzcG9uc2UocGFyc2VkKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJSZWNlaXZlZCBtZXNzYWdlIHdpdGggdW5rbm93biBzdHJ1Y3R1cmU6XCIsIHBhcnNlZCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiRXJyb3IgcGFyc2luZyBtZXNzYWdlOlwiLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVJbmNvbWluZ1JlcXVlc3QocmVxdWVzdDogSVJlcXVlc3Q8YW55Pikge1xuICAgIGNvbnN0IHsgcmVxdWVzdFR5cGUgfSA9IHJlcXVlc3QuaGVhZGVyO1xuXG4gICAgaWYgKCFyZXF1ZXN0VHlwZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIlJlY2VpdmVkIHJlcXVlc3Qgd2l0aG91dCByZXF1ZXN0VHlwZVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5saXN0ZW5lckNvdW50KHJlcXVlc3RUeXBlKSA+IDApIHtcbiAgICAgIC8vIFBhc3MgYm90aCBwYXlsb2FkIGFuZCBoZWFkZXIgdG8gZW5zdXJlIHdlIGNhbiBjb25zdHJ1Y3QgdGhlIHJlc3BvbnNlXG4gICAgICB0aGlzLmVtaXQocmVxdWVzdFR5cGUsIHJlcXVlc3QuYm9keSwgcmVxdWVzdC5oZWFkZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFxuICAgICAgICBgTm8gaGFuZGxlcnMgcmVnaXN0ZXJlZCBmb3IgcmVxdWVzdFR5cGU6ICR7cmVxdWVzdFR5cGV9YFxuICAgICAgKTtcblxuICAgICAgLy8gU2VuZCBlcnJvciByZXNwb25zZSBmb3IgdW5oYW5kbGVkIHJlcXVlc3QgdHlwZXNcbiAgICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IElSZXNwb25zZTxudWxsPiA9IHtcbiAgICAgICAgcmVxdWVzdEhlYWRlcjogcmVxdWVzdC5oZWFkZXIsXG4gICAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgICAgcmVzcG9uZGVyQWRkcmVzczogXCJSZXF1ZXN0TWFuYWdlclwiLFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgfSxcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIGRhdGE6IG51bGwsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgZXJyb3I6IG5ldyBFcnJvcihcbiAgICAgICAgICAgIGBObyBoYW5kbGVyIHJlZ2lzdGVyZWQgZm9yIHJlcXVlc3RUeXBlOiAke3JlcXVlc3RUeXBlfWBcbiAgICAgICAgICApLFxuICAgICAgICB9LFxuICAgICAgfTtcbiAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5zZW5kKEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3BvbnNlPFQ+KHJlc3BvbnNlOiBJUmVzcG9uc2U8VD4pIHtcbiAgICBjb25zdCBwZW5kaW5nUmVxdWVzdCA9IHRoaXMucGVuZGluZ1JlcXVlc3RzLmdldChcbiAgICAgIHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdElkXG4gICAgKTtcbiAgICBpZiAocGVuZGluZ1JlcXVlc3QpIHtcbiAgICAgIHBlbmRpbmdSZXF1ZXN0KHJlc3BvbnNlKTtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RJZCk7XG4gICAgfVxuICB9XG5cbiAgLy8gTWV0aG9kIHRvIHJlZ2lzdGVyIGhhbmRsZXJzIGZvciBpbmNvbWluZyByZXF1ZXN0c1xuICBwdWJsaWMgcmVnaXN0ZXJIYW5kbGVyPFQsIFI+KFxuICAgIHJlcXVlc3RUeXBlOiBzdHJpbmcsXG4gICAgaGFuZGxlcjogKHBheWxvYWQ6IFQsIHJlcXVlc3RIZWFkZXI6IElSZXF1ZXN0SGVhZGVyKSA9PiBQcm9taXNlPFI+IHwgUlxuICApOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZXF1ZXN0SGFuZGxlcnMuaGFzKHJlcXVlc3RUeXBlKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgSGFuZGxlciBhbHJlYWR5IHJlZ2lzdGVyZWQgZm9yIHJlcXVlc3RUeXBlOiAke3JlcXVlc3RUeXBlfWBcbiAgICAgICk7XG4gICAgfVxuXG4gICAgdGhpcy5yZXF1ZXN0SGFuZGxlcnMuc2V0KHJlcXVlc3RUeXBlLCBoYW5kbGVyKTtcblxuICAgIC8vIFNldCB1cCB0aGUgZXZlbnQgbGlzdGVuZXIgdGhhdCBlbnN1cmVzIHJlc3BvbnNlcyBnbyBiYWNrIHRocm91Z2ggV2ViU29ja2V0XG4gICAgdGhpcy5vbihyZXF1ZXN0VHlwZSwgYXN5bmMgKHBheWxvYWQ6IFQsIHJlcXVlc3RIZWFkZXI6IElSZXF1ZXN0SGVhZGVyKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBoYW5kbGVyKHBheWxvYWQsIHJlcXVlc3RIZWFkZXIpO1xuICAgICAgICBpZiAoIXJlcXVlc3RIZWFkZXIucmVxdWlyZXNSZXNwb25zZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCByZXNwb25zZTogSVJlc3BvbnNlPFI+ID0ge1xuICAgICAgICAgIHJlcXVlc3RIZWFkZXIsXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgICAgIHJlc3BvbmRlckFkZHJlc3M6IFwiUmVxdWVzdE1hbmFnZXJcIixcbiAgICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgIGRhdGE6IHJlc3VsdCxcbiAgICAgICAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICAgICAgICBlcnJvcjogbnVsbCxcbiAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIuc2VuZChKU09OLnN0cmluZ2lmeShyZXNwb25zZSkpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgaWYgKCFyZXF1ZXN0SGVhZGVyLnJlcXVpcmVzUmVzcG9uc2UpIHtcbiAgICAgICAgICB0aGlzLmxvZ2dlci53YXJuKFxuICAgICAgICAgICAgYFJlcXVlc3QgZXJyb3Igbm90IHNlbnQuIE5vIHJlc3BvbnNlIHJlcXVpcmVkIGZvciByZXF1ZXN0VHlwZTogJHtyZXF1ZXN0VHlwZX1gLFxuICAgICAgICAgICAgZXJyb3JcbiAgICAgICAgICApO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBlcnJvclJlc3BvbnNlOiBJUmVzcG9uc2U8bnVsbD4gPSB7XG4gICAgICAgICAgcmVxdWVzdEhlYWRlcixcbiAgICAgICAgICByZXNwb25zZUhlYWRlcjoge1xuICAgICAgICAgICAgcmVzcG9uZGVyQWRkcmVzczogXCJSZXF1ZXN0TWFuYWdlclwiLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgZGF0YTogbnVsbCxcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLFxuICAgICAgICAgICAgZXJyb3I6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKSxcbiAgICAgICAgICB9LFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIuc2VuZChKU09OLnN0cmluZ2lmeShlcnJvclJlc3BvbnNlKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICAvLyBNZXRob2QgdG8gcmVtb3ZlIGhhbmRsZXJzXG4gIHB1YmxpYyByZW1vdmVIYW5kbGVyKHJlcXVlc3RUeXBlOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLnJlcXVlc3RIYW5kbGVycy5kZWxldGUocmVxdWVzdFR5cGUpO1xuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKHJlcXVlc3RUeXBlKTtcbiAgfVxuXG4gIHB1YmxpYyBzZXRBdXRoVG9rZW4odG9rZW46IHN0cmluZykge1xuICAgIHRoaXMuYXV0aFRva2VuID0gdG9rZW47XG4gIH1cblxuICBwdWJsaWMgY2xlYXJBdXRoVG9rZW4oKSB7XG4gICAgdGhpcy5hdXRoVG9rZW4gPSB1bmRlZmluZWQ7XG4gIH1cblxuICBwdWJsaWMgY2xlYXJTdGF0ZSgpOiB2b2lkIHtcbiAgICAvLyBDbGVhciBwZW5kaW5nIHJlcXVlc3RzIGJ1dCBrZWVwIHRoZSBtYW5hZ2VyIGFsaXZlXG4gICAgZm9yIChjb25zdCBbcmVxdWVzdElkXSBvZiB0aGlzLnBlbmRpbmdSZXF1ZXN0cykge1xuICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgfVxuICAgIHRoaXMuY2xlYXJBdXRoVG9rZW4oKTtcbiAgfVxuXG4gIHB1YmxpYyBkZXN0cm95KCk6IHZvaWQge1xuICAgIC8vIENsZWFyIHRpbWVvdXQgZm9yIGFueSBwZW5kaW5nIHJlcXVlc3RzXG4gICAgZm9yIChjb25zdCBbcmVxdWVzdElkXSBvZiB0aGlzLnBlbmRpbmdSZXF1ZXN0cykge1xuICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIFdlYlNvY2tldCBtZXNzYWdlIGxpc3RlbmVyXG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLnJlbW92ZUxpc3RlbmVyKFxuICAgICAgXCJtZXNzYWdlXCIsXG4gICAgICB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKVxuICAgICk7XG5cbiAgICAvLyBDbGVhciBhbGwgZXZlbnQgbGlzdGVuZXJzXG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcblxuICAgIC8vIENsZWFyIGF1dGggdG9rZW5cbiAgICB0aGlzLmNsZWFyQXV0aFRva2VuKCk7XG5cbiAgICAvLyBDbGVhciByZWZlcmVuY2VzXG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyID0gbnVsbCE7XG4gICAgdGhpcy5sb2dnZXIgPSBudWxsITtcbiAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cyA9IG51bGwhO1xuICB9XG59XG4iXX0=