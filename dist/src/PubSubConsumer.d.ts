import { IPubSubClient, IMessage } from "./interfaces";
import { EventEmitter } from "events";
export type MessageHandler<T> = (message: IMessage<T>) => void;
export interface ChannelBinding<T> {
    send: (message: T) => Promise<void>;
    unsubscribe: () => Promise<void>;
}
export interface PubSubConsumerOptions {
    echoPublished?: boolean;
}
export declare class PubSubConsumer<T = any> extends EventEmitter {
    protected client: IPubSubClient;
    protected subscribedChannels: Map<string, MessageHandler<T>>;
    protected publishOnlyChannels: Set<string>;
    private running;
    private echoPublished;
    constructor(client: IPubSubClient, options?: PubSubConsumerOptions);
    subscribe(channel: string, handler: MessageHandler<T>): Promise<void>;
    unsubscribe(channel: string): Promise<void>;
    registerPublishOnlyChannel(channel: string): void;
    start(): Promise<void>;
    stop(): Promise<void>;
    publish(channel: string, message: T): Promise<void>;
    bindChannel(channel: string, handler?: MessageHandler<T>): ChannelBinding<T>;
    protected setupChannelHandler(channel: string, handler: MessageHandler<T>): void;
    protected generateMessageId(message: T): string;
    ack(message: IMessage<T>): Promise<void>;
    nack(message: IMessage<T>): Promise<void>;
    isRunning(): boolean;
}
