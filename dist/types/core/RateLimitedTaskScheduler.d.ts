import { EventEmitter } from "events";
import { Loggable, LoggableError } from "../logging/Loggable";
import { IQueueStrategy } from "../interfaces";
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
export declare abstract class RateLimitedTaskScheduler<TIn, TOut> extends Loggable {
    protected concurrencyLimit: number;
    protected tasksPerInterval: number;
    protected interval: number;
    protected queue: IQueueStrategy<DeferredTask<TIn, TOut>>;
    protected runningTasks: number;
    protected tasksInitiatedInWindow: number;
    private windowStartTime;
    protected emitter: EventEmitter<[never]>;
    protected readonly instanceId: string;
    private taskProcessedCount;
    private windowCheckInterval;
    constructor(concurrencyLimit?: number, tasksPerInterval?: number, interval?: number, queue?: IQueueStrategy<DeferredTask<TIn, TOut>>);
    protected createDeferredTask(task: Task<TIn, TOut>, input: TaskInput<TIn>): DeferredTask<TIn, TOut>;
    setConcurrencyLimit(limit: number): void;
    setTasksPerInterval(limit: number): void;
    setInterval(interval: number): void;
    scheduleTask(task: Task<TIn, TOut>, input: TaskInput<TIn>): void;
    scheduleTasks(tasks: Array<{
        task: Task<TIn, TOut>;
        input: TaskInput<TIn>;
    }>): Promise<void>;
    onTaskComplete(callback: (result: TaskOutput<TOut>) => void): void;
    private processOrEnqueueTask;
    private updateWindowState;
    private canInitiateTask;
    private initiateTask;
    protected processTask(deferredTask: DeferredTask<TIn, TOut>): Promise<void>;
    private processNextTaskIfAvailable;
    private checkAndProcessTasks;
    private restartTimerIfNeeded;
    private stopTimerIfNoTasks;
    private resetWindowState;
    destroy(): void;
}
export {};
