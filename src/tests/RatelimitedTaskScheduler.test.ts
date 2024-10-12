import {
  RateLimitedTaskScheduler,
  TaskOutput,
} from "../core/RateLimitedTaskScheduler";
import { Loggable } from "../logging";

class TestRateLimitedTaskScheduler extends RateLimitedTaskScheduler<
  number,
  number
> {
  public getRunningTasks(): number {
    return this.runningTasks;
  }

  public getTasksInitiatedInWindow(): number {
    return this.tasksInitiatedInWindow;
  }

  public getQueueSize(): number {
    return this.queue.size();
  }

  protected debug(data: any) {
    console.log(data);
  }
}

describe("RateLimitedTaskScheduler", () => {
  let scheduler: TestRateLimitedTaskScheduler;
  let completedTasks: TaskOutput<number>[];

  beforeEach(() => {
    jest.useFakeTimers();
    scheduler = new TestRateLimitedTaskScheduler(2, 3, 1000);
    completedTasks = [];
    scheduler.onTaskComplete((result) => completedTasks.push(result));
  });

  afterEach(() => {
    jest.useRealTimers();
    scheduler.destroy();
    Loggable.shutdown();
  });

  const createTask =
    (delay: number) =>
    async (input: number): Promise<number> => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return input * 2;
    };

  test("1. Scheduling a task will run it immediately if limits allow", async () => {
    const task = jest.fn().mockImplementation(async (input: number) => {
      await new Promise((resolve) => setImmediate(resolve));
      return input * 2;
    });

    scheduler.scheduleTask(task, 1);

    expect(scheduler.getRunningTasks()).toBe(1);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(1);
    expect(scheduler.getQueueSize()).toBe(0);

    // Advance all timers and wait for pending promises
    await jest.runAllTimersAsync();

    expect(completedTasks).toHaveLength(1);
    expect(completedTasks[0]).toEqual({ success: true, result: 2 });
  }, 10000);

  test("2. After reaching throttling limit, new tasks will be enqueued", async () => {
    const task = createTask(100);

    // Schedule tasks up to the concurrency limit
    scheduler.scheduleTask(task, 1);
    scheduler.scheduleTask(task, 2);

    // Check state after scheduling 2 tasks
    expect(scheduler.getRunningTasks()).toBe(2);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(2);
    expect(scheduler.getQueueSize()).toBe(0);

    // Schedule third task - should be enqueued due to concurrency limit
    scheduler.scheduleTask(task, 3);

    // Check state after scheduling 3rd task
    expect(scheduler.getRunningTasks()).toBe(2);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(2);
    expect(scheduler.getQueueSize()).toBe(1);

    // Schedule fourth task - should also be enqueued
    scheduler.scheduleTask(task, 4);

    // Check state after scheduling 4th task
    expect(scheduler.getRunningTasks()).toBe(2);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(2);
    expect(scheduler.getQueueSize()).toBe(2);

    // Advance time to complete the first two tasks
    await jest.advanceTimersByTimeAsync(100);

    // We will hit the throttling limit, so it should run 1 more task and enqueue the other.
    expect(scheduler.getRunningTasks()).toBe(1);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(3);
    expect(scheduler.getQueueSize()).toBe(1);

    // Complete the remaining tasks within the current window
    await jest.advanceTimersByTimeAsync(100);

    expect(scheduler.getRunningTasks()).toBe(0);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(3);
    expect(scheduler.getQueueSize()).toBe(1);

    // Next task should start running after the first throttling window elapses
    await jest.advanceTimersByTimeAsync(800);

    expect(scheduler.getRunningTasks()).toBe(1);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(1);
    expect(scheduler.getQueueSize()).toBe(0);

    // Finally all tasks must be complete
    await jest.advanceTimersByTimeAsync(800);

    expect(scheduler.getRunningTasks()).toBe(0);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(1);
    expect(scheduler.getQueueSize()).toBe(0);
  });

  test("3. After reaching concurrency limit, new tasks will be enqueued", async () => {
    const task = createTask(1000);

    // Schedule tasks up to the concurrency limit
    scheduler.scheduleTask(task, 1);
    scheduler.scheduleTask(task, 2);

    await jest.advanceTimersByTimeAsync(100);

    expect(scheduler.getRunningTasks()).toBe(2);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(2);
    expect(scheduler.getQueueSize()).toBe(0);

    // Schedule one more task
    scheduler.scheduleTask(task, 3);

    expect(scheduler.getRunningTasks()).toBe(2);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(2);
    expect(scheduler.getQueueSize()).toBe(1);
  });

  test("4. Task initiated immediately when slot becomes available within same throttling window", async () => {
    const fastTask = createTask(100);
    const slowTask = createTask(500);

    scheduler.scheduleTask(fastTask, 1);
    scheduler.scheduleTask(slowTask, 2);
    scheduler.scheduleTask(slowTask, 3);

    expect(scheduler.getRunningTasks()).toBe(2);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(2);
    expect(scheduler.getQueueSize()).toBe(1);

    await jest.advanceTimersByTimeAsync(100);

    expect(scheduler.getRunningTasks()).toBe(2);
    expect(scheduler.getTasksInitiatedInWindow()).toBe(3);
    expect(scheduler.getQueueSize()).toBe(0);
  });

  test("5. Task initiated immediately when new throttling window starts", async () => {
    const task = createTask(1000);

    // Fill up the current window
    for (let i = 0; i < 3; i++) {
      scheduler.scheduleTask(task, i);
    }

    expect(scheduler.getTasksInitiatedInWindow()).toBe(2);
    expect(scheduler.getQueueSize()).toBe(1);

    // Move to the next window
    await jest.advanceTimersByTimeAsync(1000);

    expect(scheduler.getTasksInitiatedInWindow()).toBe(1);
    expect(scheduler.getRunningTasks()).toBe(1);
    expect(scheduler.getQueueSize()).toBe(0);
  });
});
