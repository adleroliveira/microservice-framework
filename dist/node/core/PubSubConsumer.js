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
        await this.client.publish(channel, safeStringify(message));
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
function safeStringify(value, options = {}) {
    const { fallback = "[Object]", maxDepth = 3, classInstanceHandler = (instance) => {
        const className = instance.constructor?.name || "Object";
        // Try to get an ID or name property, common in many classes
        const identifier = instance.id || instance.name || "";
        return `[${className}${identifier ? `:${identifier}` : ""}]`;
    }, } = options;
    try {
        const seen = new WeakSet();
        const serializer = (key, value, depth = 0) => {
            // Handle null and undefined
            if (value === null || value === undefined) {
                return value;
            }
            // Handle primitive types
            if (typeof value !== "object") {
                return value;
            }
            // Check for circular reference
            if (seen.has(value)) {
                return "[Circular]";
            }
            // Check depth limit
            if (depth >= maxDepth) {
                return "[Nested]";
            }
            // Handle class instances (non-plain objects)
            if (value.constructor && value.constructor !== Object) {
                return classInstanceHandler(value);
            }
            // Handle Date objects
            if (value instanceof Date) {
                return value.toISOString();
            }
            // Handle arrays
            if (Array.isArray(value)) {
                seen.add(value);
                const result = value.map((item) => serializer("", item, depth + 1));
                seen.delete(value);
                return result;
            }
            // Handle plain objects
            seen.add(value);
            const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializer(k, v, depth + 1)]));
            seen.delete(value);
            return result;
        };
        return JSON.stringify(value, (key, value) => serializer(key, value));
    }
    catch (error) {
        console.error("Stringification failed:", error);
        return fallback;
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUHViU3ViQ29uc3VtZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29yZS9QdWJTdWJDb25zdW1lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSxtQ0FBc0M7QUFRdEMsTUFBYSxjQUF3QixTQUFRLHFCQUFZO0lBT3ZELFlBQVksTUFBcUIsRUFBRSxVQUFpQyxFQUFFO1FBQ3BFLEtBQUssRUFBRSxDQUFDO1FBTkEsdUJBQWtCLEdBQW1DLElBQUksR0FBRyxFQUFFLENBQUM7UUFDL0Qsd0JBQW1CLEdBQWdCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDL0MsWUFBTyxHQUFZLEtBQUssQ0FBQztRQUsvQixJQUFJLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztRQUNyQixJQUFJLENBQUMsYUFBYSxHQUFHLE9BQU8sQ0FBQyxhQUFhLElBQUksS0FBSyxDQUFDO0lBQ3RELENBQUM7SUFFRCxLQUFLLENBQUMsU0FBUyxDQUFDLE9BQWUsRUFBRSxPQUEwQjtRQUN6RCxJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTztRQUNqRCxJQUFJLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUMxQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQzNDLENBQUM7UUFFRCxJQUFJLENBQUM7WUFDSCxJQUFJLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztnQkFDakIsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN2QyxDQUFDO1lBRUQsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFFOUMsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7Z0JBQ2pCLElBQUksQ0FBQyxtQkFBbUIsQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7WUFDN0MsQ0FBQztRQUNILENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ3BCLElBQUksSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNqQixJQUFJLENBQUM7b0JBQ0gsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFDekMsQ0FBQztnQkFBQyxPQUFPLFVBQWUsRUFBRSxDQUFDO29CQUN6QixJQUFJLENBQUMsSUFBSSxDQUNQLE9BQU8sRUFDUCxJQUFJLEtBQUssQ0FDUCxzQ0FBc0MsT0FBTyw4QkFBOEIsVUFBVSxDQUFDLE9BQU8sRUFBRSxDQUNoRyxDQUNGLENBQUM7Z0JBQ0osQ0FBQztZQUNILENBQUM7WUFDRCxNQUFNLElBQUksS0FBSyxDQUNiLGtDQUFrQyxPQUFPLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUM5RCxDQUFDO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVyxDQUFDLE9BQWU7UUFDL0IsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDO1lBQUUsT0FBTztRQUNsRCxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxNQUFNLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUVELDBCQUEwQixDQUFDLE9BQWU7UUFDeEMsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUMxQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ3hDLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUs7UUFDVCxJQUFJLElBQUksQ0FBQyxPQUFPO1lBQUUsT0FBTztRQUN6QixJQUFJLENBQUMsT0FBTyxHQUFHLElBQUksQ0FBQztRQUNwQixLQUFLLE1BQU0sQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLElBQUksSUFBSSxDQUFDLGtCQUFrQixDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUM7WUFDbkUsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUNyQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1FBQzdDLENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUk7UUFDUixJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU87WUFBRSxPQUFPO1FBQzFCLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxFQUFFLENBQUM7WUFDckQsTUFBTSxJQUFJLENBQUMsV0FBVyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2xDLENBQUM7UUFDRCxJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQztRQUNyQixJQUFJLENBQUMsa0JBQWtCLEVBQUUsQ0FBQztJQUM1QixDQUFDO0lBRUQsS0FBSyxDQUFDLE9BQU8sQ0FBQyxPQUFlLEVBQUUsT0FBVTtRQUN2QyxJQUNFLENBQUMsSUFBSSxDQUFDLGtCQUFrQixDQUFDLEdBQUcsQ0FBQyxPQUFPLENBQUM7WUFDckMsQ0FBQyxJQUFJLENBQUMsbUJBQW1CLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBQyxFQUN0QyxDQUFDO1lBQ0QsTUFBTSxJQUFJLEtBQUssQ0FBQyxXQUFXLE9BQU8sbUNBQW1DLENBQUMsQ0FBQztRQUN6RSxDQUFDO1FBRUQsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsYUFBYSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7UUFFM0QsSUFBSSxJQUFJLENBQUMsYUFBYSxJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztZQUMvRCxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsa0JBQWtCLENBQUMsR0FBRyxDQUFDLE9BQU8sQ0FBRSxDQUFDO1lBQ3RELE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNuQixDQUFDO0lBQ0gsQ0FBQztJQUVELFdBQVcsQ0FBQyxPQUFlLEVBQUUsT0FBMkI7UUFDdEQsSUFBSSxPQUFPLEVBQUUsQ0FBQztZQUNaLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQ2pDLE9BQU87Z0JBQ0wsSUFBSSxFQUFFLEtBQUssRUFBRSxPQUFVLEVBQUUsRUFBRTtvQkFDekIsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLE9BQU8sRUFBRSxPQUFPLENBQUMsQ0FBQztnQkFDdkMsQ0FBQztnQkFDRCxXQUFXLEVBQUUsS0FBSyxJQUFJLEVBQUU7b0JBQ3RCLE1BQU0sSUFBSSxDQUFDLFdBQVcsQ0FBQyxPQUFPLENBQUMsQ0FBQztnQkFDbEMsQ0FBQzthQUNGLENBQUM7UUFDSixDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUN6QyxPQUFPO2dCQUNMLElBQUksRUFBRSxLQUFLLEVBQUUsT0FBVSxFQUFFLEVBQUU7b0JBQ3pCLE1BQU0sSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLEVBQUUsT0FBTyxDQUFDLENBQUM7Z0JBQ3ZDLENBQUM7Z0JBQ0QsV0FBVyxFQUFFLEtBQUssSUFBSSxFQUFFLEdBQUUsQ0FBQzthQUM1QixDQUFDO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFUyxtQkFBbUIsQ0FDM0IsT0FBZSxFQUNmLE9BQTBCO1FBRTFCLHVGQUF1RjtJQUN6RixDQUFDO0lBRVMsaUJBQWlCLENBQUMsT0FBVTtRQUNwQyxPQUFPLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3BFLENBQUM7SUFFRCxLQUFLLENBQUMsR0FBRyxDQUFDLE9BQVU7UUFDbEIsdURBQXVEO0lBQ3pELENBQUM7SUFFRCxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQVU7UUFDbkIsdURBQXVEO0lBQ3pELENBQUM7SUFFTSxTQUFTO1FBQ2QsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDO0lBQ3RCLENBQUM7Q0FDRjtBQTFJRCx3Q0EwSUM7QUFFRCxTQUFTLGFBQWEsQ0FDcEIsS0FBVSxFQUNWLFVBSUksRUFBRTtJQUVOLE1BQU0sRUFDSixRQUFRLEdBQUcsVUFBVSxFQUNyQixRQUFRLEdBQUcsQ0FBQyxFQUNaLG9CQUFvQixHQUFHLENBQUMsUUFBYSxFQUFFLEVBQUU7UUFDdkMsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLFdBQVcsRUFBRSxJQUFJLElBQUksUUFBUSxDQUFDO1FBQ3pELDREQUE0RDtRQUM1RCxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsRUFBRSxJQUFJLFFBQVEsQ0FBQyxJQUFJLElBQUksRUFBRSxDQUFDO1FBQ3RELE9BQU8sSUFBSSxTQUFTLEdBQUcsVUFBVSxDQUFDLENBQUMsQ0FBQyxJQUFJLFVBQVUsRUFBRSxDQUFDLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQztJQUMvRCxDQUFDLEdBQ0YsR0FBRyxPQUFPLENBQUM7SUFFWixJQUFJLENBQUM7UUFDSCxNQUFNLElBQUksR0FBRyxJQUFJLE9BQU8sRUFBRSxDQUFDO1FBRTNCLE1BQU0sVUFBVSxHQUFHLENBQUMsR0FBVyxFQUFFLEtBQVUsRUFBRSxLQUFLLEdBQUcsQ0FBQyxFQUFPLEVBQUU7WUFDN0QsNEJBQTRCO1lBQzVCLElBQUksS0FBSyxLQUFLLElBQUksSUFBSSxLQUFLLEtBQUssU0FBUyxFQUFFLENBQUM7Z0JBQzFDLE9BQU8sS0FBSyxDQUFDO1lBQ2YsQ0FBQztZQUVELHlCQUF5QjtZQUN6QixJQUFJLE9BQU8sS0FBSyxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUM5QixPQUFPLEtBQUssQ0FBQztZQUNmLENBQUM7WUFFRCwrQkFBK0I7WUFDL0IsSUFBSSxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7Z0JBQ3BCLE9BQU8sWUFBWSxDQUFDO1lBQ3RCLENBQUM7WUFFRCxvQkFBb0I7WUFDcEIsSUFBSSxLQUFLLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQ3RCLE9BQU8sVUFBVSxDQUFDO1lBQ3BCLENBQUM7WUFFRCw2Q0FBNkM7WUFDN0MsSUFBSSxLQUFLLENBQUMsV0FBVyxJQUFJLEtBQUssQ0FBQyxXQUFXLEtBQUssTUFBTSxFQUFFLENBQUM7Z0JBQ3RELE9BQU8sb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDckMsQ0FBQztZQUVELHNCQUFzQjtZQUN0QixJQUFJLEtBQUssWUFBWSxJQUFJLEVBQUUsQ0FBQztnQkFDMUIsT0FBTyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDN0IsQ0FBQztZQUVELGdCQUFnQjtZQUNoQixJQUFJLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDekIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztnQkFDaEIsTUFBTSxNQUFNLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLElBQUksRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLEVBQUUsRUFBRSxJQUFJLEVBQUUsS0FBSyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUM7Z0JBQ3BFLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ25CLE9BQU8sTUFBTSxDQUFDO1lBQ2hCLENBQUM7WUFFRCx1QkFBdUI7WUFDdkIsSUFBSSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNoQixNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsV0FBVyxDQUMvQixNQUFNLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxDQUFDLENBQUMsRUFBRSxVQUFVLENBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUN4RSxDQUFDO1lBQ0YsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUNuQixPQUFPLE1BQU0sQ0FBQztRQUNoQixDQUFDLENBQUM7UUFFRixPQUFPLElBQUksQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLENBQUMsR0FBRyxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBQ3ZFLENBQUM7SUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1FBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUNoRCxPQUFPLFFBQVEsQ0FBQztJQUNsQixDQUFDO0FBQ0gsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElQdWJTdWJDbGllbnQsIENoYW5uZWxCaW5kaW5nIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gXCJldmVudHNcIjtcblxuZXhwb3J0IHR5cGUgTWVzc2FnZUhhbmRsZXI8VD4gPSAobWVzc2FnZTogVCkgPT4gdm9pZDtcblxuZXhwb3J0IGludGVyZmFjZSBQdWJTdWJDb25zdW1lck9wdGlvbnMge1xuICBlY2hvUHVibGlzaGVkPzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IGNsYXNzIFB1YlN1YkNvbnN1bWVyPFQgPSBhbnk+IGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcbiAgcHJvdGVjdGVkIGNsaWVudDogSVB1YlN1YkNsaWVudDtcbiAgcHJvdGVjdGVkIHN1YnNjcmliZWRDaGFubmVsczogTWFwPHN0cmluZywgTWVzc2FnZUhhbmRsZXI8VD4+ID0gbmV3IE1hcCgpO1xuICBwcm90ZWN0ZWQgcHVibGlzaE9ubHlDaGFubmVsczogU2V0PHN0cmluZz4gPSBuZXcgU2V0KCk7XG4gIHByaXZhdGUgcnVubmluZzogYm9vbGVhbiA9IGZhbHNlO1xuICBwcml2YXRlIGVjaG9QdWJsaXNoZWQ6IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoY2xpZW50OiBJUHViU3ViQ2xpZW50LCBvcHRpb25zOiBQdWJTdWJDb25zdW1lck9wdGlvbnMgPSB7fSkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5jbGllbnQgPSBjbGllbnQ7XG4gICAgdGhpcy5lY2hvUHVibGlzaGVkID0gb3B0aW9ucy5lY2hvUHVibGlzaGVkID8/IGZhbHNlO1xuICB9XG5cbiAgYXN5bmMgc3Vic2NyaWJlKGNoYW5uZWw6IHN0cmluZywgaGFuZGxlcjogTWVzc2FnZUhhbmRsZXI8VD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuaGFzKGNoYW5uZWwpKSByZXR1cm47XG4gICAgaWYgKHRoaXMucHVibGlzaE9ubHlDaGFubmVscy5oYXMoY2hhbm5lbCkpIHtcbiAgICAgIHRoaXMucHVibGlzaE9ubHlDaGFubmVscy5kZWxldGUoY2hhbm5lbCk7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGlmICh0aGlzLnJ1bm5pbmcpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5jbGllbnQuc3Vic2NyaWJlKGNoYW5uZWwpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5zZXQoY2hhbm5lbCwgaGFuZGxlcik7XG5cbiAgICAgIGlmICh0aGlzLnJ1bm5pbmcpIHtcbiAgICAgICAgdGhpcy5zZXR1cENoYW5uZWxIYW5kbGVyKGNoYW5uZWwsIGhhbmRsZXIpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIGlmICh0aGlzLnJ1bm5pbmcpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmNsaWVudC51bnN1YnNjcmliZShjaGFubmVsKTtcbiAgICAgICAgfSBjYXRjaCAodW5zdWJFcnJvcjogYW55KSB7XG4gICAgICAgICAgdGhpcy5lbWl0KFxuICAgICAgICAgICAgXCJlcnJvclwiLFxuICAgICAgICAgICAgbmV3IEVycm9yKFxuICAgICAgICAgICAgICBgRmFpbGVkIHRvIHVuc3Vic2NyaWJlIGZyb20gY2hhbm5lbCAke2NoYW5uZWx9IGFmdGVyIHN1YnNjcmlwdGlvbiBlcnJvcjogJHt1bnN1YkVycm9yLm1lc3NhZ2V9YFxuICAgICAgICAgICAgKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgYEZhaWxlZCB0byBzdWJzY3JpYmUgdG8gY2hhbm5lbCAke2NoYW5uZWx9OiAke2Vycm9yLm1lc3NhZ2V9YFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyB1bnN1YnNjcmliZShjaGFubmVsOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmhhcyhjaGFubmVsKSkgcmV0dXJuO1xuICAgIGF3YWl0IHRoaXMuY2xpZW50LnVuc3Vic2NyaWJlKGNoYW5uZWwpO1xuICAgIHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmRlbGV0ZShjaGFubmVsKTtcbiAgfVxuXG4gIHJlZ2lzdGVyUHVibGlzaE9ubHlDaGFubmVsKGNoYW5uZWw6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICghdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuaGFzKGNoYW5uZWwpKSB7XG4gICAgICB0aGlzLnB1Ymxpc2hPbmx5Q2hhbm5lbHMuYWRkKGNoYW5uZWwpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnJ1bm5pbmcpIHJldHVybjtcbiAgICB0aGlzLnJ1bm5pbmcgPSB0cnVlO1xuICAgIGZvciAoY29uc3QgW2NoYW5uZWwsIGhhbmRsZXJdIG9mIHRoaXMuc3Vic2NyaWJlZENoYW5uZWxzLmVudHJpZXMoKSkge1xuICAgICAgYXdhaXQgdGhpcy5jbGllbnQuc3Vic2NyaWJlKGNoYW5uZWwpO1xuICAgICAgdGhpcy5zZXR1cENoYW5uZWxIYW5kbGVyKGNoYW5uZWwsIGhhbmRsZXIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHN0b3AoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLnJ1bm5pbmcpIHJldHVybjtcbiAgICBmb3IgKGNvbnN0IGNoYW5uZWwgb2YgdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMua2V5cygpKSB7XG4gICAgICBhd2FpdCB0aGlzLnVuc3Vic2NyaWJlKGNoYW5uZWwpO1xuICAgIH1cbiAgICB0aGlzLnJ1bm5pbmcgPSBmYWxzZTtcbiAgICB0aGlzLnJlbW92ZUFsbExpc3RlbmVycygpO1xuICB9XG5cbiAgYXN5bmMgcHVibGlzaChjaGFubmVsOiBzdHJpbmcsIG1lc3NhZ2U6IFQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoXG4gICAgICAhdGhpcy5zdWJzY3JpYmVkQ2hhbm5lbHMuaGFzKGNoYW5uZWwpICYmXG4gICAgICAhdGhpcy5wdWJsaXNoT25seUNoYW5uZWxzLmhhcyhjaGFubmVsKVxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDaGFubmVsICR7Y2hhbm5lbH0gaXMgbm90IHJlZ2lzdGVyZWQgZm9yIHB1Ymxpc2hpbmdgKTtcbiAgICB9XG5cbiAgICBhd2FpdCB0aGlzLmNsaWVudC5wdWJsaXNoKGNoYW5uZWwsIHNhZmVTdHJpbmdpZnkobWVzc2FnZSkpO1xuXG4gICAgaWYgKHRoaXMuZWNob1B1Ymxpc2hlZCAmJiB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5oYXMoY2hhbm5lbCkpIHtcbiAgICAgIGNvbnN0IGhhbmRsZXIgPSB0aGlzLnN1YnNjcmliZWRDaGFubmVscy5nZXQoY2hhbm5lbCkhO1xuICAgICAgaGFuZGxlcihtZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBiaW5kQ2hhbm5lbChjaGFubmVsOiBzdHJpbmcsIGhhbmRsZXI/OiBNZXNzYWdlSGFuZGxlcjxUPik6IENoYW5uZWxCaW5kaW5nPFQ+IHtcbiAgICBpZiAoaGFuZGxlcikge1xuICAgICAgdGhpcy5zdWJzY3JpYmUoY2hhbm5lbCwgaGFuZGxlcik7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzZW5kOiBhc3luYyAobWVzc2FnZTogVCkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucHVibGlzaChjaGFubmVsLCBtZXNzYWdlKTtcbiAgICAgICAgfSxcbiAgICAgICAgdW5zdWJzY3JpYmU6IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnVuc3Vic2NyaWJlKGNoYW5uZWwpO1xuICAgICAgICB9LFxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZWdpc3RlclB1Ymxpc2hPbmx5Q2hhbm5lbChjaGFubmVsKTtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHNlbmQ6IGFzeW5jIChtZXNzYWdlOiBUKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wdWJsaXNoKGNoYW5uZWwsIG1lc3NhZ2UpO1xuICAgICAgICB9LFxuICAgICAgICB1bnN1YnNjcmliZTogYXN5bmMgKCkgPT4ge30sXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBzZXR1cENoYW5uZWxIYW5kbGVyKFxuICAgIGNoYW5uZWw6IHN0cmluZyxcbiAgICBoYW5kbGVyOiBNZXNzYWdlSGFuZGxlcjxUPlxuICApOiB2b2lkIHtcbiAgICAvLyBUaGlzIG1ldGhvZCBzaG91bGQgYmUgb3ZlcnJpZGRlbiBpbiBzdWJjbGFzc2VzIHRvIHNldCB1cCB0aGUgYWN0dWFsIG1lc3NhZ2UgaGFuZGxpbmdcbiAgfVxuXG4gIHByb3RlY3RlZCBnZW5lcmF0ZU1lc3NhZ2VJZChtZXNzYWdlOiBUKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgOSl9YDtcbiAgfVxuXG4gIGFzeW5jIGFjayhtZXNzYWdlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gZGVwZW5kcyBvbiB5b3VyIHNwZWNpZmljIHJlcXVpcmVtZW50c1xuICB9XG5cbiAgYXN5bmMgbmFjayhtZXNzYWdlOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gSW1wbGVtZW50YXRpb24gZGVwZW5kcyBvbiB5b3VyIHNwZWNpZmljIHJlcXVpcmVtZW50c1xuICB9XG5cbiAgcHVibGljIGlzUnVubmluZygpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5ydW5uaW5nO1xuICB9XG59XG5cbmZ1bmN0aW9uIHNhZmVTdHJpbmdpZnkoXG4gIHZhbHVlOiBhbnksXG4gIG9wdGlvbnM6IHtcbiAgICBmYWxsYmFjaz86IHN0cmluZztcbiAgICBtYXhEZXB0aD86IG51bWJlcjtcbiAgICBjbGFzc0luc3RhbmNlSGFuZGxlcj86IChpbnN0YW5jZTogYW55KSA9PiBzdHJpbmc7XG4gIH0gPSB7fVxuKTogc3RyaW5nIHtcbiAgY29uc3Qge1xuICAgIGZhbGxiYWNrID0gXCJbT2JqZWN0XVwiLFxuICAgIG1heERlcHRoID0gMyxcbiAgICBjbGFzc0luc3RhbmNlSGFuZGxlciA9IChpbnN0YW5jZTogYW55KSA9PiB7XG4gICAgICBjb25zdCBjbGFzc05hbWUgPSBpbnN0YW5jZS5jb25zdHJ1Y3Rvcj8ubmFtZSB8fCBcIk9iamVjdFwiO1xuICAgICAgLy8gVHJ5IHRvIGdldCBhbiBJRCBvciBuYW1lIHByb3BlcnR5LCBjb21tb24gaW4gbWFueSBjbGFzc2VzXG4gICAgICBjb25zdCBpZGVudGlmaWVyID0gaW5zdGFuY2UuaWQgfHwgaW5zdGFuY2UubmFtZSB8fCBcIlwiO1xuICAgICAgcmV0dXJuIGBbJHtjbGFzc05hbWV9JHtpZGVudGlmaWVyID8gYDoke2lkZW50aWZpZXJ9YCA6IFwiXCJ9XWA7XG4gICAgfSxcbiAgfSA9IG9wdGlvbnM7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBzZWVuID0gbmV3IFdlYWtTZXQoKTtcblxuICAgIGNvbnN0IHNlcmlhbGl6ZXIgPSAoa2V5OiBzdHJpbmcsIHZhbHVlOiBhbnksIGRlcHRoID0gMCk6IGFueSA9PiB7XG4gICAgICAvLyBIYW5kbGUgbnVsbCBhbmQgdW5kZWZpbmVkXG4gICAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICB9XG5cbiAgICAgIC8vIEhhbmRsZSBwcmltaXRpdmUgdHlwZXNcbiAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBmb3IgY2lyY3VsYXIgcmVmZXJlbmNlXG4gICAgICBpZiAoc2Vlbi5oYXModmFsdWUpKSB7XG4gICAgICAgIHJldHVybiBcIltDaXJjdWxhcl1cIjtcbiAgICAgIH1cblxuICAgICAgLy8gQ2hlY2sgZGVwdGggbGltaXRcbiAgICAgIGlmIChkZXB0aCA+PSBtYXhEZXB0aCkge1xuICAgICAgICByZXR1cm4gXCJbTmVzdGVkXVwiO1xuICAgICAgfVxuXG4gICAgICAvLyBIYW5kbGUgY2xhc3MgaW5zdGFuY2VzIChub24tcGxhaW4gb2JqZWN0cylcbiAgICAgIGlmICh2YWx1ZS5jb25zdHJ1Y3RvciAmJiB2YWx1ZS5jb25zdHJ1Y3RvciAhPT0gT2JqZWN0KSB7XG4gICAgICAgIHJldHVybiBjbGFzc0luc3RhbmNlSGFuZGxlcih2YWx1ZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEhhbmRsZSBEYXRlIG9iamVjdHNcbiAgICAgIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLnRvSVNPU3RyaW5nKCk7XG4gICAgICB9XG5cbiAgICAgIC8vIEhhbmRsZSBhcnJheXNcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICBzZWVuLmFkZCh2YWx1ZSk7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IHZhbHVlLm1hcCgoaXRlbSkgPT4gc2VyaWFsaXplcihcIlwiLCBpdGVtLCBkZXB0aCArIDEpKTtcbiAgICAgICAgc2Vlbi5kZWxldGUodmFsdWUpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfVxuXG4gICAgICAvLyBIYW5kbGUgcGxhaW4gb2JqZWN0c1xuICAgICAgc2Vlbi5hZGQodmFsdWUpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuICAgICAgICBPYmplY3QuZW50cmllcyh2YWx1ZSkubWFwKChbaywgdl0pID0+IFtrLCBzZXJpYWxpemVyKGssIHYsIGRlcHRoICsgMSldKVxuICAgICAgKTtcbiAgICAgIHNlZW4uZGVsZXRlKHZhbHVlKTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcblxuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh2YWx1ZSwgKGtleSwgdmFsdWUpID0+IHNlcmlhbGl6ZXIoa2V5LCB2YWx1ZSkpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoXCJTdHJpbmdpZmljYXRpb24gZmFpbGVkOlwiLCBlcnJvcik7XG4gICAgcmV0dXJuIGZhbGxiYWNrO1xuICB9XG59XG4iXX0=