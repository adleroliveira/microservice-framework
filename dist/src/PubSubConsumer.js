"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PubSubConsumer = void 0;
const events_1 = require("events");
class PubSubConsumer extends events_1.EventEmitter {
    constructor(client, options = {}) {
        super();
        this.subscribedChannels = new Map();
        this.publishOnlyChannels = new Set();
        this.running = false;
        this.client = client;
        this.echoPublished = options.echoPublished ?? false;
    }
    async subscribe(channel, handler) {
        if (this.subscribedChannels.has(channel))
            return;
        if (this.publishOnlyChannels.has(channel)) {
            this.publishOnlyChannels.delete(channel);
        }
        try {
            if (this.running) {
                await this.client.subscribe(channel);
            }
            this.subscribedChannels.set(channel, handler);
            if (this.running) {
                this.setupChannelHandler(channel, handler);
            }
        }
        catch (error) {
            if (this.running) {
                try {
                    await this.client.unsubscribe(channel);
                }
                catch (unsubError) {
                    this.emit("error", new Error(`Failed to unsubscribe from channel ${channel} after subscription error: ${unsubError.message}`));
                }
            }
            throw new Error(`Failed to subscribe to channel ${channel}: ${error.message}`);
        }
    }
    async unsubscribe(channel) {
        if (!this.subscribedChannels.has(channel))
            return;
        await this.client.unsubscribe(channel);
        this.subscribedChannels.delete(channel);
    }
    registerPublishOnlyChannel(channel) {
        if (!this.subscribedChannels.has(channel)) {
            this.publishOnlyChannels.add(channel);
        }
    }
    async start() {
        if (this.running)
            return;
        this.running = true;
        for (const [channel, handler] of this.subscribedChannels.entries()) {
            await this.client.subscribe(channel);
            this.setupChannelHandler(channel, handler);
        }
    }
    async stop() {
        if (!this.running)
            return;
        for (const channel of this.subscribedChannels.keys()) {
            await this.unsubscribe(channel);
        }
        this.running = false;
        this.removeAllListeners();
    }
    async publish(channel, message) {
        if (!this.subscribedChannels.has(channel) &&
            !this.publishOnlyChannels.has(channel)) {
            throw new Error(`Channel ${channel} is not registered for publishing`);
        }
        await this.client.publish(channel, JSON.stringify(message));
        if (this.echoPublished && this.subscribedChannels.has(channel)) {
            const handler = this.subscribedChannels.get(channel);
            const messageWrapper = {
                id: this.generateMessageId(message),
                payload: message,
                timestamp: Date.now(),
            };
            handler(messageWrapper);
        }
    }
    bindChannel(channel, handler) {
        if (handler) {
            this.subscribe(channel, handler);
            return {
                send: async (message) => {
                    await this.publish(channel, message);
                },
                unsubscribe: async () => {
                    await this.unsubscribe(channel);
                },
            };
        }
        else {
            this.registerPublishOnlyChannel(channel);
            return {
                send: async (message) => {
                    await this.publish(channel, message);
                },
                unsubscribe: async () => { },
            };
        }
    }
    setupChannelHandler(channel, handler) {
        // This method should be overridden in subclasses to set up the actual message handling
    }
    generateMessageId(message) {
        return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
    async ack(message) {
        // Implementation depends on your specific requirements
    }
    async nack(message) {
        // Implementation depends on your specific requirements
    }
    isRunning() {
        return this.running;
    }
}
exports.PubSubConsumer = PubSubConsumer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUHViU3ViQ29uc3VtZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvUHViU3ViQ29uc3VtZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsbUNBQXNDO0FBYXRDLE1BQWEsY0FBd0IsU0FBUSxxQkFBWTtJQU92RCxZQUFZLE1BQXFCLEVBQUUsVUFBaUMsRUFBRTtRQUNwRSxLQUFLLEVBQUUsQ0FBQztRQU5BLHVCQUFrQixHQUFtQyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQy9ELHdCQUFtQixHQUFnQixJQUFJLEdBQUcsRUFBRSxDQUFDO1FBQy9DLFlBQU8sR0FBWSxLQUFLLENBQUM7UUFLL0IsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUM7UUFDckIsSUFBSSxDQUFDLGFBQWEsR0FBRyxPQUFPLENBQUMsYUFBYSxJQUFJLEtBQUssQ0FBQztJQUN0RCxDQUFDO0lBRUQsS0FBSyxDQUFDLFNBQVMsQ0FBQyxPQUFlLEVBQUUsT0FBMEI7UUFDekQsSUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQztZQUFFLE9BQU87UUFDakQsSUFBSSxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDMUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMzQyxDQUFDO1FBRUQsSUFBSSxDQUFDO1lBQ0gsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ2pCLE1BQU0sSUFBSSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDdkMsQ0FBQztZQUVELElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBRTlDLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNqQixJQUFJLENBQUMsbUJBQW1CLENBQUMs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QUFpQixDQUFDLE9BQVU7UUFDcEMsT0FBTyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUNwRSxDQUFDO0lBRUQsS0FBSyxDQUFDLEdBQUcsQ0FBQyxPQUFvQjtRQUM1Qix1REFBdUQ7SUFDekQsQ0FBQztJQUVELEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBb0I7UUFDN0IsdURBQXVEO0lBQ3pELENBQUM7SUFFTSxTQUFTO1FBQ2QsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDO0lBQ3RCLENBQUM7Q0FDRjtBQS9JRCx3Q0ErSUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBJUHViU3ViQ2xpZW50LCBJTWVzc2FnZSB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gXCJldmVudHNcIjtcblxuZXhwb3J0IHR5cGUgTWVzc2FnZUhhbmRsZXI8VD4gPSAobWVzc2FnZTogSU1lc3NhZ2U8VD4pID0+IHZvaWQ7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbm5lbEJpbmRpbmc8VD4ge1xuICBzZW5kOiAobWVzc2FnZTogVCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgdW5zdWJzY3JpYmU6ICgpID0+IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHViU3ViQ29uc3VtZXJPcHRpb25zIHtcbiAgZWNob1B1Ymxpc2hlZD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjbGFzcyBQdWJTdWJDb25zdW1lcjxUID0gYW55PiBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIHByb3RlY3RlZCBjbGllbnQ6IElQdWJTdWJDbGllbnQ7XG4gIHByb3RlY3RlZCBzdWJzY3JpYmVkQ2hhbm5lbHM6IE1hcDxzdHJpbmcsIE1lc3NhZ2VIYW5kbGVyPFQ+PiA9IG5ldyBNYXAoKTtcbiAgcHJvdGVjdGVkIHB1Ymxpc2hPbmx5Q2hhbm5lbHM6IFNldDxzdHJpbmc+ID0gbmV3IFNldCgpO1xuICBwcml2YXRlIHJ1bm5pbmc6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBlY2hvUHVibGlzaGVkOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKGNsaWVudDogSVB1YlN1YkNsaWVudCwgb3B0aW9uczogUHViU3ViQ29uc3VtZXJPcHRpb25zID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50O1xuICAgIHRoaXMuZWNob1B1Ymxpc2hlZCA9IG9wdGlvbnMuZWNob1B1Ymxpc2hlZCA/PyBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHN1YnNjcmliZShjaGFubmVsOiBzdHJpbmcsIGhhbmRsZXI6IE1lc3NhZ2VIYW5kbGVyPFQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSkgcmV0dXJuO1xuICAgIGlmICh0aGlzLnB1Ymxpc2hPbmx5Q2hhbm5lbHMuaGFzKGNoYW5uZWwpKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hPbmx5Q2hhbm5lbHMuZGVsZXRlKGNoYW5uZWwpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xpZW50LnN1YnNjcmliZShjaGFubmVsKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuc2V0KGNoYW5uZWwsIGhhbmRsZXIpO1xuXG4gICAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICAgIHRoaXMuc2V0dXBDaGFubmVsSGFuZGxlcihjaGFubmVsLCBoYW5kbGVyKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jbGllbnQudW5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gICAgICAgIH0gY2F0Y2ggKHVuc3ViRXJyb3I6IGFueSkge1xuICAgICAgICAgIHRoaXMuZW1pdChcbiAgICAgICAgICAgIFwiZXJyb3JcIixcbiAgICAgICAgICAgIG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYEZhaWxlZCB0byB1bnN1YnNjcmliZSBmcm9tIGNoYW5uZWwgJHtjaGFubmVsfSBhZnRlciBzdWJzY3JpcHRpb24gZXJyb3I6ICR7dW5zdWJFcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBGYWlsZWQgdG8gc3Vic2NyaWJlIHRvIGNoYW5uZWwgJHtjaGFubmVsfTogJHtlcnJvci5tZXNzYWdlfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdW5zdWJzY3JpYmUoY2hhbm5lbDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnN1YnNjcmliZWRDaGFubmVscy5oYXMoY2hhbm5lbCkpIHJldHVybjtcbiAgICBhd2FpdCB0aGlzLmNsaWVudC51bnN1YnNjcmliZShjaGFubmVsKTtcbiAgICB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5kZWxldGUoY2hhbm5lbCk7XG4gIH1cblxuICByZWdpc3RlclB1Ymxpc2hPbmx5Q2hhbm5lbChjaGFubmVsOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSkge1xuICAgICAgdGhpcy5wdWJsaXNoT25seUNoYW5uZWxzLmFkZChjaGFubmVsKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5ydW5uaW5nKSByZXR1cm47XG4gICAgdGhpcy5ydW5uaW5nID0gdHJ1ZTtcbiAgICBmb3IgKGNvbnN0IFtjaGFubmVsLCBoYW5kbGVyXSBvZiB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5lbnRyaWVzKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xpZW50LnN1YnNjcmliZShjaGFubmVsKTtcbiAgICAgIHRoaXMuc2V0dXBDaGFubmVsSGFuZGxlcihjaGFubmVsLCBoYW5kbGVyKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzdG9wKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5ydW5uaW5nKSByZXR1cm47XG4gICAgZm9yIChjb25zdCBjaGFubmVsIG9mIHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmtleXMoKSkge1xuICAgICAgYXdhaXQgdGhpcy51bnN1YnNjcmliZShjaGFubmVsKTtcbiAgICB9XG4gICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgfVxuXG4gIGFzeW5jIHB1Ymxpc2goY2hhbm5lbDogc3RyaW5nLCBtZXNzYWdlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKFxuICAgICAgIXRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSAmJlxuICAgICAgIXRoaXMucHVibGlzaE9ubHlDaGFubmVscy5oYXMoY2hhbm5lbClcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2hhbm5lbCAke2NoYW5uZWx9IGlzIG5vdCByZWdpc3RlcmVkIGZvciBwdWJsaXNoaW5nYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jbGllbnQucHVibGlzaChjaGFubmVsLCBKU09OLnN0cmluZ2lmeShtZXNzYWdlKSk7XG5cbiAgICBpZiAodGhpcy5lY2hvUHVibGlzaGVkICYmIHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSkge1xuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmdldChjaGFubmVsKSE7XG4gICAgICBjb25zdCBtZXNzYWdlV3JhcHBlcjogSU1lc3NhZ2U8VD4gPSB7XG4gICAgICAgIGlkOiB0aGlzLmdlbmVyYXRlTWVzc2FnZUlkKG1lc3NhZ2UpLFxuICAgICAgICBwYXlsb2FkOiBtZXNzYWdlLFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICB9O1xuICAgICAgaGFuZGxlcihtZXNzYWdlV3JhcHBlcik7XG4gICAgfVxuICB9XG5cbiAgYmluZENoYW5uZWwoY2hhbm5lbDogc3RyaW5nLCBoYW5kbGVyPzogTWVzc2FnZUhhbmRsZXI8VD4pOiBDaGFubmVsQmluZGluZzxUPiB7XG4gICAgaWYgKGhhbmRsZXIpIHtcbiAgICAgIHRoaXMuc3Vic2NyaWJlKGNoYW5uZWwsIGhhbmRsZXIpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc2VuZDogYXN5bmMgKG1lc3NhZ2U6IFQpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2goY2hhbm5lbCwgbWVzc2FnZSk7XG4gICAgICAgIH0sXG4gICAgICAgIHVuc3Vic2NyaWJlOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy51bnN1YnNjcmliZShjaGFubmVsKTtcbiAgICAgICAgfSxcbiAgICAgIH07XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVnaXN0ZXJQdWJsaXNoT25seUNoYW5uZWwoY2hhbm5lbCk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzZW5kOiBhc3luYyAobWVzc2FnZTogVCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucHVibGlzaChjaGFubmVsLCBtZXNzYWdlKTtcbiAgICAgICAgfSxcbiAgICAgICAgdW5zdWJzY3JpYmU6IGFzeW5jICgpID0+IHt9LFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgc2V0dXBDaGFubmVsSGFuZGxlcihcbiAgICBjaGFubmVsOiBzdHJpbmcsXG4gICAgaGFuZGxlcjogTWVzc2FnZUhhbmRsZXI8VD5cbiAgKTogdm9pZCB7XG4gICAgLy8gVGhpcyBtZXRob2Qgc2hvdWxkIGJlIG92ZXJyaWRkZW4gaW4gc3ViY2xhc3NlcyB0byBzZXQgdXAgdGhlIGFjdHVhbCBtZXNzYWdlIGhhbmRsaW5nXG4gIH1cblxuICBwcm90ZWN0ZWQgZ2VuZXJhdGVNZXNzYWdlSWQobWVzc2FnZTogVCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XG4gIH1cblxuICBhc3luYyBhY2sobWVzc2FnZTogSU1lc3NhZ2U8VD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBkZXBlbmRzIG9uIHlvdXIgc3BlY2lmaWMgcmVxdWlyZW1lbnRzXG4gIH1cblxuICBhc3luYyBuYWNrKG1lc3NhZ2U6IElNZXNzYWdlPFQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gZGVwZW5kcyBvbiB5b3VyIHNwZWNpZmljIHJlcXVpcmVtZW50c1xuICB9XG5cbiAgcHVibGljIGlzUnVubmluZygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nO1xuICB9XG59XG4iXX0=