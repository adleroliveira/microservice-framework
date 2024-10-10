import { PubSubConsumer, PubSubConsumerOptions } from "../../PubSubConsumer";
import { IPubSubClient } from "../../interfaces";

export class PubSubConsumerClient implements IPubSubClient {
  private channels: Map<string, Set<(message: any) => void>> = new Map();

  constructor() {}

  async subscribe(channel: string): Promise<void> {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
  }

  async unsubscribe(channel: string): Promise<void> {
    this.channels.delete(channel);
  }

  async publish(channel: string, message: any): Promise<void> {
    if (this.channels.has(channel)) {
      for (const callback of this.channels.get(channel)!) {
        callback(message);
      }
    }
  }

  addCallback(channel: string, callback: (message: any) => void): void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new Set());
    }
    this.channels.get(channel)!.add(callback);
  }

  removeCallback(channel: string, callback: (message: any) => void): void {
    if (this.channels.has(channel)) {
      this.channels.get(channel)!.delete(callback);
      if (this.channels.get(channel)!.size === 0) {
        this.channels.delete(channel);
      }
    }
  }
}

interface MemoryPubSubConsumerOptions extends PubSubConsumerOptions {}

export class MemoryPubSubConsumer extends PubSubConsumer {
  private callbacks: Map<string, Set<(message: any) => void>> = new Map();

  constructor(
    protected client: PubSubConsumerClient,
    options: MemoryPubSubConsumerOptions
  ) {
    super(client, options);
  }

  async subscribe(
    channel: string,
    callback: (message: any) => void
  ): Promise<void> {
    await this.client.subscribe(channel);
    this.client.addCallback(channel, callback);
    if (!this.callbacks.has(channel)) {
      this.callbacks.set(channel, new Set());
    }
    this.callbacks.get(channel)!.add(callback);
  }

  async unsubscribe(channel: string): Promise<void> {
    if (this.callbacks.has(channel)) {
      for (const callback of this.callbacks.get(channel)!) {
        this.client.removeCallback(channel, callback);
      }
      this.callbacks.delete(channel);
    }
    await this.client.unsubscribe(channel);
  }

  async publish(channel: string, message: any): Promise<void> {
    await this.client.publish(channel, message);
  }
}
