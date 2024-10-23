"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebsocketConnection = void 0;
const ws_1 = __importDefault(require("ws"));
class WebsocketConnection {
    constructor(handleMessage, handleClose, inactivityTimeout = 300000, // 5 minutes
    maxMessagesPerMinute = 100, websocket) {
        this.handleMessage = handleMessage;
        this.handleClose = handleClose;
        this.inactivityTimeout = inactivityTimeout;
        this.maxMessagesPerMinute = maxMessagesPerMinute;
        this.messageCount = 0;
        this.authenticated = false;
        this.metadata = new Map();
        this.websocket = null;
        this.eventListenersSetup = false;
        this.closePromise = null;
        this.connectionId = crypto.randomUUID();
        this.lastActivityTime = Date.now();
        if (websocket) {
            this.setWebSocket(websocket);
        }
        this.startInactivityTimer();
    }
    setWebSocket(websocket) {
        this.websocket = websocket;
        this.setupEventListeners();
        this.lastActivityTime = Date.now();
    }
    setupEventListeners() {
        if (!this.websocket || this.eventListenersSetup) {
            return;
        }
        this.websocket.on("message", this.handleWebsocketMessages.bind(this));
        this.websocket.on("close", this.handleCloseConnection.bind(this));
        this.websocket.on("pong", this.handlePong.bind(this));
        this.eventListenersSetup = true;
    }
    startInactivityTimer() {
        setInterval(() => {
            if (Date.now() - this.lastActivityTime > this.inactivityTimeout) {
                this.close(1000, "Connection timed out due to inactivity");
            }
        }, 60000); // Check every minute
    }
    handlePong() {
        this.lastActivityTime = Date.now();
    }
    send(message) {
        if (!this.websocket) {
            throw new Error("Cannot send message: WebSocket not initialized");
        }
        this.websocket.send(message);
        this.lastActivityTime = Date.now();
    }
    handleCloseConnection() {
        this.handleClose(this.connectionId);
    }
    handleWebsocketMessages(message) {
        this.lastActivityTime = Date.now();
        if (this.isRateLimited()) {
            this.send("Rate limit exceeded. Please slow down.");
            return;
        }
        this.messageCount++;
        this.handleMessage(message, this);
    }
    isRateLimited() {
        const oneMinuteAgo = Date.now() - 60000;
        if (this.messageCount > this.maxMessagesPerMinute &&
            this.lastActivityTime > oneMinuteAgo) {
            return true;
        }
        if (this.lastActivityTime <= oneMinuteAgo) {
            this.messageCount = 0;
        }
        return false;
    }
    getConnectionId() {
        return this.connectionId;
    }
    setAuthenticated(value) {
        this.authenticated = value;
    }
    isAuthenticated() {
        return this.authenticated;
    }
    close(code, reason) {
        if (!this.closePromise) {
            this.closePromise = new Promise((resolve) => {
                if (!this.websocket) {
                    resolve();
                    return;
                }
                // Handle the case where the socket is already closed
                if (this.websocket.readyState === ws_1.default.CLOSED) {
                    resolve();
                    return;
                }
                // Listen for the close event
                const onClose = () => {
                    this.websocket?.removeListener('close', onClose);
                    resolve();
                };
                this.websocket.on('close', onClose);
                this.websocket.close(code, reason);
                // Safeguard: resolve after 5 seconds even if we don't get a close event
                setTimeout(() => {
                    this.websocket?.removeListener('close', onClose);
                    resolve();
                }, 5000);
            });
        }
        return this.closePromise;
    }
    ping() {
        if (this.websocket) {
            this.websocket.ping();
        }
    }
    isConnected() {
        return (this.websocket !== null && this.websocket.readyState === ws_1.default.OPEN);
    }
    setMetadata(key, value) {
        this.metadata.set(key, value);
    }
    getMetadata(key) {
        return this.metadata.get(key);
    }
    async refreshSession(sessionStore) {
        const sessionId = this.getMetadata("sessionId");
        if (!sessionId)
            return false;
        const session = await sessionStore.get(sessionId);
        if (!session)
            return false;
        session.lastAccessedAt = new Date();
        return sessionStore.update(sessionId, session);
    }
    // Static method for broadcasting to multiple connections
    static broadcast(message, connections) {
        connections.forEach((connection) => {
            if (connection.isConnected()) {
                connection.send(message);
            }
        });
    }
    getSessionId() {
        return this.getMetadata("sessionId");
    }
}
exports.WebsocketConnection = WebsocketConnection;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2Vic29ja2V0Q29ubmVjdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zZXJ2aWNlcy9XZWJzb2NrZXRDb25uZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLDRDQUEyQjtBQUczQixNQUFhLG1CQUFtQjtJQVU5QixZQUNVLGFBR0MsRUFDRCxXQUEyQyxFQUMzQyxvQkFBNEIsTUFBTSxFQUFFLFlBQVk7SUFDaEQsdUJBQStCLEdBQUcsRUFDMUMsU0FBcUI7UUFQYixrQkFBYSxHQUFiLGFBQWEsQ0FHWjtRQUNELGdCQUFXLEdBQVgsV0FBVyxDQUFnQztRQUMzQyxzQkFBaUIsR0FBakIsaUJBQWlCLENBQWlCO1FBQ2xDLHlCQUFvQixHQUFwQixvQkFBb0IsQ0FBYztRQWRwQyxpQkFBWSxHQUFXLENBQUMsQ0FBQztRQUN6QixrQkFBYSxHQUFZLEtBQUssQ0FBQztRQUMvQixhQUFRLEdBQXFCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDdkMsY0FBUyxHQUFxQixJQUFJLENBQUM7UUFDbkMsd0JBQW1CLEdBQVksS0FBSyxDQUFDO1FBQ3JDLGlCQUFZLEdBQXlCLElBQUksQ0FBQztRQVloRCxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUN4QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRW5DLElBQUksU0FBUyxFQUFFLENBQUM7WUFDZCxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQy9CLENBQUM7UUFFRCxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztJQUM5QixDQUFDO0lBRU0sWUFBWSxDQUFDLFNBQW9CO1FBQ3RDLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBQzNCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJ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QUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMzQixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU0sWUFBWTtRQUNqQixPQUFPLElBQUksQ0FBQyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUM7SUFDdkMsQ0FBQztDQUNGO0FBekxELGtEQXlMQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBXZWJTb2NrZXQgZnJvbSBcIndzXCI7XG5pbXBvcnQgeyBJU2Vzc2lvblN0b3JlIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuZXhwb3J0IGNsYXNzIFdlYnNvY2tldENvbm5lY3Rpb24ge1xuICBwcml2YXRlIGNvbm5lY3Rpb25JZDogc3RyaW5nO1xuICBwcml2YXRlIGxhc3RBY3Rpdml0eVRpbWU6IG51bWJlcjtcbiAgcHJpdmF0ZSBtZXNzYWdlQ291bnQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgYXV0aGVudGljYXRlZDogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIG1ldGFkYXRhOiBNYXA8c3RyaW5nLCBhbnk+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHdlYnNvY2tldDogV2ViU29ja2V0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgZXZlbnRMaXN0ZW5lcnNTZXR1cDogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGNsb3NlUHJvbWlzZTogUHJvbWlzZTx2b2lkPiB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgaGFuZGxlTWVzc2FnZTogKFxuICAgICAgZGF0YTogV2ViU29ja2V0LkRhdGEsXG4gICAgICB3ZWJzb2NrZXQ6IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgICApID0+IHZvaWQsXG4gICAgcHJpdmF0ZSBoYW5kbGVDbG9zZTogKGNvbm5lY3Rpb25JZDogc3RyaW5nKSA9PiB2b2lkLFxuICAgIHByaXZhdGUgaW5hY3Rpdml0eVRpbWVvdXQ6IG51bWJlciA9IDMwMDAwMCwgLy8gNSBtaW51dGVzXG4gICAgcHJpdmF0ZSBtYXhNZXNzYWdlc1Blck1pbnV0ZTogbnVtYmVyID0gMTAwLFxuICAgIHdlYnNvY2tldD86IFdlYlNvY2tldFxuICApIHtcbiAgICB0aGlzLmNvbm5lY3Rpb25JZCA9IGNyeXB0by5yYW5kb21VVUlEKCk7XG4gICAgdGhpcy5sYXN0QWN0aXZpdHlUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgIGlmICh3ZWJzb2NrZXQpIHtcbiAgICAgIHRoaXMuc2V0V2ViU29ja2V0KHdlYnNvY2tldCk7XG4gICAgfVxuXG4gICAgdGhpcy5zdGFydEluYWN0aXZpdHlUaW1lcigpO1xuICB9XG5cbiAgcHVibGljIHNldFdlYlNvY2tldCh3ZWJzb2NrZXQ6IFdlYlNvY2tldCkge1xuICAgIHRoaXMud2Vic29ja2V0ID0gd2Vic29ja2V0O1xuICAgIHRoaXMuc2V0dXBFdmVudExpc3RlbmVycygpO1xuICAgIHRoaXMubGFzdEFjdGl2aXR5VGltZSA9IERhdGUubm93KCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwRXZlbnRMaXN0ZW5lcnMoKSB7XG4gICAgaWYgKCF0aGlzLndlYnNvY2tldCB8fCB0aGlzLmV2ZW50TGlzdGVuZXJzU2V0dXApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLndlYnNvY2tldC5vbihcIm1lc3NhZ2VcIiwgdGhpcy5oYW5kbGVXZWJzb2NrZXRNZXNzYWdlcy5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLndlYnNvY2tldC5vbihcImNsb3NlXCIsIHRoaXMuaGFuZGxlQ2xvc2VDb25uZWN0aW9uLmJpbmQodGhpcykpO1xuICAgIHRoaXMud2Vic29ja2V0Lm9uKFwicG9uZ1wiLCB0aGlzLmhhbmRsZVBvbmcuYmluZCh0aGlzKSk7XG5cbiAgICB0aGlzLmV2ZW50TGlzdGVuZXJzU2V0dXAgPSB0cnVlO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGFydEluYWN0aXZpdHlUaW1lcigpIHtcbiAgICBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICBpZiAoRGF0ZS5ub3coKSAtIHRoaXMubGFzdEFjdGl2aXR5VGltZSA+IHRoaXMuaW5hY3Rpdml0eVRpbWVvdXQpIHtcbiAgICAgICAgdGhpcy5jbG9zZSgxMDAwLCBcIkNvbm5lY3Rpb24gdGltZWQgb3V0IGR1ZSB0byBpbmFjdGl2aXR5XCIpO1xuICAgICAgfVxuICAgIH0sIDYwMDAwKTsgLy8gQ2hlY2sgZXZlcnkgbWludXRlXG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVBvbmcoKSB7XG4gICAgdGhpcy5sYXN0QWN0aXZpdHlUaW1lID0gRGF0ZS5ub3coKTtcbiAgfVxuXG4gIHB1YmxpYyBzZW5kKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIGlmICghdGhpcy53ZWJzb2NrZXQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkNhbm5vdCBzZW5kIG1lc3NhZ2U6IFdlYlNvY2tldCBub3QgaW5pdGlhbGl6ZWRcIik7XG4gICAgfVxuICAgIHRoaXMud2Vic29ja2V0LnNlbmQobWVzc2FnZSk7XG4gICAgdGhpcy5sYXN0QWN0aXZpdHlUaW1lID0gRGF0ZS5ub3coKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlQ2xvc2VDb25uZWN0aW9uKCkge1xuICAgIHRoaXMuaGFuZGxlQ2xvc2UodGhpcy5jb25uZWN0aW9uSWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVXZWJzb2NrZXRNZXNzYWdlcyhtZXNzYWdlOiBXZWJTb2NrZXQuRGF0YSkge1xuICAgIHRoaXMubGFzdEFjdGl2aXR5VGltZSA9IERhdGUubm93KCk7XG4gICAgaWYgKHRoaXMuaXNSYXRlTGltaXRlZCgpKSB7XG4gICAgICB0aGlzLnNlbmQoXCJSYXRlIGxpbWl0IGV4Y2VlZGVkLiBQbGVhc2Ugc2xvdyBkb3duLlwiKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5tZXNzYWdlQ291bnQrKztcbiAgICB0aGlzLmhhbmRsZU1lc3NhZ2UobWVzc2FnZSwgdGhpcyk7XG4gIH1cblxuICBwcml2YXRlIGlzUmF0ZUxpbWl0ZWQoKTogYm9vbGVhbiB7XG4gICAgY29uc3Qgb25lTWludXRlQWdvID0gRGF0ZS5ub3coKSAtIDYwMDAwO1xuICAgIGlmIChcbiAgICAgIHRoaXMubWVzc2FnZUNvdW50ID4gdGhpcy5tYXhNZXNzYWdlc1Blck1pbnV0ZSAmJlxuICAgICAgdGhpcy5sYXN0QWN0aXZpdHlUaW1lID4gb25lTWludXRlQWdvXG4gICAgKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKHRoaXMubGFzdEFjdGl2aXR5VGltZSA8PSBvbmVNaW51dGVBZ28pIHtcbiAgICAgIHRoaXMubWVzc2FnZUNvdW50ID0gMDtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcHVibGljIGdldENvbm5lY3Rpb25JZCgpIHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uSWQ7XG4gIH1cblxuICBwdWJsaWMgc2V0QXV0aGVudGljYXRlZCh2YWx1ZTogYm9vbGVhbikge1xuICAgIHRoaXMuYXV0aGVudGljYXRlZCA9IHZhbHVlO1xuICB9XG5cbiAgcHVibGljIGlzQXV0aGVudGljYXRlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5hdXRoZW50aWNhdGVkO1xuICB9XG5cbiAgcHVibGljIGNsb3NlKGNvZGU/OiBudW1iZXIsIHJlYXNvbj86IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5jbG9zZVByb21pc2UpIHtcbiAgICAgIHRoaXMuY2xvc2VQcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgICAgaWYgKCF0aGlzLndlYnNvY2tldCkge1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBIYW5kbGUgdGhlIGNhc2Ugd2hlcmUgdGhlIHNvY2tldCBpcyBhbHJlYWR5IGNsb3NlZFxuICAgICAgICBpZiAodGhpcy53ZWJzb2NrZXQucmVhZHlTdGF0ZSA9PT0gV2ViU29ja2V0LkNMT1NFRCkge1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBMaXN0ZW4gZm9yIHRoZSBjbG9zZSBldmVudFxuICAgICAgICBjb25zdCBvbkNsb3NlID0gKCkgPT4ge1xuICAgICAgICAgIHRoaXMud2Vic29ja2V0Py5yZW1vdmVMaXN0ZW5lcignY2xvc2UnLCBvbkNsb3NlKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgdGhpcy53ZWJzb2NrZXQub24oJ2Nsb3NlJywgb25DbG9zZSk7XG4gICAgICAgIHRoaXMud2Vic29ja2V0LmNsb3NlKGNvZGUsIHJlYXNvbik7XG5cbiAgICAgICAgLy8gU2FmZWd1YXJkOiByZXNvbHZlIGFmdGVyIDUgc2Vjb25kcyBldmVuIGlmIHdlIGRvbid0IGdldCBhIGNsb3NlIGV2ZW50XG4gICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgIHRoaXMud2Vic29ja2V0Py5yZW1vdmVMaXN0ZW5lcignY2xvc2UnLCBvbkNsb3NlKTtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH0sIDUwMDApO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuY2xvc2VQcm9taXNlO1xuICB9XG5cbiAgcHVibGljIHBpbmcoKSB7XG4gICAgaWYgKHRoaXMud2Vic29ja2V0KSB7XG4gICAgICB0aGlzLndlYnNvY2tldC5waW5nKCk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIGlzQ29ubmVjdGVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLndlYnNvY2tldCAhPT0gbnVsbCAmJiB0aGlzLndlYnNvY2tldC5yZWFkeVN0YXRlID09PSBXZWJTb2NrZXQuT1BFTlxuICAgICk7XG4gIH1cblxuICBzZXRNZXRhZGF0YShrZXk6IHN0cmluZywgdmFsdWU6IGFueSk6IHZvaWQge1xuICAgIHRoaXMubWV0YWRhdGEuc2V0KGtleSwgdmFsdWUpO1xuICB9XG5cbiAgZ2V0TWV0YWRhdGEoa2V5OiBzdHJpbmcpOiBhbnkge1xuICAgIHJldHVybiB0aGlzLm1ldGFkYXRhLmdldChrZXkpO1xuICB9XG5cbiAgYXN5bmMgcmVmcmVzaFNlc3Npb24oc2Vzc2lvblN0b3JlOiBJU2Vzc2lvblN0b3JlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gdGhpcy5nZXRNZXRhZGF0YShcInNlc3Npb25JZFwiKTtcbiAgICBpZiAoIXNlc3Npb25JZCkgcmV0dXJuIGZhbHNlO1xuXG4gICAgY29uc3Qgc2Vzc2lvbiA9IGF3YWl0IHNlc3Npb25TdG9yZS5nZXQoc2Vzc2lvbklkKTtcbiAgICBpZiAoIXNlc3Npb24pIHJldHVybiBmYWxzZTtcblxuICAgIHNlc3Npb24ubGFzdEFjY2Vzc2VkQXQgPSBuZXcgRGF0ZSgpO1xuICAgIHJldHVybiBzZXNzaW9uU3RvcmUudXBkYXRlKHNlc3Npb25JZCwgc2Vzc2lvbik7XG4gIH1cblxuICAvLyBTdGF0aWMgbWV0aG9kIGZvciBicm9hZGNhc3RpbmcgdG8gbXVsdGlwbGUgY29ubmVjdGlvbnNcbiAgcHVibGljIHN0YXRpYyBicm9hZGNhc3QobWVzc2FnZTogc3RyaW5nLCBjb25uZWN0aW9uczogV2Vic29ja2V0Q29ubmVjdGlvbltdKSB7XG4gICAgY29ubmVjdGlvbnMuZm9yRWFjaCgoY29ubmVjdGlvbikgPT4ge1xuICAgICAgaWYgKGNvbm5lY3Rpb24uaXNDb25uZWN0ZWQoKSkge1xuICAgICAgICBjb25uZWN0aW9uLnNlbmQobWVzc2FnZSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwdWJsaWMgZ2V0U2Vzc2lvbklkKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0TWV0YWRhdGEoXCJzZXNzaW9uSWRcIik7XG4gIH1cbn1cbiJdfQ==