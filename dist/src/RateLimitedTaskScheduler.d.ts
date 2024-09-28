import { EventEmitter } from "events";
import { Loggable, LoggableError } from "./utils/logging/Loggable";
import { IQueueStrategy } from "./interfaces";
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
    protected requestsPerInterval: number;
    protected interval: number;
    protected runningTasks: number;
    private timer;
    protected emitter: EventEmitter<[never]>;
    protected isProcessing: boolean;
    protected readonly instanceId: string;
    private taskProcessedCount;
    private lastLogTime;
    private logInterval;
    private lastTaskStartTime;
    constructor(concurrencyLimit?: number, requestsPerInterval?: number, interval?: number);
    protected queue: IQueueStrategy<DeferredTask<TIn, TOut>>;
    protected createDeferredTask(task: Task<TIn, TOut>, input: TaskInput<TIn>): DeferredTask<TIn, TOut>;
    protected setConcurrencyLimit(limit: number): void;
    protected setRequestsPerInterval(limit: number): void;
    protected setTpsInterval(interval: number): void;
    scheduleTask(task: Task<TIn, TOut>, input: TaskInput<TIn>): void;
    scheduleTasks(tasks: Array<{
        task: Task<TIn, TOut>;
        input: TaskInput<TIn>;
    }>): Promise<void>;
    onTaskComplete(callback: (result: TaskOutput<TOut>) => void): void;
    protected processTask(): Promise<void>;
    private logProcessingRate;
    protected startProcessing(): void;
    private stopProcessing;
    private processQueue;
}
export {};
