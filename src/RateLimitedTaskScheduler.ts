import { EventEmitter } from "events";
import { Loggable, LoggableError } from "./utils/logging/Loggable";
import { IQueueStrategy } from "./interfaces";
import { InMemoryQueueStrategy } from "./utils/queue/InMemoryQueueStrategy";

type TaskInput<TIn> = TIn;

export type TaskOutput<TOut> = {
  success: boolean;
  result?: TOut;
  error?: LoggableError;
};

type Task<TIn, TOut> = (input: TaskInput<TIn>) => Promise<TOut>;

export type DeferredTask<TIn, TOut> = {
  execute: Task<TIn, TOut>;
  input: TaskInput<TIn>;
};

export abstract class RateLimitedTaskScheduler<TIn, TOut> extends Loggable {
  protected runningTasks: number = 0;
  private timer: NodeJS.Timeout | null = null;
  protected emitter = new EventEmitter();
  protected isProcessing = false;
  protected readonly instanceId: string;
  private taskProcessedCount: number = 0;
  private lastLogTime: number = Date.now();
  private logInterval: number = 2000; // Log every two second
  private lastTaskStartTime: number = 0;

  constructor(
    protected concurrencyLimit: number = 10,
    protected requestsPerInterval: number = 5,
    protected interval: number = 2000
  ) {
    super();
    if (interval <= 0) throw new Error("Rate limit must be greater than 0");
    this.instanceId = Math.random().toString(36).slice(2, 11);
    // this.debug(`Scheduler initialized with concurrencyLimit: ${concurrencyLimit}, requestsPerInterval: ${requestsPerInterval}, interval: ${interval}ms`);
  }

  protected queue: IQueueStrategy<DeferredTask<TIn, TOut>> =
    new InMemoryQueueStrategy<DeferredTask<TIn, TOut>>();

  protected createDeferredTask(
    task: Task<TIn, TOut>,
    input: TaskInput<TIn>
  ): DeferredTask<TIn, TOut> {
    return { execute: task, input };
  }

  protected setConcurrencyLimit(limit: number): void {
    this.concurrencyLimit = limit;
  }

  protected setRequestsPerInterval(limit: number): void {
    this.requestsPerInterval = limit;
  }

  protected setTpsInterval(interval: number): void {
    this.interval = interval;
  }

  scheduleTask(task: Task<TIn, TOut>, input: TaskInput<TIn>): void {
    const deferredTask = this.createDeferredTask(task, input);
    this.queue.enqueue(deferredTask);
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  async scheduleTasks(
    tasks: Array<{ task: Task<TIn, TOut>; input: TaskInput<TIn> }>
  ): Promise<void> {
    for (const { task, input } of tasks) {
      await this.scheduleTask(task, input);
    }
  }

  onTaskComplete(callback: (result: TaskOutput<TOut>) => void): void {
    this.emitter.on("taskComplete", callback);
  }

  protected async processTask(): Promise<void> {
    const deferredTask = this.queue.dequeue();
    if (!deferredTask) {
      // this.debug("No task to process");
      this.runningTasks--;
      return;
    }

    const startTime = Date.now();

    let result: TaskOutput<TOut>;
    try {
      const executionResult = await deferredTask.execute(deferredTask.input);
      result = {
        success: true,
        result: executionResult,
      };
      this.taskProcessedCount++;
      const endTime = Date.now();
      // this.debug(`Task completed at ${endTime}. Execution time: ${endTime - startTime}ms`);
    } catch (error: any) {
      result = {
        success: false,
        error:
          error instanceof LoggableError ? error : new LoggableError(error),
      };
      this.error("Task execution failed", error);
    }

    this.emitter.emit("taskComplete", result);
    this.runningTasks--;
    this.logProcessingRate();
  }

  private logProcessingRate(): void {
    const now = Date.now();
    if (now - this.lastLogTime >= this.logInterval) {
      const elapsedSeconds = (now - this.lastLogTime) / 1000;
      const avgTasksPerInterval =
        (this.taskProcessedCount / elapsedSeconds) * (this.interval / 1000);
      // this.debug(`Average tasks processed per interval: ${avgTasksPerInterval.toFixed(2)} (over last ${elapsedSeconds.toFixed(2)} seconds)`);
      // this.debug(`Total tasks processed: ${this.taskProcessedCount}`);
      // this.debug(`Current queue size: ${this.queue.size()}`);

      // Reset counters
      this.taskProcessedCount = 0;
      this.lastLogTime = now;
    }
  }

  protected startProcessing() {
    if (!this.isProcessing) {
      this.isProcessing = true;
      this.lastTaskStartTime = Date.now();

      this.timer = setInterval(() => {
        const now = Date.now();
        // this.debug(`Tick at ${now}. Time since last tick: ${now - this.lastTaskStartTime}ms`);

        if (
          this.runningTasks < this.concurrencyLimit &&
          this.queue.size() > 0
        ) {
          this.runningTasks++;
          this.processTask();
          this.lastTaskStartTime = now;
        } else {
          // this.debug(`No task processed at this tick. Running tasks: ${this.runningTasks}, Queue size: ${this.queue.size()}`);
        }
      }, this.interval);

      // this.debug(`Timer set with interval: ${this.interval}ms`);
    }
  }

  private stopProcessing() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emitter.removeAllListeners(`tick_${this.instanceId}`);
    this.isProcessing = false;
  }

  private processQueue() {
    if (this.isProcessing) {
      this.emitter.emit(`tick_${this.instanceId}`);
    }
  }
}
