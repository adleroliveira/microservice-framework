import { IQueueStrategy } from "../../interfaces";
export declare class InMemoryQueueStrategy<T> implements IQueueStrategy<T> {
    private queue;
    enqueue(message: T): void;
    dequeue(): T | undefined;
    asyncEnqueue(message: T): Promise<void>;
    asyncDequeue(): Promise<T | undefined>;
    peek(): T | undefined;
    isEmpty(): boolean;
    size(): number;
}
