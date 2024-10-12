"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketManager = exports.WebSocketState = void 0;
const eventemitter3_1 = __importDefault(require("eventemitter3"));
const BrowserConsoleStrategy_1 = require("./BrowserConsoleStrategy");
var WebSocketState;
(function (WebSocketState) {
    WebSocketState[WebSocketState["CONNECTING"] = 0] = "CONNECTING";
    WebSocketState[WebSocketState["OPEN"] = 1] = "OPEN";
    WebSocketState[WebSocketState["CLOSING"] = 2] = "CLOSING";
    WebSocketState[WebSocketState["CLOSED"] = 3] = "CLOSED";
})(WebSocketState || (exports.WebSocketState = WebSocketState = {}));
class WebSocketManager extends eventemitter3_1.default {
    constructor(url, secure = false, maxReconnectAttempts = 5, reconnectInterval = 5000, connectionTimeout = 10000) {
        super();
        this.reconnectAttempts = 0;
        this.state = WebSocketState.CLOSED;
        this.logger = new BrowserConsoleStrategy_1.BrowserConsoleStrategy();
        this.url = url;
        this.secure = secure;
        this.maxReconnectAttempts = maxReconnectAttempts;
        this.reconnectInterval = reconnectInterval;
        this.connectionTimeout = connectionTimeout;
        this.connect();
    }
    connect() {
        this.state = WebSocketState.CONNECTING;
        const secureUrl = this.getSecureUrl(this.url, this.secure);
        this.logger.info(`Attempting to connect to ${secureUrl}`);
        this.ws = new WebSocket(secureUrl);
        this.setHooks();
        this.setConnectionTimeout();
    }
    getSecureUrl(url, secure) {
        return secure ? url.replace(/^ws:/, "wss:") : url;
    }
    setHooks() {
        this.ws.onopen = () => {
            this.clearConnectionTimeout();
            this.state = WebSocketState.OPEN;
            this.reconnectAttempts = 0;
            this.logger.info(`WebSocket opened. ReadyState: ${this.ws.readyState}`);
            this.emit("open");
        };
        this.ws.onclose = (event) => {
            this.clearConnectionTimeout();
            this.state = WebSocketState.CLOSED;
            this.logger.info(`WebSocket closed. ReadyState: ${this.ws.readyState}. Code: ${event.code}, Reason: ${event.reason}`);
            this.emit("close", event);
            this.handleReconnection();
        };
        this.ws.onerror = (error) => {
            this.logger.error(error);
            this.emit("error", error);
        };
        this.ws.onmessage = (event) => {
            const parsedData = this.parseMessage(event.data);
            this.emit("message", parsedData);
        };
    }
    handleReconnection() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            const minDelay = 1000;
            const delay = Math.max(minDelay, this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1));
            this.logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`);
            setTimeout(() => this.connect(), delay);
        }
        else {
            this.logger.error("Max reconnection attempts reached. Please reconnect manually.");
            this.emit("maxReconnectAttemptsReached");
        }
    }
    setConnectionTimeout() {
        this.connectionTimer = window.setTimeout(() => {
            if (this.state === WebSocketState.CONNECTING) {
                this.logger.error("Connection attempt timed out");
                this.ws.close();
            }
        }, this.connectionTimeout);
    }
    clearConnectionTimeout() {
        if (this.connectionTimer) {
            window.clearTimeout(this.connectionTimer);
        }
    }
    parseMessage(data) {
        try {
            return JSON.parse(data);
        }
        catch (error) {
            return data;
        }
    }
    send(message) {
        if (this.state === WebSocketState.OPEN) {
            const data = typeof message === "string" ? message : JSON.stringify(message);
            this.ws.send(data);
        }
        else {
            const error = new Error("WebSocket is not open");
            this.emit("error", error);
        }
    }
    close() {
        this.state = WebSocketState.CLOSING;
        this.ws.close();
    }
    reconnect() {
        this.logger.debug("Manual reconnection initiated.");
        this.reconnectAttempts = 0;
        this.close();
        this.connect();
    }
    getState() {
        return this.state;
    }
    getReadyState() {
        return this.ws.readyState;
    }
}
exports.WebSocketManager = WebSocketManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0TWFuYWdlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9icm93c2VyL1dlYlNvY2tldE1hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsa0VBQXlDO0FBQ3pDLHFFQUFrRTtBQUVsRSxJQUFZLGNBS1g7QUFMRCxXQUFZLGNBQWM7SUFDeEIsK0RBQVUsQ0FBQTtJQUNWLG1EQUFJLENBQUE7SUFDSix5REFBTyxDQUFBO0lBQ1AsdURBQU0sQ0FBQTtBQUNSLENBQUMsRUFMVyxjQUFjLDhCQUFkLGNBQWMsUUFLekI7QUFFRCxNQUFhLGdCQUFpQixTQUFRLHVCQUFZO0lBWWhELFlBQ0UsR0FBVyxFQUNYLFNBQWtCLEtBQUssRUFDdkIsdUJBQStCLENBQUMsRUFDaEMsb0JBQTRCLElBQUksRUFDaEMsb0JBQTRCLEtBQUs7UUFFakMsS0FBSyxFQUFFLENBQUM7UUFkRixzQkFBaUIsR0FBVyxDQUFDLENBQUM7UUFHOUIsVUFBSyxHQUFtQixjQUFjLENBQUMsTUFBTSxDQUFDO1FBWXBELElBQUksQ0FBQyxNQUFNLEdBQUcsSUFBSSwrQ0FBc0IsRUFBRSxDQUFDO1FBQzNDLElBQUksQ0FBQyxHQUFHLEdBQUcsR0FBRyxDQUFDO1FBQ2YsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLG9CQUFvQixHQUFHLG9CQUFvQixDQUFDO1FBQ2pELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxpQkFBaUIsQ0FBQztRQUMzQyxJQUFJLENBQUMsaUJBQWlCLEdBQUcsaUJBQWlCLENBQUM7UUFDM0MsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQ2pCLENBQUM7SUFFTyxPQUFPO1FBQ2IsSUFBSSxDQUFDLEtBQUssR0FBRyxjQUFjLENBQUMsVUFBVSxDQUFDO1FBQ3ZDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJ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QUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNsRSxJQUFJLENBQUMsRUFBRSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUNyQixDQUFDO2FBQU0sQ0FBQztZQUNOLE1BQU0sS0FBSyxHQUFHLElBQUksS0FBSyxDQUFDLHVCQUF1QixDQUFDLENBQUM7WUFDakQsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDNUIsQ0FBQztJQUNILENBQUM7SUFFTSxLQUFLO1FBQ1YsSUFBSSxDQUFDLEtBQUssR0FBRyxjQUFjLENBQUMsT0FBTyxDQUFDO1FBQ3BDLElBQUksQ0FBQyxFQUFFLENBQUMsS0FBSyxFQUFFLENBQUM7SUFDbEIsQ0FBQztJQUVNLFNBQVM7UUFDZCxJQUFJLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQyxnQ0FBZ0MsQ0FBQyxDQUFDO1FBQ3BELElBQUksQ0FBQyxpQkFBaUIsR0FBRyxDQUFDLENBQUM7UUFDM0IsSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1FBQ2IsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQ2pCLENBQUM7SUFFTSxRQUFRO1FBQ2IsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDO0lBQ3BCLENBQUM7SUFFTSxhQUFhO1FBQ2xCLE9BQU8sSUFBSSxDQUFDLEVBQUUsQ0FBQyxVQUFVLENBQUM7SUFDNUIsQ0FBQztDQUNGO0FBOUlELDRDQThJQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBFdmVudEVtaXR0ZXIgZnJvbSBcImV2ZW50ZW1pdHRlcjNcIjtcbmltcG9ydCB7IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3kgfSBmcm9tIFwiLi9Ccm93c2VyQ29uc29sZVN0cmF0ZWd5XCI7XG5cbmV4cG9ydCBlbnVtIFdlYlNvY2tldFN0YXRlIHtcbiAgQ09OTkVDVElORyxcbiAgT1BFTixcbiAgQ0xPU0lORyxcbiAgQ0xPU0VELFxufVxuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0TWFuYWdlciBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIHByaXZhdGUgbG9nZ2VyOiBCcm93c2VyQ29uc29sZVN0cmF0ZWd5O1xuICBwcml2YXRlIHdzITogV2ViU29ja2V0O1xuICBwcml2YXRlIHVybDogc3RyaW5nO1xuICBwcml2YXRlIHNlY3VyZTogYm9vbGVhbjtcbiAgcHJpdmF0ZSByZWNvbm5lY3RBdHRlbXB0czogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSBtYXhSZWNvbm5lY3RBdHRlbXB0czogbnVtYmVyO1xuICBwcml2YXRlIHJlY29ubmVjdEludGVydmFsOiBudW1iZXI7XG4gIHByaXZhdGUgc3RhdGU6IFdlYlNvY2tldFN0YXRlID0gV2ViU29ja2V0U3RhdGUuQ0xPU0VEO1xuICBwcml2YXRlIGNvbm5lY3Rpb25UaW1lb3V0OiBudW1iZXI7XG4gIHByaXZhdGUgY29ubmVjdGlvblRpbWVyPzogbnVtYmVyO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHVybDogc3RyaW5nLFxuICAgIHNlY3VyZTogYm9vbGVhbiA9IGZhbHNlLFxuICAgIG1heFJlY29ubmVjdEF0dGVtcHRzOiBudW1iZXIgPSA1LFxuICAgIHJlY29ubmVjdEludGVydmFsOiBudW1iZXIgPSA1MDAwLFxuICAgIGNvbm5lY3Rpb25UaW1lb3V0OiBudW1iZXIgPSAxMDAwMFxuICApIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMubG9nZ2VyID0gbmV3IEJyb3dzZXJDb25zb2xlU3RyYXRlZ3koKTtcbiAgICB0aGlzLnVybCA9IHVybDtcbiAgICB0aGlzLnNlY3VyZSA9IHNlY3VyZTtcbiAgICB0aGlzLm1heFJlY29ubmVjdEF0dGVtcHRzID0gbWF4UmVjb25uZWN0QXR0ZW1wdHM7XG4gICAgdGhpcy5yZWNvbm5lY3RJbnRlcnZhbCA9IHJlY29ubmVjdEludGVydmFsO1xuICAgIHRoaXMuY29ubmVjdGlvblRpbWVvdXQgPSBjb25uZWN0aW9uVGltZW91dDtcbiAgICB0aGlzLmNvbm5lY3QoKTtcbiAgfVxuXG4gIHByaXZhdGUgY29ubmVjdCgpIHtcbiAgICB0aGlzLnN0YXRlID0gV2ViU29ja2V0U3RhdGUuQ09OTkVDVElORztcbiAgICBjb25zdCBzZWN1cmVVcmwgPSB0aGlzLmdldFNlY3VyZVVybCh0aGlzLnVybCwgdGhpcy5zZWN1cmUpO1xuICAgIHRoaXMubG9nZ2VyLmluZm8oYEF0dGVtcHRpbmcgdG8gY29ubmVjdCB0byAke3NlY3VyZVVybH1gKTtcbiAgICB0aGlzLndzID0gbmV3IFdlYlNvY2tldChzZWN1cmVVcmwpO1xuICAgIHRoaXMuc2V0SG9va3MoKTtcbiAgICB0aGlzLnNldENvbm5lY3Rpb25UaW1lb3V0KCk7XG4gIH1cblxuICBwcml2YXRlIGdldFNlY3VyZVVybCh1cmw6IHN0cmluZywgc2VjdXJlOiBib29sZWFuKTogc3RyaW5nIHtcbiAgICByZXR1cm4gc2VjdXJlID8gdXJsLnJlcGxhY2UoL153czovLCBcIndzczpcIikgOiB1cmw7XG4gIH1cblxuICBwcml2YXRlIHNldEhvb2tzKCkge1xuICAgIHRoaXMud3Mub25vcGVuID0gKCkgPT4ge1xuICAgICAgdGhpcy5jbGVhckNvbm5lY3Rpb25UaW1lb3V0KCk7XG4gICAgICB0aGlzLnN0YXRlID0gV2ViU29ja2V0U3RhdGUuT1BFTjtcbiAgICAgIHRoaXMucmVjb25uZWN0QXR0ZW1wdHMgPSAwO1xuICAgICAgdGhpcy5sb2dnZXIuaW5mbyhgV2ViU29ja2V0IG9wZW5lZC4gUmVhZHlTdGF0ZTogJHt0aGlzLndzLnJlYWR5U3RhdGV9YCk7XG4gICAgICB0aGlzLmVtaXQoXCJvcGVuXCIpO1xuICAgIH07XG4gICAgdGhpcy53cy5vbmNsb3NlID0gKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLmNsZWFyQ29ubmVjdGlvblRpbWVvdXQoKTtcbiAgICAgIHRoaXMuc3RhdGUgPSBXZWJTb2NrZXRTdGF0ZS5DTE9TRUQ7XG4gICAgICB0aGlzLmxvZ2dlci5pbmZvKFxuICAgICAgICBgV2ViU29ja2V0IGNsb3NlZC4gUmVhZHlTdGF0ZTogJHt0aGlzLndzLnJlYWR5U3RhdGV9LiBDb2RlOiAke2V2ZW50LmNvZGV9LCBSZWFzb246ICR7ZXZlbnQucmVhc29ufWBcbiAgICAgICk7XG4gICAgICB0aGlzLmVtaXQoXCJjbG9zZVwiLCBldmVudCk7XG4gICAgICB0aGlzLmhhbmRsZVJlY29ubmVjdGlvbigpO1xuICAgIH07XG4gICAgdGhpcy53cy5vbmVycm9yID0gKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmxvZ2dlci5lcnJvcihlcnJvcik7XG4gICAgICB0aGlzLmVtaXQoXCJlcnJvclwiLCBlcnJvcik7XG4gICAgfTtcbiAgICB0aGlzLndzLm9ubWVzc2FnZSA9IChldmVudCkgPT4ge1xuICAgICAgY29uc3QgcGFyc2VkRGF0YSA9IHRoaXMucGFyc2VNZXNzYWdlKGV2ZW50LmRhdGEpO1xuICAgICAgdGhpcy5lbWl0KFwibWVzc2FnZVwiLCBwYXJzZWREYXRhKTtcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVSZWNvbm5lY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMucmVjb25uZWN0QXR0ZW1wdHMgPCB0aGlzLm1heFJlY29ubmVjdEF0dGVtcHRzKSB7XG4gICAgICB0aGlzLnJlY29ubmVjdEF0dGVtcHRzKys7XG4gICAgICBjb25zdCBtaW5EZWxheSA9IDEwMDA7XG4gICAgICBjb25zdCBkZWxheSA9IE1hdGgubWF4KFxuICAgICAgICBtaW5EZWxheSxcbiAgICAgICAgdGhpcy5yZWNvbm5lY3RJbnRlcnZhbCAqIE1hdGgucG93KDIsIHRoaXMucmVjb25uZWN0QXR0ZW1wdHMgLSAxKVxuICAgICAgKTtcbiAgICAgIHRoaXMubG9nZ2VyLmluZm8oXG4gICAgICAgIGBBdHRlbXB0aW5nIHRvIHJlY29ubmVjdCAoJHt0aGlzLnJlY29ubmVjdEF0dGVtcHRzfS8ke3RoaXMubWF4UmVjb25uZWN0QXR0ZW1wdHN9KSBpbiAke2RlbGF5fW1zLi4uYFxuICAgICAgKTtcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4gdGhpcy5jb25uZWN0KCksIGRlbGF5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dnZXIuZXJyb3IoXG4gICAgICAgIFwiTWF4IHJlY29ubmVjdGlvbiBhdHRlbXB0cyByZWFjaGVkLiBQbGVhc2UgcmVjb25uZWN0IG1hbnVhbGx5LlwiXG4gICAgICApO1xuICAgICAgdGhpcy5lbWl0KFwibWF4UmVjb25uZWN0QXR0ZW1wdHNSZWFjaGVkXCIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2V0Q29ubmVjdGlvblRpbWVvdXQoKSB7XG4gICAgdGhpcy5jb25uZWN0aW9uVGltZXIgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBpZiAodGhpcy5zdGF0ZSA9PT0gV2ViU29ja2V0U3RhdGUuQ09OTkVDVElORykge1xuICAgICAgICB0aGlzLmxvZ2dlci5lcnJvcihcIkNvbm5lY3Rpb24gYXR0ZW1wdCB0aW1lZCBvdXRcIik7XG4gICAgICAgIHRoaXMud3MuY2xvc2UoKTtcbiAgICAgIH1cbiAgICB9LCB0aGlzLmNvbm5lY3Rpb25UaW1lb3V0KTtcbiAgfVxuXG4gIHByaXZhdGUgY2xlYXJDb25uZWN0aW9uVGltZW91dCgpIHtcbiAgICBpZiAodGhpcy5jb25uZWN0aW9uVGltZXIpIHtcbiAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGhpcy5jb25uZWN0aW9uVGltZXIpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgcGFyc2VNZXNzYWdlKGRhdGE6IGFueSk6IGFueSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKGRhdGEpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICByZXR1cm4gZGF0YTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgc2VuZChtZXNzYWdlOiBzdHJpbmcgfCBvYmplY3QpIHtcbiAgICBpZiAodGhpcy5zdGF0ZSA9PT0gV2ViU29ja2V0U3RhdGUuT1BFTikge1xuICAgICAgY29uc3QgZGF0YSA9XG4gICAgICAgIHR5cGVvZiBtZXNzYWdlID09PSBcInN0cmluZ1wiID8gbWVzc2FnZSA6IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuICAgICAgdGhpcy53cy5zZW5kKGRhdGEpO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcihcIldlYlNvY2tldCBpcyBub3Qgb3BlblwiKTtcbiAgICAgIHRoaXMuZW1pdChcImVycm9yXCIsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgY2xvc2UoKSB7XG4gICAgdGhpcy5zdGF0ZSA9IFdlYlNvY2tldFN0YXRlLkNMT1NJTkc7XG4gICAgdGhpcy53cy5jbG9zZSgpO1xuICB9XG5cbiAgcHVibGljIHJlY29ubmVjdCgpIHtcbiAgICB0aGlzLmxvZ2dlci5kZWJ1ZyhcIk1hbnVhbCByZWNvbm5lY3Rpb24gaW5pdGlhdGVkLlwiKTtcbiAgICB0aGlzLnJlY29ubmVjdEF0dGVtcHRzID0gMDtcbiAgICB0aGlzLmNsb3NlKCk7XG4gICAgdGhpcy5jb25uZWN0KCk7XG4gIH1cblxuICBwdWJsaWMgZ2V0U3RhdGUoKTogV2ViU29ja2V0U3RhdGUge1xuICAgIHJldHVybiB0aGlzLnN0YXRlO1xuICB9XG5cbiAgcHVibGljIGdldFJlYWR5U3RhdGUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy53cy5yZWFkeVN0YXRlO1xuICB9XG59XG4iXX0=