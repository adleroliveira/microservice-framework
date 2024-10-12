"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Loggable = exports.LoggableError = void 0;
exports.logMethod = logMethod;
const LogStrategy_1 = require("./LogStrategy");
const InMemoryQueueStrategy_1 = require("../core/InMemoryQueueStrategy");
const LogStrategy_2 = require("./LogStrategy");
const util_1 = __importDefault(require("util"));
/**
 * @fileoverview This module provides a logging system with different log levels,
 * notification strategies, and queue strategies.
 */
const timers_1 = require("timers");
/**
 * Enum representing different log levels.
 */
function logMethod() {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args) {
            const className = this.constructor.name;
            const truncatedArgs = LogStrategy_1.LogStrategy.truncateAndStringify(args);
            const logResult = (result) => {
                if (Loggable.shouldLog(LogStrategy_2.LogLevel.DEBUG)) {
                    const truncatedResult = LogStrategy_1.LogStrategy.truncateAndStringify(result);
                    const message = {
                        args: truncatedArgs,
                        result: truncatedResult,
                    };
                    Loggable.logDebug(`LogMethodDecorator::${className}::${propertyKey}`, message, className);
                }
                return result;
            };
            const logError = (error) => {
                const errorMessage = `${className}::${propertyKey} resulted in error`;
                const truncatedError = error instanceof LoggableError
                    ? error.toJSON()
                    : LogStrategy_1.LogStrategy.truncateAndStringify(error.message || error);
                const message = {
                    args: truncatedArgs,
                    error: truncatedError,
                };
                Loggable.logError(`LogMethodDecorator::${errorMessage}`, message, className);
                throw error;
            };
            try {
                const result = originalMethod.apply(this, args);
                if (result instanceof Promise) {
                    return result.then(logResult, logError);
                }
                else {
                    return logResult(result);
                }
            }
            catch (error) {
                return logError(error);
            }
        };
        return descriptor;
    };
}
class LoggableError extends Error {
    constructor(message, payload, originalError) {
        super(message);
        this.name = "LoggableError";
        this.payload = payload;
        this.originalError = originalError;
        // Capture the stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, LoggableError);
        }
        // Append the original error's stack to this error's stack
        if (originalError && originalError.stack) {
            this.stack = this.stack + "\n\nCaused by:\n" + originalError.stack;
        }
        Object.setPrototypeOf(this, LoggableError.prototype);
    }
    getThrowingClassName() {
        // Get the stack trace
        const stack = this.stack?.split("\n");
        if (!stack || stack.length < 4)
            return null;
        // The constructor call will be the third line in the stack (index 2)
        const constructorCall = stack[2];
        // Extract the class name using a regular expression
        const match = constructorCall.match(/at\s+(.*?)\s+\(/);
        if (match && match[1]) {
            const fullName = match[1];
            // If it's a method call, extract the class name
            const lastDotIndex = fullName.lastIndexOf(".");
            return lastDotIndex !== -1
                ? fullName.substring(0, lastDotIndex)
                : fullName;
        }
        return null;
    }
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            payload: this.payload,
            throwingClass: this.getThrowingClassName(),
            stack: this.stack,
        };
    }
    toString() {
        return JSON.stringify(this.toJSON(), null, 2);
    }
}
exports.LoggableError = LoggableError;
/**
 * Abstract base class for objects that can log messages.
 */
