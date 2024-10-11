import { IQueueStrategy } from "../interfaces";

export class InMemoryQueueStrategy<T> implements IQueueStrategy<T> {
  private queue: T[] = [];

  enqueue(message: T): void {
    this.queue.push(message);
  }

  dequeue(): T | undefined {
    return this.queue.shift();
  }

  async asyncEnqueue(message: T): Promise<void> {
    this.queue.push(message);
  }

  async asyncDequeue(): Promise<T | undefined> {
    return this.queue.shift();
  }

  peek(): T | undefined {
    return this.queue[0];
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  size(): number {
    return this.queue.length;
  }
}
