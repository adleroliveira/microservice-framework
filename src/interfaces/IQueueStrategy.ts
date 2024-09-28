export interface IQueueStrategy<T> {
  asyncEnqueue(message: T): Promise<void>;
  asyncDequeue(): Promise<T | undefined>;
  enqueue(message: T): void;
  dequeue(): T | undefined;
  size(): number;
}