class Loggable {
    static FormatLogMessage(message) {
        let timestamp;
        try {
            timestamp = new Date(message.timestamp).toISOString().slice(0, -5);
        }
        catch (error) {
            // Handle invalid date
            console.error(`Invalid timestamp: ${message.timestamp}`, message);
            timestamp = "Invalid Date";
        }
        let formattedMessage = `[${timestamp}] ${message.level?.toUpperCase() ?? "UNKNOWN"}: ${message.message}`;
        if (message.payload) {
            formattedMessage += "\nPayload:";
            formattedMessage += `\n  Type: ${message.payload.type}`;
            formattedMessage += `\n  Content: ${formatPayloadContent(message.payload)}`;
        }
        return formattedMessage;
    }
    static handleErrors(target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args) {
            try {
                const result = originalMethod.apply(this, args);
                if (result instanceof Promise) {
                    return result.catch((error) => {
                        if (this instanceof Loggable) {
                            const truncatedArgs = LogStrategy_1.LogStrategy.truncateAndStringify(args, 300);
                            return this.logAndThrowError(error, truncatedArgs);
                        }
                        else {
                            console.warn(`handleErrors decorator used on non-Loggable class: ${target.constructor.name}`);
                            throw error;
                        }
                    });
                }
                return result;
            }
            catch (error) {
                if (this instanceof Loggable) {
                    return this.logAndThrowError(error);
                }
                else {
                    console.warn(`handleErrors decorator used on non-Loggable class: ${target.constructor.name}`);
                    throw error;
                }
            }
        };
        return descriptor;
    }
    /**
     * Protected constructor to ensure the class is properly initialized.
     * @throws {Error} If the class is not initialized.
     */
    constructor() {
        if (!Loggable.isProcessing) {
            Loggable.startProcessing();
        }
    }
    /**
     * Sets the log strategy.
     * @param {LogStrategy} strategy - The new log strategy to use.
     */
    static setLogStrategy(strategy) {
        Loggable.logStrategy = strategy;
    }
    /**
     * Sets the queue strategy.
     * @param {IQueueStrategy<LogMessage>} strategy - The new queue strategy to use.
     */
    static setQueueStrategy(strategy) {
        Loggable.queueStrategy = strategy;
    }
    /**
     * Sets the log level.
     * @param {LogLevel} level - The new log level to use.
     */
    static setLogLevel(level) {
        Loggable.logLevel = level;
    }
    async logAndThrowError(error, args = {}) {
        const ErrorClass = this.constructor.LoggableError ||
            Loggable.DefaultLoggableError;
        let loggableError;
        if (error instanceof ErrorClass) {
            loggableError = error;
        }
        else {
            loggableError = new ErrorClass(error.message, { originalArgs: args }, error);
            // Preserve the original stack trace
            if (error instanceof Error && error.stack) {
                loggableError.stack = error.stack;
            }
        }
        // Add throwing class information without modifying the error object directly
        const throwingClass = this.constructor.name;
        const errorInfo = {
            ...loggableError.toJSON(),
            throwingClass,
        };
        this.error(loggableError.message, errorInfo);
        await Loggable.waitForEmptyQueue(); // Ensure the queue is empty before throwing
        throw loggableError;
    }
    /**
     * Waits for the queue to be empty.
     * @returns {Promise<void>} A promise that resolves when the queue is empty.
     */
    static waitForEmptyQueue() {
        return new Promise((resolve) => {
            const checkQueue = () => {
                if (!Loggable.isProcessing &&
                    Loggable.queueStrategy.dequeue() === undefined) {
                    resolve();
                }
                else {
                    (0, timers_1.setTimeout)(checkQueue, 100); // Check again after 100ms
                }
            };
            checkQueue();
        });
    }
    /**
     * Checks if a message with the given level should be logged.
     * @param {LogLevel} messageLevel - The level of the message to check.
     * @returns {boolean} True if the message should be logged, false otherwise.
     */
    static shouldLog(messageLevel) {
        return messageLevel >= Loggable.logLevel;
    }
    /**
     * Returns a value after ensuring all logs have been processed.
     * @param {T} value - The value to return.
     * @returns {Promise<T>} A promise that resolves with the value after all logs are processed.
     */
    async returnAfterLogging(value) {
        await Loggable.waitForEmptyQueue();
        return value;
    }
    /**
     * Creates a log message object.
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {string | object} [payload] - Optional payload for additional information.
     * @param {string} [className] - Optional class name for context.
     * @returns {LogMessage} The created log message object.
     */
    static createLogMessage(level, message, payload, className) {
        const prefixedMessage = className ? `${className}::${message}` : message;
        const logPayload = payload
            ? {
                type: typeof payload === "string" ? "text" : "json",
                content: payload,
            }
            : undefined;
        return {
            timestamp: new Date().toISOString(),
            level,
            message: prefixedMessage,
            payload: logPayload,
            sender: className || "Loggable",
        };
    }
    static logWithLevel(level, message, payload, className) {
        if (Loggable.shouldLog(level)) {
            const logMessage = Loggable.createLogMessage(LogStrategy_2.LogLevel[level], message, payload, className);
            Loggable.queueStrategy.enqueue(logMessage);
            Loggable.wakeUpQueue();
        }
    }
    static logDebug(message, payload, className) {
        Loggable.logWithLevel(LogStrategy_2.LogLevel.DEBUG, message, payload, className);
    }
    static logError(message, payload, className) {
        Loggable.logWithLevel(LogStrategy_2.LogLevel.ERROR, message, payload, className);
    }
    /**
     * Logs a debug message for the current instance.
     * @param {string} message - The debug message.
     * @param {string | object} [payload] - Optional payload for additional information.
     */
    debug(message, payload) {
        Loggable.logDebug(message, payload, this.constructor.name);
    }
    /**
     * Logs an info message for the current instance.
     * @param {string} message - The info message.
     * @param {string | object} [payload] - Optional payload for additional information.
     */
    info(message, payload) {
        if (Loggable.shouldLog(LogStrategy_2.LogLevel.INFO)) {
            const logMessage = Loggable.createLogMessage("INFO", message, payload, this.constructor.name);
            Loggable.queueStrategy.enqueue(logMessage);
        }
    }
    /**
     * Logs a warning message for the current instance.
     * @param {string} message - The warning message.
     * @param {string | object} [payload] - Optional payload for additional information.
     */
    warn(message, payload) {
        if (Loggable.shouldLog(LogStrategy_2.LogLevel.WARN)) {
            const logMessage = Loggable.createLogMessage("WARN", message, payload, this.constructor.name);
            Loggable.queueStrategy.enqueue(logMessage);
        }
    }
    /**
     * Logs an error message for the current instance.
     * @param {string | LoggableError} messageOrError - The error message or LoggableError object.
     * @param {string | object} [payload] - Optional payload for additional information (used only if message is a string).
     */
    error(messageOrError, payload) {
        if (Loggable.shouldLog(LogStrategy_2.LogLevel.ERROR)) {
            let message;
            let errorPayload;
            if (messageOrError instanceof LoggableError) {
                message = messageOrError.message;
                errorPayload = messageOrError.toJSON();
            }
            else {
                message = messageOrError;
                errorPayload = typeof payload === "object" ? payload : undefined;
            }
            const logMessage = Loggable.createLogMessage("ERROR", message, errorPayload, this.constructor.name);
            Loggable.queueStrategy.enqueue(logMessage);
        }
    }
    /**
     * Processes the queue of log messages.
     * @returns {Promise<void>} A promise that resolves when processing is complete.
     */
    static async processQueue() {
        if (Loggable.isProcessing)
            return;
        Loggable.isProcessing = true;
        while (true) {
            const message = Loggable.queueStrategy.dequeue();
            if (!message)
                break;
            try {
                await Loggable.logStrategy.send(message);
            }
            catch (error) {
                console.error("Failed to send message:", error);
                // Optionally re-enqueue the message or implement retry logic
            }
        }
        Loggable.isProcessing = false;
        // If there's no more messages and we're shutting down, resolve the shutdown promise
        if (Loggable.shutdownPromise &&
            Loggable.queueStrategy.dequeue() === undefined) {
            Loggable.resolveShutdown();
        }
        else {
            // Schedule the next processing cycle
            Loggable.scheduleNextProcessing();
        }
    }
    static scheduleNextProcessing() {
        if (Loggable.processingTimeout) {
            (0, timers_1.clearTimeout)(Loggable.processingTimeout);
        }
        Loggable.processingTimeout = (0, timers_1.setTimeout)(() => {
            Loggable.processQueue();
        }, 100);
    }
    /**
     * Starts processing the queue of log messages.
     */
    static startProcessing() {
        if (!Loggable.isProcessing && !Loggable.processingTimeout) {
            Loggable.scheduleNextProcessing();
        }
    }
    /**
     * Shuts down the logging system.
     */
    static async shutdown() {
        if (Loggable.processingTimeout) {
            (0, timers_1.clearTimeout)(Loggable.processingTimeout);
            Loggable.processingTimeout = null;
        }
        if (!Loggable.shutdownPromise) {
            Loggable.shutdownPromise = new Promise((resolve) => {
                Loggable.resolveShutdown = resolve;
            });
            // Process any remaining messages
            await Loggable.processQueue();
        }
        return Loggable.shutdownPromise;
    }
    static wakeUpQueue() {
        if (!Loggable.isProcessing &&
            !Loggable.processingTimeout &&
            !Loggable.shutdownPromise) {
            Loggable.startProcessing();
        }
    }
}
exports.Loggable = Loggable;
Loggable.queueStrategy = new InMemoryQueueStrategy_1.InMemoryQueueStrategy();
Loggable.logLevel = LogStrategy_2.LogLevel.INFO;
Loggable.isProcessing = false;
Loggable.processingTimeout = null;
Loggable.LogLevel = LogStrategy_2.LogLevel;
Loggable.LoggableError = LoggableError;
Loggable.shutdownPromise = null;
Loggable.DefaultLoggableError = class extends Error {
    constructor(message, payload, originalError) {
        super(message);
        this.name = "DefaultLoggableError";
        this.payload = payload;
        this.originalError = originalError;
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
        if (originalError && originalError.stack) {
            this.stack = this.stack + "\n\nCaused by:\n" + originalError.stack;
        }
    }
    toJSON() {
        return {
            name: this.name,
            message: this.message,
            payload: this.payload,
            stack: this.stack,
            originalError: this.originalError
                ? {
                    name: this.originalError.name,
                    message: this.originalError.message,
                    stack: this.originalError.stack,
                }
                : undefined,
        };
    }
};
Loggable.resolveShutdown = () => { };
function formatPayloadContent(payload) {
    const truncatedContent = LogStrategy_1.LogStrategy.truncateAndStringify(payload.content);
    if (payload.type === "text") {
        return truncatedContent;
    }
    return util_1.default.inspect(truncatedContent, { depth: null, colors: true });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTG9nZ2FibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9Mb2dnYWJsZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUEra0JTLDhCQUFTO0FBOWtCbEIsK0NBQTRDO0FBQzVDLHlFQUFzRTtBQUN0RSwrQ0FBaUU7QUFDakUsZ0RBQXdCO0FBRXhCOzs7R0FHRztBQUVILG1DQUFrRDtBQUVsRDs7R0FFRztBQUVILFNBQVMsU0FBUztJQUNoQixPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQThCO1FBRTlCLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsVUFBVSxDQUFDLEtBQUssR0FBRyxVQUFVLEdBQUcsSUFBVztZQUN6QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztZQUN4QyxNQUFNLGFBQWEsR0FBRyx5QkFBVyxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFDO1lBRTdELE1BQU0sU0FBUyxHQUFHLENBQUMsTUFBVyxFQUFFLEVBQUU7Z0JBQ2hDLElBQUksUUFBUSxDQUFDLFNBQVMsQ0FBQyxzQkFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQ3ZDLE1BQU0sZUFBZSxHQUFHLHlCQUFXLENBQUMsb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7b0JBQ2pFLE1BQU0sT0FBTyxHQUFHO3dCQUNkLElBQUksRUFBRSxhQUFhO3dCQUNuQixNQUFNLEVBQUUsZUFBZTtxQkFDeEIsQ0FBQztvQkFDRixRQUFRLENBQUMsUUFBUSxDQUNmLHVCQUF1QixTQUFTLEtBQUssV0FBVyxFQUFFLEVBQ2xELE9BQU8sRUFDUCxTQUFTLENBQ1YsQ0FBQztnQkFDSixDQUFDO2dCQUNELE9BQU8sTUFBTSxDQUFDO1lBQ2hCLENBQUMsQ0FBQztZQUVGLE1BQU0sUUFBUSxHQUFHLENBQUMsS0FBVSxFQUFFLEVBQUU7Z0JBQzlC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QUcsRUFBRSxHQUFFLENBQUMsQ0FBQztBQWF4RCxTQUFTLG9CQUFvQixDQUFDLE9BQW1CO0lBQy9DLE1BQU0sZ0JBQWdCLEdBQUcseUJBQVcsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFM0UsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRSxDQUFDO1FBQzVCLE9BQU8sZ0JBQTBCLENBQUM7SUFDcEMsQ0FBQztJQUVELE9BQU8sY0FBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7QUFDdkUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElRdWV1ZVN0cmF0ZWd5IH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IExvZ1N0cmF0ZWd5IH0gZnJvbSBcIi4vTG9nU3RyYXRlZ3lcIjtcbmltcG9ydCB7IEluTWVtb3J5UXVldWVTdHJhdGVneSB9IGZyb20gXCIuLi9jb3JlL0luTWVtb3J5UXVldWVTdHJhdGVneVwiO1xuaW1wb3J0IHsgTG9nTGV2ZWwsIExvZ01lc3NhZ2UsIExvZ1BheWxvYWQgfSBmcm9tIFwiLi9Mb2dTdHJhdGVneVwiO1xuaW1wb3J0IHV0aWwgZnJvbSBcInV0aWxcIjtcblxuLyoqXG4gKiBAZmlsZW92ZXJ2aWV3IFRoaXMgbW9kdWxlIHByb3ZpZGVzIGEgbG9nZ2luZyBzeXN0ZW0gd2l0aCBkaWZmZXJlbnQgbG9nIGxldmVscyxcbiAqIG5vdGlmaWNhdGlvbiBzdHJhdGVnaWVzLCBhbmQgcXVldWUgc3RyYXRlZ2llcy5cbiAqL1xuXG5pbXBvcnQgeyBzZXRUaW1lb3V0LCBjbGVhclRpbWVvdXQgfSBmcm9tIFwidGltZXJzXCI7XG5cbi8qKlxuICogRW51bSByZXByZXNlbnRpbmcgZGlmZmVyZW50IGxvZyBsZXZlbHMuXG4gKi9cblxuZnVuY3Rpb24gbG9nTWV0aG9kKCkge1xuICByZXR1cm4gZnVuY3Rpb24gKFxuICAgIHRhcmdldDogYW55LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcsXG4gICAgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yXG4gICkge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICBjb25zdCBjbGFzc05hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgICBjb25zdCB0cnVuY2F0ZWRBcmdzID0gTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkoYXJncyk7XG5cbiAgICAgIGNvbnN0IGxvZ1Jlc3VsdCA9IChyZXN1bHQ6IGFueSkgPT4ge1xuICAgICAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLkRFQlVHKSkge1xuICAgICAgICAgIGNvbnN0IHRydW5jYXRlZFJlc3VsdCA9IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KHJlc3VsdCk7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgICAgICAgIGFyZ3M6IHRydW5jYXRlZEFyZ3MsXG4gICAgICAgICAgICByZXN1bHQ6IHRydW5jYXRlZFJlc3VsdCxcbiAgICAgICAgICB9O1xuICAgICAgICAgIExvZ2dhYmxlLmxvZ0RlYnVnKFxuICAgICAgICAgICAgYExvZ01ldGhvZERlY29yYXRvcjo6JHtjbGFzc05hbWV9Ojoke3Byb3BlcnR5S2V5fWAsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgY2xhc3NOYW1lXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfTtcblxuICAgICAgY29uc3QgbG9nRXJyb3IgPSAoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgJHtjbGFzc05hbWV9Ojoke3Byb3BlcnR5S2V5fSByZXN1bHRlZCBpbiBlcnJvcmA7XG4gICAgICAgIGNvbnN0IHRydW5jYXRlZEVycm9yID1cbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIExvZ2dhYmxlRXJyb3JcbiAgICAgICAgICAgID8gZXJyb3IudG9KU09OKClcbiAgICAgICAgICAgIDogTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkoZXJyb3IubWVzc2FnZSB8fCBlcnJvcik7XG5cbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgICAgICBhcmdzOiB0cnVuY2F0ZWRBcmdzLFxuICAgICAgICAgIGVycm9yOiB0cnVuY2F0ZWRFcnJvcixcbiAgICAgICAgfTtcbiAgICAgICAgTG9nZ2FibGUubG9nRXJyb3IoXG4gICAgICAgICAgYExvZ01ldGhvZERlY29yYXRvcjo6JHtlcnJvck1lc3NhZ2V9YCxcbiAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgIGNsYXNzTmFtZVxuICAgICAgICApO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpO1xuXG4gICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC50aGVuKGxvZ1Jlc3VsdCwgbG9nRXJyb3IpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBsb2dSZXN1bHQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICByZXR1cm4gbG9nRXJyb3IoZXJyb3IpO1xuICAgICAgfVxuICAgIH07XG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBMb2dnYWJsZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBwdWJsaWMgcmVhZG9ubHkgcGF5bG9hZDogYW55O1xuICBwdWJsaWMgcmVhZG9ubHkgb3JpZ2luYWxFcnJvcjogRXJyb3IgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogYW55LCBvcmlnaW5hbEVycm9yPzogRXJyb3IpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSBcIkxvZ2dhYmxlRXJyb3JcIjtcbiAgICB0aGlzLnBheWxvYWQgPSBwYXlsb2FkO1xuICAgIHRoaXMub3JpZ2luYWxFcnJvciA9IG9yaWdpbmFsRXJyb3I7XG5cbiAgICAvLyBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZVxuICAgIGlmIChFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSkge1xuICAgICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgTG9nZ2FibGVFcnJvcik7XG4gICAgfVxuXG4gICAgLy8gQXBwZW5kIHRoZSBvcmlnaW5hbCBlcnJvcidzIHN0YWNrIHRvIHRoaXMgZXJyb3IncyBzdGFja1xuICAgIGlmIChvcmlnaW5hbEVycm9yICYmIG9yaWdpbmFsRXJyb3Iuc3RhY2spIHtcbiAgICAgIHRoaXMuc3RhY2sgPSB0aGlzLnN0YWNrICsgXCJcXG5cXG5DYXVzZWQgYnk6XFxuXCIgKyBvcmlnaW5hbEVycm9yLnN0YWNrO1xuICAgIH1cblxuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBMb2dnYWJsZUVycm9yLnByb3RvdHlwZSk7XG4gIH1cblxuICBwcml2YXRlIGdldFRocm93aW5nQ2xhc3NOYW1lKCk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIEdldCB0aGUgc3RhY2sgdHJhY2VcbiAgICBjb25zdCBzdGFjayA9IHRoaXMuc3RhY2s/LnNwbGl0KFwiXFxuXCIpO1xuICAgIGlmICghc3RhY2sgfHwgc3RhY2subGVuZ3RoIDwgNCkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBUaGUgY29uc3RydWN0b3IgY2FsbCB3aWxsIGJlIHRoZSB0aGlyZCBsaW5lIGluIHRoZSBzdGFjayAoaW5kZXggMilcbiAgICBjb25zdCBjb25zdHJ1Y3RvckNhbGwgPSBzdGFja1syXTtcblxuICAgIC8vIEV4dHJhY3QgdGhlIGNsYXNzIG5hbWUgdXNpbmcgYSByZWd1bGFyIGV4cHJlc3Npb25cbiAgICBjb25zdCBtYXRjaCA9IGNvbnN0cnVjdG9yQ2FsbC5tYXRjaCgvYXRcXHMrKC4qPylcXHMrXFwoLyk7XG4gICAgaWYgKG1hdGNoICYmIG1hdGNoWzFdKSB7XG4gICAgICBjb25zdCBmdWxsTmFtZSA9IG1hdGNoWzFdO1xuICAgICAgLy8gSWYgaXQncyBhIG1ldGhvZCBjYWxsLCBleHRyYWN0IHRoZSBjbGFzcyBuYW1lXG4gICAgICBjb25zdCBsYXN0RG90SW5kZXggPSBmdWxsTmFtZS5sYXN0SW5kZXhPZihcIi5cIik7XG4gICAgICByZXR1cm4gbGFzdERvdEluZGV4ICE9PSAtMVxuICAgICAgICA/IGZ1bGxOYW1lLnN1YnN0cmluZygwLCBsYXN0RG90SW5kZXgpXG4gICAgICAgIDogZnVsbE5hbWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgdG9KU09OKCkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgICBtZXNzYWdlOiB0aGlzLm1lc3NhZ2UsXG4gICAgICBwYXlsb2FkOiB0aGlzLnBheWxvYWQsXG4gICAgICB0aHJvd2luZ0NsYXNzOiB0aGlzLmdldFRocm93aW5nQ2xhc3NOYW1lKCksXG4gICAgICBzdGFjazogdGhpcy5zdGFjayxcbiAgICB9O1xuICB9XG5cbiAgcHVibGljIHRvU3RyaW5nKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHRoaXMudG9KU09OKCksIG51bGwsIDIpO1xuICB9XG59XG5cbi8qKlxuICogQWJzdHJhY3QgYmFzZSBjbGFzcyBmb3Igb2JqZWN0cyB0aGF0IGNhbiBsb2cgbWVzc2FnZXMuXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBMb2dnYWJsZSB7XG4gIHB1YmxpYyBzdGF0aWMgbG9nU3RyYXRlZ3k6IExvZ1N0cmF0ZWd5O1xuICBwcml2YXRlIHN0YXRpYyBxdWV1ZVN0cmF0ZWd5OiBJUXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPiA9XG4gICAgbmV3IEluTWVtb3J5UXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPigpO1xuICBwcml2YXRlIHN0YXRpYyBsb2dMZXZlbDogTG9nTGV2ZWwgPSBMb2dMZXZlbC5JTkZPO1xuICBwcml2YXRlIHN0YXRpYyBpc1Byb2Nlc3Npbmc6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBzdGF0aWMgcHJvY2Vzc2luZ1RpbWVvdXQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHN0YXRpYyBMb2dMZXZlbCA9IExvZ0xldmVsO1xuICBwcm90ZWN0ZWQgc3RhdGljIExvZ2dhYmxlRXJyb3IgPSBMb2dnYWJsZUVycm9yO1xuICBwcml2YXRlIHN0YXRpYyBzaHV0ZG93blByb21pc2U6IFByb21pc2U8dm9pZD4gfCBudWxsID0gbnVsbDtcbiAgcHJvdGVjdGVkIHN0YXRpYyBEZWZhdWx0TG9nZ2FibGVFcnJvciA9IGNsYXNzIGV4dGVuZHMgRXJyb3Ige1xuICAgIHB1YmxpYyByZWFkb25seSBwYXlsb2FkOiBhbnk7XG4gICAgcHVibGljIHJlYWRvbmx5IG9yaWdpbmFsRXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkO1xuXG4gICAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogYW55LCBvcmlnaW5hbEVycm9yPzogRXJyb3IpIHtcbiAgICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgICAgdGhpcy5uYW1lID0gXCJEZWZhdWx0TG9nZ2FibGVFcnJvclwiO1xuICAgICAgdGhpcy5wYXlsb2FkID0gcGF5bG9hZDtcbiAgICAgIHRoaXMub3JpZ2luYWxFcnJvciA9IG9yaWdpbmFsRXJyb3I7XG5cbiAgICAgIGlmIChFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSkge1xuICAgICAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCB0aGlzLmNvbnN0cnVjdG9yKTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9yaWdpbmFsRXJyb3IgJiYgb3JpZ2luYWxFcnJvci5zdGFjaykge1xuICAgICAgICB0aGlzLnN0YWNrID0gdGhpcy5zdGFjayArIFwiXFxuXFxuQ2F1c2VkIGJ5OlxcblwiICsgb3JpZ2luYWxFcnJvci5zdGFjaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgdG9KU09OKCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogdGhpcy5uYW1lLFxuICAgICAgICBtZXNzYWdlOiB0aGlzLm1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQ6IHRoaXMucGF5bG9hZCxcbiAgICAgICAgc3RhY2s6IHRoaXMuc3RhY2ssXG4gICAgICAgIG9yaWdpbmFsRXJyb3I6IHRoaXMub3JpZ2luYWxFcnJvclxuICAgICAgICAgID8ge1xuICAgICAgICAgICAgICBuYW1lOiB0aGlzLm9yaWdpbmFsRXJyb3IubmFtZSxcbiAgICAgICAgICAgICAgbWVzc2FnZTogdGhpcy5vcmlnaW5hbEVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgIHN0YWNrOiB0aGlzLm9yaWdpbmFsRXJyb3Iuc3RhY2ssXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgIH1cbiAgfTtcblxuICBwdWJsaWMgc3RhdGljIEZvcm1hdExvZ01lc3NhZ2UobWVzc2FnZTogTG9nTWVzc2FnZSk6IHN0cmluZyB7XG4gICAgbGV0IHRpbWVzdGFtcDogc3RyaW5nO1xuICAgIHRyeSB7XG4gICAgICB0aW1lc3RhbXAgPSBuZXcgRGF0ZShtZXNzYWdlLnRpbWVzdGFtcCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAtNSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIEhhbmRsZSBpbnZhbGlkIGRhdGVcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEludmFsaWQgdGltZXN0YW1wOiAke21lc3NhZ2UudGltZXN0YW1wfWAsIG1lc3NhZ2UpO1xuICAgICAgdGltZXN0YW1wID0gXCJJbnZhbGlkIERhdGVcIjtcbiAgICB9XG5cbiAgICBsZXQgZm9ybWF0dGVkTWVzc2FnZSA9IGBbJHt0aW1lc3RhbXB9XSAke1xuICAgICAgbWVzc2FnZS5sZXZlbD8udG9VcHBlckNhc2UoKSA/PyBcIlVOS05PV05cIlxuICAgIH06ICR7bWVzc2FnZS5tZXNzYWdlfWA7XG5cbiAgICBpZiAobWVzc2FnZS5wYXlsb2FkKSB7XG4gICAgICBmb3JtYXR0ZWRNZXNzYWdlICs9IFwiXFxuUGF5bG9hZDpcIjtcbiAgICAgIGZvcm1hdHRlZE1lc3NhZ2UgKz0gYFxcbiAgVHlwZTogJHttZXNzYWdlLnBheWxvYWQudHlwZX1gO1xuICAgICAgZm9ybWF0dGVkTWVzc2FnZSArPSBgXFxuICBDb250ZW50OiAke2Zvcm1hdFBheWxvYWRDb250ZW50KFxuICAgICAgICBtZXNzYWdlLnBheWxvYWRcbiAgICAgICl9YDtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9ybWF0dGVkTWVzc2FnZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBzdGF0aWMgaGFuZGxlRXJyb3JzKFxuICAgIHRhcmdldDogYW55LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcsXG4gICAgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yXG4gICkge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgICAgaWYgKHJlc3VsdCBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0LmNhdGNoKChlcnJvcjogYW55KSA9PiB7XG4gICAgICAgICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIExvZ2dhYmxlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHRydW5jYXRlZEFyZ3MgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShhcmdzLCAzMDApO1xuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5sb2dBbmRUaHJvd0Vycm9yKGVycm9yLCB0cnVuY2F0ZWRBcmdzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgICAgICBgaGFuZGxlRXJyb3JzIGRlY29yYXRvciB1c2VkIG9uIG5vbi1Mb2dnYWJsZSBjbGFzczogJHt0YXJnZXQuY29uc3RydWN0b3IubmFtZX1gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgTG9nZ2FibGUpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5sb2dBbmRUaHJvd0Vycm9yKGVycm9yKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICBgaGFuZGxlRXJyb3JzIGRlY29yYXRvciB1c2VkIG9uIG5vbi1Mb2dnYWJsZSBjbGFzczogJHt0YXJnZXQuY29uc3RydWN0b3IubmFtZX1gXG4gICAgICAgICAgKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH1cblxuICAvKipcbiAgICogUHJvdGVjdGVkIGNvbnN0cnVjdG9yIHRvIGVuc3VyZSB0aGUgY2xhc3MgaXMgcHJvcGVybHkgaW5pdGlhbGl6ZWQuXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgY2xhc3MgaXMgbm90IGluaXRpYWxpemVkLlxuICAgKi9cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKCkge1xuICAgIGlmICghTG9nZ2FibGUuaXNQcm9jZXNzaW5nKSB7XG4gICAgICBMb2dnYWJsZS5zdGFydFByb2Nlc3NpbmcoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgbG9nIHN0cmF0ZWd5LlxuICAgKiBAcGFyYW0ge0xvZ1N0cmF0ZWd5fSBzdHJhdGVneSAtIFRoZSBuZXcgbG9nIHN0cmF0ZWd5IHRvIHVzZS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc2V0TG9nU3RyYXRlZ3koc3RyYXRlZ3k6IExvZ1N0cmF0ZWd5KTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nU3RyYXRlZ3kgPSBzdHJhdGVneTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBxdWV1ZSBzdHJhdGVneS5cbiAgICogQHBhcmFtIHtJUXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPn0gc3RyYXRlZ3kgLSBUaGUgbmV3IHF1ZXVlIHN0cmF0ZWd5IHRvIHVzZS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc2V0UXVldWVTdHJhdGVneShzdHJhdGVneTogSVF1ZXVlU3RyYXRlZ3k8TG9nTWVzc2FnZT4pOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5ID0gc3RyYXRlZ3k7XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgbG9nIGxldmVsLlxuICAgKiBAcGFyYW0ge0xvZ0xldmVsfSBsZXZlbCAtIFRoZSBuZXcgbG9nIGxldmVsIHRvIHVzZS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc2V0TG9nTGV2ZWwobGV2ZWw6IExvZ0xldmVsKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nTGV2ZWwgPSBsZXZlbDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9nQW5kVGhyb3dFcnJvcihlcnJvcjogYW55LCBhcmdzOiBhbnkgPSB7fSk6IFByb21pc2U8bmV2ZXI+IHtcbiAgICBjb25zdCBFcnJvckNsYXNzID1cbiAgICAgICh0aGlzLmNvbnN0cnVjdG9yIGFzIHR5cGVvZiBMb2dnYWJsZSkuTG9nZ2FibGVFcnJvciB8fFxuICAgICAgTG9nZ2FibGUuRGVmYXVsdExvZ2dhYmxlRXJyb3I7XG5cbiAgICBsZXQgbG9nZ2FibGVFcnJvcjogTG9nZ2FibGVFcnJvcjtcblxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yQ2xhc3MpIHtcbiAgICAgIGxvZ2dhYmxlRXJyb3IgPSBlcnJvcjtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nZ2FibGVFcnJvciA9IG5ldyBFcnJvckNsYXNzKFxuICAgICAgICBlcnJvci5tZXNzYWdlLFxuICAgICAgICB7IG9yaWdpbmFsQXJnczogYXJncyB9LFxuICAgICAgICBlcnJvclxuICAgICAgKTtcblxuICAgICAgLy8gUHJlc2VydmUgdGhlIG9yaWdpbmFsIHN0YWNrIHRyYWNlXG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5zdGFjaykge1xuICAgICAgICBsb2dnYWJsZUVycm9yLnN0YWNrID0gZXJyb3Iuc3RhY2s7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWRkIHRocm93aW5nIGNsYXNzIGluZm9ybWF0aW9uIHdpdGhvdXQgbW9kaWZ5aW5nIHRoZSBlcnJvciBvYmplY3QgZGlyZWN0bHlcbiAgICBjb25zdCB0aHJvd2luZ0NsYXNzID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IGVycm9ySW5mbyA9IHtcbiAgICAgIC4uLmxvZ2dhYmxlRXJyb3IudG9KU09OKCksXG4gICAgICB0aHJvd2luZ0NsYXNzLFxuICAgIH07XG5cbiAgICB0aGlzLmVycm9yKGxvZ2dhYmxlRXJyb3IubWVzc2FnZSwgZXJyb3JJbmZvKTtcbiAgICBhd2FpdCBMb2dnYWJsZS53YWl0Rm9yRW1wdHlRdWV1ZSgpOyAvLyBFbnN1cmUgdGhlIHF1ZXVlIGlzIGVtcHR5IGJlZm9yZSB0aHJvd2luZ1xuICAgIHRocm93IGxvZ2dhYmxlRXJyb3I7XG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIHRoZSBxdWV1ZSB0byBiZSBlbXB0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIHF1ZXVlIGlzIGVtcHR5LlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgd2FpdEZvckVtcHR5UXVldWUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgICBjb25zdCBjaGVja1F1ZXVlID0gKCkgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgIUxvZ2dhYmxlLmlzUHJvY2Vzc2luZyAmJlxuICAgICAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZGVxdWV1ZSgpID09PSB1bmRlZmluZWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNldFRpbWVvdXQoY2hlY2tRdWV1ZSwgMTAwKTsgLy8gQ2hlY2sgYWdhaW4gYWZ0ZXIgMTAwbXNcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGNoZWNrUXVldWUoKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBtZXNzYWdlIHdpdGggdGhlIGdpdmVuIGxldmVsIHNob3VsZCBiZSBsb2dnZWQuXG4gICAqIEBwYXJhbSB7TG9nTGV2ZWx9IG1lc3NhZ2VMZXZlbCAtIFRoZSBsZXZlbCBvZiB0aGUgbWVzc2FnZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIG1lc3NhZ2Ugc2hvdWxkIGJlIGxvZ2dlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBzaG91bGRMb2cobWVzc2FnZUxldmVsOiBMb2dMZXZlbCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBtZXNzYWdlTGV2ZWwgPj0gTG9nZ2FibGUubG9nTGV2ZWw7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHZhbHVlIGFmdGVyIGVuc3VyaW5nIGFsbCBsb2dzIGhhdmUgYmVlbiBwcm9jZXNzZWQuXG4gICAqIEBwYXJhbSB7VH0gdmFsdWUgLSBUaGUgdmFsdWUgdG8gcmV0dXJuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgdmFsdWUgYWZ0ZXIgYWxsIGxvZ3MgYXJlIHByb2Nlc3NlZC5cbiAgICovXG4gIHB1YmxpYyBhc3luYyByZXR1cm5BZnRlckxvZ2dpbmc8VD4odmFsdWU6IFQpOiBQcm9taXNlPFQ+IHtcbiAgICBhd2FpdCBMb2dnYWJsZS53YWl0Rm9yRW1wdHlRdWV1ZSgpO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbG9nIG1lc3NhZ2Ugb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGV2ZWwgLSBUaGUgbG9nIGxldmVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFRoZSBsb2cgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbY2xhc3NOYW1lXSAtIE9wdGlvbmFsIGNsYXNzIG5hbWUgZm9yIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtMb2dNZXNzYWdlfSBUaGUgY3JlYXRlZCBsb2cgbWVzc2FnZSBvYmplY3QuXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBjcmVhdGVMb2dNZXNzYWdlKFxuICAgIGxldmVsOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QsXG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICk6IExvZ01lc3NhZ2Uge1xuICAgIGNvbnN0IHByZWZpeGVkTWVzc2FnZSA9IGNsYXNzTmFtZSA/IGAke2NsYXNzTmFtZX06OiR7bWVzc2FnZX1gIDogbWVzc2FnZTtcbiAgICBjb25zdCBsb2dQYXlsb2FkOiBMb2dQYXlsb2FkIHwgdW5kZWZpbmVkID0gcGF5bG9hZFxuICAgICAgPyB7XG4gICAgICAgICAgdHlwZTogdHlwZW9mIHBheWxvYWQgPT09IFwic3RyaW5nXCIgPyBcInRleHRcIiA6IFwianNvblwiLFxuICAgICAgICAgIGNvbnRlbnQ6IHBheWxvYWQsXG4gICAgICAgIH1cbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgbGV2ZWwsXG4gICAgICBtZXNzYWdlOiBwcmVmaXhlZE1lc3NhZ2UsXG4gICAgICBwYXlsb2FkOiBsb2dQYXlsb2FkLFxuICAgICAgc2VuZGVyOiBjbGFzc05hbWUgfHwgXCJMb2dnYWJsZVwiLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBsb2dXaXRoTGV2ZWwoXG4gICAgbGV2ZWw6IExvZ0xldmVsLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0LFxuICAgIGNsYXNzTmFtZT86IHN0cmluZ1xuICApOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKGxldmVsKSkge1xuICAgICAgY29uc3QgbG9nTWVzc2FnZSA9IExvZ2dhYmxlLmNyZWF0ZUxvZ01lc3NhZ2UoXG4gICAgICAgIExvZ0xldmVsW2xldmVsXSxcbiAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgY2xhc3NOYW1lXG4gICAgICApO1xuICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5lbnF1ZXVlKGxvZ01lc3NhZ2UpO1xuICAgICAgTG9nZ2FibGUud2FrZVVwUXVldWUoKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgc3RhdGljIGxvZ0RlYnVnKFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0LFxuICAgIGNsYXNzTmFtZT86IHN0cmluZ1xuICApOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5sb2dXaXRoTGV2ZWwoTG9nTGV2ZWwuREVCVUcsIG1lc3NhZ2UsIHBheWxvYWQsIGNsYXNzTmFtZSk7XG4gIH1cblxuICBwdWJsaWMgc3RhdGljIGxvZ0Vycm9yKFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0LFxuICAgIGNsYXNzTmFtZT86IHN0cmluZ1xuICApOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5sb2dXaXRoTGV2ZWwoTG9nTGV2ZWwuRVJST1IsIG1lc3NhZ2UsIHBheWxvYWQsIGNsYXNzTmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhIGRlYnVnIG1lc3NhZ2UgZm9yIHRoZSBjdXJyZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFRoZSBkZWJ1ZyBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbi5cbiAgICovXG4gIHByb3RlY3RlZCBkZWJ1ZyhtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QpOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5sb2dEZWJ1ZyhtZXNzYWdlLCBwYXlsb2FkLCB0aGlzLmNvbnN0cnVjdG9yLm5hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYW4gaW5mbyBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgaW5mbyBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbi5cbiAgICovXG4gIHByb3RlY3RlZCBpbmZvKG1lc3NhZ2U6IHN0cmluZywgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCk6IHZvaWQge1xuICAgIGlmIChMb2dnYWJsZS5zaG91bGRMb2coTG9nTGV2ZWwuSU5GTykpIHtcbiAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBMb2dnYWJsZS5jcmVhdGVMb2dNZXNzYWdlKFxuICAgICAgICBcIklORk9cIixcbiAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lXG4gICAgICApO1xuICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5lbnF1ZXVlKGxvZ01lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGEgd2FybmluZyBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgd2FybmluZyBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbi5cbiAgICovXG4gIHByb3RlY3RlZCB3YXJuKG1lc3NhZ2U6IHN0cmluZywgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCk6IHZvaWQge1xuICAgIGlmIChMb2dnYWJsZS5zaG91bGRMb2coTG9nTGV2ZWwuV0FSTikpIHtcbiAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBMb2dnYWJsZS5jcmVhdGVMb2dNZXNzYWdlKFxuICAgICAgICBcIldBUk5cIixcbiAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lXG4gICAgICApO1xuICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5lbnF1ZXVlKGxvZ01lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGFuIGVycm9yIG1lc3NhZ2UgZm9yIHRoZSBjdXJyZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IExvZ2dhYmxlRXJyb3J9IG1lc3NhZ2VPckVycm9yIC0gVGhlIGVycm9yIG1lc3NhZ2Ugb3IgTG9nZ2FibGVFcnJvciBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgb2JqZWN0fSBbcGF5bG9hZF0gLSBPcHRpb25hbCBwYXlsb2FkIGZvciBhZGRpdGlvbmFsIGluZm9ybWF0aW9uICh1c2VkIG9ubHkgaWYgbWVzc2FnZSBpcyBhIHN0cmluZykuXG4gICAqL1xuICBwcm90ZWN0ZWQgZXJyb3IoXG4gICAgbWVzc2FnZU9yRXJyb3I6IHN0cmluZyB8IExvZ2dhYmxlRXJyb3IsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdFxuICApOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLkVSUk9SKSkge1xuICAgICAgbGV0IG1lc3NhZ2U6IHN0cmluZztcbiAgICAgIGxldCBlcnJvclBheWxvYWQ6IG9iamVjdCB8IHVuZGVmaW5lZDtcblxuICAgICAgaWYgKG1lc3NhZ2VPckVycm9yIGluc3RhbmNlb2YgTG9nZ2FibGVFcnJvcikge1xuICAgICAgICBtZXNzYWdlID0gbWVzc2FnZU9yRXJyb3IubWVzc2FnZTtcbiAgICAgICAgZXJyb3JQYXlsb2FkID0gbWVzc2FnZU9yRXJyb3IudG9KU09OKCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtZXNzYWdlID0gbWVzc2FnZU9yRXJyb3I7XG4gICAgICAgIGVycm9yUGF5bG9hZCA9IHR5cGVvZiBwYXlsb2FkID09PSBcIm9iamVjdFwiID8gcGF5bG9hZCA6IHVuZGVmaW5lZDtcbiAgICAgIH1cblxuICAgICAgY29uc3QgbG9nTWVzc2FnZSA9IExvZ2dhYmxlLmNyZWF0ZUxvZ01lc3NhZ2UoXG4gICAgICAgIFwiRVJST1JcIixcbiAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgZXJyb3JQYXlsb2FkLFxuICAgICAgICB0aGlzLmNvbnN0cnVjdG9yLm5hbWVcbiAgICAgICk7XG4gICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmVucXVldWUobG9nTWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFByb2Nlc3NlcyB0aGUgcXVldWUgb2YgbG9nIG1lc3NhZ2VzLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiBwcm9jZXNzaW5nIGlzIGNvbXBsZXRlLlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgYXN5bmMgcHJvY2Vzc1F1ZXVlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2dnYWJsZS5pc1Byb2Nlc3NpbmcpIHJldHVybjtcblxuICAgIExvZ2dhYmxlLmlzUHJvY2Vzc2luZyA9IHRydWU7XG4gICAgd2hpbGUgKHRydWUpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmRlcXVldWUoKTtcbiAgICAgIGlmICghbWVzc2FnZSkgYnJlYWs7XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IExvZ2dhYmxlLmxvZ1N0cmF0ZWd5LnNlbmQobWVzc2FnZSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIHNlbmQgbWVzc2FnZTpcIiwgZXJyb3IpO1xuICAgICAgICAvLyBPcHRpb25hbGx5IHJlLWVucXVldWUgdGhlIG1lc3NhZ2Ugb3IgaW1wbGVtZW50IHJldHJ5IGxvZ2ljXG4gICAgICB9XG4gICAgfVxuICAgIExvZ2dhYmxlLmlzUHJvY2Vzc2luZyA9IGZhbHNlO1xuXG4gICAgLy8gSWYgdGhlcmUncyBubyBtb3JlIG1lc3NhZ2VzIGFuZCB3ZSdyZSBzaHV0dGluZyBkb3duLCByZXNvbHZlIHRoZSBzaHV0ZG93biBwcm9taXNlXG4gICAgaWYgKFxuICAgICAgTG9nZ2FibGUuc2h1dGRvd25Qcm9taXNlICYmXG4gICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmRlcXVldWUoKSA9PT0gdW5kZWZpbmVkXG4gICAgKSB7XG4gICAgICBMb2dnYWJsZS5yZXNvbHZlU2h1dGRvd24oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU2NoZWR1bGUgdGhlIG5leHQgcHJvY2Vzc2luZyBjeWNsZVxuICAgICAgTG9nZ2FibGUuc2NoZWR1bGVOZXh0UHJvY2Vzc2luZygpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHNjaGVkdWxlTmV4dFByb2Nlc3NpbmcoKTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQoTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgIH1cbiAgICBMb2dnYWJsZS5wcm9jZXNzaW5nVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgTG9nZ2FibGUucHJvY2Vzc1F1ZXVlKCk7XG4gICAgfSwgMTAwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgcHJvY2Vzc2luZyB0aGUgcXVldWUgb2YgbG9nIG1lc3NhZ2VzLlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgc3RhcnRQcm9jZXNzaW5nKCk6IHZvaWQge1xuICAgIGlmICghTG9nZ2FibGUuaXNQcm9jZXNzaW5nICYmICFMb2dnYWJsZS5wcm9jZXNzaW5nVGltZW91dCkge1xuICAgICAgTG9nZ2FibGUuc2NoZWR1bGVOZXh0UHJvY2Vzc2luZygpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTaHV0cyBkb3duIHRoZSBsb2dnaW5nIHN5c3RlbS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgYXN5bmMgc2h1dGRvd24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQoTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgICAgTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQgPSBudWxsO1xuICAgIH1cblxuICAgIGlmICghTG9nZ2FibGUuc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICBMb2dnYWJsZS5zaHV0ZG93blByb21pc2UgPSBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgICBMb2dnYWJsZS5yZXNvbHZlU2h1dGRvd24gPSByZXNvbHZlO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFByb2Nlc3MgYW55IHJlbWFpbmluZyBtZXNzYWdlc1xuICAgICAgYXdhaXQgTG9nZ2FibGUucHJvY2Vzc1F1ZXVlKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIExvZ2dhYmxlLnNodXRkb3duUHJvbWlzZTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHJlc29sdmVTaHV0ZG93bjogKCkgPT4gdm9pZCA9ICgpID0+IHt9O1xuXG4gIHB1YmxpYyBzdGF0aWMgd2FrZVVwUXVldWUoKTogdm9pZCB7XG4gICAgaWYgKFxuICAgICAgIUxvZ2dhYmxlLmlzUHJvY2Vzc2luZyAmJlxuICAgICAgIUxvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0ICYmXG4gICAgICAhTG9nZ2FibGUuc2h1dGRvd25Qcm9taXNlXG4gICAgKSB7XG4gICAgICBMb2dnYWJsZS5zdGFydFByb2Nlc3NpbmcoKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0UGF5bG9hZENvbnRlbnQocGF5bG9hZDogTG9nUGF5bG9hZCk6IHN0cmluZyB7XG4gIGNvbnN0IHRydW5jYXRlZENvbnRlbnQgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShwYXlsb2FkLmNvbnRlbnQpO1xuXG4gIGlmIChwYXlsb2FkLnR5cGUgPT09IFwidGV4dFwiKSB7XG4gICAgcmV0dXJuIHRydW5jYXRlZENvbnRlbnQgYXMgc3RyaW5nO1xuICB9XG5cbiAgcmV0dXJuIHV0aWwuaW5zcGVjdCh0cnVuY2F0ZWRDb250ZW50LCB7IGRlcHRoOiBudWxsLCBjb2xvcnM6IHRydWUgfSk7XG59XG5cbmV4cG9ydCB7IGxvZ01ldGhvZCB9O1xuIl19