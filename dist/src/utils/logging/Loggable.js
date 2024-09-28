"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleStrategy = exports.Loggable = exports.LoggableError = exports.LogLevel = void 0;
exports.logMethod = logMethod;
const LogStrategy_1 = require("./LogStrategy");
Object.defineProperty(exports, "ConsoleStrategy", { enumerable: true, get: function () { return LogStrategy_1.ConsoleStrategy; } });
const InMemoryQueueStrategy_1 = require("../queue/InMemoryQueueStrategy");
const util_1 = __importDefault(require("util"));
const MAX_STRING_LENGTH = 1000; // Maximum length for individual string values
const MAX_DEPTH = 10; // Maximum depth for nested objects
/**
 * @fileoverview This module provides a logging system with different log levels,
 * notification strategies, and queue strategies.
 */
const timers_1 = require("timers");
/**
 * Enum representing different log levels.
 */
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
function logMethod() {
    return function (target, propertyKey, descriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args) {
            const className = this.constructor.name;
            const truncatedArgs = LogStrategy_1.LogStrategy.truncateAndStringify(args);
            const logResult = (result) => {
                if (Loggable.shouldLog(LogLevel.DEBUG)) {
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
            console.error(`Invalid timestamp: ${message.timestamp}`);
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
            const logMessage = Loggable.createLogMessage(LogLevel[level], message, payload, className);
            Loggable.queueStrategy.enqueue(logMessage);
        }
    }
    static logDebug(message, payload, className) {
        Loggable.logWithLevel(LogLevel.DEBUG, message, payload, className);
    }
    static logError(message, payload, className) {
        Loggable.logWithLevel(LogLevel.ERROR, message, payload, className);
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
        if (Loggable.shouldLog(LogLevel.INFO)) {
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
        if (Loggable.shouldLog(LogLevel.WARN)) {
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
        if (Loggable.shouldLog(LogLevel.ERROR)) {
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
    }
    /**
     * Starts processing the queue of log messages.
     */
    static startProcessing() {
        const scheduleProcessing = () => {
            Loggable.processingTimeout = (0, timers_1.setTimeout)(() => {
                Loggable.processQueue().finally(() => {
                    scheduleProcessing();
                });
            }, 100); // Adjust this delay as needed
        };
        scheduleProcessing();
    }
    /**
     * Shuts down the logging system.
     */
    static async shutdown() {
        if (Loggable.processingTimeout) {
            (0, timers_1.clearTimeout)(Loggable.processingTimeout);
            await Loggable.waitForEmptyQueue();
        }
    }
}
exports.Loggable = Loggable;
Loggable.logStrategy = new LogStrategy_1.ConsoleStrategy();
Loggable.queueStrategy = new InMemoryQueueStrategy_1.InMemoryQueueStrategy();
Loggable.logLevel = LogLevel.INFO;
Loggable.isProcessing = false;
Loggable.processingTimeout = null;
Loggable.LogLevel = LogLevel;
Loggable.LoggableError = LoggableError;
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
function formatPayloadContent(payload) {
    const truncatedContent = LogStrategy_1.LogStrategy.truncateAndStringify(payload.content);
    if (payload.type === "text") {
        return truncatedContent;
    }
    return util_1.default.inspect(truncatedContent, { depth: null, colors: true });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTG9nZ2FibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvdXRpbHMvbG9nZ2luZy9Mb2dnYWJsZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUE4a0JTLDhCQUFTO0FBN2tCbEIsK0NBQTZEO0FBNmtCekMsZ0dBN2tCWCw2QkFBZSxPQTZrQlc7QUE1a0JuQywwRUFBdUU7QUFDdkUsZ0RBQXdCO0FBRXhCLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLENBQUMsOENBQThDO0FBQzlFLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQyxDQUFDLG1DQUFtQztBQUV6RDs7O0dBR0c7QUFFSCxtQ0FBa0Q7QUFFbEQ7O0dBRUc7QUFDSCxJQUFZLFFBS1g7QUFMRCxXQUFZLFFBQVE7SUFDbEIseUNBQVMsQ0FBQTtJQUNULHVDQUFRLENBQUE7SUFDUix1Q0FBUSxDQUFBO0lBQ1IseUNBQVMsQ0FBQTtBQUNYLENBQUMsRUFMVyxRQUFRLHdCQUFSLFFBQVEsUUFLbkI7QUFnQ0QsU0FBUyxTQUFTO0lBQ2hCLE9BQU8sVUFDTCxNQUFXLEVBQ1gsV0FBbUIsRUFDbkIsVUFBOEI7UUFFOUIsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUN4QyxVQUFVLENBQUMsS0FBSyxHQUFHLFVBQVUsR0FBRyxJQUFXO1lBQ3pDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1lBQ3hDLE1BQU0sYUFBYSxHQUFHLHlCQUFXLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLENBQUM7WUFFN0QsTUFBTSxTQUFTLEdBQUcsQ0FBQyxNQUFXLEVBQUUsRUFBRTtnQkFDaEMsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUN2QyxNQUFNLGVBQWUsR0FBRyx5QkFBVyxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUNqRSxN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SCxDQUFDO0lBRU0sTUFBTTtRQUNYLE9BQU87WUFDTCxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDZixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztZQUNqQixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQy9CLENBQUMsQ0FBQztvQkFDRSxJQUFJLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJO29CQUM3QixPQUFPLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPO29CQUNuQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLO2lCQUNoQztnQkFDSCxDQUFDLENBQUMsU0FBUztTQUNkLENBQUM7SUFDSixDQUFDO0NBQ0YsQ0FBQztBQXFXSixTQUFTLG9CQUFvQixDQUFDLE9BQW1CO0lBQy9DLE1BQU0sZ0JBQWdCLEdBQUcseUJBQVcsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFM0UsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRSxDQUFDO1FBQzVCLE9BQU8sZ0JBQTBCLENBQUM7SUFDcEMsQ0FBQztJQUVELE9BQU8sY0FBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7QUFDdkUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElRdWV1ZVN0cmF0ZWd5IH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IENvbnNvbGVTdHJhdGVneSwgTG9nU3RyYXRlZ3kgfSBmcm9tIFwiLi9Mb2dTdHJhdGVneVwiO1xuaW1wb3J0IHsgSW5NZW1vcnlRdWV1ZVN0cmF0ZWd5IH0gZnJvbSBcIi4uL3F1ZXVlL0luTWVtb3J5UXVldWVTdHJhdGVneVwiO1xuaW1wb3J0IHV0aWwgZnJvbSBcInV0aWxcIjtcblxuY29uc3QgTUFYX1NUUklOR19MRU5HVEggPSAxMDAwOyAvLyBNYXhpbXVtIGxlbmd0aCBmb3IgaW5kaXZpZHVhbCBzdHJpbmcgdmFsdWVzXG5jb25zdCBNQVhfREVQVEggPSAxMDsgLy8gTWF4aW11bSBkZXB0aCBmb3IgbmVzdGVkIG9iamVjdHNcblxuLyoqXG4gKiBAZmlsZW92ZXJ2aWV3IFRoaXMgbW9kdWxlIHByb3ZpZGVzIGEgbG9nZ2luZyBzeXN0ZW0gd2l0aCBkaWZmZXJlbnQgbG9nIGxldmVscyxcbiAqIG5vdGlmaWNhdGlvbiBzdHJhdGVnaWVzLCBhbmQgcXVldWUgc3RyYXRlZ2llcy5cbiAqL1xuXG5pbXBvcnQgeyBzZXRUaW1lb3V0LCBjbGVhclRpbWVvdXQgfSBmcm9tIFwidGltZXJzXCI7XG5cbi8qKlxuICogRW51bSByZXByZXNlbnRpbmcgZGlmZmVyZW50IGxvZyBsZXZlbHMuXG4gKi9cbmV4cG9ydCBlbnVtIExvZ0xldmVsIHtcbiAgREVCVUcgPSAwLFxuICBJTkZPID0gMSxcbiAgV0FSTiA9IDIsXG4gIEVSUk9SID0gMyxcbn1cblxuLyoqXG4gKiBUeXBlIHJlcHJlc2VudGluZyB0aGUgcGF5bG9hZCB0eXBlIG9mIGEgbG9nIG1lc3NhZ2UuXG4gKi9cbmV4cG9ydCB0eXBlIFBheWxvYWRUeXBlID0gXCJ0ZXh0XCIgfCBcImpzb25cIjtcblxuLyoqXG4gKiBJbnRlcmZhY2UgcmVwcmVzZW50aW5nIHRoZSBwYXlsb2FkIG9mIGEgbG9nIG1lc3NhZ2UuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9nUGF5bG9hZCB7XG4gIC8qKiBUaGUgdHlwZSBvZiB0aGUgcGF5bG9hZC4gKi9cbiAgdHlwZTogUGF5bG9hZFR5cGU7XG4gIC8qKiBUaGUgY29udGVudCBvZiB0aGUgcGF5bG9hZC4gKi9cbiAgY29udGVudDogc3RyaW5nIHwgb2JqZWN0O1xufVxuXG4vKipcbiAqIEludGVyZmFjZSByZXByZXNlbnRpbmcgYSBsb2cgbWVzc2FnZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2dNZXNzYWdlIHtcbiAgc2VuZGVyPzogc3RyaW5nO1xuICAvKiogVGhlIHRpbWVzdGFtcCBvZiB0aGUgbG9nIG1lc3NhZ2UuICovXG4gIHRpbWVzdGFtcDogc3RyaW5nO1xuICAvKiogVGhlIGxvZyBsZXZlbCBvZiB0aGUgbWVzc2FnZS4gKi9cbiAgbGV2ZWw6IHN0cmluZztcbiAgLyoqIFRoZSBjb250ZW50IG9mIHRoZSBsb2cgbWVzc2FnZS4gKi9cbiAgbWVzc2FnZTogc3RyaW5nO1xuICAvKiogT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbi4gKi9cbiAgcGF5bG9hZD86IExvZ1BheWxvYWQ7XG59XG5cbmZ1bmN0aW9uIGxvZ01ldGhvZCgpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChcbiAgICB0YXJnZXQ6IGFueSxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nLFxuICAgIGRlc2NyaXB0b3I6IFByb3BlcnR5RGVzY3JpcHRvclxuICApIHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgY29uc3QgY2xhc3NOYW1lID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgICAgY29uc3QgdHJ1bmNhdGVkQXJncyA9IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KGFyZ3MpO1xuXG4gICAgICBjb25zdCBsb2dSZXN1bHQgPSAocmVzdWx0OiBhbnkpID0+IHtcbiAgICAgICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhMb2dMZXZlbC5ERUJVRykpIHtcbiAgICAgICAgICBjb25zdCB0cnVuY2F0ZWRSZXN1bHQgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShyZXN1bHQpO1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICAgICAgICBhcmdzOiB0cnVuY2F0ZWRBcmdzLFxuICAgICAgICAgICAgcmVzdWx0OiB0cnVuY2F0ZWRSZXN1bHQsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBMb2dnYWJsZS5sb2dEZWJ1ZyhcbiAgICAgICAgICAgIGBMb2dNZXRob2REZWNvcmF0b3I6OiR7Y2xhc3NOYW1lfTo6JHtwcm9wZXJ0eUtleX1gLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIGNsYXNzTmFtZVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGxvZ0Vycm9yID0gKGVycm9yOiBhbnkpID0+IHtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYCR7Y2xhc3NOYW1lfTo6JHtwcm9wZXJ0eUtleX0gcmVzdWx0ZWQgaW4gZXJyb3JgO1xuICAgICAgICBjb25zdCB0cnVuY2F0ZWRFcnJvciA9XG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBMb2dnYWJsZUVycm9yXG4gICAgICAgICAgICA/IGVycm9yLnRvSlNPTigpXG4gICAgICAgICAgICA6IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KGVycm9yLm1lc3NhZ2UgfHwgZXJyb3IpO1xuXG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICAgICAgYXJnczogdHJ1bmNhdGVkQXJncyxcbiAgICAgICAgICBlcnJvcjogdHJ1bmNhdGVkRXJyb3IsXG4gICAgICAgIH07XG4gICAgICAgIExvZ2dhYmxlLmxvZ0Vycm9yKFxuICAgICAgICAgIGBMb2dNZXRob2REZWNvcmF0b3I6OiR7ZXJyb3JNZXNzYWdlfWAsXG4gICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICBjbGFzc05hbWVcbiAgICAgICAgKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9O1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKTtcblxuICAgICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQudGhlbihsb2dSZXN1bHQsIGxvZ0Vycm9yKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gbG9nUmVzdWx0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgcmV0dXJuIGxvZ0Vycm9yKGVycm9yKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgTG9nZ2FibGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcHVibGljIHJlYWRvbmx5IHBheWxvYWQ6IGFueTtcbiAgcHVibGljIHJlYWRvbmx5IG9yaWdpbmFsRXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgcGF5bG9hZD86IGFueSwgb3JpZ2luYWxFcnJvcj86IEVycm9yKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gXCJMb2dnYWJsZUVycm9yXCI7XG4gICAgdGhpcy5wYXlsb2FkID0gcGF5bG9hZDtcbiAgICB0aGlzLm9yaWdpbmFsRXJyb3IgPSBvcmlnaW5hbEVycm9yO1xuXG4gICAgLy8gQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2VcbiAgICBpZiAoRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UpIHtcbiAgICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIExvZ2dhYmxlRXJyb3IpO1xuICAgIH1cblxuICAgIC8vIEFwcGVuZCB0aGUgb3JpZ2luYWwgZXJyb3IncyBzdGFjayB0byB0aGlzIGVycm9yJ3Mgc3RhY2tcbiAgICBpZiAob3JpZ2luYWxFcnJvciAmJiBvcmlnaW5hbEVycm9yLnN0YWNrKSB7XG4gICAgICB0aGlzLnN0YWNrID0gdGhpcy5zdGFjayArIFwiXFxuXFxuQ2F1c2VkIGJ5OlxcblwiICsgb3JpZ2luYWxFcnJvci5zdGFjaztcbiAgICB9XG5cbiAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGhpcywgTG9nZ2FibGVFcnJvci5wcm90b3R5cGUpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRUaHJvd2luZ0NsYXNzTmFtZSgpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBHZXQgdGhlIHN0YWNrIHRyYWNlXG4gICAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YWNrPy5zcGxpdChcIlxcblwiKTtcbiAgICBpZiAoIXN0YWNrIHx8IHN0YWNrLmxlbmd0aCA8IDQpIHJldHVybiBudWxsO1xuXG4gICAgLy8gVGhlIGNvbnN0cnVjdG9yIGNhbGwgd2lsbCBiZSB0aGUgdGhpcmQgbGluZSBpbiB0aGUgc3RhY2sgKGluZGV4IDIpXG4gICAgY29uc3QgY29uc3RydWN0b3JDYWxsID0gc3RhY2tbMl07XG5cbiAgICAvLyBFeHRyYWN0IHRoZSBjbGFzcyBuYW1lIHVzaW5nIGEgcmVndWxhciBleHByZXNzaW9uXG4gICAgY29uc3QgbWF0Y2ggPSBjb25zdHJ1Y3RvckNhbGwubWF0Y2goL2F0XFxzKyguKj8pXFxzK1xcKC8pO1xuICAgIGlmIChtYXRjaCAmJiBtYXRjaFsxXSkge1xuICAgICAgY29uc3QgZnVsbE5hbWUgPSBtYXRjaFsxXTtcbiAgICAgIC8vIElmIGl0J3MgYSBtZXRob2QgY2FsbCwgZXh0cmFjdCB0aGUgY2xhc3MgbmFtZVxuICAgICAgY29uc3QgbGFzdERvdEluZGV4ID0gZnVsbE5hbWUubGFzdEluZGV4T2YoXCIuXCIpO1xuICAgICAgcmV0dXJuIGxhc3REb3RJbmRleCAhPT0gLTFcbiAgICAgICAgPyBmdWxsTmFtZS5zdWJzdHJpbmcoMCwgbGFzdERvdEluZGV4KVxuICAgICAgICA6IGZ1bGxOYW1lO1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHVibGljIHRvSlNPTigpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZTogdGhpcy5uYW1lLFxuICAgICAgbWVzc2FnZTogdGhpcy5tZXNzYWdlLFxuICAgICAgcGF5bG9hZDogdGhpcy5wYXlsb2FkLFxuICAgICAgdGhyb3dpbmdDbGFzczogdGhpcy5nZXRUaHJvd2luZ0NsYXNzTmFtZSgpLFxuICAgICAgc3RhY2s6IHRoaXMuc3RhY2ssXG4gICAgfTtcbiAgfVxuXG4gIHB1YmxpYyB0b1N0cmluZygpOiBzdHJpbmcge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh0aGlzLnRvSlNPTigpLCBudWxsLCAyKTtcbiAgfVxufVxuXG4vKipcbiAqIEFic3RyYWN0IGJhc2UgY2xhc3MgZm9yIG9iamVjdHMgdGhhdCBjYW4gbG9nIG1lc3NhZ2VzLlxuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgTG9nZ2FibGUge1xuICBwdWJsaWMgc3RhdGljIGxvZ1N0cmF0ZWd5OiBMb2dTdHJhdGVneSA9IG5ldyBDb25zb2xlU3RyYXRlZ3koKTtcbiAgcHJpdmF0ZSBzdGF0aWMgcXVldWVTdHJhdGVneTogSVF1ZXVlU3RyYXRlZ3k8TG9nTWVzc2FnZT4gPVxuICAgIG5ldyBJbk1lbW9yeVF1ZXVlU3RyYXRlZ3k8TG9nTWVzc2FnZT4oKTtcbiAgcHJpdmF0ZSBzdGF0aWMgbG9nTGV2ZWw6IExvZ0xldmVsID0gTG9nTGV2ZWwuSU5GTztcbiAgcHJpdmF0ZSBzdGF0aWMgaXNQcm9jZXNzaW5nOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgc3RhdGljIHByb2Nlc3NpbmdUaW1lb3V0OiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBzdGF0aWMgTG9nTGV2ZWwgPSBMb2dMZXZlbDtcbiAgcHJvdGVjdGVkIHN0YXRpYyBMb2dnYWJsZUVycm9yID0gTG9nZ2FibGVFcnJvcjtcbiAgcHJvdGVjdGVkIHN0YXRpYyBEZWZhdWx0TG9nZ2FibGVFcnJvciA9IGNsYXNzIGV4dGVuZHMgRXJyb3Ige1xuICAgIHB1YmxpYyByZWFkb25seSBwYXlsb2FkOiBhbnk7XG4gICAgcHVibGljIHJlYWRvbmx5IG9yaWdpbmFsRXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkO1xuXG4gICAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogYW55LCBvcmlnaW5hbEVycm9yPzogRXJyb3IpIHtcbiAgICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgICAgdGhpcy5uYW1lID0gXCJEZWZhdWx0TG9nZ2FibGVFcnJvclwiO1xuICAgICAgdGhpcy5wYXlsb2FkID0gcGF5bG9hZDtcbiAgICAgIHRoaXMub3JpZ2luYWxFcnJvciA9IG9yaWdpbmFsRXJyb3I7XG5cbiAgICAgIGlmIChFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSkge1xuICAgICAgICBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCB0aGlzLmNvbnN0cnVjdG9yKTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9yaWdpbmFsRXJyb3IgJiYgb3JpZ2luYWxFcnJvci5zdGFjaykge1xuICAgICAgICB0aGlzLnN0YWNrID0gdGhpcy5zdGFjayArIFwiXFxuXFxuQ2F1c2VkIGJ5OlxcblwiICsgb3JpZ2luYWxFcnJvci5zdGFjaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBwdWJsaWMgdG9KU09OKCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgbmFtZTogdGhpcy5uYW1lLFxuICAgICAgICBtZXNzYWdlOiB0aGlzLm1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQ6IHRoaXMucGF5bG9hZCxcbiAgICAgICAgc3RhY2s6IHRoaXMuc3RhY2ssXG4gICAgICAgIG9yaWdpbmFsRXJyb3I6IHRoaXMub3JpZ2luYWxFcnJvclxuICAgICAgICAgID8ge1xuICAgICAgICAgICAgICBuYW1lOiB0aGlzLm9yaWdpbmFsRXJyb3IubmFtZSxcbiAgICAgICAgICAgICAgbWVzc2FnZTogdGhpcy5vcmlnaW5hbEVycm9yLm1lc3NhZ2UsXG4gICAgICAgICAgICAgIHN0YWNrOiB0aGlzLm9yaWdpbmFsRXJyb3Iuc3RhY2ssXG4gICAgICAgICAgICB9XG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICB9O1xuICAgIH1cbiAgfTtcblxuICBwdWJsaWMgc3RhdGljIEZvcm1hdExvZ01lc3NhZ2UobWVzc2FnZTogTG9nTWVzc2FnZSk6IHN0cmluZyB7XG4gICAgbGV0IHRpbWVzdGFtcDogc3RyaW5nO1xuICAgIHRyeSB7XG4gICAgICB0aW1lc3RhbXAgPSBuZXcgRGF0ZShtZXNzYWdlLnRpbWVzdGFtcCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAtNSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIC8vIEhhbmRsZSBpbnZhbGlkIGRhdGVcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEludmFsaWQgdGltZXN0YW1wOiAke21lc3NhZ2UudGltZXN0YW1wfWApO1xuICAgICAgdGltZXN0YW1wID0gXCJJbnZhbGlkIERhdGVcIjtcbiAgICB9XG5cbiAgICBsZXQgZm9ybWF0dGVkTWVzc2FnZSA9IGBbJHt0aW1lc3RhbXB9XSAke1xuICAgICAgbWVzc2FnZS5sZXZlbD8udG9VcHBlckNhc2UoKSA/PyBcIlVOS05PV05cIlxuICAgIH06ICR7bWVzc2FnZS5tZXNzYWdlfWA7XG5cbiAgICBpZiAobWVzc2FnZS5wYXlsb2FkKSB7XG4gICAgICBmb3JtYXR0ZWRNZXNzYWdlICs9IFwiXFxuUGF5bG9hZDpcIjtcbiAgICAgIGZvcm1hdHRlZE1lc3NhZ2UgKz0gYFxcbiAgVHlwZTogJHttZXNzYWdlLnBheWxvYWQudHlwZX1gO1xuICAgICAgZm9ybWF0dGVkTWVzc2FnZSArPSBgXFxuICBDb250ZW50OiAke2Zvcm1hdFBheWxvYWRDb250ZW50KFxuICAgICAgICBtZXNzYWdlLnBheWxvYWRcbiAgICAgICl9YDtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9ybWF0dGVkTWVzc2FnZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBzdGF0aWMgaGFuZGxlRXJyb3JzKFxuICAgIHRhcmdldDogYW55LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcsXG4gICAgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yXG4gICkge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKTtcbiAgICAgICAgaWYgKHJlc3VsdCBpbnN0YW5jZW9mIFByb21pc2UpIHtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0LmNhdGNoKChlcnJvcjogYW55KSA9PiB7XG4gICAgICAgICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIExvZ2dhYmxlKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHRydW5jYXRlZEFyZ3MgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShhcmdzLCAzMDApO1xuICAgICAgICAgICAgICByZXR1cm4gdGhpcy5sb2dBbmRUaHJvd0Vycm9yKGVycm9yLCB0cnVuY2F0ZWRBcmdzKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgICAgICBgaGFuZGxlRXJyb3JzIGRlY29yYXRvciB1c2VkIG9uIG5vbi1Mb2dnYWJsZSBjbGFzczogJHt0YXJnZXQuY29uc3RydWN0b3IubmFtZX1gXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgTG9nZ2FibGUpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5sb2dBbmRUaHJvd0Vycm9yKGVycm9yKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICBgaGFuZGxlRXJyb3JzIGRlY29yYXRvciB1c2VkIG9uIG5vbi1Mb2dnYWJsZSBjbGFzczogJHt0YXJnZXQuY29uc3RydWN0b3IubmFtZX1gXG4gICAgICAgICAgKTtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH1cblxuICAvKipcbiAgICogUHJvdGVjdGVkIGNvbnN0cnVjdG9yIHRvIGVuc3VyZSB0aGUgY2xhc3MgaXMgcHJvcGVybHkgaW5pdGlhbGl6ZWQuXG4gICAqIEB0aHJvd3Mge0Vycm9yfSBJZiB0aGUgY2xhc3MgaXMgbm90IGluaXRpYWxpemVkLlxuICAgKi9cbiAgcHJvdGVjdGVkIGNvbnN0cnVjdG9yKCkge1xuICAgIGlmICghTG9nZ2FibGUuaXNQcm9jZXNzaW5nKSB7XG4gICAgICBMb2dnYWJsZS5zdGFydFByb2Nlc3NpbmcoKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgbG9nIHN0cmF0ZWd5LlxuICAgKiBAcGFyYW0ge0xvZ1N0cmF0ZWd5fSBzdHJhdGVneSAtIFRoZSBuZXcgbG9nIHN0cmF0ZWd5IHRvIHVzZS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc2V0TG9nU3RyYXRlZ3koc3RyYXRlZ3k6IExvZ1N0cmF0ZWd5KTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nU3RyYXRlZ3kgPSBzdHJhdGVneTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBxdWV1ZSBzdHJhdGVneS5cbiAgICogQHBhcmFtIHtJUXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPn0gc3RyYXRlZ3kgLSBUaGUgbmV3IHF1ZXVlIHN0cmF0ZWd5IHRvIHVzZS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc2V0UXVldWVTdHJhdGVneShzdHJhdGVneTogSVF1ZXVlU3RyYXRlZ3k8TG9nTWVzc2FnZT4pOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5ID0gc3RyYXRlZ3k7XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgbG9nIGxldmVsLlxuICAgKiBAcGFyYW0ge0xvZ0xldmVsfSBsZXZlbCAtIFRoZSBuZXcgbG9nIGxldmVsIHRvIHVzZS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc2V0TG9nTGV2ZWwobGV2ZWw6IExvZ0xldmVsKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nTGV2ZWwgPSBsZXZlbDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgbG9nQW5kVGhyb3dFcnJvcihlcnJvcjogYW55LCBhcmdzOiBhbnkgPSB7fSk6IFByb21pc2U8bmV2ZXI+IHtcbiAgICBjb25zdCBFcnJvckNsYXNzID1cbiAgICAgICh0aGlzLmNvbnN0cnVjdG9yIGFzIHR5cGVvZiBMb2dnYWJsZSkuTG9nZ2FibGVFcnJvciB8fFxuICAgICAgTG9nZ2FibGUuRGVmYXVsdExvZ2dhYmxlRXJyb3I7XG5cbiAgICBsZXQgbG9nZ2FibGVFcnJvcjogTG9nZ2FibGVFcnJvcjtcblxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yQ2xhc3MpIHtcbiAgICAgIGxvZ2dhYmxlRXJyb3IgPSBlcnJvcjtcbiAgICB9IGVsc2Uge1xuICAgICAgbG9nZ2FibGVFcnJvciA9IG5ldyBFcnJvckNsYXNzKFxuICAgICAgICBlcnJvci5tZXNzYWdlLFxuICAgICAgICB7IG9yaWdpbmFsQXJnczogYXJncyB9LFxuICAgICAgICBlcnJvclxuICAgICAgKTtcblxuICAgICAgLy8gUHJlc2VydmUgdGhlIG9yaWdpbmFsIHN0YWNrIHRyYWNlXG4gICAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciAmJiBlcnJvci5zdGFjaykge1xuICAgICAgICBsb2dnYWJsZUVycm9yLnN0YWNrID0gZXJyb3Iuc3RhY2s7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQWRkIHRocm93aW5nIGNsYXNzIGluZm9ybWF0aW9uIHdpdGhvdXQgbW9kaWZ5aW5nIHRoZSBlcnJvciBvYmplY3QgZGlyZWN0bHlcbiAgICBjb25zdCB0aHJvd2luZ0NsYXNzID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgIGNvbnN0IGVycm9ySW5mbyA9IHtcbiAgICAgIC4uLmxvZ2dhYmxlRXJyb3IudG9KU09OKCksXG4gICAgICB0aHJvd2luZ0NsYXNzLFxuICAgIH07XG5cbiAgICB0aGlzLmVycm9yKGxvZ2dhYmxlRXJyb3IubWVzc2FnZSwgZXJyb3JJbmZvKTtcbiAgICBhd2FpdCBMb2dnYWJsZS53YWl0Rm9yRW1wdHlRdWV1ZSgpOyAvLyBFbnN1cmUgdGhlIHF1ZXVlIGlzIGVtcHR5IGJlZm9yZSB0aHJvd2luZ1xuICAgIHRocm93IGxvZ2dhYmxlRXJyb3I7XG4gIH1cblxuICAvKipcbiAgICogV2FpdHMgZm9yIHRoZSBxdWV1ZSB0byBiZSBlbXB0eS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gdGhlIHF1ZXVlIGlzIGVtcHR5LlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgd2FpdEZvckVtcHR5UXVldWUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XG4gICAgICBjb25zdCBjaGVja1F1ZXVlID0gKCkgPT4ge1xuICAgICAgICBpZiAoXG4gICAgICAgICAgIUxvZ2dhYmxlLmlzUHJvY2Vzc2luZyAmJlxuICAgICAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZGVxdWV1ZSgpID09PSB1bmRlZmluZWRcbiAgICAgICAgKSB7XG4gICAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHNldFRpbWVvdXQoY2hlY2tRdWV1ZSwgMTAwKTsgLy8gQ2hlY2sgYWdhaW4gYWZ0ZXIgMTAwbXNcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIGNoZWNrUXVldWUoKTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgaWYgYSBtZXNzYWdlIHdpdGggdGhlIGdpdmVuIGxldmVsIHNob3VsZCBiZSBsb2dnZWQuXG4gICAqIEBwYXJhbSB7TG9nTGV2ZWx9IG1lc3NhZ2VMZXZlbCAtIFRoZSBsZXZlbCBvZiB0aGUgbWVzc2FnZSB0byBjaGVjay5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIG1lc3NhZ2Ugc2hvdWxkIGJlIGxvZ2dlZCwgZmFsc2Ugb3RoZXJ3aXNlLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBzaG91bGRMb2cobWVzc2FnZUxldmVsOiBMb2dMZXZlbCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBtZXNzYWdlTGV2ZWwgPj0gTG9nZ2FibGUubG9nTGV2ZWw7XG4gIH1cblxuICAvKipcbiAgICogUmV0dXJucyBhIHZhbHVlIGFmdGVyIGVuc3VyaW5nIGFsbCBsb2dzIGhhdmUgYmVlbiBwcm9jZXNzZWQuXG4gICAqIEBwYXJhbSB7VH0gdmFsdWUgLSBUaGUgdmFsdWUgdG8gcmV0dXJuLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxUPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2l0aCB0aGUgdmFsdWUgYWZ0ZXIgYWxsIGxvZ3MgYXJlIHByb2Nlc3NlZC5cbiAgICovXG4gIHB1YmxpYyBhc3luYyByZXR1cm5BZnRlckxvZ2dpbmc8VD4odmFsdWU6IFQpOiBQcm9taXNlPFQ+IHtcbiAgICBhd2FpdCBMb2dnYWJsZS53YWl0Rm9yRW1wdHlRdWV1ZSgpO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbG9nIG1lc3NhZ2Ugb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbGV2ZWwgLSBUaGUgbG9nIGxldmVsLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFRoZSBsb2cgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBbY2xhc3NOYW1lXSAtIE9wdGlvbmFsIGNsYXNzIG5hbWUgZm9yIGNvbnRleHQuXG4gICAqIEByZXR1cm5zIHtMb2dNZXNzYWdlfSBUaGUgY3JlYXRlZCBsb2cgbWVzc2FnZSBvYmplY3QuXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBjcmVhdGVMb2dNZXNzYWdlKFxuICAgIGxldmVsOiBzdHJpbmcsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QsXG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICk6IExvZ01lc3NhZ2Uge1xuICAgIGNvbnN0IHByZWZpeGVkTWVzc2FnZSA9IGNsYXNzTmFtZSA/IGAke2NsYXNzTmFtZX06OiR7bWVzc2FnZX1gIDogbWVzc2FnZTtcbiAgICBjb25zdCBsb2dQYXlsb2FkOiBMb2dQYXlsb2FkIHwgdW5kZWZpbmVkID0gcGF5bG9hZFxuICAgICAgPyB7XG4gICAgICAgICAgdHlwZTogdHlwZW9mIHBheWxvYWQgPT09IFwic3RyaW5nXCIgPyBcInRleHRcIiA6IFwianNvblwiLFxuICAgICAgICAgIGNvbnRlbnQ6IHBheWxvYWQsXG4gICAgICAgIH1cbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHRpbWVzdGFtcDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgbGV2ZWwsXG4gICAgICBtZXNzYWdlOiBwcmVmaXhlZE1lc3NhZ2UsXG4gICAgICBwYXlsb2FkOiBsb2dQYXlsb2FkLFxuICAgICAgc2VuZGVyOiBjbGFzc05hbWUgfHwgXCJMb2dnYWJsZVwiLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIHN0YXRpYyBsb2dXaXRoTGV2ZWwoXG4gICAgbGV2ZWw6IExvZ0xldmVsLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0LFxuICAgIGNsYXNzTmFtZT86IHN0cmluZ1xuICApOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKGxldmVsKSkge1xuICAgICAgY29uc3QgbG9nTWVzc2FnZSA9IExvZ2dhYmxlLmNyZWF0ZUxvZ01lc3NhZ2UoXG4gICAgICAgIExvZ0xldmVsW2xldmVsXSxcbiAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgcGF5bG9hZCxcbiAgICAgICAgY2xhc3NOYW1lXG4gICAgICApO1xuICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5lbnF1ZXVlKGxvZ01lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgbG9nRGVidWcoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QsXG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICk6IHZvaWQge1xuICAgIExvZ2dhYmxlLmxvZ1dpdGhMZXZlbChMb2dMZXZlbC5ERUJVRywgbWVzc2FnZSwgcGF5bG9hZCwgY2xhc3NOYW1lKTtcbiAgfVxuXG4gIHB1YmxpYyBzdGF0aWMgbG9nRXJyb3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QsXG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICk6IHZvaWQge1xuICAgIExvZ2dhYmxlLmxvZ1dpdGhMZXZlbChMb2dMZXZlbC5FUlJPUiwgbWVzc2FnZSwgcGF5bG9hZCwgY2xhc3NOYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGEgZGVidWcgbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIGRlYnVnIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgb2JqZWN0fSBbcGF5bG9hZF0gLSBPcHRpb25hbCBwYXlsb2FkIGZvciBhZGRpdGlvbmFsIGluZm9ybWF0aW9uLlxuICAgKi9cbiAgcHJvdGVjdGVkIGRlYnVnKG1lc3NhZ2U6IHN0cmluZywgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCk6IHZvaWQge1xuICAgIExvZ2dhYmxlLmxvZ0RlYnVnKG1lc3NhZ2UsIHBheWxvYWQsIHRoaXMuY29uc3RydWN0b3IubmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhbiBpbmZvIG1lc3NhZ2UgZm9yIHRoZSBjdXJyZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFRoZSBpbmZvIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgb2JqZWN0fSBbcGF5bG9hZF0gLSBPcHRpb25hbCBwYXlsb2FkIGZvciBhZGRpdGlvbmFsIGluZm9ybWF0aW9uLlxuICAgKi9cbiAgcHJvdGVjdGVkIGluZm8obWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0KTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhMb2dMZXZlbC5JTkZPKSkge1xuICAgICAgY29uc3QgbG9nTWVzc2FnZSA9IExvZ2dhYmxlLmNyZWF0ZUxvZ01lc3NhZ2UoXG4gICAgICAgIFwiSU5GT1wiLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwYXlsb2FkLFxuICAgICAgICB0aGlzLmNvbnN0cnVjdG9yLm5hbWVcbiAgICAgICk7XG4gICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmVucXVldWUobG9nTWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYSB3YXJuaW5nIG1lc3NhZ2UgZm9yIHRoZSBjdXJyZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gbWVzc2FnZSAtIFRoZSB3YXJuaW5nIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgb2JqZWN0fSBbcGF5bG9hZF0gLSBPcHRpb25hbCBwYXlsb2FkIGZvciBhZGRpdGlvbmFsIGluZm9ybWF0aW9uLlxuICAgKi9cbiAgcHJvdGVjdGVkIHdhcm4obWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0KTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhMb2dMZXZlbC5XQVJOKSkge1xuICAgICAgY29uc3QgbG9nTWVzc2FnZSA9IExvZ2dhYmxlLmNyZWF0ZUxvZ01lc3NhZ2UoXG4gICAgICAgIFwiV0FSTlwiLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwYXlsb2FkLFxuICAgICAgICB0aGlzLmNvbnN0cnVjdG9yLm5hbWVcbiAgICAgICk7XG4gICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmVucXVldWUobG9nTWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYW4gZXJyb3IgbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgTG9nZ2FibGVFcnJvcn0gbWVzc2FnZU9yRXJyb3IgLSBUaGUgZXJyb3IgbWVzc2FnZSBvciBMb2dnYWJsZUVycm9yIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24gKHVzZWQgb25seSBpZiBtZXNzYWdlIGlzIGEgc3RyaW5nKS5cbiAgICovXG4gIHByb3RlY3RlZCBlcnJvcihcbiAgICBtZXNzYWdlT3JFcnJvcjogc3RyaW5nIHwgTG9nZ2FibGVFcnJvcixcbiAgICBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0XG4gICk6IHZvaWQge1xuICAgIGlmIChMb2dnYWJsZS5zaG91bGRMb2coTG9nTGV2ZWwuRVJST1IpKSB7XG4gICAgICBsZXQgbWVzc2FnZTogc3RyaW5nO1xuICAgICAgbGV0IGVycm9yUGF5bG9hZDogb2JqZWN0IHwgdW5kZWZpbmVkO1xuXG4gICAgICBpZiAobWVzc2FnZU9yRXJyb3IgaW5zdGFuY2VvZiBMb2dnYWJsZUVycm9yKSB7XG4gICAgICAgIG1lc3NhZ2UgPSBtZXNzYWdlT3JFcnJvci5tZXNzYWdlO1xuICAgICAgICBlcnJvclBheWxvYWQgPSBtZXNzYWdlT3JFcnJvci50b0pTT04oKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1lc3NhZ2UgPSBtZXNzYWdlT3JFcnJvcjtcbiAgICAgICAgZXJyb3JQYXlsb2FkID0gdHlwZW9mIHBheWxvYWQgPT09IFwib2JqZWN0XCIgPyBwYXlsb2FkIDogdW5kZWZpbmVkO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgXCJFUlJPUlwiLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBlcnJvclBheWxvYWQsXG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHJvY2Vzc2VzIHRoZSBxdWV1ZSBvZiBsb2cgbWVzc2FnZXMuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHByb2Nlc3NpbmcgaXMgY29tcGxldGUuXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyBhc3luYyBwcm9jZXNzUXVldWUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvZ2dhYmxlLmlzUHJvY2Vzc2luZykgcmV0dXJuO1xuXG4gICAgTG9nZ2FibGUuaXNQcm9jZXNzaW5nID0gdHJ1ZTtcbiAgICB3aGlsZSAodHJ1ZSkge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZGVxdWV1ZSgpO1xuICAgICAgaWYgKCFtZXNzYWdlKSBicmVhaztcblxuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgTG9nZ2FibGUubG9nU3RyYXRlZ3kuc2VuZChtZXNzYWdlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoXCJGYWlsZWQgdG8gc2VuZCBtZXNzYWdlOlwiLCBlcnJvcik7XG4gICAgICAgIC8vIE9wdGlvbmFsbHkgcmUtZW5xdWV1ZSB0aGUgbWVzc2FnZSBvciBpbXBsZW1lbnQgcmV0cnkgbG9naWNcbiAgICAgIH1cbiAgICB9XG4gICAgTG9nZ2FibGUuaXNQcm9jZXNzaW5nID0gZmFsc2U7XG4gIH1cblxuICAvKipcbiAgICogU3RhcnRzIHByb2Nlc3NpbmcgdGhlIHF1ZXVlIG9mIGxvZyBtZXNzYWdlcy5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIHN0YXJ0UHJvY2Vzc2luZygpOiB2b2lkIHtcbiAgICBjb25zdCBzY2hlZHVsZVByb2Nlc3NpbmcgPSAoKSA9PiB7XG4gICAgICBMb2dnYWJsZS5wcm9jZXNzaW5nVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBMb2dnYWJsZS5wcm9jZXNzUXVldWUoKS5maW5hbGx5KCgpID0+IHtcbiAgICAgICAgICBzY2hlZHVsZVByb2Nlc3NpbmcoKTtcbiAgICAgICAgfSk7XG4gICAgICB9LCAxMDApOyAvLyBBZGp1c3QgdGhpcyBkZWxheSBhcyBuZWVkZWRcbiAgICB9O1xuXG4gICAgc2NoZWR1bGVQcm9jZXNzaW5nKCk7XG4gIH1cblxuICAvKipcbiAgICogU2h1dHMgZG93biB0aGUgbG9nZ2luZyBzeXN0ZW0uXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIGFzeW5jIHNodXRkb3duKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChMb2dnYWJsZS5wcm9jZXNzaW5nVGltZW91dCkge1xuICAgICAgY2xlYXJUaW1lb3V0KExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0KTtcbiAgICAgIGF3YWl0IExvZ2dhYmxlLndhaXRGb3JFbXB0eVF1ZXVlKCk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIGZvcm1hdFBheWxvYWRDb250ZW50KHBheWxvYWQ6IExvZ1BheWxvYWQpOiBzdHJpbmcge1xuICBjb25zdCB0cnVuY2F0ZWRDb250ZW50ID0gTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkocGF5bG9hZC5jb250ZW50KTtcblxuICBpZiAocGF5bG9hZC50eXBlID09PSBcInRleHRcIikge1xuICAgIHJldHVybiB0cnVuY2F0ZWRDb250ZW50IGFzIHN0cmluZztcbiAgfVxuXG4gIHJldHVybiB1dGlsLmluc3BlY3QodHJ1bmNhdGVkQ29udGVudCwgeyBkZXB0aDogbnVsbCwgY29sb3JzOiB0cnVlIH0pO1xufVxuXG5leHBvcnQgeyBsb2dNZXRob2QsIENvbnNvbGVTdHJhdGVneSB9O1xuIl19