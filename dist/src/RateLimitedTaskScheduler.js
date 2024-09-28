"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitedTaskScheduler = void 0;
const events_1 = require("events");
const Loggable_1 = require("./utils/logging/Loggable");
const InMemoryQueueStrategy_1 = require("./utils/queue/InMemoryQueueStrategy");
class RateLimitedTaskScheduler extends Loggable_1.Loggable {
    constructor(concurrencyLimit = 10, requestsPerInterval = 5, interval = 2000) {
        super();
        this.concurrencyLimit = concurrencyLimit;
        this.requestsPerInterval = requestsPerInterval;
        this.interval = interval;
        this.runningTasks = 0;
        this.timer = null;
        this.emitter = new events_1.EventEmitter();
        this.isProcessing = false;
        this.taskProcessedCount = 0;
        this.lastLogTime = Date.now();
        this.logInterval = 2000; // Log every two second
        this.lastTaskStartTime = 0;
        this.queue = new InMemoryQueueStrategy_1.InMemoryQueueStrategy();
        if (interval <= 0)
            throw new Error("Rate limit must be greater than 0");
        this.instanceId = Math.random().toString(36).slice(2, 11);
        // this.debug(`Scheduler initialized with concurrencyLimit: ${concurrencyLimit}, requestsPerInterval: ${requestsPerInterval}, interval: ${interval}ms`);
    }
    createDeferredTask(task, input) {
        return { execute: task, input };
    }
    setConcurrencyLimit(limit) {
        this.concurrencyLimit = limit;
    }
    setRequestsPerInterval(limit) {
        this.requestsPerInterval = limit;
    }
    setTpsInterval(interval) {
        this.interval = interval;
    }
    scheduleTask(task, input) {
        const deferredTask = this.createDeferredTask(task, input);
        this.queue.enqueue(deferredTask);
        if (!this.isProcessing) {
            this.startProcessing();
        }
    }
    async scheduleTasks(tasks) {
        for (const { task, input } of tasks) {
            await this.scheduleTask(task, input);
        }
    }
    onTaskComplete(callback) {
        this.emitter.on("taskComplete", callback);
    }
    async processTask() {
        const deferredTask = this.queue.dequeue();
        if (!deferredTask) {
            // this.debug("No task to process");
            this.runningTasks--;
            return;
        }
        const startTime = Date.now();
        let result;
        try {
            const executionResult = await deferredTask.execute(deferredTask.input);
            result = {
                success: true,
                result: executionResult,
            };
            this.taskProcessedCount++;
            const endTime = Date.now();
            // this.debug(`Task completed at ${endTime}. Execution time: ${endTime - startTime}ms`);
        }
        catch (error) {
            result = {
                success: false,
                error: error instanceof Loggable_1.LoggableError ? error : new Loggable_1.LoggableError(error),
            };
            this.error("Task execution failed", error);
        }
        this.emitter.emit("taskComplete", result);
        this.runningTasks--;
        this.logProcessingRate();
    }
    logProcessingRate() {
        const now = Date.now();
        if (now - this.lastLogTime >= this.logInterval) {
            const elapsedSeconds = (now - this.lastLogTime) / 1000;
            const avgTasksPerInterval = (this.taskProcessedCount / elapsedSeconds) * (this.interval / 1000);
            // this.debug(`Average tasks processed per interval: ${avgTasksPerInterval.toFixed(2)} (over last ${elapsedSeconds.toFixed(2)} seconds)`);
            // this.debug(`Total tasks processed: ${this.taskProcessedCount}`);
            // this.debug(`Current queue size: ${this.queue.size()}`);
            // Reset counters
            this.taskProcessedCount = 0;
            this.lastLogTime = now;
        }
    }
    startProcessing() {
        if (!this.isProcessing) {
            this.isProcessing = true;
            this.lastTaskStartTime = Date.now();
            this.timer = setInterval(() => {
                const now = Date.now();
                // this.debug(`Tick at ${now}. Time since last tick: ${now - this.lastTaskStartTime}ms`);
                if (this.runningTasks < this.concurrencyLimit &&
                    this.queue.size() > 0) {
                    this.runningTasks++;
                    this.processTask();
                    this.lastTaskStartTime = now;
                }
                else {
                    // this.debug(`No task processed at this tick. Running tasks: ${this.runningTasks}, Queue size: ${this.queue.size()}`);
                }
            }, this.interval);
            // this.debug(`Timer set with interval: ${this.interval}ms`);
        }
    }
    stopProcessing() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.emitter.removeAllListeners(`tick_${this.instanceId}`);
        this.isProcessing = false;
    }
    processQueue() {
        if (this.isProcessing) {
            this.emitter.emit(`tick_${this.instanceId}`);
        }
    }
}
exports.RateLimitedTaskScheduler = RateLimitedTaskScheduler;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL1JhdGVMaW1pdGVkVGFza1NjaGVkdWxlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBc0M7QUFDdEMsdURBQW1FO0FBRW5FLCtFQUE0RTtBQWlCNUUsTUFBc0Isd0JBQW9DLFNBQVEsbUJBQVE7SUFXeEUsWUFDWSxtQkFBMkIsRUFBRSxFQUM3QixzQkFBOEIsQ0FBQyxFQUMvQixXQUFtQixJQUFJO1FBRWpDLEtBQUssRUFBRSxDQUFDO1FBSkUscUJBQWdCLEdBQWhCLGdCQUFnQixDQUFhO1FBQzdCLHdCQUFtQixHQUFuQixtQkFBbUIsQ0FBWTtRQUMvQixhQUFRLEdBQVIsUUFBUSxDQUFlO1FBYnpCLGlCQUFZLEdBQVcsQ0FBQyxDQUFDO1FBQzNCLFVBQUssR0FBMEIsSUFBSSxDQUFDO1FBQ2xDLFlBQU8sR0FBRyxJQUFJLHFCQUFZLEVBQUUsQ0FBQztRQUM3QixpQkFBWSxHQUFHLEtBQUssQ0FBQztRQUV2Qix1QkFBa0IsR0FBVyxDQUFDLENBQUM7UUFDL0IsZ0JBQVcsR0FBVyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7UUFDakMsZ0JBQVcsR0FBVyxJQUFJLENBQUMsQ0FBQyx1QkFBdUI7UUFDbkQsc0JBQWlCLEdBQVcsQ0FBQyxDQUFDO1FBYTVCLFVBQUssR0FDYixJQUFJLDZDQUFxQixFQUEyQixDQUFDO1FBTnJELElBQUksUUFBUSxJQUFJLENBQUM7WUFBRSxNQUFNLElBQUksS0FBSyxDQUFDLG1DQUFtQyxDQUFDLENBQUM7UUFDeEUsSUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUMsUUFBUSxDQUFDLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsRUFBRSxDQUFDLENBQUM7UUFDMUQsd0pBQXdKO0lBQzFKLENBQUM7SUFLUyxrQkFBa0IsQ0FDMUIsSUFBcUIs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QUksQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUNmLGFBQWEsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDMUIsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUM7UUFDcEIsQ0FBQztRQUNELElBQUksQ0FBQyxPQUFPLENBQUMsa0JBQWtCLENBQUMsUUFBUSxJQUFJLENBQUMsVUFBVSxFQUFFLENBQUMsQ0FBQztRQUMzRCxJQUFJLENBQUMsWUFBWSxHQUFHLEtBQUssQ0FBQztJQUM1QixDQUFDO0lBRU8sWUFBWTtRQUNsQixJQUFJLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUN0QixJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQy9DLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUF6SkQsNERBeUpDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRXZlbnRFbWl0dGVyIH0gZnJvbSBcImV2ZW50c1wiO1xuaW1wb3J0IHsgTG9nZ2FibGUsIExvZ2dhYmxlRXJyb3IgfSBmcm9tIFwiLi91dGlscy9sb2dnaW5nL0xvZ2dhYmxlXCI7XG5pbXBvcnQgeyBJUXVldWVTdHJhdGVneSB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IEluTWVtb3J5UXVldWVTdHJhdGVneSB9IGZyb20gXCIuL3V0aWxzL3F1ZXVlL0luTWVtb3J5UXVldWVTdHJhdGVneVwiO1xuXG50eXBlIFRhc2tJbnB1dDxUSW4+ID0gVEluO1xuXG5leHBvcnQgdHlwZSBUYXNrT3V0cHV0PFRPdXQ+ID0ge1xuICBzdWNjZXNzOiBib29sZWFuO1xuICByZXN1bHQ/OiBUT3V0O1xuICBlcnJvcj86IExvZ2dhYmxlRXJyb3I7XG59O1xuXG50eXBlIFRhc2s8VEluLCBUT3V0PiA9IChpbnB1dDogVGFza0lucHV0PFRJbj4pID0+IFByb21pc2U8VE91dD47XG5cbmV4cG9ydCB0eXBlIERlZmVycmVkVGFzazxUSW4sIFRPdXQ+ID0ge1xuICBleGVjdXRlOiBUYXNrPFRJbiwgVE91dD47XG4gIGlucHV0OiBUYXNrSW5wdXQ8VEluPjtcbn07XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBSYXRlTGltaXRlZFRhc2tTY2hlZHVsZXI8VEluLCBUT3V0PiBleHRlbmRzIExvZ2dhYmxlIHtcbiAgcHJvdGVjdGVkIHJ1bm5pbmdUYXNrczogbnVtYmVyID0gMDtcbiAgcHJpdmF0ZSB0aW1lcjogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcbiAgcHJvdGVjdGVkIGVtaXR0ZXIgPSBuZXcgRXZlbnRFbWl0dGVyKCk7XG4gIHByb3RlY3RlZCBpc1Byb2Nlc3NpbmcgPSBmYWxzZTtcbiAgcHJvdGVjdGVkIHJlYWRvbmx5IGluc3RhbmNlSWQ6IHN0cmluZztcbiAgcHJpdmF0ZSB0YXNrUHJvY2Vzc2VkQ291bnQ6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgbGFzdExvZ1RpbWU6IG51bWJlciA9IERhdGUubm93KCk7XG4gIHByaXZhdGUgbG9nSW50ZXJ2YWw6IG51bWJlciA9IDIwMDA7IC8vIExvZyBldmVyeSB0d28gc2Vjb25kXG4gIHByaXZhdGUgbGFzdFRhc2tTdGFydFRpbWU6IG51bWJlciA9IDA7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgcHJvdGVjdGVkIGNvbmN1cnJlbmN5TGltaXQ6IG51bWJlciA9IDEwLFxuICAgIHByb3RlY3RlZCByZXF1ZXN0c1BlckludGVydmFsOiBudW1iZXIgPSA1LFxuICAgIHByb3RlY3RlZCBpbnRlcnZhbDogbnVtYmVyID0gMjAwMFxuICApIHtcbiAgICBzdXBlcigpO1xuICAgIGlmIChpbnRlcnZhbCA8PSAwKSB0aHJvdyBuZXcgRXJyb3IoXCJSYXRlIGxpbWl0IG11c3QgYmUgZ3JlYXRlciB0aGFuIDBcIik7XG4gICAgdGhpcy5pbnN0YW5jZUlkID0gTWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgMTEpO1xuICAgIC8vIHRoaXMuZGVidWcoYFNjaGVkdWxlciBpbml0aWFsaXplZCB3aXRoIGNvbmN1cnJlbmN5TGltaXQ6ICR7Y29uY3VycmVuY3lMaW1pdH0sIHJlcXVlc3RzUGVySW50ZXJ2YWw6ICR7cmVxdWVzdHNQZXJJbnRlcnZhbH0sIGludGVydmFsOiAke2ludGVydmFsfW1zYCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgcXVldWU6IElRdWV1ZVN0cmF0ZWd5PERlZmVycmVkVGFzazxUSW4sIFRPdXQ+PiA9XG4gICAgbmV3IEluTWVtb3J5UXVldWVTdHJhdGVneTxEZWZlcnJlZFRhc2s8VEluLCBUT3V0Pj4oKTtcblxuICBwcm90ZWN0ZWQgY3JlYXRlRGVmZXJyZWRUYXNrKFxuICAgIHRhc2s6IFRhc2s8VEluLCBUT3V0PixcbiAgICBpbnB1dDogVGFza0lucHV0PFRJbj5cbiAgKTogRGVmZXJyZWRUYXNrPFRJbiwgVE91dD4ge1xuICAgIHJldHVybiB7IGV4ZWN1dGU6IHRhc2ssIGlucHV0IH07XG4gIH1cblxuICBwcm90ZWN0ZWQgc2V0Q29uY3VycmVuY3lMaW1pdChsaW1pdDogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5jb25jdXJyZW5jeUxpbWl0ID0gbGltaXQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgc2V0UmVxdWVzdHNQZXJJbnRlcnZhbChsaW1pdDogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5yZXF1ZXN0c1BlckludGVydmFsID0gbGltaXQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgc2V0VHBzSW50ZXJ2YWwoaW50ZXJ2YWw6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMuaW50ZXJ2YWwgPSBpbnRlcnZhbDtcbiAgfVxuXG4gIHNjaGVkdWxlVGFzayh0YXNrOiBUYXNrPFRJbiwgVE91dD4sIGlucHV0OiBUYXNrSW5wdXQ8VEluPik6IHZvaWQge1xuICAgIGNvbnN0IGRlZmVycmVkVGFzayA9IHRoaXMuY3JlYXRlRGVmZXJyZWRUYXNrKHRhc2ssIGlucHV0KTtcbiAgICB0aGlzLnF1ZXVlLmVucXVldWUoZGVmZXJyZWRUYXNrKTtcbiAgICBpZiAoIXRoaXMuaXNQcm9jZXNzaW5nKSB7XG4gICAgICB0aGlzLnN0YXJ0UHJvY2Vzc2luZygpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHNjaGVkdWxlVGFza3MoXG4gICAgdGFza3M6IEFycmF5PHsgdGFzazogVGFzazxUSW4sIFRPdXQ+OyBpbnB1dDogVGFza0lucHV0PFRJbj4gfT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgZm9yIChjb25zdCB7IHRhc2ssIGlucHV0IH0gb2YgdGFza3MpIHtcbiAgICAgIGF3YWl0IHRoaXMuc2NoZWR1bGVUYXNrKHRhc2ssIGlucHV0KTtcbiAgICB9XG4gIH1cblxuICBvblRhc2tDb21wbGV0ZShjYWxsYmFjazogKHJlc3VsdDogVGFza091dHB1dDxUT3V0PikgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuZW1pdHRlci5vbihcInRhc2tDb21wbGV0ZVwiLCBjYWxsYmFjayk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgcHJvY2Vzc1Rhc2soKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZGVmZXJyZWRUYXNrID0gdGhpcy5xdWV1ZS5kZXF1ZXVlKCk7XG4gICAgaWYgKCFkZWZlcnJlZFRhc2spIHtcbiAgICAgIC8vIHRoaXMuZGVidWcoXCJObyB0YXNrIHRvIHByb2Nlc3NcIik7XG4gICAgICB0aGlzLnJ1bm5pbmdUYXNrcy0tO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XG5cbiAgICBsZXQgcmVzdWx0OiBUYXNrT3V0cHV0PFRPdXQ+O1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBleGVjdXRpb25SZXN1bHQgPSBhd2FpdCBkZWZlcnJlZFRhc2suZXhlY3V0ZShkZWZlcnJlZFRhc2suaW5wdXQpO1xuICAgICAgcmVzdWx0ID0ge1xuICAgICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgICByZXN1bHQ6IGV4ZWN1dGlvblJlc3VsdCxcbiAgICAgIH07XG4gICAgICB0aGlzLnRhc2tQcm9jZXNzZWRDb3VudCsrO1xuICAgICAgY29uc3QgZW5kVGltZSA9IERhdGUubm93KCk7XG4gICAgICAvLyB0aGlzLmRlYnVnKGBUYXNrIGNvbXBsZXRlZCBhdCAke2VuZFRpbWV9LiBFeGVjdXRpb24gdGltZTogJHtlbmRUaW1lIC0gc3RhcnRUaW1lfW1zYCk7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgcmVzdWx0ID0ge1xuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3I6XG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBMb2dnYWJsZUVycm9yID8gZXJyb3IgOiBuZXcgTG9nZ2FibGVFcnJvcihlcnJvciksXG4gICAgICB9O1xuICAgICAgdGhpcy5lcnJvcihcIlRhc2sgZXhlY3V0aW9uIGZhaWxlZFwiLCBlcnJvcik7XG4gICAgfVxuXG4gICAgdGhpcy5lbWl0dGVyLmVtaXQoXCJ0YXNrQ29tcGxldGVcIiwgcmVzdWx0KTtcbiAgICB0aGlzLnJ1bm5pbmdUYXNrcy0tO1xuICAgIHRoaXMubG9nUHJvY2Vzc2luZ1JhdGUoKTtcbiAgfVxuXG4gIHByaXZhdGUgbG9nUHJvY2Vzc2luZ1JhdGUoKTogdm9pZCB7XG4gICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICBpZiAobm93IC0gdGhpcy5sYXN0TG9nVGltZSA+PSB0aGlzLmxvZ0ludGVydmFsKSB7XG4gICAgICBjb25zdCBlbGFwc2VkU2Vjb25kcyA9IChub3cgLSB0aGlzLmxhc3RMb2dUaW1lKSAvIDEwMDA7XG4gICAgICBjb25zdCBhdmdUYXNrc1BlckludGVydmFsID1cbiAgICAgICAgKHRoaXMudGFza1Byb2Nlc3NlZENvdW50IC8gZWxhcHNlZFNlY29uZHMpICogKHRoaXMuaW50ZXJ2YWwgLyAxMDAwKTtcbiAgICAgIC8vIHRoaXMuZGVidWcoYEF2ZXJhZ2UgdGFza3MgcHJvY2Vzc2VkIHBlciBpbnRlcnZhbDogJHthdmdUYXNrc1BlckludGVydmFsLnRvRml4ZWQoMil9IChvdmVyIGxhc3QgJHtlbGFwc2VkU2Vjb25kcy50b0ZpeGVkKDIpfSBzZWNvbmRzKWApO1xuICAgICAgLy8gdGhpcy5kZWJ1ZyhgVG90YWwgdGFza3MgcHJvY2Vzc2VkOiAke3RoaXMudGFza1Byb2Nlc3NlZENvdW50fWApO1xuICAgICAgLy8gdGhpcy5kZWJ1ZyhgQ3VycmVudCBxdWV1ZSBzaXplOiAke3RoaXMucXVldWUuc2l6ZSgpfWApO1xuXG4gICAgICAvLyBSZXNldCBjb3VudGVyc1xuICAgICAgdGhpcy50YXNrUHJvY2Vzc2VkQ291bnQgPSAwO1xuICAgICAgdGhpcy5sYXN0TG9nVGltZSA9IG5vdztcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgc3RhcnRQcm9jZXNzaW5nKCkge1xuICAgIGlmICghdGhpcy5pc1Byb2Nlc3NpbmcpIHtcbiAgICAgIHRoaXMuaXNQcm9jZXNzaW5nID0gdHJ1ZTtcbiAgICAgIHRoaXMubGFzdFRhc2tTdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgICB0aGlzLnRpbWVyID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgICBjb25zdCBub3cgPSBEYXRlLm5vdygpO1xuICAgICAgICAvLyB0aGlzLmRlYnVnKGBUaWNrIGF0ICR7bm93fS4gVGltZSBzaW5jZSBsYXN0IHRpY2s6ICR7bm93IC0gdGhpcy5sYXN0VGFza1N0YXJ0VGltZX1tc2ApO1xuXG4gICAgICAgIGlmIChcbiAgICAgICAgICB0aGlzLnJ1bm5pbmdUYXNrcyA8IHRoaXMuY29uY3VycmVuY3lMaW1pdCAmJlxuICAgICAgICAgIHRoaXMucXVldWUuc2l6ZSgpID4gMFxuICAgICAgICApIHtcbiAgICAgICAgICB0aGlzLnJ1bm5pbmdUYXNrcysrO1xuICAgICAgICAgIHRoaXMucHJvY2Vzc1Rhc2soKTtcbiAgICAgICAgICB0aGlzLmxhc3RUYXNrU3RhcnRUaW1lID0gbm93O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIHRoaXMuZGVidWcoYE5vIHRhc2sgcHJvY2Vzc2VkIGF0IHRoaXMgdGljay4gUnVubmluZyB0YXNrczogJHt0aGlzLnJ1bm5pbmdUYXNrc30sIFF1ZXVlIHNpemU6ICR7dGhpcy5xdWV1ZS5zaXplKCl9YCk7XG4gICAgICAgIH1cbiAgICAgIH0sIHRoaXMuaW50ZXJ2YWwpO1xuXG4gICAgICAvLyB0aGlzLmRlYnVnKGBUaW1lciBzZXQgd2l0aCBpbnRlcnZhbDogJHt0aGlzLmludGVydmFsfW1zYCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzdG9wUHJvY2Vzc2luZygpIHtcbiAgICBpZiAodGhpcy50aW1lcikge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnRpbWVyKTtcbiAgICAgIHRoaXMudGltZXIgPSBudWxsO1xuICAgIH1cbiAgICB0aGlzLmVtaXR0ZXIucmVtb3ZlQWxsTGlzdGVuZXJzKGB0aWNrXyR7dGhpcy5pbnN0YW5jZUlkfWApO1xuICAgIHRoaXMuaXNQcm9jZXNzaW5nID0gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIHByb2Nlc3NRdWV1ZSgpIHtcbiAgICBpZiAodGhpcy5pc1Byb2Nlc3NpbmcpIHtcbiAgICAgIHRoaXMuZW1pdHRlci5lbWl0KGB0aWNrXyR7dGhpcy5pbnN0YW5jZUlkfWApO1xuICAgIH1cbiAgfVxufVxuIl19