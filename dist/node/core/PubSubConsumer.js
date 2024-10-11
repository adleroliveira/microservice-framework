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
            handler(message);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUHViU3ViQ29uc3VtZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29yZS9QdWJTdWJDb25zdW1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBc0M7QUFhdEMsTUFBYSxjQUF3QixTQUFRLHFCQUFZO0lBT3ZELFlBQVksTUFBcUIsRUFBRSxVQUFpQyxFQUFFO1FBQ3BFLEtBQUssRUFBRSxDQUFDO1FBTkEsdUJBQWtCLEdBQW1DLElBQUksR0FBRyxFQUFFLENBQUM7UUFDL0Qsd0JBQW1CLEdBQWdCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDL0MsWUFBTyxHQUFZLEtBQUssQ0FBQztRQUsvQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUNyQixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksS0FBSyxDQUFDO0lBQ3RELENBQUM7SUFFRCxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQWUsRUFBRSxPQUEwQjtRQUN6RCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTztRQUNqRCxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUMxQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN2QyxDQUFDO1lBRUQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFOUMsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ2pCLElBQUksQ0FBQyxtQkFB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QUFDLEVBQUUsQ0FBQztJQUNwRSxDQUFDO0lBRUQsS0FBSyxDQUFDLEdBQUcsQ0FBQyxPQUFVO1FBQ2xCLHVEQUF1RDtJQUN6RCxDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFVO1FBQ25CLHVEQUF1RDtJQUN6RCxDQUFDO0lBRU0sU0FBUztRQUNkLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQztJQUN0QixDQUFDO0NBQ0Y7QUExSUQsd0NBMElDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSVB1YlN1YkNsaWVudCB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tIFwiZXZlbnRzXCI7XG5cbmV4cG9ydCB0eXBlIE1lc3NhZ2VIYW5kbGVyPFQ+ID0gKG1lc3NhZ2U6IFQpID0+IHZvaWQ7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbm5lbEJpbmRpbmc8VD4ge1xuICBzZW5kOiAobWVzc2FnZTogVCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgdW5zdWJzY3JpYmU6ICgpID0+IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUHViU3ViQ29uc3VtZXJPcHRpb25zIHtcbiAgZWNob1B1Ymxpc2hlZD86IGJvb2xlYW47XG59XG5cbmV4cG9ydCBjbGFzcyBQdWJTdWJDb25zdW1lcjxUID0gYW55PiBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG4gIHByb3RlY3RlZCBjbGllbnQ6IElQdWJTdWJDbGllbnQ7XG4gIHByb3RlY3RlZCBzdWJzY3JpYmVkQ2hhbm5lbHM6IE1hcDxzdHJpbmcsIE1lc3NhZ2VIYW5kbGVyPFQ+PiA9IG5ldyBNYXAoKTtcbiAgcHJvdGVjdGVkIHB1Ymxpc2hPbmx5Q2hhbm5lbHM6IFNldDxzdHJpbmc+ID0gbmV3IFNldCgpO1xuICBwcml2YXRlIHJ1bm5pbmc6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBlY2hvUHVibGlzaGVkOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKGNsaWVudDogSVB1YlN1YkNsaWVudCwgb3B0aW9uczogUHViU3ViQ29uc3VtZXJPcHRpb25zID0ge30pIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50O1xuICAgIHRoaXMuZWNob1B1Ymxpc2hlZCA9IG9wdGlvbnMuZWNob1B1Ymxpc2hlZCA/PyBmYWxzZTtcbiAgfVxuXG4gIGFzeW5jIHN1YnNjcmliZShjaGFubmVsOiBzdHJpbmcsIGhhbmRsZXI6IE1lc3NhZ2VIYW5kbGVyPFQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSkgcmV0dXJuO1xuICAgIGlmICh0aGlzLnB1Ymxpc2hPbmx5Q2hhbm5lbHMuaGFzKGNoYW5uZWwpKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hPbmx5Q2hhbm5lbHMuZGVsZXRlKGNoYW5uZWwpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuY2xpZW50LnN1YnNjcmliZShjaGFubmVsKTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuc2V0KGNoYW5uZWwsIGhhbmRsZXIpO1xuXG4gICAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICAgIHRoaXMuc2V0dXBDaGFubmVsSGFuZGxlcihjaGFubmVsLCBoYW5kbGVyKTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5jbGllbnQudW5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gICAgICAgIH0gY2F0Y2ggKHVuc3ViRXJyb3I6IGFueSkge1xuICAgICAgICAgIHRoaXMuZW1pdChcbiAgICAgICAgICAgIFwiZXJyb3JcIixcbiAgICAgICAgICAgIG5ldyBFcnJvcihcbiAgICAgICAgICAgICAgYEZhaWxlZCB0byB1bnN1YnNjcmliZSBmcm9tIGNoYW5uZWwgJHtjaGFubmVsfSBhZnRlciBzdWJzY3JpcHRpb24gZXJyb3I6ICR7dW5zdWJFcnJvci5tZXNzYWdlfWBcbiAgICAgICAgICAgIClcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBGYWlsZWQgdG8gc3Vic2NyaWJlIHRvIGNoYW5uZWwgJHtjaGFubmVsfTogJHtlcnJvci5tZXNzYWdlfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdW5zdWJzY3JpYmUoY2hhbm5lbDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnN1YnNjcmliZWRDaGFubmVscy5oYXMoY2hhbm5lbCkpIHJldHVybjtcbiAgICBhd2FpdCB0aGlzLmNsaWVudC51bnN1YnNjcmliZShjaGFubmVsKTtcbiAgICB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5kZWxldGUoY2hhbm5lbCk7XG4gIH1cblxuICByZWdpc3RlclB1Ymxpc2hPbmx5Q2hhbm5lbChjaGFubmVsOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSkge1xuICAgICAgdGhpcy5wdWJsaXNoT25seUNoYW5uZWxzLmFkZChjaGFubmVsKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5ydW5uaW5nKSByZXR1cm47XG4gICAgdGhpcy5ydW5uaW5nID0gdHJ1ZTtcbiAgICBmb3IgKGNvbnN0IFtjaGFubmVsLCBoYW5kbGVyXSBvZiB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5lbnRyaWVzKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuY2xpZW50LnN1YnNjcmliZShjaGFubmVsKTtcbiAgICAgIHRoaXMuc2V0dXBDaGFubmVsSGFuZGxlcihjaGFubmVsLCBoYW5kbGVyKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzdG9wKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5ydW5uaW5nKSByZXR1cm47XG4gICAgZm9yIChjb25zdCBjaGFubmVsIG9mIHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmtleXMoKSkge1xuICAgICAgYXdhaXQgdGhpcy51bnN1YnNjcmliZShjaGFubmVsKTtcbiAgICB9XG4gICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7XG4gICAgdGhpcy5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgfVxuXG4gIGFzeW5jIHB1Ymxpc2goY2hhbm5lbDogc3RyaW5nLCBtZXNzYWdlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKFxuICAgICAgIXRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSAmJlxuICAgICAgIXRoaXMucHVibGlzaE9ubHlDaGFubmVscy5oYXMoY2hhbm5lbClcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgQ2hhbm5lbCAke2NoYW5uZWx9IGlzIG5vdCByZWdpc3RlcmVkIGZvciBwdWJsaXNoaW5nYCk7XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5jbGllbnQucHVibGlzaChjaGFubmVsLCBKU09OLnN0cmluZ2lmeShtZXNzYWdlKSk7XG5cbiAgICBpZiAodGhpcy5lY2hvUHVibGlzaGVkICYmIHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSkge1xuICAgICAgY29uc3QgaGFuZGxlciA9IHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmdldChjaGFubmVsKSE7XG4gICAgICBoYW5kbGVyKG1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIGJpbmRDaGFubmVsKGNoYW5uZWw6IHN0cmluZywgaGFuZGxlcj86IE1lc3NhZ2VIYW5kbGVyPFQ+KTogQ2hhbm5lbEJpbmRpbmc8VD4ge1xuICAgIGlmIChoYW5kbGVyKSB7XG4gICAgICB0aGlzLnN1YnNjcmliZShjaGFubmVsLCBoYW5kbGVyKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHNlbmQ6IGFzeW5jIChtZXNzYWdlOiBUKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoKGNoYW5uZWwsIG1lc3NhZ2UpO1xuICAgICAgICB9LFxuICAgICAgICB1bnN1YnNjcmliZTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMudW5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gICAgICAgIH0sXG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlZ2lzdGVyUHVibGlzaE9ubHlDaGFubmVsKGNoYW5uZWwpO1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc2VuZDogYXN5bmMgKG1lc3NhZ2U6IFQpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnB1Ymxpc2goY2hhbm5lbCwgbWVzc2FnZSk7XG4gICAgICAgIH0sXG4gICAgICAgIHVuc3Vic2NyaWJlOiBhc3luYyAoKSA9PiB7fSxcbiAgICAgIH07XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIHNldHVwQ2hhbm5lbEhhbmRsZXIoXG4gICAgY2hhbm5lbDogc3RyaW5nLFxuICAgIGhhbmRsZXI6IE1lc3NhZ2VIYW5kbGVyPFQ+XG4gICk6IHZvaWQge1xuICAgIC8vIFRoaXMgbWV0aG9kIHNob3VsZCBiZSBvdmVycmlkZGVuIGluIHN1YmNsYXNzZXMgdG8gc2V0IHVwIHRoZSBhY3R1YWwgbWVzc2FnZSBoYW5kbGluZ1xuICB9XG5cbiAgcHJvdGVjdGVkIGdlbmVyYXRlTWVzc2FnZUlkKG1lc3NhZ2U6IFQpOiBzdHJpbmcge1xuICAgIHJldHVybiBgJHtEYXRlLm5vdygpfS0ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xuICB9XG5cbiAgYXN5bmMgYWNrKG1lc3NhZ2U6IFQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBkZXBlbmRzIG9uIHlvdXIgc3BlY2lmaWMgcmVxdWlyZW1lbnRzXG4gIH1cblxuICBhc3luYyBuYWNrKG1lc3NhZ2U6IFQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiBkZXBlbmRzIG9uIHlvdXIgc3BlY2lmaWMgcmVxdWlyZW1lbnRzXG4gIH1cblxuICBwdWJsaWMgaXNSdW5uaW5nKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnJ1bm5pbmc7XG4gIH1cbn1cbiJdfQ==