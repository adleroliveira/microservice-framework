"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunicationsManager = void 0;
const eventemitter3_1 = __importDefault(require("eventemitter3"));
const WebSocketManager_1 = require("./WebSocketManager");
const BrowserConsoleStrategy_1 = require("./BrowserConsoleStrategy");
const RequestManager_1 = require("./RequestManager");
class CommunicationsManager extends eventemitter3_1.default {
    constructor(config) {
        super();
        this.logger = new BrowserConsoleStrategy_1.BrowserConsoleStrategy();
        this.validateConfig(config);
        try {
            this.webSocketManager = new WebSocketManager_1.WebSocketManager({
                url: config.url,
                secure: config.secure,
                auth: config.auth,
                maxReconnectAttempts: config.maxReconnectAttempts,
                reconnectInterval: config.reconnectInterval,
            });
            this.requestManager = new RequestManager_1.RequestManager({
                webSocketManager: this.webSocketManager,
                requestTimeout: config.requestTimeout,
            });
            this.setupWebSocketHooks();
        }
        catch (error) {
            this.logger.error("Error initializing CommunicationsManager", { error });
            throw new Error("Failed to initialize CommunicationsManager");
        }
    }
    setupWebSocketHooks() {
        this.webSocketManager.on("maxReconnectAttemptsReached", this.handleMaxReconnectAttemptsReached.bind(this));
        this.webSocketManager.on("authError", (error) => {
            this.logger.error("Authentication error", error);
            this.emit("authError", error);
        });
    }
    onOpen(callback) {
        this.logger.info("onOpen callback registered");
        this.webSocketManager.on("open", callback);
    }
    onClose(callback) {
        this.logger.info("onClose callback registered");
        this.webSocketManager.on("close", callback);
    }
    onError(callback) {
        this.logger.info("onError callback registered");
        this.webSocketManager.on("error", callback);
    }
    onMessage(callback) {
        this.logger.info("onMessage callback registered");
        this.webSocketManager.on("message", callback);
    }
    handleMaxReconnectAttemptsReached() {
        this.logger.error("Maximum reconnection attempts reached. To try again, please refresh the page.");
    }
    validateConfig(config) {
        if (!config.url) {
            throw new Error("URL is required in the configuration");
        }
    }
    async request(requestType, body, to) {
        try {
            return this.requestManager.request(requestType, body, to);
        }
        catch (error) {
            this.logger.error("Error making request", { requestType, error });
            throw error;
        }
    }
    registerMessageHandler(messageType, handler) {
        this.requestManager.on(messageType, handler);
    }
    getConnectionState() {
        return this.webSocketManager.getState();
    }
    updateAuthentication(auth) {
        this.webSocketManager.reconnectWithNewAuth(auth);
    }
    isAuthenticated() {
        return this.webSocketManager.isAuthenticated();
    }
}
exports.CommunicationsManager = CommunicationsManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Jyb3dzZXIvQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGtFQUF5QztBQUN6Qyx5REFLNEI7QUFDNUIscUVBQWtFO0FBQ2xFLHFEQUFrRDtBQW9CbEQsTUFBYSxxQkFBc0IsU0FBUSx1QkFBWTtJQUtyRCxZQUFZLE1BQW9DO1FBQzlDLEtBQUssRUFBRSxDQUFDO1FBSEYsV0FBTSxHQUFHLElBQUksK0NBQXNCLEVBQUUsQ0FBQztRQUk1QyxJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVCLElBQUksQ0FBQztZQUNILElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLG1DQUFnQixDQUFDO2dCQUMzQyxHQUFHLEVBQUUsTUFBTSxDQUFDLEdBQUc7Z0JBQ2YsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO2dCQUNyQixJQUFJLEVBQUUsTUFBTSxDQUFDLElBQUk7Z0JBQ2pCLG9CQUFvQixFQUFFLE1BQU0sQ0FBQyxvQkFBb0I7Z0JBQ2pELGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxpQkFBaUI7YUFDNUMsQ0FBQyxDQUFDO1lBRUgsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLCtCQUFjLENBQUM7Z0JBQ3ZDLGdCQUFnQixFQUFFLElBQUksQ0FBQyxnQkFBZ0I7Z0JBQ3ZDLGNBQWMsRUFBRSxNQUFNLENBQUMsY0FBYzthQUN0QyxDQUFDLENBQUM7WUFFSCxJQUFJLENBQUMsbUJBQW1CLEVBQUUsQ0FBQztRQUM3QixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUN6RSxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7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Iiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiZXZlbnRlbWl0dGVyM1wiO1xuaW1wb3J0IHtcbiAgV2ViU29ja2V0TWFuYWdlcixcbiAgV2ViU29ja2V0U3RhdGUsXG4gIEF1dGhNZXRob2QsXG4gIElXZWJTb2NrZXRBdXRoQ29uZmlnLFxufSBmcm9tIFwiLi9XZWJTb2NrZXRNYW5hZ2VyXCI7XG5pbXBvcnQgeyBCcm93c2VyQ29uc29sZVN0cmF0ZWd5IH0gZnJvbSBcIi4vQnJvd3NlckNvbnNvbGVTdHJhdGVneVwiO1xuaW1wb3J0IHsgUmVxdWVzdE1hbmFnZXIgfSBmcm9tIFwiLi9SZXF1ZXN0TWFuYWdlclwiO1xuaW1wb3J0IHsgSVJlc3BvbnNlRGF0YSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cbmV4cG9ydCBpbnRlcmZhY2UgSUNvbW11bmljYXRpb25zTWFuYWdlckNvbmZpZyB7XG4gIHVybDogc3RyaW5nO1xuICBzZWN1cmU/OiBib29sZWFuO1xuICBhdXRoPzoge1xuICAgIG1ldGhvZDogQXV0aE1ldGhvZDtcbiAgICB0b2tlbj86IHN0cmluZztcbiAgICBjcmVkZW50aWFscz86IHtcbiAgICAgIHVzZXJuYW1lOiBzdHJpbmc7XG4gICAgICBwYXNzd29yZDogc3RyaW5nO1xuICAgIH07XG4gIH07XG4gIG1heFJlY29ubmVjdEF0dGVtcHRzPzogbnVtYmVyO1xuICByZWNvbm5lY3RJbnRlcnZhbD86IG51bWJlcjtcbiAgaGVhcnRiZWF0SW50ZXJ2YWw/OiBudW1iZXI7XG4gIHJlcXVlc3RUaW1lb3V0PzogbnVtYmVyO1xufVxuXG5leHBvcnQgY2xhc3MgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgcHJpdmF0ZSB3ZWJTb2NrZXRNYW5hZ2VyOiBXZWJTb2NrZXRNYW5hZ2VyO1xuICBwcml2YXRlIHJlcXVlc3RNYW5hZ2VyOiBSZXF1ZXN0TWFuYWdlcjtcbiAgcHJpdmF0ZSBsb2dnZXIgPSBuZXcgQnJvd3NlckNvbnNvbGVTdHJhdGVneSgpO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogSUNvbW11bmljYXRpb25zTWFuYWdlckNvbmZpZykge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy52YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlciA9IG5ldyBXZWJTb2NrZXRNYW5hZ2VyKHtcbiAgICAgICAgdXJsOiBjb25maWcudXJsLFxuICAgICAgICBzZWN1cmU6IGNvbmZpZy5zZWN1cmUsXG4gICAgICAgIGF1dGg6IGNvbmZpZy5hdXRoLFxuICAgICAgICBtYXhSZWNvbm5lY3RBdHRlbXB0czogY29uZmlnLm1heFJlY29ubmVjdEF0dGVtcHRzLFxuICAgICAgICByZWNvbm5lY3RJbnRlcnZhbDogY29uZmlnLnJlY29ubmVjdEludGVydmFsLFxuICAgICAgfSk7XG5cbiAgICAgIHRoaXMucmVxdWVzdE1hbmFnZXIgPSBuZXcgUmVxdWVzdE1hbmFnZXIoe1xuICAgICAgICB3ZWJTb2NrZXRNYW5hZ2VyOiB0aGlzLndlYlNvY2tldE1hbmFnZXIsXG4gICAgICAgIHJlcXVlc3RUaW1lb3V0OiBjb25maWcucmVxdWVzdFRpbWVvdXQsXG4gICAgICB9KTtcblxuICAgICAgdGhpcy5zZXR1cFdlYlNvY2tldEhvb2tzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiRXJyb3IgaW5pdGlhbGl6aW5nIENvbW11bmljYXRpb25zTWFuYWdlclwiLCB7IGVycm9yIH0pO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGluaXRpYWxpemUgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRIb29rcygpIHtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXG4gICAgICBcIm1heFJlY29ubmVjdEF0dGVtcHRzUmVhY2hlZFwiLFxuICAgICAgdGhpcy5oYW5kbGVNYXhSZWNvbm5lY3RBdHRlbXB0c1JlYWNoZWQuYmluZCh0aGlzKVxuICAgICk7XG5cbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXCJhdXRoRXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkF1dGhlbnRpY2F0aW9uIGVycm9yXCIsIGVycm9yKTtcbiAgICAgIHRoaXMuZW1pdChcImF1dGhFcnJvclwiLCBlcnJvcik7XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgb25PcGVuKGNhbGxiYWNrOiAoKSA9PiB2b2lkKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIm9uT3BlbiBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcIm9wZW5cIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHVibGljIG9uQ2xvc2UoY2FsbGJhY2s6IChldmVudDogQ2xvc2VFdmVudCkgPT4gdm9pZCkge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJvbkNsb3NlIGNhbGxiYWNrIHJlZ2lzdGVyZWRcIik7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLm9uKFwiY2xvc2VcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHVibGljIG9uRXJyb3IoY2FsbGJhY2s6IChlcnJvcjogRXZlbnQpID0+IHZvaWQpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwib25FcnJvciBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcImVycm9yXCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHB1YmxpYyBvbk1lc3NhZ2UoY2FsbGJhY2s6IChkYXRhOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwib25NZXNzYWdlIGNhbGxiYWNrIHJlZ2lzdGVyZWRcIik7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLm9uKFwibWVzc2FnZVwiLCBjYWxsYmFjayk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZU1heFJlY29ubmVjdEF0dGVtcHRzUmVhY2hlZCgpIHtcbiAgICB0aGlzLmxvZ2dlci5lcnJvcihcbiAgICAgIFwiTWF4aW11bSByZWNvbm5lY3Rpb24gYXR0ZW1wdHMgcmVhY2hlZC4gVG8gdHJ5IGFnYWluLCBwbGVhc2UgcmVmcmVzaCB0aGUgcGFnZS5cIlxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlQ29uZmlnKGNvbmZpZzogSUNvbW11bmljYXRpb25zTWFuYWdlckNvbmZpZyk6IHZvaWQge1xuICAgIGlmICghY29uZmlnLnVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVVJMIGlzIHJlcXVpcmVkIGluIHRoZSBjb25maWd1cmF0aW9uXCIpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyByZXF1ZXN0PEksIE8+KFxuICAgIHJlcXVlc3RUeXBlOiBzdHJpbmcsXG4gICAgYm9keTogSSxcbiAgICB0bz86IHN0cmluZ1xuICApOiBQcm9taXNlPElSZXNwb25zZURhdGE8Tz4+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdE1hbmFnZXIucmVxdWVzdChyZXF1ZXN0VHlwZSwgYm9keSwgdG8pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkVycm9yIG1ha2luZyByZXF1ZXN0XCIsIHsgcmVxdWVzdFR5cGUsIGVycm9yIH0pO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIoXG4gICAgbWVzc2FnZVR5cGU6IHN0cmluZyxcbiAgICBoYW5kbGVyOiAoZGF0YTogYW55KSA9PiB2b2lkXG4gICkge1xuICAgIHRoaXMucmVxdWVzdE1hbmFnZXIub24obWVzc2FnZVR5cGUsIGhhbmRsZXIpO1xuICB9XG5cbiAgcHVibGljIGdldENvbm5lY3Rpb25TdGF0ZSgpOiBXZWJTb2NrZXRTdGF0ZSB7XG4gICAgcmV0dXJuIHRoaXMud2ViU29ja2V0TWFuYWdlci5nZXRTdGF0ZSgpO1xuICB9XG5cbiAgcHVibGljIHVwZGF0ZUF1dGhlbnRpY2F0aW9uKGF1dGg6IElXZWJTb2NrZXRBdXRoQ29uZmlnKSB7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLnJlY29ubmVjdFdpdGhOZXdBdXRoKGF1dGgpO1xuICB9XG5cbiAgcHVibGljIGlzQXV0aGVudGljYXRlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLmlzQXV0aGVudGljYXRlZCgpO1xuICB9XG59XG4iXX0=