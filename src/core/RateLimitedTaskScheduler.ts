import { EventEmitter } from "events";
import { Loggable, LoggableError } from "../logging/Loggable";
import { IQueueStrategy } from "../interfaces";
import { InMemoryQueueStrategy } from "./InMemoryQueueStrategy";

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
  protected tasksInitiatedInWindow: number = 0;
  private windowStartTime: number = Date.now();
  protected emitter = new EventEmitter();
  protected readonly instanceId: string;
  private taskProcessedCount: number = 0;
  private windowCheckInterval: NodeJS.Timeout | null = null;

  constructor(
    protected concurrencyLimit: number = 10,
    protected tasksPerInterval: number = 5,
    protected interval: number = 1000,
    protected queue: IQueueStrategy<
      DeferredTask<TIn, TOut>
    > = new InMemoryQueueStrategy<DeferredTask<TIn, TOut>>()
  ) {
    super();
    if (interval <= 0) throw new Error("Interval must be greater than 0");
    this.instanceId = Math.random().toString(36).slice(2, 11);
    // this.debug(
    //   `Scheduler initialized with concurrencyLimit: ${concurrencyLimit}, tasksPerInterval: ${tasksPerInterval}, interval: ${interval}ms`
    // );
  }

  protected createDeferredTask(
    task: Task<TIn, TOut>,
    input: TaskInput<TIn>
  ): DeferredTask<TIn, TOut> {
    return { execute: task, input };
  }

  public setConcurrencyLimit(limit: number): void {
    this.concurrencyLimit = limit;
    this.resetWindowState();
  }

  public setTasksPerInterval(limit: number): void {
    this.tasksPerInterval = limit;
    this.resetWindowState();
  }

  public setInterval(interval: number): void {
    this.interval = interval;
    this.resetWindowState();
  }

  scheduleTask(task: Task<TIn, TOut>, input: TaskInput<TIn>): void {
    const deferredTask = this.createDeferredTask(task, input);
    this.processOrEnqueueTask(deferredTask);
    this.restartTimerIfNeeded();
  }

  async scheduleTasks(
    tasks: Array<{ task: Task<TIn, TOut>; input: TaskInput<TIn> }>
  ): Promise<void> {
    for (const { task, input } of tasks) {
      this.scheduleTask(task, input);
    }
  }

  onTaskComplete(callback: (result: TaskOutput<TOut>) => void): void {
    this.emitter.on("taskComplete", callback);
  }

  private processOrEnqueueTask(deferredTask: DeferredTask<TIn, TOut>): void {
    this.updateWindowState();

    if (this.canInitiateTask()) {
      this.initiateTask(deferredTask);
    } else {
      this.queue.enqueue(deferredTask);
      // this.debug(`Task enqueued. Current queue size: ${this.queue.size()}`);
    }
  }

  private updateWindowState(): void {
    const now = Date.now();
    if (now - this.windowStartTime >= this.interval) {
      this.windowStartTime = now;
      this.tasksInitiatedInWindow = 0;
    }
  }

  private canInitiateTask(): boolean {
    this.updateWindowState();
    return (
      this.tasksInitiatedInWindow < this.tasksPerInterval &&
      this.runningTasks < this.concurrencyLimit
    );
  }

  private initiateTask(deferredTask: DeferredTask<TIn, TOut>): void {
    this.tasksInitiatedInWindow++;
    this.runningTasks++;
    this.processTask(deferredTask);
  }

  protected async processTask(
    deferredTask: DeferredTask<TIn, TOut>
  ): Promise<void> {
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
      // this.debug(`Task completed. Execution time: ${endTime - startTime}ms`);
      this.emitter.emit("taskComplete", result);
    } catch (error: any) {
      result = {
        success: false,
        error:
          error instanceof LoggableError ? error : new LoggableError(error),
      };
      this.error("Task execution failed", error);
      this.emitter.emit("taskComplete", result);
    } finally {
      this.runningTasks--;
      this.processNextTaskIfAvailable();
      this.stopTimerIfNoTasks();
    }
  }

  private processNextTaskIfAvailable(): void {
    if (this.queue.size() > 0 && this.canInitiateTask()) {
      const nextTask = this.queue.dequeue();
      if (nextTask) {
        this.initiateTask(nextTask);
      }
    }
  }

  private checkAndProcessTasks(): void {
    this.updateWindowState();
    while (this.canInitiateTask() && this.queue.size() > 0) {
      const nextTask = this.queue.dequeue();
      if (nextTask) {
        this.initiateTask(nextTask);
      }
    }
    this.stopTimerIfNoTasks();
  }

  private restartTimerIfNeeded(): void {
    if (
      this.windowCheckInterval === null &&
      (this.runningTasks > 0 || this.queue.size() > 0)
    ) {
      this.windowCheckInterval = setInterval(
        () => this.checkAndProcessTasks(),
        Math.min(this.interval, 1000)
      );
      // this.debug("Timer started");
    }
  }

  private stopTimerIfNoTasks(): void {
    if (
      this.windowCheckInterval !== null &&
      this.runningTasks === 0 &&
      this.queue.size() === 0
    ) {
      clearInterval(this.windowCheckInterval);
      this.windowCheckInterval = null;
      // this.debug("Timer stopped");
    }
  }

  private resetWindowState(): void {
    this.windowStartTime = Date.now();
    this.tasksInitiatedInWindow = 0;
  }

  public destroy(): void {
    if (this.windowCheckInterval !== null) {
      clearInterval(this.windowCheckInterval);
      this.windowCheckInterval = null;
    }
  }
}
