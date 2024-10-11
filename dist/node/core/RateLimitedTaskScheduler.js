"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitedTaskScheduler = void 0;
const events_1 = require("events");
const Loggable_1 = require("../logging/Loggable");
const InMemoryQueueStrategy_1 = require("./InMemoryQueueStrategy");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvcmUvUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLG1DQUFzQztBQUN0QyxrREFBOEQ7QUFFOUQsbUVBQWdFO0FBaUJoRSxNQUFzQix3QkFBb0MsU0FBUSxtQkFBUTtJQVd4RSxZQUNZLG1CQUEyQixFQUFFLEVBQzdCLHNCQUE4QixDQUFDLEVBQy9CLFdBQW1CLElBQUk7UUFFakMsS0FBSyxFQUFFLENBQUM7UUFKRSxxQkFBZ0IsR0FBaEIsZ0JBQWdCLENBQWE7UUFDN0Isd0JBQW1CLEdBQW5CLG1CQUFtQixDQUFZO1FBQy9CLGFBQVEsR0FBUixRQUFRLENBQWU7UUFiekIsaUJBQVksR0FBVyxDQUFDLENBQUM7UUFDM0IsVUFBSyxHQUEwQixJQUFJLENBQUM7UUFDbEMsWUFBTyxHQUFHLElBQUkscUJBQVksRUFBRSxDQUFDO1FBQzdCLGlCQUFZLEdBQUcsS0FBSyxDQUFDO1FBRXZCLHVCQUFrQixHQUFXLENBQUMsQ0FBQztRQUMvQixnQkFBVyxHQUFXLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUNqQyxnQkFBVyxHQUFXLElBQUksQ0FBQyxDQUFDLHVCQUF1QjtRQUNuRCxzQkFBaUIsR0FBVyxDQUFDLENBQUM7UUFhNUIsVUFBSyxHQUNiLElBQUksNkNBQXFCLEVBQTJCLENBQUM7UUFOckQsSUFBSSxRQUFRLElBQUksQ0FBQztZQUFFLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLENBQUMsQ0FBQztRQUN4RSxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUMxRCx3SkFBd0o7SUFDMUosQ0FBQztJQUtTLGtCQUFrQixDQUMxQixJQUFxQixFQUNyQixLQUFxQjtRQUVyQixPQUFPLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsQ0FBQztJQUNsQyxDQUFDO0lBRVMsbUJBQW1CLENBQUMsS0FBYTtRQUN6QyxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsS0FBSyxDQUFDO0lBQ2hDLENBQUM7SUFFUyxzQkFBc0IsQ0FBQyxLQUFhO1FBQzVDLElBQUksQ0FBQyxtQkFBbUIsR0FBRyxLQUFLLENBQUM7SUFDbkMsQ0FBQztJQUVTLGNBQWMsQ0FBQyxRQUFnQjtRQUN2QyxJQUFJLENBQUMsUUFBUSxHQUFHLFFBQVEsQ0FBQztJQUMzQixDQUFDO0lBRUQsWUFBWSxDQUFDLElBQXFCLEVBQUUsS0FBcUI7UUFDdkQsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksRUFBRSxLQUFLLENBQUMsQ0FBQztRQUMxRCxJQUFJLENBQUMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxZQUFZLENBQUMsQ0FBQztRQUNqQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3ZCLElBQUksQ0FBQyxlQUFlLEVBQUUsQ0FBQztRQUN6QixDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxhQUFhLENBQ2pCLEtBQThEO1FBRTlELEtBQUssTUFBTSxFQUFFLElBQUksRUFBRSxLQUFLLEVBQUUsSUFBSSxLQUFLLEVBQUUsQ0FBQztZQUNwQyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQ3ZDLENBQUM7SUFDSCxDQUFDO0lBRUQsY0FBYyxDQUFDLFFBQTRDO1FBQ3pELElBQUksQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDLGNBQWMsRUFBRSxRQUFRLENBQUMsQ0FBQztJQUM1QyxDQUFDO0lBRVMsS0FBSyxDQUFDLFdBQVc7UUFDekIsTUFBTSxZQUFZLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUMxQyxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUM7WUFDbEIsb0NBQW9DO1lBQ3BDLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUNwQixPQUFPO1FBQ1QsQ0FBQztRQUVELE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztRQUU3QixJQUFJLE1BQXdCLENBQUM7UUFDN0IsSUFBSSxDQUFDO1lBQ0gsTUFBTSxlQUFlLEdBQUcsTUFBTSxZQUFZLENBQUMsT0FBTyxDQUFDLFlBQVksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUN2RSxNQUFNLEdBQUc7Z0JBQ1AsT0FBTyxFQUFFLElBQUk7Z0JBQ2IsTUFBTSxFQUFFLGVBQWU7YUFDeEIsQ0FBQztZQUNGLElBQUksQ0FBQyxrQkFBa0IsRUFBRSxDQUFDO1lBQzFCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUMzQix3RkFBd0Y7UUFDMUYsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsTUFBTSxHQUFHO2dCQUNQLE9BQU8sRUFBRSxLQUFLO2dCQUNkLEtBQUssRUFDSCxLQUFLLFlBQVksd0JBQWEsQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxJQUFJLHdCQUFhLENBQUMsS0FBSyxDQUFDO2FBQ3BFLENBQUM7WUFDRixJQUFJLENBQUMsS0FBSyxDQUFDLHVCQUF1QixFQUFFLEtBQUssQ0FBQyxDQUFDO1FBQzdDLENBQUM7UUFFRCxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxjQUFjLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDMUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ3BCLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO0lBQzNCLENBQUM7SUFFTyxpQkFBaUI7UUFDdkIsTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQ3ZCLElBQUksR0FBRyxHQUFHLElBQUksQ0FBQyxXQUFXLElBQUksSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQy9DLE1BQU0sY0FBYyxHQUFHLENBQUMsR0FBRyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsR0FBRyxJQUFJLENBQUM7WUFDdkQsTUFBTSxtQkFBbUIsR0FDdkIsQ0FBQyxJQUFJLENBQUMsa0JBQWtCLEdBQUcsY0FBYyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxDQUFDO1lBQ3RFLDBJQUEwSTtZQUMxSSxtRUFBbUU7WUFDbkUsMERBQTBEO1lBRTFELGlCQUFpQjtZQUNqQixJQUFJLENBQUMsa0JBQWtCLEdBQUcsQ0FBQyxDQUFDO1lBQzVCLElBQUksQ0FBQyxXQUFXLEdBQUcsR0FBRyxDQUFDO1FBQ3pCLENBQUM7SUFDSCxDQUFDO0lBRVMsZUFBZTtRQUN2QixJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3ZCLElBQUksQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDO1lBQ3pCLElBQUksQ0FBQyxpQkFBaUIsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7WUFFcEMsSUFBSSxDQUFDLEtBQUssR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFO2dCQUM1QixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxFQUFFLENBQUM7Z0JBQ3ZCLHlGQUF5RjtnQkFFekYsSUFDRSxJQUFJLENBQUMsWUFBWSxHQUFHLElBQUksQ0FBQyxnQkFBZ0I7b0JBQ3pDLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLEdBQUcsQ0FBQyxFQUNyQixDQUFDO29CQUNELElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztvQkFDcEIsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO29CQUNuQixJQUFJLENBQUMsaUJBQWlCLEdBQUcsR0FBRyxDQUFDO2dCQUMvQixDQUFDO3FCQUFNLENBQUM7b0JBQ04sdUhBQXVIO2dCQUN6SCxDQUFDO1lBQ0gsQ0FBQyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQztZQUVsQiw2REFBNkQ7UUFDL0QsQ0FBQztJQUNILENBQUM7SUFFTyxjQUFjO1FBQ3BCLElBQUksSUFBSSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ2YsYUFBYSxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUMxQixJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQztRQUNwQixDQUFDO1FBQ0QsSUFBSSxDQUFDLE9BQU8sQ0FBQyxrQkFBa0IsQ0FBQyxRQUFRLElBQUksQ0FBQyxVQUFVLEVBQUUsQ0FBQyxDQUFDO1FBQzNELElBQUksQ0FBQyxZQUFZLEdBQUcsS0FBSyxDQUFDO0lBQzVCLENBQUM7SUFFTyxZQUFZO1FBQ2xCLElBQUksSUFBSSxDQUFDLFlBQVksRUFBRSxDQUFDO1lBQ3RCLElBQUksQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLFFBQVEsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDLENBQUM7UUFDL0MsQ0FBQztJQUNILENBQUM7Q0FDRjtBQXpKRCw0REF5SkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tIFwiZXZlbnRzXCI7XG5pbXBvcnQgeyBMb2dnYWJsZSwgTG9nZ2FibGVFcnJvciB9IGZyb20gXCIuLi9sb2dnaW5nL0xvZ2dhYmxlXCI7XG5pbXBvcnQgeyBJUXVldWVTdHJhdGVneSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBJbk1lbW9yeVF1ZXVlU3RyYXRlZ3kgfSBmcm9tIFwiLi9Jbk1lbW9yeVF1ZXVlU3RyYXRlZ3lcIjtcblxudHlwZSBUYXNrSW5wdXQ8VEluPiA9IFRJbjtcblxuZXhwb3J0IHR5cGUgVGFza091dHB1dDxUT3V0PiA9IHtcbiAgc3VjY2VzczogYm9vbGVhbjtcbiAgcmVzdWx0PzogVE91dDtcbiAgZXJyb3I/OiBMb2dnYWJsZUVycm9yO1xufTtcblxudHlwZSBUYXNrPFRJbiwgVE91dD4gPSAoaW5wdXQ6IFRhc2tJbnB1dDxUSW4+KSA9PiBQcm9taXNlPFRPdXQ+O1xuXG5leHBvcnQgdHlwZSBEZWZlcnJlZFRhc2s8VEluLCBUT3V0PiA9IHtcbiAgZXhlY3V0ZTogVGFzazxUSW4sIFRPdXQ+O1xuICBpbnB1dDogVGFza0lucHV0PFRJbj47XG59O1xuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyPFRJbiwgVE91dD4gZXh0ZW5kcyBMb2dnYWJsZSB7XG4gIHByb3RlY3RlZCBydW5uaW5nVGFza3M6IG51bWJlciA9IDA7XG4gIHByaXZhdGUgdGltZXI6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHByb3RlY3RlZCBlbWl0dGVyID0gbmV3IEV2ZW50RW1pdHRlcigpO1xuICBwcm90ZWN0ZWQgaXNQcm9jZXNzaW5nID0gZmFsc2U7XG4gIHByb3RlY3RlZCByZWFkb25seSBpbnN0YW5jZUlkOiBzdHJpbmc7XG4gIHByaXZhdGUgdGFza1Byb2Nlc3NlZENvdW50OiBudW1iZXIgPSAwO1xuICBwcml2YXRlIGxhc3RMb2dUaW1lOiBudW1iZXIgPSBEYXRlLm5vdygpO1xuICBwcml2YXRlIGxvZ0ludGVydmFsOiBudW1iZXIgPSAyMDAwOyAvLyBMb2cgZXZlcnkgdHdvIHNlY29uZFxuICBwcml2YXRlIGxhc3RUYXNrU3RhcnRUaW1lOiBudW1iZXIgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByb3RlY3RlZCBjb25jdXJyZW5jeUxpbWl0OiBudW1iZXIgPSAxMCxcbiAgICBwcm90ZWN0ZWQgcmVxdWVzdHNQZXJJbnRlcnZhbDogbnVtYmVyID0gNSxcbiAgICBwcm90ZWN0ZWQgaW50ZXJ2YWw6IG51bWJlciA9IDIwMDBcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICBpZiAoaW50ZXJ2YWwgPD0gMCkgdGhyb3cgbmV3IEVycm9yKFwiUmF0ZSBsaW1pdCBtdXN0IGJlIGdyZWF0ZXIgdGhhbiAwXCIpO1xuICAgIHRoaXMuaW5zdGFuY2VJZCA9IE1hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnNsaWNlKDIsIDExKTtcbiAgICAvLyB0aGlzLmRlYnVnKGBTY2hlZHVsZXIgaW5pdGlhbGl6ZWQgd2l0aCBjb25jdXJyZW5jeUxpbWl0OiAke2NvbmN1cnJlbmN5TGltaXR9LCByZXF1ZXN0c1BlckludGVydmFsOiAke3JlcXVlc3RzUGVySW50ZXJ2YWx9LCBpbnRlcnZhbDogJHtpbnRlcnZhbH1tc2ApO1xuICB9XG5cbiAgcHJvdGVjdGVkIHF1ZXVlOiBJUXVldWVTdHJhdGVneTxEZWZlcnJlZFRhc2s8VEluLCBUT3V0Pj4gPVxuICAgIG5ldyBJbk1lbW9yeVF1ZXVlU3RyYXRlZ3k8RGVmZXJyZWRUYXNrPFRJbiwgVE91dD4+KCk7XG5cbiAgcHJvdGVjdGVkIGNyZWF0ZURlZmVycmVkVGFzayhcbiAgICB0YXNrOiBUYXNrPFRJbiwgVE91dD4sXG4gICAgaW5wdXQ6IFRhc2tJbnB1dDxUSW4+XG4gICk6IERlZmVycmVkVGFzazxUSW4sIFRPdXQ+IHtcbiAgICByZXR1cm4geyBleGVjdXRlOiB0YXNrLCBpbnB1dCB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIHNldENvbmN1cnJlbmN5TGltaXQobGltaXQ6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMuY29uY3VycmVuY3lMaW1pdCA9IGxpbWl0O1xuICB9XG5cbiAgcHJvdGVjdGVkIHNldFJlcXVlc3RzUGVySW50ZXJ2YWwobGltaXQ6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMucmVxdWVzdHNQZXJJbnRlcnZhbCA9IGxpbWl0O1xuICB9XG5cbiAgcHJvdGVjdGVkIHNldFRwc0ludGVydmFsKGludGVydmFsOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmludGVydmFsID0gaW50ZXJ2YWw7XG4gIH1cblxuICBzY2hlZHVsZVRhc2sodGFzazogVGFzazxUSW4sIFRPdXQ+LCBpbnB1dDogVGFza0lucHV0PFRJbj4pOiB2b2lkIHtcbiAgICBjb25zdCBkZWZlcnJlZFRhc2sgPSB0aGlzLmNyZWF0ZURlZmVycmVkVGFzayh0YXNrLCBpbnB1dCk7XG4gICAgdGhpcy5xdWV1ZS5lbnF1ZXVlKGRlZmVycmVkVGFzayk7XG4gICAgaWYgKCF0aGlzLmlzUHJvY2Vzc2luZykge1xuICAgICAgdGhpcy5zdGFydFByb2Nlc3NpbmcoKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBzY2hlZHVsZVRhc2tzKFxuICAgIHRhc2tzOiBBcnJheTx7IHRhc2s6IFRhc2s8VEluLCBUT3V0PjsgaW5wdXQ6IFRhc2tJbnB1dDxUSW4+IH0+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGZvciAoY29uc3QgeyB0YXNrLCBpbnB1dCB9IG9mIHRhc2tzKSB7XG4gICAgICBhd2FpdCB0aGlzLnNjaGVkdWxlVGFzayh0YXNrLCBpbnB1dCk7XG4gICAgfVxuICB9XG5cbiAgb25UYXNrQ29tcGxldGUoY2FsbGJhY2s6IChyZXN1bHQ6IFRhc2tPdXRwdXQ8VE91dD4pID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLmVtaXR0ZXIub24oXCJ0YXNrQ29tcGxldGVcIiwgY2FsbGJhY2spO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHByb2Nlc3NUYXNrKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRlZmVycmVkVGFzayA9IHRoaXMucXVldWUuZGVxdWV1ZSgpO1xuICAgIGlmICghZGVmZXJyZWRUYXNrKSB7XG4gICAgICAvLyB0aGlzLmRlYnVnKFwiTm8gdGFzayB0byBwcm9jZXNzXCIpO1xuICAgICAgdGhpcy5ydW5uaW5nVGFza3MtLTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBzdGFydFRpbWUgPSBEYXRlLm5vdygpO1xuXG4gICAgbGV0IHJlc3VsdDogVGFza091dHB1dDxUT3V0PjtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZXhlY3V0aW9uUmVzdWx0ID0gYXdhaXQgZGVmZXJyZWRUYXNrLmV4ZWN1dGUoZGVmZXJyZWRUYXNrLmlucHV0KTtcbiAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgICAgcmVzdWx0OiBleGVjdXRpb25SZXN1bHQsXG4gICAgICB9O1xuICAgICAgdGhpcy50YXNrUHJvY2Vzc2VkQ291bnQrKztcbiAgICAgIGNvbnN0IGVuZFRpbWUgPSBEYXRlLm5vdygpO1xuICAgICAgLy8gdGhpcy5kZWJ1ZyhgVGFzayBjb21wbGV0ZWQgYXQgJHtlbmRUaW1lfS4gRXhlY3V0aW9uIHRpbWU6ICR7ZW5kVGltZSAtIHN0YXJ0VGltZX1tc2ApO1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIHJlc3VsdCA9IHtcbiAgICAgICAgc3VjY2VzczogZmFsc2UsXG4gICAgICAgIGVycm9yOlxuICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgTG9nZ2FibGVFcnJvciA/IGVycm9yIDogbmV3IExvZ2dhYmxlRXJyb3IoZXJyb3IpLFxuICAgICAgfTtcbiAgICAgIHRoaXMuZXJyb3IoXCJUYXNrIGV4ZWN1dGlvbiBmYWlsZWRcIiwgZXJyb3IpO1xuICAgIH1cblxuICAgIHRoaXMuZW1pdHRlci5lbWl0KFwidGFza0NvbXBsZXRlXCIsIHJlc3VsdCk7XG4gICAgdGhpcy5ydW5uaW5nVGFza3MtLTtcbiAgICB0aGlzLmxvZ1Byb2Nlc3NpbmdSYXRlKCk7XG4gIH1cblxuICBwcml2YXRlIGxvZ1Byb2Nlc3NpbmdSYXRlKCk6IHZvaWQge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgaWYgKG5vdyAtIHRoaXMubGFzdExvZ1RpbWUgPj0gdGhpcy5sb2dJbnRlcnZhbCkge1xuICAgICAgY29uc3QgZWxhcHNlZFNlY29uZHMgPSAobm93IC0gdGhpcy5sYXN0TG9nVGltZSkgLyAxMDAwO1xuICAgICAgY29uc3QgYXZnVGFza3NQZXJJbnRlcnZhbCA9XG4gICAgICAgICh0aGlzLnRhc2tQcm9jZXNzZWRDb3VudCAvIGVsYXBzZWRTZWNvbmRzKSAqICh0aGlzLmludGVydmFsIC8gMTAwMCk7XG4gICAgICAvLyB0aGlzLmRlYnVnKGBBdmVyYWdlIHRhc2tzIHByb2Nlc3NlZCBwZXIgaW50ZXJ2YWw6ICR7YXZnVGFza3NQZXJJbnRlcnZhbC50b0ZpeGVkKDIpfSAob3ZlciBsYXN0ICR7ZWxhcHNlZFNlY29uZHMudG9GaXhlZCgyKX0gc2Vjb25kcylgKTtcbiAgICAgIC8vIHRoaXMuZGVidWcoYFRvdGFsIHRhc2tzIHByb2Nlc3NlZDogJHt0aGlzLnRhc2tQcm9jZXNzZWRDb3VudH1gKTtcbiAgICAgIC8vIHRoaXMuZGVidWcoYEN1cnJlbnQgcXVldWUgc2l6ZTogJHt0aGlzLnF1ZXVlLnNpemUoKX1gKTtcblxuICAgICAgLy8gUmVzZXQgY291bnRlcnNcbiAgICAgIHRoaXMudGFza1Byb2Nlc3NlZENvdW50ID0gMDtcbiAgICAgIHRoaXMubGFzdExvZ1RpbWUgPSBub3c7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIHN0YXJ0UHJvY2Vzc2luZygpIHtcbiAgICBpZiAoIXRoaXMuaXNQcm9jZXNzaW5nKSB7XG4gICAgICB0aGlzLmlzUHJvY2Vzc2luZyA9IHRydWU7XG4gICAgICB0aGlzLmxhc3RUYXNrU3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcblxuICAgICAgdGhpcy50aW1lciA9IHNldEludGVydmFsKCgpID0+IHtcbiAgICAgICAgY29uc3Qgbm93ID0gRGF0ZS5ub3coKTtcbiAgICAgICAgLy8gdGhpcy5kZWJ1ZyhgVGljayBhdCAke25vd30uIFRpbWUgc2luY2UgbGFzdCB0aWNrOiAke25vdyAtIHRoaXMubGFzdFRhc2tTdGFydFRpbWV9bXNgKTtcblxuICAgICAgICBpZiAoXG4gICAgICAgICAgdGhpcy5ydW5uaW5nVGFza3MgPCB0aGlzLmNvbmN1cnJlbmN5TGltaXQgJiZcbiAgICAgICAgICB0aGlzLnF1ZXVlLnNpemUoKSA+IDBcbiAgICAgICAgKSB7XG4gICAgICAgICAgdGhpcy5ydW5uaW5nVGFza3MrKztcbiAgICAgICAgICB0aGlzLnByb2Nlc3NUYXNrKCk7XG4gICAgICAgICAgdGhpcy5sYXN0VGFza1N0YXJ0VGltZSA9IG5vdztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB0aGlzLmRlYnVnKGBObyB0YXNrIHByb2Nlc3NlZCBhdCB0aGlzIHRpY2suIFJ1bm5pbmcgdGFza3M6ICR7dGhpcy5ydW5uaW5nVGFza3N9LCBRdWV1ZSBzaXplOiAke3RoaXMucXVldWUuc2l6ZSgpfWApO1xuICAgICAgICB9XG4gICAgICB9LCB0aGlzLmludGVydmFsKTtcblxuICAgICAgLy8gdGhpcy5kZWJ1ZyhgVGltZXIgc2V0IHdpdGggaW50ZXJ2YWw6ICR7dGhpcy5pbnRlcnZhbH1tc2ApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc3RvcFByb2Nlc3NpbmcoKSB7XG4gICAgaWYgKHRoaXMudGltZXIpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy50aW1lcik7XG4gICAgICB0aGlzLnRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5lbWl0dGVyLnJlbW92ZUFsbExpc3RlbmVycyhgdGlja18ke3RoaXMuaW5zdGFuY2VJZH1gKTtcbiAgICB0aGlzLmlzUHJvY2Vzc2luZyA9IGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBwcm9jZXNzUXVldWUoKSB7XG4gICAgaWYgKHRoaXMuaXNQcm9jZXNzaW5nKSB7XG4gICAgICB0aGlzLmVtaXR0ZXIuZW1pdChgdGlja18ke3RoaXMuaW5zdGFuY2VJZH1gKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==