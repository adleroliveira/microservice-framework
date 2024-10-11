import { PubSubConsumer, PubSubConsumerOptions } from "../../core/PubSubConsumer";
import { IPubSubClient } from "../../interfaces";
export declare class PubSubConsumerClient implements IPubSubClient {
    private channels;
    constructor();
    subscribe(channel: string): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    publish(channel: string, message: any): Promise<void>;
    addCallback(channel: string, callback: (message: any) => void): void;
    removeCallback(channel: string, callback: (message: any) => void): void;
}
interface MemoryPubSubConsumerOptions extends PubSubConsumerOptions {
}
export declare class MemoryPubSubConsumer extends PubSubConsumer {
    protected client: PubSubConsumerClient;
    private callbacks;
    constructor(client: PubSubConsumerClient, options: MemoryPubSubConsumerOptions);
    subscribe(channel: string, callback: (message: any) => void): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    publish(channel: string, message: any): Promise<void>;
}
export {};
