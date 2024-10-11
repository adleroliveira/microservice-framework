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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUHViU3ViQ29uc3VtZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29yZS9QdWJTdWJDb25zdW1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBc0M7QUFRdEMsTUFBYSxjQUF3QixTQUFRLHFCQUFZO0lBT3ZELFlBQVksTUFBcUIsRUFBRSxVQUFpQyxFQUFFO1FBQ3BFLEtBQUssRUFBRSxDQUFDO1FBTkEsdUJBQWtCLEdBQW1DLElBQUksR0FBRyxFQUFFLENBQUM7UUFDL0Qsd0JBQW1CLEdBQWdCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDL0MsWUFBTyxHQUFZLEtBQUssQ0FBQztRQUsvQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUNyQixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksS0FBSyxDQUFDO0lBQ3RELENBQUM7SUFFRCxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQWUsRUFBRSxPQUEwQjtRQUN6RCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTztRQUNqRCxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUMxQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN2QyxDQUFDO1lBRUQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFOUMsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ2pCLElBQUksQ0FBQyxtQkFB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QUFDLEVBQUUsQ0FBQztJQUNwRSxDQUFDO0lBRUQsS0FBSyxDQUFDLEdBQUcsQ0FBQyxPQUFVO1FBQ2xCLHVEQUF1RDtJQUN6RCxDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUksQ0FBQyxPQUFVO1FBQ25CLHVEQUF1RDtJQUN6RCxDQUFDO0lBRU0sU0FBUztRQUNkLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQztJQUN0QixDQUFDO0NBQ0Y7QUExSUQsd0NBMElDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSVB1YlN1YkNsaWVudCwgQ2hhbm5lbEJpbmRpbmcgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgRXZlbnRFbWl0dGVyIH0gZnJvbSBcImV2ZW50c1wiO1xuXG5leHBvcnQgdHlwZSBNZXNzYWdlSGFuZGxlcjxUPiA9IChtZXNzYWdlOiBUKSA9PiB2b2lkO1xuXG5leHBvcnQgaW50ZXJmYWNlIFB1YlN1YkNvbnN1bWVyT3B0aW9ucyB7XG4gIGVjaG9QdWJsaXNoZWQ/OiBib29sZWFuO1xufVxuXG5leHBvcnQgY2xhc3MgUHViU3ViQ29uc3VtZXI8VCA9IGFueT4gZXh0ZW5kcyBFdmVudEVtaXR0ZXIge1xuICBwcm90ZWN0ZWQgY2xpZW50OiBJUHViU3ViQ2xpZW50O1xuICBwcm90ZWN0ZWQgc3Vic2NyaWJlZENoYW5uZWxzOiBNYXA8c3RyaW5nLCBNZXNzYWdlSGFuZGxlcjxUPj4gPSBuZXcgTWFwKCk7XG4gIHByb3RlY3RlZCBwdWJsaXNoT25seUNoYW5uZWxzOiBTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoKTtcbiAgcHJpdmF0ZSBydW5uaW5nOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgZWNob1B1Ymxpc2hlZDogYm9vbGVhbjtcblxuICBjb25zdHJ1Y3RvcihjbGllbnQ6IElQdWJTdWJDbGllbnQsIG9wdGlvbnM6IFB1YlN1YkNvbnN1bWVyT3B0aW9ucyA9IHt9KSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLmVjaG9QdWJsaXNoZWQgPSBvcHRpb25zLmVjaG9QdWJsaXNoZWQgPz8gZmFsc2U7XG4gIH1cblxuICBhc3luYyBzdWJzY3JpYmUoY2hhbm5lbDogc3RyaW5nLCBoYW5kbGVyOiBNZXNzYWdlSGFuZGxlcjxUPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnN1YnNjcmliZWRDaGFubmVscy5oYXMoY2hhbm5lbCkpIHJldHVybjtcbiAgICBpZiAodGhpcy5wdWJsaXNoT25seUNoYW5uZWxzLmhhcyhjaGFubmVsKSkge1xuICAgICAgdGhpcy5wdWJsaXNoT25seUNoYW5uZWxzLmRlbGV0ZShjaGFubmVsKTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgaWYgKHRoaXMucnVubmluZykge1xuICAgICAgICBhd2FpdCB0aGlzLmNsaWVudC5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLnNldChjaGFubmVsLCBoYW5kbGVyKTtcblxuICAgICAgaWYgKHRoaXMucnVubmluZykge1xuICAgICAgICB0aGlzLnNldHVwQ2hhbm5lbEhhbmRsZXIoY2hhbm5lbCwgaGFuZGxlcik7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgaWYgKHRoaXMucnVubmluZykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuY2xpZW50LnVuc3Vic2NyaWJlKGNoYW5uZWwpO1xuICAgICAgICB9IGNhdGNoICh1bnN1YkVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmVtaXQoXG4gICAgICAgICAgICBcImVycm9yXCIsXG4gICAgICAgICAgICBuZXcgRXJyb3IoXG4gICAgICAgICAgICAgIGBGYWlsZWQgdG8gdW5zdWJzY3JpYmUgZnJvbSBjaGFubmVsICR7Y2hhbm5lbH0gYWZ0ZXIgc3Vic2NyaXB0aW9uIGVycm9yOiAke3Vuc3ViRXJyb3IubWVzc2FnZX1gXG4gICAgICAgICAgICApXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgRmFpbGVkIHRvIHN1YnNjcmliZSB0byBjaGFubmVsICR7Y2hhbm5lbH06ICR7ZXJyb3IubWVzc2FnZX1gXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHVuc3Vic2NyaWJlKGNoYW5uZWw6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuaGFzKGNoYW5uZWwpKSByZXR1cm47XG4gICAgYXdhaXQgdGhpcy5jbGllbnQudW5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gICAgdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuZGVsZXRlKGNoYW5uZWwpO1xuICB9XG5cbiAgcmVnaXN0ZXJQdWJsaXNoT25seUNoYW5uZWwoY2hhbm5lbDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnN1YnNjcmliZWRDaGFubmVscy5oYXMoY2hhbm5lbCkpIHtcbiAgICAgIHRoaXMucHVibGlzaE9ubHlDaGFubmVscy5hZGQoY2hhbm5lbCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMucnVubmluZykgcmV0dXJuO1xuICAgIHRoaXMucnVubmluZyA9IHRydWU7XG4gICAgZm9yIChjb25zdCBbY2hhbm5lbCwgaGFuZGxlcl0gb2YgdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuZW50cmllcygpKSB7XG4gICAgICBhd2FpdCB0aGlzLmNsaWVudC5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gICAgICB0aGlzLnNldHVwQ2hhbm5lbEhhbmRsZXIoY2hhbm5lbCwgaGFuZGxlcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMucnVubmluZykgcmV0dXJuO1xuICAgIGZvciAoY29uc3QgY2hhbm5lbCBvZiB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5rZXlzKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMudW5zdWJzY3JpYmUoY2hhbm5lbCk7XG4gICAgfVxuICAgIHRoaXMucnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCk7XG4gIH1cblxuICBhc3luYyBwdWJsaXNoKGNoYW5uZWw6IHN0cmluZywgbWVzc2FnZTogVCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChcbiAgICAgICF0aGlzLnN1YnNjcmliZWRDaGFubmVscy5oYXMoY2hhbm5lbCkgJiZcbiAgICAgICF0aGlzLnB1Ymxpc2hPbmx5Q2hhbm5lbHMuaGFzKGNoYW5uZWwpXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYENoYW5uZWwgJHtjaGFubmVsfSBpcyBub3QgcmVnaXN0ZXJlZCBmb3IgcHVibGlzaGluZ2ApO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuY2xpZW50LnB1Ymxpc2goY2hhbm5lbCwgSlNPTi5zdHJpbmdpZnkobWVzc2FnZSkpO1xuXG4gICAgaWYgKHRoaXMuZWNob1B1Ymxpc2hlZCAmJiB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5oYXMoY2hhbm5lbCkpIHtcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5nZXQoY2hhbm5lbCkhO1xuICAgICAgaGFuZGxlcihtZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBiaW5kQ2hhbm5lbChjaGFubmVsOiBzdHJpbmcsIGhhbmRsZXI/OiBNZXNzYWdlSGFuZGxlcjxUPik6IENoYW5uZWxCaW5kaW5nPFQ+IHtcbiAgICBpZiAoaGFuZGxlcikge1xuICAgICAgdGhpcy5zdWJzY3JpYmUoY2hhbm5lbCwgaGFuZGxlcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzZW5kOiBhc3luYyAobWVzc2FnZTogVCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucHVibGlzaChjaGFubmVsLCBtZXNzYWdlKTtcbiAgICAgICAgfSxcbiAgICAgICAgdW5zdWJzY3JpYmU6IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnVuc3Vic2NyaWJlKGNoYW5uZWwpO1xuICAgICAgICB9LFxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZWdpc3RlclB1Ymxpc2hPbmx5Q2hhbm5lbChjaGFubmVsKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHNlbmQ6IGFzeW5jIChtZXNzYWdlOiBUKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoKGNoYW5uZWwsIG1lc3NhZ2UpO1xuICAgICAgICB9LFxuICAgICAgICB1bnN1YnNjcmliZTogYXN5bmMgKCkgPT4ge30sXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBzZXR1cENoYW5uZWxIYW5kbGVyKFxuICAgIGNoYW5uZWw6IHN0cmluZyxcbiAgICBoYW5kbGVyOiBNZXNzYWdlSGFuZGxlcjxUPlxuICApOiB2b2lkIHtcbiAgICAvLyBUaGlzIG1ldGhvZCBzaG91bGQgYmUgb3ZlcnJpZGRlbiBpbiBzdWJjbGFzc2VzIHRvIHNldCB1cCB0aGUgYWN0dWFsIG1lc3NhZ2UgaGFuZGxpbmdcbiAgfVxuXG4gIHByb3RlY3RlZCBnZW5lcmF0ZU1lc3NhZ2VJZChtZXNzYWdlOiBUKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgOSl9YDtcbiAgfVxuXG4gIGFzeW5jIGFjayhtZXNzYWdlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gZGVwZW5kcyBvbiB5b3VyIHNwZWNpZmljIHJlcXVpcmVtZW50c1xuICB9XG5cbiAgYXN5bmMgbmFjayhtZXNzYWdlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gZGVwZW5kcyBvbiB5b3VyIHNwZWNpZmljIHJlcXVpcmVtZW50c1xuICB9XG5cbiAgcHVibGljIGlzUnVubmluZygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nO1xuICB9XG59XG4iXX0=