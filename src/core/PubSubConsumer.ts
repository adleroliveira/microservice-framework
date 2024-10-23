import { IPubSubClient, ChannelBinding } from "../interfaces";
import { EventEmitter } from "events";

export type MessageHandler<T> = (message: T) => void;

export interface PubSubConsumerOptions {
  echoPublished?: boolean;
}

export class PubSubConsumer<T = any> extends EventEmitter {
  protected client: IPubSubClient;
  protected subscribedChannels: Map<string, MessageHandler<T>> = new Map();
  protected publishOnlyChannels: Set<string> = new Set();
  private running: boolean = false;
  private echoPublished: boolean;

  constructor(client: IPubSubClient, options: PubSubConsumerOptions = {}) {
    super();
    this.client = client;
    this.echoPublished = options.echoPublished ?? false;
  }

  async subscribe(channel: string, handler: MessageHandler<T>): Promise<void> {
    if (this.subscribedChannels.has(channel)) return;
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
    } catch (error: any) {
      if (this.running) {
        try {
          await this.client.unsubscribe(channel);
        } catch (unsubError: any) {
          this.emit(
            "error",
            new Error(
              `Failed to unsubscribe from channel ${channel} after subscription error: ${unsubError.message}`
            )
          );
        }
      }
      throw new Error(
        `Failed to subscribe to channel ${channel}: ${error.message}`
      );
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    if (!this.subscribedChannels.has(channel)) return;
    await this.client.unsubscribe(channel);
    this.subscribedChannels.delete(channel);
  }

  registerPublishOnlyChannel(channel: string): void {
    if (!this.subscribedChannels.has(channel)) {
      this.publishOnlyChannels.add(channel);
    }
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    for (const [channel, handler] of this.subscribedChannels.entries()) {
      await this.client.subscribe(channel);
      this.setupChannelHandler(channel, handler);
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    for (const channel of this.subscribedChannels.keys()) {
      await this.unsubscribe(channel);
    }
    this.running = false;
    this.removeAllListeners();
  }

  async publish(channel: string, message: T): Promise<void> {
    if (
      !this.subscribedChannels.has(channel) &&
      !this.publishOnlyChannels.has(channel)
    ) {
      throw new Error(`Channel ${channel} is not registered for publishing`);
    }

    await this.client.publish(channel, safeStringify(message));

    if (this.echoPublished && this.subscribedChannels.has(channel)) {
      const handler = this.subscribedChannels.get(channel)!;
      handler(message);
    }
  }

  bindChannel(channel: string, handler?: MessageHandler<T>): ChannelBinding<T> {
    if (handler) {
      this.subscribe(channel, handler);
      return {
        send: async (message: T) => {
          await this.publish(channel, message);
        },
        unsubscribe: async () => {
          await this.unsubscribe(channel);
        },
      };
    } else {
      this.registerPublishOnlyChannel(channel);
      return {
        send: async (message: T) => {
          await this.publish(channel, message);
        },
        unsubscribe: async () => {},
      };
    }
  }

  protected setupChannelHandler(
    channel: string,
    handler: MessageHandler<T>
  ): void {
    // This method should be overridden in subclasses to set up the actual message handling
  }

  protected generateMessageId(message: T): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  async ack(message: T): Promise<void> {
    // Implementation depends on your specific requirements
  }

  async nack(message: T): Promise<void> {
    // Implementation depends on your specific requirements
  }

  public isRunning(): boolean {
    return this.running;
  }
}

function safeStringify(
  value: any,
  options: {
    fallback?: string;
    maxDepth?: number;
    classInstanceHandler?: (instance: any) => string;
  } = {}
): string {
  const {
    fallback = "[Object]",
    maxDepth = 3,
    classInstanceHandler = (instance: any) => {
      const className = instance.constructor?.name || "Object";
      // Try to get an ID or name property, common in many classes
      const identifier = instance.id || instance.name || "";
      return `[${className}${identifier ? `:${identifier}` : ""}]`;
    },
  } = options;

  try {
    const seen = new WeakSet();

    const serializer = (key: string, value: any, depth = 0): any => {
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
      const result = Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, serializer(k, v, depth + 1)])
      );
      seen.delete(value);
      return result;
    };

    return JSON.stringify(value, (key, value) => serializer(key, value));
  } catch (error) {
    console.error("Stringification failed:", error);
    return fallback;
  }
}
