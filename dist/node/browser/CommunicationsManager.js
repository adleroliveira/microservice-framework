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
        this.config = config;
        this.validateConfig(config);
        try {
            this.initializeManagers(config);
        }
        catch (error) {
            this.logger.error("Error initializing CommunicationsManager", { error });
            throw new Error("Failed to initialize CommunicationsManager");
        }
    }
    initializeManagers(config) {
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
    async cleanupCurrentState() {
        // Remove event listeners but keep the manager instances
        this.webSocketManager.removeAllListeners();
        this.requestManager.removeAllListeners();
        // Close current WebSocket connection
        if (this.webSocketManager) {
            await new Promise((resolve) => {
                this.webSocketManager.once("close", () => resolve());
                this.webSocketManager.close();
            });
        }
        // Clear request manager state
        if (this.requestManager) {
            this.requestManager.clearState();
        }
    }
    setupWebSocketHooks() {
        this.webSocketManager.on("maxReconnectAttemptsReached", this.handleMaxReconnectAttemptsReached.bind(this));
        this.webSocketManager.on("authError", (error) => {
            this.logger.error("Authentication error", error);
            this.emit("authError", error);
        });
    }
    async authenticate(authConfig) {
        try {
            await this.cleanupCurrentState();
            // Create new config with authentication
            const newConfig = {
                ...this.config,
                auth: authConfig,
            };
            // Reinitialize with authenticated config
            this.initializeManagers(newConfig);
            this.logger.info("Switched to authenticated mode");
            this.emit("modeChanged", "authenticated");
        }
        catch (error) {
            this.logger.error("Error switching to authenticated mode", error);
            throw error;
        }
    }
    async switchToAnonymous() {
        try {
            // Clear current state but don't destroy everything
            await this.cleanupCurrentState();
            // Create new config for anonymous connection
            const anonymousConfig = {
                ...this.config,
                auth: {
                    method: WebSocketManager_1.AuthMethod.ANONYMOUS,
                },
            };
            // Reinitialize with anonymous config
            this.initializeManagers(anonymousConfig);
            this.logger.info("Switched to anonymous mode");
            this.emit("modeChanged", "anonymous");
        }
        catch (error) {
            this.logger.error("Error switching to anonymous mode", error);
            throw error;
        }
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
    getCurrentMode() {
        return this.config.auth?.method === WebSocketManager_1.AuthMethod.ANONYMOUS
            ? "anonymous"
            : "authenticated";
    }
    destroy() {
        this.removeAllListeners();
        if (this.webSocketManager) {
            this.webSocketManager.destroy();
            this.webSocketManager = null;
        }
        if (this.requestManager) {
            this.requestManager.destroy();
            this.requestManager = null;
        }
        this.logger = null;
        this.config = null;
    }
}
exports.CommunicationsManager = CommunicationsManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Jyb3dzZXIvQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGtFQUF5QztBQUN6Qyx5REFLNEI7QUFDNUIscUVBQWtFO0FBQ2xFLHFEQUFrRDtBQW9CbEQsTUFBYSxxQkFBc0IsU0FBUSx1QkFBWTtJQU1yRCxZQUFZLE1BQW9DO1FBQzlDLEtBQUssRUFBRSxDQUFDO1FBSkYsV0FBTSxHQUFHLElBQUksK0NBQXNCLEVBQUUsQ0FBQztRQUs1QyxJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUNyQixJQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBRTVCLElBQUksQ0FBQztZQUNILElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUNsQyxDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLDBDQUEwQyxFQUFFLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztZQUN6RSxNQUFNLElBQUksS0FBSyxDQUFDLDRDQUE0QyxDQUFDLENBQUM7UUFDaEUsQ0FBQztJQUNILENBQUM7SUFFTyxrQkFBa0IsQ0FBQyxNQUFvQztRQUM3RCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxtQ0FBZ0IsQ0FBQztZQUMzQyxHQUFHLEVBQUUsTUFBTSxDQUFDLEdBQUc7WUFDZixNQUFNLEVBQUUsTUFBTSxDQUFDLE1BQU07WUFDckIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJO1lBQ2pCLG9CQUFvQixFQUFFLE1BQU0sQ0FBQyxvQkFBb0I7WUFDakQsaUJBQWlCLEVBQUUsTUFBTSxDQUFDLGlCQUFpQjtTQUM1QyxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksK0JBQWMsQ0FB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QixDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2hDLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFLLENBQUM7UUFDaEMsQ0FBQztRQUVELElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxDQUFDO1lBQ3hCLElBQUksQ0FBQyxjQUFjLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDOUIsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFLLENBQUM7UUFDOUIsQ0FBQztRQUVELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSyxDQUFDO1FBQ3BCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSyxDQUFDO0lBQ3RCLENBQUM7Q0FDRjtBQXRNRCxzREFzTUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgRXZlbnRFbWl0dGVyIGZyb20gXCJldmVudGVtaXR0ZXIzXCI7XG5pbXBvcnQge1xuICBXZWJTb2NrZXRNYW5hZ2VyLFxuICBXZWJTb2NrZXRTdGF0ZSxcbiAgQXV0aE1ldGhvZCxcbiAgSVdlYlNvY2tldEF1dGhDb25maWcsXG59IGZyb20gXCIuL1dlYlNvY2tldE1hbmFnZXJcIjtcbmltcG9ydCB7IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3kgfSBmcm9tIFwiLi9Ccm93c2VyQ29uc29sZVN0cmF0ZWd5XCI7XG5pbXBvcnQgeyBSZXF1ZXN0TWFuYWdlciB9IGZyb20gXCIuL1JlcXVlc3RNYW5hZ2VyXCI7XG5pbXBvcnQgeyBJUmVzcG9uc2VEYXRhIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuZXhwb3J0IGludGVyZmFjZSBJQ29tbXVuaWNhdGlvbnNNYW5hZ2VyQ29uZmlnIHtcbiAgdXJsOiBzdHJpbmc7XG4gIHNlY3VyZT86IGJvb2xlYW47XG4gIGF1dGg/OiB7XG4gICAgbWV0aG9kOiBBdXRoTWV0aG9kO1xuICAgIHRva2VuPzogc3RyaW5nO1xuICAgIGNyZWRlbnRpYWxzPzoge1xuICAgICAgdXNlcm5hbWU6IHN0cmluZztcbiAgICAgIHBhc3N3b3JkOiBzdHJpbmc7XG4gICAgfTtcbiAgfTtcbiAgbWF4UmVjb25uZWN0QXR0ZW1wdHM/OiBudW1iZXI7XG4gIHJlY29ubmVjdEludGVydmFsPzogbnVtYmVyO1xuICBoZWFydGJlYXRJbnRlcnZhbD86IG51bWJlcjtcbiAgcmVxdWVzdFRpbWVvdXQ/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBDb21tdW5pY2F0aW9uc01hbmFnZXIgZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBwcml2YXRlIHdlYlNvY2tldE1hbmFnZXI6IFdlYlNvY2tldE1hbmFnZXI7XG4gIHByaXZhdGUgcmVxdWVzdE1hbmFnZXI6IFJlcXVlc3RNYW5hZ2VyO1xuICBwcml2YXRlIGxvZ2dlciA9IG5ldyBCcm93c2VyQ29uc29sZVN0cmF0ZWd5KCk7XG4gIHByaXZhdGUgY29uZmlnOiBJQ29tbXVuaWNhdGlvbnNNYW5hZ2VyQ29uZmlnO1xuXG4gIGNvbnN0cnVjdG9yKGNvbmZpZzogSUNvbW11bmljYXRpb25zTWFuYWdlckNvbmZpZykge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5jb25maWcgPSBjb25maWc7XG4gICAgdGhpcy52YWxpZGF0ZUNvbmZpZyhjb25maWcpO1xuXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZU1hbmFnZXJzKGNvbmZpZyk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiRXJyb3IgaW5pdGlhbGl6aW5nIENvbW11bmljYXRpb25zTWFuYWdlclwiLCB7IGVycm9yIH0pO1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiRmFpbGVkIHRvIGluaXRpYWxpemUgQ29tbXVuaWNhdGlvbnNNYW5hZ2VyXCIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaW5pdGlhbGl6ZU1hbmFnZXJzKGNvbmZpZzogSUNvbW11bmljYXRpb25zTWFuYWdlckNvbmZpZykge1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlciA9IG5ldyBXZWJTb2NrZXRNYW5hZ2VyKHtcbiAgICAgIHVybDogY29uZmlnLnVybCxcbiAgICAgIHNlY3VyZTogY29uZmlnLnNlY3VyZSxcbiAgICAgIGF1dGg6IGNvbmZpZy5hdXRoLFxuICAgICAgbWF4UmVjb25uZWN0QXR0ZW1wdHM6IGNvbmZpZy5tYXhSZWNvbm5lY3RBdHRlbXB0cyxcbiAgICAgIHJlY29ubmVjdEludGVydmFsOiBjb25maWcucmVjb25uZWN0SW50ZXJ2YWwsXG4gICAgfSk7XG5cbiAgICB0aGlzLnJlcXVlc3RNYW5hZ2VyID0gbmV3IFJlcXVlc3RNYW5hZ2VyKHtcbiAgICAgIHdlYlNvY2tldE1hbmFnZXI6IHRoaXMud2ViU29ja2V0TWFuYWdlcixcbiAgICAgIHJlcXVlc3RUaW1lb3V0OiBjb25maWcucmVxdWVzdFRpbWVvdXQsXG4gICAgfSk7XG5cbiAgICB0aGlzLnNldHVwV2ViU29ja2V0SG9va3MoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgY2xlYW51cEN1cnJlbnRTdGF0ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBSZW1vdmUgZXZlbnQgbGlzdGVuZXJzIGJ1dCBrZWVwIHRoZSBtYW5hZ2VyIGluc3RhbmNlc1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICB0aGlzLnJlcXVlc3RNYW5hZ2VyLnJlbW92ZUFsbExpc3RlbmVycygpO1xuXG4gICAgLy8gQ2xvc2UgY3VycmVudCBXZWJTb2NrZXQgY29ubmVjdGlvblxuICAgIGlmICh0aGlzLndlYlNvY2tldE1hbmFnZXIpIHtcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbmNlKFwiY2xvc2VcIiwgKCkgPT4gcmVzb2x2ZSgpKTtcbiAgICAgICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLmNsb3NlKCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICAvLyBDbGVhciByZXF1ZXN0IG1hbmFnZXIgc3RhdGVcbiAgICBpZiAodGhpcy5yZXF1ZXN0TWFuYWdlcikge1xuICAgICAgdGhpcy5yZXF1ZXN0TWFuYWdlci5jbGVhclN0YXRlKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzZXR1cFdlYlNvY2tldEhvb2tzKCkge1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcbiAgICAgIFwibWF4UmVjb25uZWN0QXR0ZW1wdHNSZWFjaGVkXCIsXG4gICAgICB0aGlzLmhhbmRsZU1heFJlY29ubmVjdEF0dGVtcHRzUmVhY2hlZC5iaW5kKHRoaXMpXG4gICAgKTtcblxuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcImF1dGhFcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiQXV0aGVudGljYXRpb24gZXJyb3JcIiwgZXJyb3IpO1xuICAgICAgdGhpcy5lbWl0KFwiYXV0aEVycm9yXCIsIGVycm9yKTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBhdXRoZW50aWNhdGUoYXV0aENvbmZpZzogSVdlYlNvY2tldEF1dGhDb25maWcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwQ3VycmVudFN0YXRlKCk7XG5cbiAgICAgIC8vIENyZWF0ZSBuZXcgY29uZmlnIHdpdGggYXV0aGVudGljYXRpb25cbiAgICAgIGNvbnN0IG5ld0NvbmZpZyA9IHtcbiAgICAgICAgLi4udGhpcy5jb25maWcsXG4gICAgICAgIGF1dGg6IGF1dGhDb25maWcsXG4gICAgICB9O1xuXG4gICAgICAvLyBSZWluaXRpYWxpemUgd2l0aCBhdXRoZW50aWNhdGVkIGNvbmZpZ1xuICAgICAgdGhpcy5pbml0aWFsaXplTWFuYWdlcnMobmV3Q29uZmlnKTtcblxuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhcIlN3aXRjaGVkIHRvIGF1dGhlbnRpY2F0ZWQgbW9kZVwiKTtcbiAgICAgIHRoaXMuZW1pdChcIm1vZGVDaGFuZ2VkXCIsIFwiYXV0aGVudGljYXRlZFwiKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoXCJFcnJvciBzd2l0Y2hpbmcgdG8gYXV0aGVudGljYXRlZCBtb2RlXCIsIGVycm9yKTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzd2l0Y2hUb0Fub255bW91cygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gQ2xlYXIgY3VycmVudCBzdGF0ZSBidXQgZG9uJ3QgZGVzdHJveSBldmVyeXRoaW5nXG4gICAgICBhd2FpdCB0aGlzLmNsZWFudXBDdXJyZW50U3RhdGUoKTtcblxuICAgICAgLy8gQ3JlYXRlIG5ldyBjb25maWcgZm9yIGFub255bW91cyBjb25uZWN0aW9uXG4gICAgICBjb25zdCBhbm9ueW1vdXNDb25maWcgPSB7XG4gICAgICAgIC4uLnRoaXMuY29uZmlnLFxuICAgICAgICBhdXRoOiB7XG4gICAgICAgICAgbWV0aG9kOiBBdXRoTWV0aG9kLkFOT05ZTU9VUyxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIC8vIFJlaW5pdGlhbGl6ZSB3aXRoIGFub255bW91cyBjb25maWdcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZU1hbmFnZXJzKGFub255bW91c0NvbmZpZyk7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJTd2l0Y2hlZCB0byBhbm9ueW1vdXMgbW9kZVwiKTtcbiAgICAgIHRoaXMuZW1pdChcIm1vZGVDaGFuZ2VkXCIsIFwiYW5vbnltb3VzXCIpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkVycm9yIHN3aXRjaGluZyB0byBhbm9ueW1vdXMgbW9kZVwiLCBlcnJvcik7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgb25PcGVuKGNhbGxiYWNrOiAoKSA9PiB2b2lkKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIm9uT3BlbiBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcIm9wZW5cIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHVibGljIG9uQ2xvc2UoY2FsbGJhY2s6IChldmVudDogQ2xvc2VFdmVudCkgPT4gdm9pZCkge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJvbkNsb3NlIGNhbGxiYWNrIHJlZ2lzdGVyZWRcIik7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLm9uKFwiY2xvc2VcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHVibGljIG9uRXJyb3IoY2FsbGJhY2s6IChlcnJvcjogRXZlbnQpID0+IHZvaWQpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwib25FcnJvciBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcImVycm9yXCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHB1YmxpYyBvbk1lc3NhZ2UoY2FsbGJhY2s6IChkYXRhOiBzdHJpbmcpID0+IHZvaWQpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwib25NZXNzYWdlIGNhbGxiYWNrIHJlZ2lzdGVyZWRcIik7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLm9uKFwibWVzc2FnZVwiLCBjYWxsYmFjayk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZU1heFJlY29ubmVjdEF0dGVtcHRzUmVhY2hlZCgpIHtcbiAgICB0aGlzLmxvZ2dlci5lcnJvcihcbiAgICAgIFwiTWF4aW11bSByZWNvbm5lY3Rpb24gYXR0ZW1wdHMgcmVhY2hlZC4gVG8gdHJ5IGFnYWluLCBwbGVhc2UgcmVmcmVzaCB0aGUgcGFnZS5cIlxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHZhbGlkYXRlQ29uZmlnKGNvbmZpZzogSUNvbW11bmljYXRpb25zTWFuYWdlckNvbmZpZyk6IHZvaWQge1xuICAgIGlmICghY29uZmlnLnVybCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVVJMIGlzIHJlcXVpcmVkIGluIHRoZSBjb25maWd1cmF0aW9uXCIpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBhc3luYyByZXF1ZXN0PEksIE8+KFxuICAgIHJlcXVlc3RUeXBlOiBzdHJpbmcsXG4gICAgYm9keTogSSxcbiAgICB0bz86IHN0cmluZ1xuICApOiBQcm9taXNlPElSZXNwb25zZURhdGE8Tz4+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIHRoaXMucmVxdWVzdE1hbmFnZXIucmVxdWVzdChyZXF1ZXN0VHlwZSwgYm9keSwgdG8pO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkVycm9yIG1ha2luZyByZXF1ZXN0XCIsIHsgcmVxdWVzdFR5cGUsIGVycm9yIH0pO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIoXG4gICAgbWVzc2FnZVR5cGU6IHN0cmluZyxcbiAgICBoYW5kbGVyOiAoZGF0YTogYW55KSA9PiB2b2lkXG4gICkge1xuICAgIHRoaXMucmVxdWVzdE1hbmFnZXIub24obWVzc2FnZVR5cGUsIGhhbmRsZXIpO1xuICB9XG5cbiAgcHVibGljIGdldENvbm5lY3Rpb25TdGF0ZSgpOiBXZWJTb2NrZXRTdGF0ZSB7XG4gICAgcmV0dXJuIHRoaXMud2ViU29ja2V0TWFuYWdlci5nZXRTdGF0ZSgpO1xuICB9XG5cbiAgcHVibGljIHVwZGF0ZUF1dGhlbnRpY2F0aW9uKGF1dGg6IElXZWJTb2NrZXRBdXRoQ29uZmlnKSB7XG4gICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLnJlY29ubmVjdFdpdGhOZXdBdXRoKGF1dGgpO1xuICB9XG5cbiAgcHVibGljIGlzQXV0aGVudGljYXRlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLmlzQXV0aGVudGljYXRlZCgpO1xuICB9XG5cbiAgcHVibGljIGdldEN1cnJlbnRNb2RlKCk6IFwiYW5vbnltb3VzXCIgfCBcImF1dGhlbnRpY2F0ZWRcIiB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmF1dGg/Lm1ldGhvZCA9PT0gQXV0aE1ldGhvZC5BTk9OWU1PVVNcbiAgICAgID8gXCJhbm9ueW1vdXNcIlxuICAgICAgOiBcImF1dGhlbnRpY2F0ZWRcIjtcbiAgfVxuXG4gIHB1YmxpYyBkZXN0cm95KCk6IHZvaWQge1xuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG5cbiAgICBpZiAodGhpcy53ZWJTb2NrZXRNYW5hZ2VyKSB7XG4gICAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIuZGVzdHJveSgpO1xuICAgICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyID0gbnVsbCE7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMucmVxdWVzdE1hbmFnZXIpIHtcbiAgICAgIHRoaXMucmVxdWVzdE1hbmFnZXIuZGVzdHJveSgpO1xuICAgICAgdGhpcy5yZXF1ZXN0TWFuYWdlciA9IG51bGwhO1xuICAgIH1cblxuICAgIHRoaXMubG9nZ2VyID0gbnVsbCE7XG4gICAgdGhpcy5jb25maWcgPSBudWxsITtcbiAgfVxufVxuIl19