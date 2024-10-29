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
        this.lastHeartbeatTimestamp = 0;
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
        this.registerMessageHandler("heartbeat", async (heartbeat, header) => {
            // Emit heartbeat event for monitoring
            const latency = Date.now() - heartbeat.timestamp;
            this.lastHeartbeatTimestamp = Date.now();
            this.emit("heartbeat", { latency });
            return {
                requestTimestamp: heartbeat.timestamp,
                responseTimestamp: Date.now(),
            };
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
        this.requestManager.registerHandler(messageType, async (payload, header) => {
            try {
                return await handler(payload, header);
            }
            catch (error) {
                // Proper error handling while maintaining the contract
                throw error instanceof Error ? error : new Error(String(error));
            }
        });
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
    getConnectionHealth() {
        return {
            connected: this.webSocketManager.getState() === WebSocketManager_1.WebSocketState.OPEN,
            lastHeartbeat: this.lastHeartbeatTimestamp,
        };
    }
}
exports.CommunicationsManager = CommunicationsManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2Jyb3dzZXIvQ29tbXVuaWNhdGlvbnNNYW5hZ2VyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLGtFQUF5QztBQUN6Qyx5REFLNEI7QUFDNUIscUVBQWtFO0FBQ2xFLHFEQUFrRDtBQTBCbEQsTUFBYSxxQkFBc0IsU0FBUSx1QkFBWTtJQU9yRCxZQUFZLE1BQW9DO1FBQzlDLEtBQUssRUFBRSxDQUFDO1FBTEYsV0FBTSxHQUFHLElBQUksK0NBQXNCLEVBQUUsQ0FBQztRQUV0QywyQkFBc0IsR0FBVyxDQUFDLENBQUM7UUFJekMsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLGNBQWMsQ0FBQyxNQUFNLENBQUMsQ0FBQztRQUU1QixJQUFJLENBQUM7WUFDSCxJQUFJLENBQUMsa0JBQWtCLENBQUMsTUFBTSxDQUFDLENBQUM7UUFDbEMsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQywwQ0FBMEMsRUFBRSxFQUFFLEtBQUssRUFBRSxDQUFDLENBQUM7WUFDekUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0Q0FBNEMsQ0FBQyxDQUFDO1FBQ2hFLENBQUM7SUFDSCxDQUFDO0lBRU8sa0JBQWtCLENBQUMsTUFBb0M7UUFDN0QsSUFBSSxDQUFDLGdCQUFnQixHQUFHLElBQUksbUNBQWdCLENBQUM7WUFDM0MsR0FBRyxFQUFFLE1BQU0sQ0FBQyxHQUFHO1lBQ2YsTUFBTSxFQUFFLE1BQU0sQ0FBQyxNQUFNO1lBQ3JCLElBQUksRUFBRSxNQUFNLENBQUMsSUFBSTtZQUNqQixvQkFBb0IsRUFBRSxNQUFNLENBQUMsb0JBQW9CO1lBQ2pELGlCQUFpQixFQUFFLE1BQU0sQ0FBQyxpQkFBaUI7U0FDNUMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxD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QUcsSUFBSyxDQUFDO1FBQ3BCLElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSyxDQUFDO0lBQ3RCLENBQUM7SUFFTSxtQkFBbUI7UUFJeEIsT0FBTztZQUNMLFNBQVMsRUFBRSxJQUFJLENBQUMsZ0JBQWdCLENBQUMsUUFBUSxFQUFFLEtBQUssaUNBQWMsQ0FBQyxJQUFJO1lBQ25FLGFBQWEsRUFBRSxJQUFJLENBQUMsc0JBQXNCO1NBQzNDLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUExT0Qsc0RBME9DIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IEV2ZW50RW1pdHRlciBmcm9tIFwiZXZlbnRlbWl0dGVyM1wiO1xuaW1wb3J0IHtcbiAgV2ViU29ja2V0TWFuYWdlcixcbiAgV2ViU29ja2V0U3RhdGUsXG4gIEF1dGhNZXRob2QsXG4gIElXZWJTb2NrZXRBdXRoQ29uZmlnLFxufSBmcm9tIFwiLi9XZWJTb2NrZXRNYW5hZ2VyXCI7XG5pbXBvcnQgeyBCcm93c2VyQ29uc29sZVN0cmF0ZWd5IH0gZnJvbSBcIi4vQnJvd3NlckNvbnNvbGVTdHJhdGVneVwiO1xuaW1wb3J0IHsgUmVxdWVzdE1hbmFnZXIgfSBmcm9tIFwiLi9SZXF1ZXN0TWFuYWdlclwiO1xuaW1wb3J0IHtcbiAgSVJlc3BvbnNlRGF0YSxcbiAgSVJlcXVlc3QsXG4gIElSZXNwb25zZSxcbiAgSVJlcXVlc3RIZWFkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBIZWFydGJlYXRSZXF1ZXN0LCBIZWFydGJlYXRSZXNwb25zZSB9IGZyb20gXCIuLi9zZXJ2aWNlc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIElDb21tdW5pY2F0aW9uc01hbmFnZXJDb25maWcge1xuICB1cmw6IHN0cmluZztcbiAgc2VjdXJlPzogYm9vbGVhbjtcbiAgYXV0aD86IHtcbiAgICBtZXRob2Q6IEF1dGhNZXRob2Q7XG4gICAgdG9rZW4/OiBzdHJpbmc7XG4gICAgY3JlZGVudGlhbHM/OiB7XG4gICAgICB1c2VybmFtZTogc3RyaW5nO1xuICAgICAgcGFzc3dvcmQ6IHN0cmluZztcbiAgICB9O1xuICB9O1xuICBtYXhSZWNvbm5lY3RBdHRlbXB0cz86IG51bWJlcjtcbiAgcmVjb25uZWN0SW50ZXJ2YWw/OiBudW1iZXI7XG4gIGhlYXJ0YmVhdEludGVydmFsPzogbnVtYmVyO1xuICByZXF1ZXN0VGltZW91dD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGNsYXNzIENvbW11bmljYXRpb25zTWFuYWdlciBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIHByaXZhdGUgd2ViU29ja2V0TWFuYWdlcjogV2ViU29ja2V0TWFuYWdlcjtcbiAgcHJpdmF0ZSByZXF1ZXN0TWFuYWdlcjogUmVxdWVzdE1hbmFnZXI7XG4gIHByaXZhdGUgbG9nZ2VyID0gbmV3IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3koKTtcbiAgcHJpdmF0ZSBjb25maWc6IElDb21tdW5pY2F0aW9uc01hbmFnZXJDb25maWc7XG4gIHByaXZhdGUgbGFzdEhlYXJ0YmVhdFRpbWVzdGFtcDogbnVtYmVyID0gMDtcblxuICBjb25zdHJ1Y3Rvcihjb25maWc6IElDb21tdW5pY2F0aW9uc01hbmFnZXJDb25maWcpIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuY29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMudmFsaWRhdGVDb25maWcoY29uZmlnKTtcblxuICAgIHRyeSB7XG4gICAgICB0aGlzLmluaXRpYWxpemVNYW5hZ2Vycyhjb25maWcpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkVycm9yIGluaXRpYWxpemluZyBDb21tdW5pY2F0aW9uc01hbmFnZXJcIiwgeyBlcnJvciB9KTtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkZhaWxlZCB0byBpbml0aWFsaXplIENvbW11bmljYXRpb25zTWFuYWdlclwiKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGluaXRpYWxpemVNYW5hZ2Vycyhjb25maWc6IElDb21tdW5pY2F0aW9uc01hbmFnZXJDb25maWcpIHtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIgPSBuZXcgV2ViU29ja2V0TWFuYWdlcih7XG4gICAgICB1cmw6IGNvbmZpZy51cmwsXG4gICAgICBzZWN1cmU6IGNvbmZpZy5zZWN1cmUsXG4gICAgICBhdXRoOiBjb25maWcuYXV0aCxcbiAgICAgIG1heFJlY29ubmVjdEF0dGVtcHRzOiBjb25maWcubWF4UmVjb25uZWN0QXR0ZW1wdHMsXG4gICAgICByZWNvbm5lY3RJbnRlcnZhbDogY29uZmlnLnJlY29ubmVjdEludGVydmFsLFxuICAgIH0pO1xuXG4gICAgdGhpcy5yZXF1ZXN0TWFuYWdlciA9IG5ldyBSZXF1ZXN0TWFuYWdlcih7XG4gICAgICB3ZWJTb2NrZXRNYW5hZ2VyOiB0aGlzLndlYlNvY2tldE1hbmFnZXIsXG4gICAgICByZXF1ZXN0VGltZW91dDogY29uZmlnLnJlcXVlc3RUaW1lb3V0LFxuICAgIH0pO1xuXG4gICAgdGhpcy5zZXR1cFdlYlNvY2tldEhvb2tzKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNsZWFudXBDdXJyZW50U3RhdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gUmVtb3ZlIGV2ZW50IGxpc3RlbmVycyBidXQga2VlcCB0aGUgbWFuYWdlciBpbnN0YW5jZXNcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gICAgdGhpcy5yZXF1ZXN0TWFuYWdlci5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcblxuICAgIC8vIENsb3NlIGN1cnJlbnQgV2ViU29ja2V0IGNvbm5lY3Rpb25cbiAgICBpZiAodGhpcy53ZWJTb2NrZXRNYW5hZ2VyKSB7XG4gICAgICBhd2FpdCBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub25jZShcImNsb3NlXCIsICgpID0+IHJlc29sdmUoKSk7XG4gICAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5jbG9zZSgpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gQ2xlYXIgcmVxdWVzdCBtYW5hZ2VyIHN0YXRlXG4gICAgaWYgKHRoaXMucmVxdWVzdE1hbmFnZXIpIHtcbiAgICAgIHRoaXMucmVxdWVzdE1hbmFnZXIuY2xlYXJTdGF0ZSgpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBXZWJTb2NrZXRIb29rcygpIHtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXG4gICAgICBcIm1heFJlY29ubmVjdEF0dGVtcHRzUmVhY2hlZFwiLFxuICAgICAgdGhpcy5oYW5kbGVNYXhSZWNvbm5lY3RBdHRlbXB0c1JlYWNoZWQuYmluZCh0aGlzKVxuICAgICk7XG5cbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXCJhdXRoRXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkF1dGhlbnRpY2F0aW9uIGVycm9yXCIsIGVycm9yKTtcbiAgICAgIHRoaXMuZW1pdChcImF1dGhFcnJvclwiLCBlcnJvcik7XG4gICAgfSk7XG5cbiAgICB0aGlzLnJlZ2lzdGVyTWVzc2FnZUhhbmRsZXIoXG4gICAgICBcImhlYXJ0YmVhdFwiLFxuICAgICAgYXN5bmMgKGhlYXJ0YmVhdDogSGVhcnRiZWF0UmVxdWVzdCwgaGVhZGVyOiBJUmVxdWVzdEhlYWRlcikgPT4ge1xuICAgICAgICAvLyBFbWl0IGhlYXJ0YmVhdCBldmVudCBmb3IgbW9uaXRvcmluZ1xuICAgICAgICBjb25zdCBsYXRlbmN5ID0gRGF0ZS5ub3coKSAtIGhlYXJ0YmVhdC50aW1lc3RhbXA7XG4gICAgICAgIHRoaXMubGFzdEhlYXJ0YmVhdFRpbWVzdGFtcCA9IERhdGUubm93KCk7XG4gICAgICAgIHRoaXMuZW1pdChcImhlYXJ0YmVhdFwiLCB7IGxhdGVuY3kgfSk7XG5cbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICByZXF1ZXN0VGltZXN0YW1wOiBoZWFydGJlYXQudGltZXN0YW1wLFxuICAgICAgICAgIHJlc3BvbnNlVGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgICk7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgYXV0aGVudGljYXRlKGF1dGhDb25maWc6IElXZWJTb2NrZXRBdXRoQ29uZmlnKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuY2xlYW51cEN1cnJlbnRTdGF0ZSgpO1xuXG4gICAgICAvLyBDcmVhdGUgbmV3IGNvbmZpZyB3aXRoIGF1dGhlbnRpY2F0aW9uXG4gICAgICBjb25zdCBuZXdDb25maWcgPSB7XG4gICAgICAgIC4uLnRoaXMuY29uZmlnLFxuICAgICAgICBhdXRoOiBhdXRoQ29uZmlnLFxuICAgICAgfTtcblxuICAgICAgLy8gUmVpbml0aWFsaXplIHdpdGggYXV0aGVudGljYXRlZCBjb25maWdcbiAgICAgIHRoaXMuaW5pdGlhbGl6ZU1hbmFnZXJzKG5ld0NvbmZpZyk7XG5cbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oXCJTd2l0Y2hlZCB0byBhdXRoZW50aWNhdGVkIG1vZGVcIik7XG4gICAgICB0aGlzLmVtaXQoXCJtb2RlQ2hhbmdlZFwiLCBcImF1dGhlbnRpY2F0ZWRcIik7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nZ2VyLmVycm9yKFwiRXJyb3Igc3dpdGNoaW5nIHRvIGF1dGhlbnRpY2F0ZWQgbW9kZVwiLCBlcnJvcik7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc3dpdGNoVG9Bbm9ueW1vdXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIENsZWFyIGN1cnJlbnQgc3RhdGUgYnV0IGRvbid0IGRlc3Ryb3kgZXZlcnl0aGluZ1xuICAgICAgYXdhaXQgdGhpcy5jbGVhbnVwQ3VycmVudFN0YXRlKCk7XG5cbiAgICAgIC8vIENyZWF0ZSBuZXcgY29uZmlnIGZvciBhbm9ueW1vdXMgY29ubmVjdGlvblxuICAgICAgY29uc3QgYW5vbnltb3VzQ29uZmlnID0ge1xuICAgICAgICAuLi50aGlzLmNvbmZpZyxcbiAgICAgICAgYXV0aDoge1xuICAgICAgICAgIG1ldGhvZDogQXV0aE1ldGhvZC5BTk9OWU1PVVMsXG4gICAgICAgIH0sXG4gICAgICB9O1xuXG4gICAgICAvLyBSZWluaXRpYWxpemUgd2l0aCBhbm9ueW1vdXMgY29uZmlnXG4gICAgICB0aGlzLmluaXRpYWxpemVNYW5hZ2Vycyhhbm9ueW1vdXNDb25maWcpO1xuXG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKFwiU3dpdGNoZWQgdG8gYW5vbnltb3VzIG1vZGVcIik7XG4gICAgICB0aGlzLmVtaXQoXCJtb2RlQ2hhbmdlZFwiLCBcImFub255bW91c1wiKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoXCJFcnJvciBzd2l0Y2hpbmcgdG8gYW5vbnltb3VzIG1vZGVcIiwgZXJyb3IpO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIG9uT3BlbihjYWxsYmFjazogKCkgPT4gdm9pZCkge1xuICAgIHRoaXMubG9nZ2VyLmluZm8oXCJvbk9wZW4gY2FsbGJhY2sgcmVnaXN0ZXJlZFwiKTtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXCJvcGVuXCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHB1YmxpYyBvbkNsb3NlKGNhbGxiYWNrOiAoZXZlbnQ6IENsb3NlRXZlbnQpID0+IHZvaWQpIHtcbiAgICB0aGlzLmxvZ2dlci5pbmZvKFwib25DbG9zZSBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcImNsb3NlXCIsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHB1YmxpYyBvbkVycm9yKGNhbGxiYWNrOiAoZXJyb3I6IEV2ZW50KSA9PiB2b2lkKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIm9uRXJyb3IgY2FsbGJhY2sgcmVnaXN0ZXJlZFwiKTtcbiAgICB0aGlzLndlYlNvY2tldE1hbmFnZXIub24oXCJlcnJvclwiLCBjYWxsYmFjayk7XG4gIH1cblxuICBwdWJsaWMgb25NZXNzYWdlKGNhbGxiYWNrOiAoZGF0YTogc3RyaW5nKSA9PiB2b2lkKSB7XG4gICAgdGhpcy5sb2dnZXIuaW5mbyhcIm9uTWVzc2FnZSBjYWxsYmFjayByZWdpc3RlcmVkXCIpO1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5vbihcIm1lc3NhZ2VcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVNYXhSZWNvbm5lY3RBdHRlbXB0c1JlYWNoZWQoKSB7XG4gICAgdGhpcy5sb2dnZXIuZXJyb3IoXG4gICAgICBcIk1heGltdW0gcmVjb25uZWN0aW9uIGF0dGVtcHRzIHJlYWNoZWQuIFRvIHRyeSBhZ2FpbiwgcGxlYXNlIHJlZnJlc2ggdGhlIHBhZ2UuXCJcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSB2YWxpZGF0ZUNvbmZpZyhjb25maWc6IElDb21tdW5pY2F0aW9uc01hbmFnZXJDb25maWcpOiB2b2lkIHtcbiAgICBpZiAoIWNvbmZpZy51cmwpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlVSTCBpcyByZXF1aXJlZCBpbiB0aGUgY29uZmlndXJhdGlvblwiKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgcmVxdWVzdDxJLCBPPihcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IEksXG4gICAgdG8/OiBzdHJpbmdcbiAgKTogUHJvbWlzZTxJUmVzcG9uc2VEYXRhPE8+PiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiB0aGlzLnJlcXVlc3RNYW5hZ2VyLnJlcXVlc3QocmVxdWVzdFR5cGUsIGJvZHksIHRvKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoXCJFcnJvciBtYWtpbmcgcmVxdWVzdFwiLCB7IHJlcXVlc3RUeXBlLCBlcnJvciB9KTtcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyByZWdpc3Rlck1lc3NhZ2VIYW5kbGVyPFQsIFI+KFxuICAgIG1lc3NhZ2VUeXBlOiBzdHJpbmcsXG4gICAgaGFuZGxlcjogKGRhdGE6IFQsIGhlYWRlcjogSVJlcXVlc3RIZWFkZXIpID0+IFByb21pc2U8Uj4gfCBSXG4gICkge1xuICAgIHRoaXMucmVxdWVzdE1hbmFnZXIucmVnaXN0ZXJIYW5kbGVyKFxuICAgICAgbWVzc2FnZVR5cGUsXG4gICAgICBhc3luYyAocGF5bG9hZDogVCwgaGVhZGVyKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGhhbmRsZXIocGF5bG9hZCwgaGVhZGVyKTtcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAvLyBQcm9wZXIgZXJyb3IgaGFuZGxpbmcgd2hpbGUgbWFpbnRhaW5pbmcgdGhlIGNvbnRyYWN0XG4gICAgICAgICAgdGhyb3cgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgKTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRDb25uZWN0aW9uU3RhdGUoKTogV2ViU29ja2V0U3RhdGUge1xuICAgIHJldHVybiB0aGlzLndlYlNvY2tldE1hbmFnZXIuZ2V0U3RhdGUoKTtcbiAgfVxuXG4gIHB1YmxpYyB1cGRhdGVBdXRoZW50aWNhdGlvbihhdXRoOiBJV2ViU29ja2V0QXV0aENvbmZpZykge1xuICAgIHRoaXMud2ViU29ja2V0TWFuYWdlci5yZWNvbm5lY3RXaXRoTmV3QXV0aChhdXRoKTtcbiAgfVxuXG4gIHB1YmxpYyBpc0F1dGhlbnRpY2F0ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMud2ViU29ja2V0TWFuYWdlci5pc0F1dGhlbnRpY2F0ZWQoKTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRDdXJyZW50TW9kZSgpOiBcImFub255bW91c1wiIHwgXCJhdXRoZW50aWNhdGVkXCIge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5hdXRoPy5tZXRob2QgPT09IEF1dGhNZXRob2QuQU5PTllNT1VTXG4gICAgICA/IFwiYW5vbnltb3VzXCJcbiAgICAgIDogXCJhdXRoZW50aWNhdGVkXCI7XG4gIH1cblxuICBwdWJsaWMgZGVzdHJveSgpOiB2b2lkIHtcbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygpO1xuXG4gICAgaWYgKHRoaXMud2ViU29ja2V0TWFuYWdlcikge1xuICAgICAgdGhpcy53ZWJTb2NrZXRNYW5hZ2VyLmRlc3Ryb3koKTtcbiAgICAgIHRoaXMud2ViU29ja2V0TWFuYWdlciA9IG51bGwhO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnJlcXVlc3RNYW5hZ2VyKSB7XG4gICAgICB0aGlzLnJlcXVlc3RNYW5hZ2VyLmRlc3Ryb3koKTtcbiAgICAgIHRoaXMucmVxdWVzdE1hbmFnZXIgPSBudWxsITtcbiAgICB9XG5cbiAgICB0aGlzLmxvZ2dlciA9IG51bGwhO1xuICAgIHRoaXMuY29uZmlnID0gbnVsbCE7XG4gIH1cblxuICBwdWJsaWMgZ2V0Q29ubmVjdGlvbkhlYWx0aCgpOiB7XG4gICAgY29ubmVjdGVkOiBib29sZWFuO1xuICAgIGxhc3RIZWFydGJlYXQ/OiBudW1iZXI7XG4gIH0ge1xuICAgIHJldHVybiB7XG4gICAgICBjb25uZWN0ZWQ6IHRoaXMud2ViU29ja2V0TWFuYWdlci5nZXRTdGF0ZSgpID09PSBXZWJTb2NrZXRTdGF0ZS5PUEVOLFxuICAgICAgbGFzdEhlYXJ0YmVhdDogdGhpcy5sYXN0SGVhcnRiZWF0VGltZXN0YW1wLFxuICAgIH07XG4gIH1cbn1cbiJdfQ==