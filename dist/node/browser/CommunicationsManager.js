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
            this.webSocketManager = new WebSocketManager_1.WebSocketManager(config.url, config.secure, config.maxReconnectAttempts, config.reconnectInterval);
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
}
exports.CommunicationsManager = CommunicationsManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Jyb3dzZXIvQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGtFQUF5QztBQUN6Qyx5REFBc0Q7QUFDdEQscUVBQWtFO0FBQ2xFLHFEQUFrRDtBQWFsRCxNQUFhLHFCQUFzQixTQUFRLHVCQUFZO0lBS3JELFlBQVksTUFBb0M7UUFDOUMsS0FBSyxFQUFFLENBQUM7UUFIRixXQUFNLEdBQUcsSUFBSSwrQ0FBc0IsRUFBRSxDQUFDO1FBSTVDLElBQUksQ0FBQyxjQUFjLENBQUMsTUFBTSxDQUFDLENBQUM7UUFFNUIsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksbUNBQWdCLENBQzFDLE1BQU0sQ0FBQyxHQUFHLEVBQ1YsTUFBTSxDQUFDLE1BQU0sRUFDYixNQUFNLENBQUMsb0JBQW9CLEVBQzNCLE1BQU0sQ0FBQyxpQkFBaUIsQ0FDekIsQ0FBQztZQUVGLElBQUksQ0FBQyxjQUFjLEdBQUcsSUFBSSwrQkFBYyxDQUFDO2dCQUN2QyxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsZ0JBQWdCO2dCQUN2QyxjQUFjLEVBQUUsTUFBTSxDQUFDLGNBQWM7YUFDdEMsQ0FBQyxDQUFDO1lBRUgsSUFBSSxDQUFDLG1CQUFtQixFQUFFLENBQUM7UUFDN0IsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQywwQ0FBMEMsRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDekUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO1FBQ2hFLENBQUM7SUFDSCxDQUFDO0lBRU8sbUJBQW1CO1FBQ3pCLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQ3RCLDZCQUE2QixFQUM3QixJQUFJLENBQUMsaUNBQWlDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUNsRCxDQUFDO0lBQ0osQ0FBQztJQUVNLE1BQU0sQ0FBQyxRQUFvQjtRQUNoQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyw0QkFBNEIsQ0FBQyxDQUFDO1FBQy9DLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQzdDLENBQUM7SUFFTSxPQUFPLENBQUMsUUFBcUM7UUFDbEQsSUFBSSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsNkJBQTZCLENBQUMsQ0FBQztRQUNoRCxJQUFJLENBQUMsZ0JBQWdCLENBQUMsRUFBRSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBRU0sT0FBTyxDQUFDLFFBQWdDO1FBQzdDLElBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLDZCQUE2QixDQUFDLENBQUM7UUFDaEQsSUFBSSxDQUFDLGdCQUFnQixDQUFDLEVBQUUsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLENBQUM7SUFDOUMsQ0FBQztJQUVNLFNBQVMsQ0FBQyxRQUFnQztRQUMvQyxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQywrQkFBK0IsQ0FBQyxDQUFDO1FBQ2xELElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLFFBQVEsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFTyxpQ0FBaUM7UUFDdkMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQ2YsK0VBQStFLENBQ2hGLENBQUM7SUFDSixDQUFDO0lBRU8sY0FBYyxDQUFDLE1BQW9DO1FBQ3pELElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLENBQUM7WUFDaEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxzQ0FBc0MsQ0FBQyxDQUFDO1FBQzFELENBQUM7SUFDSCxDQUFDO0lBRU0sS0FBSyxDQUFDLE9BQU8sQ0FDbEIsV0FBbUIsRUFDbkIsSUFBTyxFQUNQLEVBQVc7UUFFWCxJQUFJLENBQUM7WUFDSCxPQUFPLElBQUksQ0FBQyxjQUFjLENBQUMsT0FBTyxDQUFDLFdBQVcsRUFBRSxJQUFJLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDNUQsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsRUFBRSxFQUFFLFdBQVcsRUFBRSxLQUFLLEVBQUUsQ0FBQyxDQUFDO1lBQ2xFLE1BQU0sS0FBSyxDQUFDO1FBQ2QsQ0FBQztJQUNILENBQUM7SUFFTSxzQkFBc0IsQ0FDM0IsV0FBbUIsRUFDbkIsT0FBNEI7UUFFNUIsSUFBSSxDQUFDLGNBQWMsQ0FBQyxFQUFFLENBQUMsV0FBVyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0lBQy9DLENBQUM7Q0FDRjtBQXZGRCxzREF1RkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCJldmVudGVtaXR0ZXIzXCI7XG5pbXBvcnQgeyBXZWJTb2NrZXRNYW5hZ2VyIH0gZnJvbSBcIi4vV2ViU29ja2V0TWFuYWdlclwiO1xuaW1wb3J0IHsgQnJvd3NlckNvbnNvbGVTdHJhdGVneSB9IGZyb20gXCIuL0Jyb3dzZXJDb25zb2xlU3RyYXRlZ3lcIjtcbmltcG9ydCB7IFJlcXVlc3RNYW5hZ2VyIH0gZnJvbSBcIi4vUmVxdWVzdE1hbmFnZXJcIjtcbmltcG9ydCB7IElSZXNwb25zZURhdGEgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIElDb21tdW5pY2F0aW9uc01hbmFnZXJDb25maWcge1xuICB1cmw6IHN0cmluZztcbiAgc2VjdXJlPzogYm9vbGVhbjtcbiAgYXV0aFRva2VuPzogc3RyaW5nO1xuICBtYXhSZWNvbm5lY3RBdHRlbXB0cz86IG51bWJlcjtcbiAgcmVjb25uZWN0SW50ZXJ2YWw/OiBudW1iZXI7XG4gIGhlYXJ0YmVhdEludGVydmFsPzogbnVtYmVyO1xuICByZXF1ZXN0VGltZW91dD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGNsYXNzIENvbW11bmljYXRpb25zTWFuYWdlciBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIHByaXZhdGUgd2ViU29ja2V0TWFuYWdlcjogV2ViU29ja2V0TWFuYWdlcjtcbiAgcHJpdmF0ZSByZXF1ZXN0TWFuYWdlcjogUmVxdWVzdE1hbmFnZXI7XG4gIHByaXZhdGUgbG9nZ2VyID0gbmV3IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3koKTtcblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IElDb21tdW5pY2F0aW9uc01hbmFnZXJDb25maWcpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMudmFsaWRhdGVDb25maWcoY29uZmlnKTtcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIgPSBuZXcgV2ViU29ja2V0TWFuYWdlcihcbiAgICAgICAgY29uZmlnLnVybCxcbiAgICAgICAgY29uZmlnLnNlY3VyZSxcbiAgICAgICAgY29uZmlnLm1heFJlY29ubmVjdEF0dGVtcHRzLFxuICAgICAgICBjb25maWcucmVjb25uZWN0SW50ZXJ2YWxcbiAgICAgICk7XG5cbiAgICAgIHRoaXMucmVxdWVzdE1hbmFnZXIgPSBuZXcgUmVxdWVzdE1hbmFnZXIoe1xuICAgICAgICB3ZWJTb2NrZXRNYW5hZ2VyOiB0aGlzLndlYlNvY2tldE1hbmFnZXIsXG4gICAgICAgIHJlcXVlc3RUaW1lb3V0OiBjb25maWcucmVxdWVzdFRpbWVvdXQsXG4gICAgICB9KTtcblxuICAgICAgdGhpcy5zZXR1cFdlYlNvY2tldEhvb2tzKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiRXJyb3IgaW5pdGlhbGl6aW5nIENvbW11bmljYXRpb25zTWFuYWdlclwiLCB7IGVycm9yIH0pO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGluaXRpYWxpemUgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRIb29rcygpIHtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXG4gICAgICBcIm1heFJlY29ubmVjdEF0dGVtcHRzUmVhY2hlZFwiLFxuICAgICAgdGhpcy5oYW5kbGVNYXhSZWNvbm5lY3RBdHRlbXB0c1JlYWNoZWQuYmluZCh0aGlzKVxuICAgICk7XG4gIH1cblxuICBwdWJsaWMgb25PcGVuKGNhbGxiYWNrOiAoKSA9PiB2b2lkKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIm9uT3BlbiBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcIm9wZW5cIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHVibGljIG9uQ2xvc2UoY2FsbGJhY2s6IChldmVudDogQ2xvc2VFdmVudCkgPT4gdm9pZCkge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJvbkNsb3NlIGNhbGxiYWNrIHJlZ2lzdGVyZWRcIik7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLm9uKFwiY2xvc2VcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHVibGljIG9uRXJyb3IoY2FsbGJhY2s6IChlcnJvcjogRXZlbnQpID0+IHZvaWQpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwib25FcnJvciBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcImVycm9yXCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHB1YmxpYyBvbk1lc3NhZ2UoY2FsbGJhY2s6IChkYXRhOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwib25NZXNzYWdlIGNhbGxiYWNrIHJlZ2lzdGVyZWRcIik7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLm9uKFwibWVzc2FnZVwiLCBjYWxsYmFjayk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZU1heFJlY29ubmVjdEF0dGVtcHRzUmVhY2hlZCgpIHtcbiAgICB0aGlzLmxvZ2dlci5lcnJvcihcbiAgICAgIFwiTWF4aW11bSByZWNvbm5lY3Rpb24gYXR0ZW1wdHMgcmVhY2hlZC4gVG8gdHJ5IGFnYWluLCBwbGVhc2UgcmVmcmVzaCB0aGUgcGFnZS5cIlxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlQ29uZmlnKGNvbmZpZzogSUNvbW11bmljYXRpb25zTWFuYWdlckNvbmZpZyk6IHZvaWQge1xuICAgIGlmICghY29uZmlnLnVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVVJMIGlzIHJlcXVpcmVkIGluIHRoZSBjb25maWd1cmF0aW9uXCIpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyByZXF1ZXN0PEksIE8+KFxuICAgIHJlcXVlc3RUeXBlOiBzdHJpbmcsXG4gICAgYm9keTogSSxcbiAgICB0bz86IHN0cmluZ1xuICApOiBQcm9taXNlPElSZXNwb25zZURhdGE8Tz4+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdE1hbmFnZXIucmVxdWVzdChyZXF1ZXN0VHlwZSwgYm9keSwgdG8pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkVycm9yIG1ha2luZyByZXF1ZXN0XCIsIHsgcmVxdWVzdFR5cGUsIGVycm9yIH0pO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIoXG4gICAgbWVzc2FnZVR5cGU6IHN0cmluZyxcbiAgICBoYW5kbGVyOiAoZGF0YTogYW55KSA9PiB2b2lkXG4gICkge1xuICAgIHRoaXMucmVxdWVzdE1hbmFnZXIub24obWVzc2FnZVR5cGUsIGhhbmRsZXIpO1xuICB9XG59XG4iXX0=