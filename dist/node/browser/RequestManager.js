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
        const { requestType } = response.requestHeader;
        if (requestType == "MicroserviceFramework::StatusUpdate" &&
            this.listenerCount(requestType) > 0) {
            this.emit(requestType, response.body.data, response.requestHeader);
            return;
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmVxdWVzdE1hbmFnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYnJvd3Nlci9SZXF1ZXN0TWFuYWdlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSwrQkFBb0M7QUFPcEMsa0VBQXlDO0FBRXpDLHFFQUFrRTtBQVlsRSxNQUFhLGNBQWUsU0FBUSx1QkFBWTtJQVM5QyxZQUFZLEtBQTBCO1FBQ3BDLEtBQUssRUFBRSxDQUFDO1FBUkYsb0JBQWUsR0FDckIsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQUNKLG9CQUFlLEdBQTBDLElBQUksR0FBRyxFQUFFLENBQUM7UUFPekUsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLCtDQUFzQixFQUFFLENBQUM7UUFDM0MsSUFBSSxDQUFDLGNBQWMsR0FBRyxLQUFLLENBQUMsY0FBYyxJQUFJLEtBQUssQ0FBQztRQUNwRCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsS0FBSyxDQUFDLGdCQUFnQixDQUFDO1FBQy9DLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDckUsQ0FBQztJQUVNLEtBQUssQ0FBQyxPQUFPLENBQ2xCLFdBQW1CLEVBQ25CLElBQU8sRUFDUCxFQUFXO1FBRVgsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEVBQUUsRUFBRTtZQUNyQyxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsYUFBYSxDQUFJLFdBQVcsRUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7WUFDN0QsTUFBTSxTQUFTLEdBQUcsVUFBVSxDQUFDLEdBQUcsRUFBRTtnQkFDaEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDdEQsTUFBTSxDQUFDLElBQUksS0FB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QVMsQ0FBQyxJQUFJLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztZQUMvQyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUN6QyxDQUFDO1FBRUQsb0NBQW9DO1FBQ3BDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxjQUFjLENBQ2xDLFNBQVMsRUFDVCxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FDOUIsQ0FBQztRQUVGLDRCQUE0QjtRQUM1QixJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztRQUUxQixtQkFBbUI7UUFDbkIsSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1FBRXRCLG1CQUFtQjtRQUNuQixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSyxDQUFDO1FBQzlCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSyxDQUFDO1FBQ3BCLElBQUksQ0FBQyxlQUFlLEdBQUcsSUFBSyxDQUFDO0lBQy9CLENBQUM7Q0FDRjtBQXhPRCx3Q0F3T0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuaW1wb3J0IHtcbiAgSVJlcXVlc3QsXG4gIElSZXNwb25zZSxcbiAgSVJlc3BvbnNlRGF0YSxcbiAgSVJlcXVlc3RIZWFkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCJldmVudGVtaXR0ZXIzXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRNYW5hZ2VyIH0gZnJvbSBcIi4vV2ViU29ja2V0TWFuYWdlclwiO1xuaW1wb3J0IHsgQnJvd3NlckNvbnNvbGVTdHJhdGVneSB9IGZyb20gXCIuL0Jyb3dzZXJDb25zb2xlU3RyYXRlZ3lcIjtcblxuZXhwb3J0IGludGVyZmFjZSBSZXF1ZXN0TWFuYWdlclByb3BzIHtcbiAgd2ViU29ja2V0TWFuYWdlcjogV2ViU29ja2V0TWFuYWdlcjtcbiAgcmVxdWVzdFRpbWVvdXQ/OiBudW1iZXI7XG59XG5cbnR5cGUgUmVxdWVzdEhhbmRsZXI8VCwgUj4gPSAoXG4gIHBheWxvYWQ6IFQsXG4gIHJlcXVlc3RIZWFkZXI6IElSZXF1ZXN0SGVhZGVyXG4pID0+IFByb21pc2U8Uj4gfCBSO1xuXG5leHBvcnQgY2xhc3MgUmVxdWVzdE1hbmFnZXIgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBwcml2YXRlIGxvZ2dlcjogQnJvd3NlckNvbnNvbGVTdHJhdGVneTtcbiAgcHJpdmF0ZSBwZW5kaW5nUmVxdWVzdHM6IE1hcDxzdHJpbmcsIChyZXNwb25zZTogSVJlc3BvbnNlPGFueT4pID0+IHZvaWQ+ID1cbiAgICBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcmVxdWVzdEhhbmRsZXJzOiBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlcjxhbnksIGFueT4+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlcXVlc3RUaW1lb3V0OiBudW1iZXI7XG4gIHByaXZhdGUgd2ViU29ja2V0TWFuYWdlcjogV2ViU29ja2V0TWFuYWdlcjtcbiAgcHJpdmF0ZSBhdXRoVG9rZW46IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3Rvcihwcm9wczogUmVxdWVzdE1hbmFnZXJQcm9wcykge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgQnJvd3NlckNvbnNvbGVTdHJhdGVneSgpO1xuICAgIHRoaXMucmVxdWVzdFRpbWVvdXQgPSBwcm9wcy5yZXF1ZXN0VGltZW91dCB8fCAzMDAwMDtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIgPSBwcm9wcy53ZWJTb2NrZXRNYW5hZ2VyO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcIm1lc3NhZ2VcIiwgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcykpO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHJlcXVlc3Q8SSwgTz4oXG4gICAgcmVxdWVzdFR5cGU6IHN0cmluZyxcbiAgICBib2R5OiBJLFxuICAgIHRvPzogc3RyaW5nXG4gICk6IFByb21pc2U8SVJlc3BvbnNlRGF0YTxPPj4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCByZXF1ZXN0ID0gdGhpcy5jcmVhdGVSZXF1ZXN0PEk+KHJlcXVlc3RUeXBlLCBib2R5LCB0byk7XG4gICAgICBjb25zdCB0aW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCk7XG4gICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJSZXF1ZXN0IHRpbWVvdXRcIikpO1xuICAgICAgfSwgdGhpcy5yZXF1ZXN0VGltZW91dCk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3RDYWxsYmFjayA9IChyZXNwb25zZTogSVJlc3BvbnNlPE8+KSA9PiB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SWQpO1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdC5oZWFkZXIucmVxdWVzdElkKTtcbiAgICAgICAgaWYgKHJlc3BvbnNlLmJvZHkuc3VjY2Vzcykge1xuICAgICAgICAgIHJlc29sdmUocmVzcG9uc2UuYm9keSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVqZWN0KHJlc3BvbnNlLmJvZHkuZXJyb3IgfHwgcmVzcG9uc2UuYm9keS5kYXRhKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZCwgcmVxdWVzdENhbGxiYWNrKTtcbiAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5zZW5kKEpTT04uc3RyaW5naWZ5KHJlcXVlc3QpKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgY3JlYXRlUmVxdWVzdDxUPihcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IFQsXG4gICAgdG8/OiBzdHJpbmdcbiAgKTogSVJlcXVlc3Q8VD4ge1xuICAgIHJldHVybiB7XG4gICAgICBoZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQ6IGBSTS0ke3V1aWR2NCgpfWAsXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3M6IFwiUmVxdWVzdE1hbmFnZXJcIixcbiAgICAgICAgcmVjaXBpZW50QWRkcmVzczogdG8sXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICBhdXRoVG9rZW46IHRoaXMuYXV0aFRva2VuLFxuICAgICAgfSxcbiAgICAgIGJvZHksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlTWVzc2FnZShwYXJzZWQ6IGFueSkge1xuICAgIHRyeSB7XG4gICAgICBpZiAocGFyc2VkLmhlYWRlciAmJiBwYXJzZWQuaGVhZGVyLnJlcXVlc3RUeXBlKSB7XG4gICAgICAgIHRoaXMuaGFuZGxlSW5jb21pbmdSZXF1ZXN0KHBhcnNlZCk7XG4gICAgICB9IGVsc2UgaWYgKHBhcnNlZC5yZXF1ZXN0SGVhZGVyKSB7XG4gICAgICAgIHRoaXMuaGFuZGxlUmVzcG9uc2UocGFyc2VkKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMubG9nZ2VyLndhcm4oXCJSZWNlaXZlZCBtZXNzYWdlIHdpdGggdW5rbm93biBzdHJ1Y3R1cmU6XCIsIHBhcnNlZCk7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiRXJyb3IgcGFyc2luZyBtZXNzYWdlOlwiLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVJbmNvbWluZ1JlcXVlc3QocmVxdWVzdDogSVJlcXVlc3Q8YW55Pikge1xuICAgIGNvbnN0IHsgcmVxdWVzdFR5cGUgfSA9IHJlcXVlc3QuaGVhZGVyO1xuXG4gICAgaWYgKCFyZXF1ZXN0VHlwZSkge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcIlJlY2VpdmVkIHJlcXVlc3Qgd2l0aG91dCByZXF1ZXN0VHlwZVwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5saXN0ZW5lckNvdW50KHJlcXVlc3RUeXBlKSA+IDApIHtcbiAgICAgIC8vIFBhc3MgYm90aCBwYXlsb2FkIGFuZCBoZWFkZXIgdG8gZW5zdXJlIHdlIGNhbiBjb25zdHJ1Y3QgdGhlIHJlc3BvbnNlXG4gICAgICB0aGlzLmVtaXQocmVxdWVzdFR5cGUsIHJlcXVlc3QuYm9keSwgcmVxdWVzdC5oZWFkZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmxvZ2dlci53YXJuKFxuICAgICAgICBgTm8gaGFuZGxlcnMgcmVnaXN0ZXJlZCBmb3IgcmVxdWVzdFR5cGU6ICR7cmVxdWVzdFR5cGV9YFxuICAgICAgKTtcblxuICAgICAgLy8gU2VuZCBlcnJvciByZXNwb25zZSBmb3IgdW5oYW5kbGVkIHJlcXVlc3QgdHlwZXNcbiAgICAgIGNvbnN0IGVycm9yUmVzcG9uc2U6IElSZXNwb25zZTxudWxsPiA9IHtcbiAgICAgICAgcmVxdWVzdEhlYWRlcjogcmVxdWVzdC5oZWFkZXIsXG4gICAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgICAgcmVzcG9uZGVyQWRkcmVzczogXCJSZXF1ZXN0TWFuYWdlclwiLFxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgfSxcbiAgICAgICAgYm9keToge1xuICAgICAgICAgIGRhdGE6IG51bGwsXG4gICAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgICAgZXJyb3I6IG5ldyBFcnJvcihcbiAgICAgICAgICAgIGBObyBoYW5kbGVyIHJlZ2lzdGVyZWQgZm9yIHJlcXVlc3RUeXBlOiAke3JlcXVlc3RUeXBlfWBcbiAgICAgICAgICApLFxuICAgICAgICB9LFxuICAgICAgfTtcbiAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5zZW5kKEpTT04uc3RyaW5naWZ5KGVycm9yUmVzcG9uc2UpKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVJlc3BvbnNlPFQ+KHJlc3BvbnNlOiBJUmVzcG9uc2U8VD4pIHtcbiAgICBjb25zdCB7IHJlcXVlc3RUeXBlIH0gPSByZXNwb25zZS5yZXF1ZXN0SGVhZGVyO1xuICAgIGlmIChcbiAgICAgIHJlcXVlc3RUeXBlID09IFwiTWljcm9zZXJ2aWNlRnJhbWV3b3JrOjpTdGF0dXNVcGRhdGVcIiAmJlxuICAgICAgdGhpcy5saXN0ZW5lckNvdW50KHJlcXVlc3RUeXBlKSA+IDBcbiAgICApIHtcbiAgICAgIHRoaXMuZW1pdChyZXF1ZXN0VHlwZSwgcmVzcG9uc2UuYm9keS5kYXRhLCByZXNwb25zZS5yZXF1ZXN0SGVhZGVyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgcGVuZGluZ1JlcXVlc3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQoXG4gICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RJZFxuICAgICk7XG4gICAgaWYgKHBlbmRpbmdSZXF1ZXN0KSB7XG4gICAgICBwZW5kaW5nUmVxdWVzdChyZXNwb25zZSk7XG4gICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0SWQpO1xuICAgIH1cbiAgfVxuXG4gIC8vIE1ldGhvZCB0byByZWdpc3RlciBoYW5kbGVycyBmb3IgaW5jb21pbmcgcmVxdWVzdHNcbiAgcHVibGljIHJlZ2lzdGVySGFuZGxlcjxULCBSPihcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGhhbmRsZXI6IChwYXlsb2FkOiBULCByZXF1ZXN0SGVhZGVyOiBJUmVxdWVzdEhlYWRlcikgPT4gUHJvbWlzZTxSPiB8IFJcbiAgKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVxdWVzdEhhbmRsZXJzLmhhcyhyZXF1ZXN0VHlwZSkpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEhhbmRsZXIgYWxyZWFkeSByZWdpc3RlcmVkIGZvciByZXF1ZXN0VHlwZTogJHtyZXF1ZXN0VHlwZX1gXG4gICAgICApO1xuICAgIH1cblxuICAgIHRoaXMucmVxdWVzdEhhbmRsZXJzLnNldChyZXF1ZXN0VHlwZSwgaGFuZGxlcik7XG5cbiAgICAvLyBTZXQgdXAgdGhlIGV2ZW50IGxpc3RlbmVyIHRoYXQgZW5zdXJlcyByZXNwb25zZXMgZ28gYmFjayB0aHJvdWdoIFdlYlNvY2tldFxuICAgIHRoaXMub24ocmVxdWVzdFR5cGUsIGFzeW5jIChwYXlsb2FkOiBULCByZXF1ZXN0SGVhZGVyOiBJUmVxdWVzdEhlYWRlcikgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgaGFuZGxlcihwYXlsb2FkLCByZXF1ZXN0SGVhZGVyKTtcbiAgICAgICAgaWYgKCFyZXF1ZXN0SGVhZGVyLnJlcXVpcmVzUmVzcG9uc2UpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgcmVzcG9uc2U6IElSZXNwb25zZTxSPiA9IHtcbiAgICAgICAgICByZXF1ZXN0SGVhZGVyLFxuICAgICAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgICAgICByZXNwb25kZXJBZGRyZXNzOiBcIlJlcXVlc3RNYW5hZ2VyXCIsXG4gICAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICBib2R5OiB7XG4gICAgICAgICAgICBkYXRhOiByZXN1bHQsXG4gICAgICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICAgICAgZXJyb3I6IG51bGwsXG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVzcG9uc2UpKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGlmICghcmVxdWVzdEhlYWRlci5yZXF1aXJlc1Jlc3BvbnNlKSB7XG4gICAgICAgICAgdGhpcy5sb2dnZXIud2FybihcbiAgICAgICAgICAgIGBSZXF1ZXN0IGVycm9yIG5vdCBzZW50LiBObyByZXNwb25zZSByZXF1aXJlZCBmb3IgcmVxdWVzdFR5cGU6ICR7cmVxdWVzdFR5cGV9YCxcbiAgICAgICAgICAgIGVycm9yXG4gICAgICAgICAgKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZXJyb3JSZXNwb25zZTogSVJlc3BvbnNlPG51bGw+ID0ge1xuICAgICAgICAgIHJlcXVlc3RIZWFkZXIsXG4gICAgICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgICAgIHJlc3BvbmRlckFkZHJlc3M6IFwiUmVxdWVzdE1hbmFnZXJcIixcbiAgICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJvZHk6IHtcbiAgICAgICAgICAgIGRhdGE6IG51bGwsXG4gICAgICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgICAgIGVycm9yOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSksXG4gICAgICAgICAgfSxcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLnNlbmQoSlNPTi5zdHJpbmdpZnkoZXJyb3JSZXNwb25zZSkpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gTWV0aG9kIHRvIHJlbW92ZSBoYW5kbGVyc1xuICBwdWJsaWMgcmVtb3ZlSGFuZGxlcihyZXF1ZXN0VHlwZTogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5yZXF1ZXN0SGFuZGxlcnMuZGVsZXRlKHJlcXVlc3RUeXBlKTtcbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycyhyZXF1ZXN0VHlwZSk7XG4gIH1cblxuICBwdWJsaWMgc2V0QXV0aFRva2VuKHRva2VuOiBzdHJpbmcpIHtcbiAgICB0aGlzLmF1dGhUb2tlbiA9IHRva2VuO1xuICB9XG5cbiAgcHVibGljIGNsZWFyQXV0aFRva2VuKCkge1xuICAgIHRoaXMuYXV0aFRva2VuID0gdW5kZWZpbmVkO1xuICB9XG5cbiAgcHVibGljIGNsZWFyU3RhdGUoKTogdm9pZCB7XG4gICAgLy8gQ2xlYXIgcGVuZGluZyByZXF1ZXN0cyBidXQga2VlcCB0aGUgbWFuYWdlciBhbGl2ZVxuICAgIGZvciAoY29uc3QgW3JlcXVlc3RJZF0gb2YgdGhpcy5wZW5kaW5nUmVxdWVzdHMpIHtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgIH1cbiAgICB0aGlzLmNsZWFyQXV0aFRva2VuKCk7XG4gIH1cblxuICBwdWJsaWMgZGVzdHJveSgpOiB2b2lkIHtcbiAgICAvLyBDbGVhciB0aW1lb3V0IGZvciBhbnkgcGVuZGluZyByZXF1ZXN0c1xuICAgIGZvciAoY29uc3QgW3JlcXVlc3RJZF0gb2YgdGhpcy5wZW5kaW5nUmVxdWVzdHMpIHtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgIH1cblxuICAgIC8vIFJlbW92ZSBXZWJTb2NrZXQgbWVzc2FnZSBsaXN0ZW5lclxuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5yZW1vdmVMaXN0ZW5lcihcbiAgICAgIFwibWVzc2FnZVwiLFxuICAgICAgdGhpcy5oYW5kbGVNZXNzYWdlLmJpbmQodGhpcylcbiAgICApO1xuXG4gICAgLy8gQ2xlYXIgYWxsIGV2ZW50IGxpc3RlbmVyc1xuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG5cbiAgICAvLyBDbGVhciBhdXRoIHRva2VuXG4gICAgdGhpcy5jbGVhckF1dGhUb2tlbigpO1xuXG4gICAgLy8gQ2xlYXIgcmVmZXJlbmNlc1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlciA9IG51bGwhO1xuICAgIHRoaXMubG9nZ2VyID0gbnVsbCE7XG4gICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMgPSBudWxsITtcbiAgfVxufVxuIl19