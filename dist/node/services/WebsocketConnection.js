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
}
exports.WebsocketConnection = WebsocketConnection;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2Vic29ja2V0Q29ubmVjdGlvbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9zZXJ2aWNlcy9XZWJzb2NrZXRDb25uZWN0aW9uLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLDRDQUEyQjtBQUczQixNQUFhLG1CQUFtQjtJQVU5QixZQUNVLGFBR0MsRUFDRCxXQUEyQyxFQUMzQyxvQkFBNEIsTUFBTSxFQUFFLFlBQVk7SUFDaEQsdUJBQStCLEdBQUcsRUFDMUMsU0FBcUI7UUFQYixrQkFBYSxHQUFiLGFBQWEsQ0FHWjtRQUNELGdCQUFXLEdBQVgsV0FBVyxDQUFnQztRQUMzQyxzQkFBaUIsR0FBakIsaUJBQWlCLENBQWlCO1FBQ2xDLHlCQUFvQixHQUFwQixvQkFBb0IsQ0FBYztRQWRwQyxpQkFBWSxHQUFXLENBQUMsQ0FBQztRQUN6QixrQkFBYSxHQUFZLEtBQUssQ0FBQztRQUMvQixhQUFRLEdBQXFCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDdkMsY0FBUyxHQUFxQixJQUFJLENBQUM7UUFDbkMsd0JBQW1CLEdBQVksS0FBSyxDQUFDO1FBQ3JDLGlCQUFZLEdBQXlCLElBQUksQ0FBQztRQVloRCxJQUFJLENBQUMsWUFBWSxHQUFHLE1BQU0sQ0FBQyxVQUFVLEVBQUUsQ0FBQztRQUN4QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBRW5DLElBQUksU0FBUyxFQUFFLENBQUM7WUFDZCxJQUFJLENBQUMsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQy9CLENBQUM7UUFFRCxJQUFJLENBQUMsb0JBQW9CLEVBQUUsQ0FBQztJQUM5QixDQUFDO0lBRU0sWUFBWSxDQUFDLFNBQW9CO1FBQ3RDLElBQUksQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDO1FBQzNCLElBQUksQ0FBQyxtQkFBbUIsRUFBRSxDQUFDO1FBQzNCLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJ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QUksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMzQixDQUFDO1FBQ0gsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFyTEQsa0RBcUxDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IFdlYlNvY2tldCBmcm9tIFwid3NcIjtcbmltcG9ydCB7IElTZXNzaW9uU3RvcmUgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuXG5leHBvcnQgY2xhc3MgV2Vic29ja2V0Q29ubmVjdGlvbiB7XG4gIHByaXZhdGUgY29ubmVjdGlvbklkOiBzdHJpbmc7XG4gIHByaXZhdGUgbGFzdEFjdGl2aXR5VGltZTogbnVtYmVyO1xuICBwcml2YXRlIG1lc3NhZ2VDb3VudDogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSBhdXRoZW50aWNhdGVkOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgbWV0YWRhdGE6IE1hcDxzdHJpbmcsIGFueT4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgd2Vic29ja2V0OiBXZWJTb2NrZXQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBldmVudExpc3RlbmVyc1NldHVwOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VQcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSBoYW5kbGVNZXNzYWdlOiAoXG4gICAgICBkYXRhOiBXZWJTb2NrZXQuRGF0YSxcbiAgICAgIHdlYnNvY2tldDogV2Vic29ja2V0Q29ubmVjdGlvblxuICAgICkgPT4gdm9pZCxcbiAgICBwcml2YXRlIGhhbmRsZUNsb3NlOiAoY29ubmVjdGlvbklkOiBzdHJpbmcpID0+IHZvaWQsXG4gICAgcHJpdmF0ZSBpbmFjdGl2aXR5VGltZW91dDogbnVtYmVyID0gMzAwMDAwLCAvLyA1IG1pbnV0ZXNcbiAgICBwcml2YXRlIG1heE1lc3NhZ2VzUGVyTWludXRlOiBudW1iZXIgPSAxMDAsXG4gICAgd2Vic29ja2V0PzogV2ViU29ja2V0XG4gICkge1xuICAgIHRoaXMuY29ubmVjdGlvbklkID0gY3J5cHRvLnJhbmRvbVVVSUQoKTtcbiAgICB0aGlzLmxhc3RBY3Rpdml0eVRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgaWYgKHdlYnNvY2tldCkge1xuICAgICAgdGhpcy5zZXRXZWJTb2NrZXQod2Vic29ja2V0KTtcbiAgICB9XG5cbiAgICB0aGlzLnN0YXJ0SW5hY3Rpdml0eVRpbWVyKCk7XG4gIH1cblxuICBwdWJsaWMgc2V0V2ViU29ja2V0KHdlYnNvY2tldDogV2ViU29ja2V0KSB7XG4gICAgdGhpcy53ZWJzb2NrZXQgPSB3ZWJzb2NrZXQ7XG4gICAgdGhpcy5zZXR1cEV2ZW50TGlzdGVuZXJzKCk7XG4gICAgdGhpcy5sYXN0QWN0aXZpdHlUaW1lID0gRGF0ZS5ub3coKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBFdmVudExpc3RlbmVycygpIHtcbiAgICBpZiAoIXRoaXMud2Vic29ja2V0IHx8IHRoaXMuZXZlbnRMaXN0ZW5lcnNTZXR1cCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMud2Vic29ja2V0Lm9uKFwibWVzc2FnZVwiLCB0aGlzLmhhbmRsZVdlYnNvY2tldE1lc3NhZ2VzLmJpbmQodGhpcykpO1xuICAgIHRoaXMud2Vic29ja2V0Lm9uKFwiY2xvc2VcIiwgdGhpcy5oYW5kbGVDbG9zZUNvbm5lY3Rpb24uYmluZCh0aGlzKSk7XG4gICAgdGhpcy53ZWJzb2NrZXQub24oXCJwb25nXCIsIHRoaXMuaGFuZGxlUG9uZy5iaW5kKHRoaXMpKTtcblxuICAgIHRoaXMuZXZlbnRMaXN0ZW5lcnNTZXR1cCA9IHRydWU7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0SW5hY3Rpdml0eVRpbWVyKCkge1xuICAgIHNldEludGVydmFsKCgpID0+IHtcbiAgICAgIGlmIChEYXRlLm5vdygpIC0gdGhpcy5sYXN0QWN0aXZpdHlUaW1lID4gdGhpcy5pbmFjdGl2aXR5VGltZW91dCkge1xuICAgICAgICB0aGlzLmNsb3NlKDEwMDAsIFwiQ29ubmVjdGlvbiB0aW1lZCBvdXQgZHVlIHRvIGluYWN0aXZpdHlcIik7XG4gICAgICB9XG4gICAgfSwgNjAwMDApOyAvLyBDaGVjayBldmVyeSBtaW51dGVcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlUG9uZygpIHtcbiAgICB0aGlzLmxhc3RBY3Rpdml0eVRpbWUgPSBEYXRlLm5vdygpO1xuICB9XG5cbiAgcHVibGljIHNlbmQobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgaWYgKCF0aGlzLndlYnNvY2tldCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQ2Fubm90IHNlbmQgbWVzc2FnZTogV2ViU29ja2V0IG5vdCBpbml0aWFsaXplZFwiKTtcbiAgICB9XG4gICAgdGhpcy53ZWJzb2NrZXQuc2VuZChtZXNzYWdlKTtcbiAgICB0aGlzLmxhc3RBY3Rpdml0eVRpbWUgPSBEYXRlLm5vdygpO1xuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVDbG9zZUNvbm5lY3Rpb24oKSB7XG4gICAgdGhpcy5oYW5kbGVDbG9zZSh0aGlzLmNvbm5lY3Rpb25JZCk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVdlYnNvY2tldE1lc3NhZ2VzKG1lc3NhZ2U6IFdlYlNvY2tldC5EYXRhKSB7XG4gICAgdGhpcy5sYXN0QWN0aXZpdHlUaW1lID0gRGF0ZS5ub3coKTtcbiAgICBpZiAodGhpcy5pc1JhdGVMaW1pdGVkKCkpIHtcbiAgICAgIHRoaXMuc2VuZChcIlJhdGUgbGltaXQgZXhjZWVkZWQuIFBsZWFzZSBzbG93IGRvd24uXCIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLm1lc3NhZ2VDb3VudCsrO1xuICAgIHRoaXMuaGFuZGxlTWVzc2FnZShtZXNzYWdlLCB0aGlzKTtcbiAgfVxuXG4gIHByaXZhdGUgaXNSYXRlTGltaXRlZCgpOiBib29sZWFuIHtcbiAgICBjb25zdCBvbmVNaW51dGVBZ28gPSBEYXRlLm5vdygpIC0gNjAwMDA7XG4gICAgaWYgKFxuICAgICAgdGhpcy5tZXNzYWdlQ291bnQgPiB0aGlzLm1heE1lc3NhZ2VzUGVyTWludXRlICYmXG4gICAgICB0aGlzLmxhc3RBY3Rpdml0eVRpbWUgPiBvbmVNaW51dGVBZ29cbiAgICApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBpZiAodGhpcy5sYXN0QWN0aXZpdHlUaW1lIDw9IG9uZU1pbnV0ZUFnbykge1xuICAgICAgdGhpcy5tZXNzYWdlQ291bnQgPSAwO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwdWJsaWMgZ2V0Q29ubmVjdGlvbklkKCkge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3Rpb25JZDtcbiAgfVxuXG4gIHB1YmxpYyBzZXRBdXRoZW50aWNhdGVkKHZhbHVlOiBib29sZWFuKSB7XG4gICAgdGhpcy5hdXRoZW50aWNhdGVkID0gdmFsdWU7XG4gIH1cblxuICBwdWJsaWMgaXNBdXRoZW50aWNhdGVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmF1dGhlbnRpY2F0ZWQ7XG4gIH1cblxuICBwdWJsaWMgY2xvc2UoY29kZT86IG51bWJlciwgcmVhc29uPzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmNsb3NlUHJvbWlzZSkge1xuICAgICAgdGhpcy5jbG9zZVByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgICBpZiAoIXRoaXMud2Vic29ja2V0KSB7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEhhbmRsZSB0aGUgY2FzZSB3aGVyZSB0aGUgc29ja2V0IGlzIGFscmVhZHkgY2xvc2VkXG4gICAgICAgIGlmICh0aGlzLndlYnNvY2tldC5yZWFkeVN0YXRlID09PSBXZWJTb2NrZXQuQ0xPU0VEKSB7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIExpc3RlbiBmb3IgdGhlIGNsb3NlIGV2ZW50XG4gICAgICAgIGNvbnN0IG9uQ2xvc2UgPSAoKSA9PiB7XG4gICAgICAgICAgdGhpcy53ZWJzb2NrZXQ/LnJlbW92ZUxpc3RlbmVyKCdjbG9zZScsIG9uQ2xvc2UpO1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfTtcblxuICAgICAgICB0aGlzLndlYnNvY2tldC5vbignY2xvc2UnLCBvbkNsb3NlKTtcbiAgICAgICAgdGhpcy53ZWJzb2NrZXQuY2xvc2UoY29kZSwgcmVhc29uKTtcblxuICAgICAgICAvLyBTYWZlZ3VhcmQ6IHJlc29sdmUgYWZ0ZXIgNSBzZWNvbmRzIGV2ZW4gaWYgd2UgZG9uJ3QgZ2V0IGEgY2xvc2UgZXZlbnRcbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgdGhpcy53ZWJzb2NrZXQ/LnJlbW92ZUxpc3RlbmVyKCdjbG9zZScsIG9uQ2xvc2UpO1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfSwgNTAwMCk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5jbG9zZVByb21pc2U7XG4gIH1cblxuICBwdWJsaWMgcGluZygpIHtcbiAgICBpZiAodGhpcy53ZWJzb2NrZXQpIHtcbiAgICAgIHRoaXMud2Vic29ja2V0LnBpbmcoKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgaXNDb25uZWN0ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIChcbiAgICAgIHRoaXMud2Vic29ja2V0ICE9PSBudWxsICYmIHRoaXMud2Vic29ja2V0LnJlYWR5U3RhdGUgPT09IFdlYlNvY2tldC5PUEVOXG4gICAgKTtcbiAgfVxuXG4gIHNldE1ldGFkYXRhKGtleTogc3RyaW5nLCB2YWx1ZTogYW55KTogdm9pZCB7XG4gICAgdGhpcy5tZXRhZGF0YS5zZXQoa2V5LCB2YWx1ZSk7XG4gIH1cblxuICBnZXRNZXRhZGF0YShrZXk6IHN0cmluZyk6IGFueSB7XG4gICAgcmV0dXJuIHRoaXMubWV0YWRhdGEuZ2V0KGtleSk7XG4gIH1cblxuICBhc3luYyByZWZyZXNoU2Vzc2lvbihzZXNzaW9uU3RvcmU6IElTZXNzaW9uU3RvcmUpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBzZXNzaW9uSWQgPSB0aGlzLmdldE1ldGFkYXRhKFwic2Vzc2lvbklkXCIpO1xuICAgIGlmICghc2Vzc2lvbklkKSByZXR1cm4gZmFsc2U7XG5cbiAgICBjb25zdCBzZXNzaW9uID0gYXdhaXQgc2Vzc2lvblN0b3JlLmdldChzZXNzaW9uSWQpO1xuICAgIGlmICghc2Vzc2lvbikgcmV0dXJuIGZhbHNlO1xuXG4gICAgc2Vzc2lvbi5sYXN0QWNjZXNzZWRBdCA9IG5ldyBEYXRlKCk7XG4gICAgcmV0dXJuIHNlc3Npb25TdG9yZS51cGRhdGUoc2Vzc2lvbklkLCBzZXNzaW9uKTtcbiAgfVxuXG4gIC8vIFN0YXRpYyBtZXRob2QgZm9yIGJyb2FkY2FzdGluZyB0byBtdWx0aXBsZSBjb25uZWN0aW9uc1xuICBwdWJsaWMgc3RhdGljIGJyb2FkY2FzdChtZXNzYWdlOiBzdHJpbmcsIGNvbm5lY3Rpb25zOiBXZWJzb2NrZXRDb25uZWN0aW9uW10pIHtcbiAgICBjb25uZWN0aW9ucy5mb3JFYWNoKChjb25uZWN0aW9uKSA9PiB7XG4gICAgICBpZiAoY29ubmVjdGlvbi5pc0Nvbm5lY3RlZCgpKSB7XG4gICAgICAgIGNvbm5lY3Rpb24uc2VuZChtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuIl19