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
    handleIncomingRequest(request) {
        const { requestType } = request.header;
        if (requestType && this.listenerCount(requestType) > 0) {
            this.emit(requestType, request.body, (responseBody) => {
                const response = {
                    requestHeader: request.header,
                    responseHeader: {
                        responderAddress: "RequestManager",
                        timestamp: Date.now(),
                    },
                    body: {
                        data: responseBody,
                        success: true,
                        error: null,
                    },
                };
                this.webSocketManager.send(JSON.stringify(response));
            });
        }
        else {
            this.logger.warn(`No handlers registered for requestType: ${requestType}`);
        }
    }
    handleResponse(response) {
        const pendingRequest = this.pendingRequests.get(response.requestHeader.requestId);
        if (pendingRequest) {
            pendingRequest(response);
            this.pendingRequests.delete(response.requestHeader.requestId);
        }
    }
    setAuthToken(token) {
        this.authToken = token;
    }
    clearAuthToken() {
        this.authToken = undefined;
    }
}
exports.RequestManager = RequestManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmVxdWVzdE1hbmFnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvYnJvd3Nlci9SZXF1ZXN0TWFuYWdlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSwrQkFBb0M7QUFFcEMsa0VBQXlDO0FBRXpDLHFFQUFrRTtBQU9sRSxNQUFhLGNBQWUsU0FBUSx1QkFBWTtJQVE5QyxZQUFZLEtBQTBCO1FBQ3BDLEtBQUssRUFBRSxDQUFDO1FBUEYsb0JBQWUsR0FDckIsSUFBSSxHQUFHLEVBQUUsQ0FBQztRQU9WLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSwrQ0FBc0IsRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxjQUFjLEdBQUcsS0FBSyxDQUFDLGNBQWMsSUFBSSxLQUFLLENBQUM7UUFDcEQsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEtBQUssQ0FBQyxnQkFBZ0IsQ0FBQztRQUMvQyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7SUFFTSxLQUFLLENBQUMsT0FBTyxDQUNsQixXQUFtQixFQUNuQixJQUFPLEVBQ1AsRUFBVztRQUVYLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxFQUFFLEVBQUU7WUFDckMsTUFBTSxPQUFPLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBSSxXQUFXLEVBQUUsSUFBSSxFQUFFLEVBQUUsQ0FBQyxDQUFDO1lBQzdELE1BQU0sU0FBUyxHQUFHLFVBQVUsQ0FBQyxHQUFHLEVBQUU7Z0JBQ2hDLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQ3RELE1BQU0sQ0FBQyxJQUFJLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDLENBQUM7WUFDdkMsQ0FB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QUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7WUFDdkQsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUNkLDJDQUEyQyxXQUFXLEVBQUUsQ0FDekQsQ0FBQztRQUNKLENBQUM7SUFDSCxDQUFDO0lBRU8sY0FBYyxDQUFJLFFBQXNCO1FBQzlDLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUM3QyxRQUFRLENBQUMsYUFBYSxDQUFDLFNBQVMsQ0FDakMsQ0FBQztRQUNGLElBQUksY0FBYyxFQUFFLENBQUM7WUFDbkIsY0FBYyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQ3pCLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxhQUFhLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDaEUsQ0FBQztJQUNILENBQUM7SUFFTSxZQUFZLENBQUMsS0FBYTtRQUMvQixJQUFJLENBQUMsU0FBUyxHQUFHLEtBQUssQ0FBQztJQUN6QixDQUFDO0lBRU0sY0FBYztRQUNuQixJQUFJLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztJQUM3QixDQUFDO0NBQ0Y7QUFySEQsd0NBcUhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSBcInV1aWRcIjtcbmltcG9ydCB7IElSZXF1ZXN0LCBJUmVzcG9uc2UsIElSZXNwb25zZURhdGEgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiZXZlbnRlbWl0dGVyM1wiO1xuaW1wb3J0IHsgV2ViU29ja2V0TWFuYWdlciB9IGZyb20gXCIuL1dlYlNvY2tldE1hbmFnZXJcIjtcbmltcG9ydCB7IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3kgfSBmcm9tIFwiLi9Ccm93c2VyQ29uc29sZVN0cmF0ZWd5XCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVxdWVzdE1hbmFnZXJQcm9wcyB7XG4gIHdlYlNvY2tldE1hbmFnZXI6IFdlYlNvY2tldE1hbmFnZXI7XG4gIHJlcXVlc3RUaW1lb3V0PzogbnVtYmVyO1xufVxuXG5leHBvcnQgY2xhc3MgUmVxdWVzdE1hbmFnZXIgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBwcml2YXRlIGxvZ2dlcjogQnJvd3NlckNvbnNvbGVTdHJhdGVneTtcbiAgcHJpdmF0ZSBwZW5kaW5nUmVxdWVzdHM6IE1hcDxzdHJpbmcsIChyZXNwb25zZTogSVJlc3BvbnNlPGFueT4pID0+IHZvaWQ+ID1cbiAgICBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcmVxdWVzdFRpbWVvdXQ6IG51bWJlcjtcbiAgcHJpdmF0ZSB3ZWJTb2NrZXRNYW5hZ2VyOiBXZWJTb2NrZXRNYW5hZ2VyO1xuICBwcml2YXRlIGF1dGhUb2tlbjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKHByb3BzOiBSZXF1ZXN0TWFuYWdlclByb3BzKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLmxvZ2dlciA9IG5ldyBCcm93c2VyQ29uc29sZVN0cmF0ZWd5KCk7XG4gICAgdGhpcy5yZXF1ZXN0VGltZW91dCA9IHByb3BzLnJlcXVlc3RUaW1lb3V0IHx8IDMwMDAwO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlciA9IHByb3BzLndlYlNvY2tldE1hbmFnZXI7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLm9uKFwibWVzc2FnZVwiLCB0aGlzLmhhbmRsZU1lc3NhZ2UuYmluZCh0aGlzKSk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVxdWVzdDxJLCBPPihcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IEksXG4gICAgdG8/OiBzdHJpbmdcbiAgKTogUHJvbWlzZTxJUmVzcG9uc2VEYXRhPE8+PiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3QgPSB0aGlzLmNyZWF0ZVJlcXVlc3Q8ST4ocmVxdWVzdFR5cGUsIGJvZHksIHRvKTtcbiAgICAgIGNvbnN0IHRpbWVvdXRJZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdC5oZWFkZXIucmVxdWVzdElkKTtcbiAgICAgICAgcmVqZWN0KG5ldyBFcnJvcihcIlJlcXVlc3QgdGltZW91dFwiKSk7XG4gICAgICB9LCB0aGlzLnJlcXVlc3RUaW1lb3V0KTtcblxuICAgICAgY29uc3QgcmVxdWVzdENhbGxiYWNrID0gKHJlc3BvbnNlOiBJUmVzcG9uc2U8Tz4pID0+IHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXRJZCk7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWQpO1xuICAgICAgICBpZiAocmVzcG9uc2UuYm9keS5zdWNjZXNzKSB7XG4gICAgICAgICAgcmVzb2x2ZShyZXNwb25zZS5ib2R5KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZWplY3QocmVzcG9uc2UuYm9keS5lcnJvciB8fCByZXNwb25zZS5ib2R5LmRhdGEpO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5zZXQocmVxdWVzdC5oZWFkZXIucmVxdWVzdElkLCByZXF1ZXN0Q2FsbGJhY2spO1xuICAgICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLnNlbmQoSlNPTi5zdHJpbmdpZnkocmVxdWVzdCkpO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBjcmVhdGVSZXF1ZXN0PFQ+KFxuICAgIHJlcXVlc3RUeXBlOiBzdHJpbmcsXG4gICAgYm9keTogVCxcbiAgICB0bz86IHN0cmluZ1xuICApOiBJUmVxdWVzdDxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZDogYFJNLSR7dXVpZHY0KCl9YCxcbiAgICAgICAgcmVxdWVzdGVyQWRkcmVzczogXCJSZXF1ZXN0TWFuYWdlclwiLFxuICAgICAgICByZWNpcGllbnRBZGRyZXNzOiB0byxcbiAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgIGF1dGhUb2tlbjogdGhpcy5hdXRoVG9rZW4sXG4gICAgICB9LFxuICAgICAgYm9keSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVNZXNzYWdlKHBhcnNlZDogYW55KSB7XG4gICAgdHJ5IHtcbiAgICAgIGlmIChwYXJzZWQuaGVhZGVyICYmIHBhcnNlZC5oZWFkZXIucmVxdWVzdFR5cGUpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVJbmNvbWluZ1JlcXVlc3QocGFyc2VkKTtcbiAgICAgIH0gZWxzZSBpZiAocGFyc2VkLnJlcXVlc3RIZWFkZXIpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVSZXNwb25zZShwYXJzZWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5sb2dnZXIud2FybihcIlJlY2VpdmVkIG1lc3NhZ2Ugd2l0aCB1bmtub3duIHN0cnVjdHVyZTpcIiwgcGFyc2VkKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoXCJFcnJvciBwYXJzaW5nIG1lc3NhZ2U6XCIsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZUluY29taW5nUmVxdWVzdChyZXF1ZXN0OiBJUmVxdWVzdDxhbnk+KSB7XG4gICAgY29uc3QgeyByZXF1ZXN0VHlwZSB9ID0gcmVxdWVzdC5oZWFkZXI7XG4gICAgaWYgKHJlcXVlc3RUeXBlICYmIHRoaXMubGlzdGVuZXJDb3VudChyZXF1ZXN0VHlwZSkgPiAwKSB7XG4gICAgICB0aGlzLmVtaXQocmVxdWVzdFR5cGUsIHJlcXVlc3QuYm9keSwgKHJlc3BvbnNlQm9keTogYW55KSA9PiB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlOiBJUmVzcG9uc2U8YW55PiA9IHtcbiAgICAgICAgICByZXF1ZXN0SGVhZGVyOiByZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgICByZXNwb25zZUhlYWRlcjoge1xuICAgICAgICAgICAgcmVzcG9uZGVyQWRkcmVzczogXCJSZXF1ZXN0TWFuYWdlclwiLFxuICAgICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgIH0sXG4gICAgICAgICAgYm9keToge1xuICAgICAgICAgICAgZGF0YTogcmVzcG9uc2VCb2R5LFxuICAgICAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgICAgIGVycm9yOiBudWxsLFxuICAgICAgICAgIH0sXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5zZW5kKEpTT04uc3RyaW5naWZ5KHJlc3BvbnNlKSk7XG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIud2FybihcbiAgICAgICAgYE5vIGhhbmRsZXJzIHJlZ2lzdGVyZWQgZm9yIHJlcXVlc3RUeXBlOiAke3JlcXVlc3RUeXBlfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVSZXNwb25zZTxUPihyZXNwb25zZTogSVJlc3BvbnNlPFQ+KSB7XG4gICAgY29uc3QgcGVuZGluZ1JlcXVlc3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQoXG4gICAgICByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RJZFxuICAgICk7XG4gICAgaWYgKHBlbmRpbmdSZXF1ZXN0KSB7XG4gICAgICBwZW5kaW5nUmVxdWVzdChyZXNwb25zZSk7XG4gICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0SWQpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBzZXRBdXRoVG9rZW4odG9rZW46IHN0cmluZykge1xuICAgIHRoaXMuYXV0aFRva2VuID0gdG9rZW47XG4gIH1cblxuICBwdWJsaWMgY2xlYXJBdXRoVG9rZW4oKSB7XG4gICAgdGhpcy5hdXRoVG9rZW4gPSB1bmRlZmluZWQ7XG4gIH1cbn1cbiJdfQ==