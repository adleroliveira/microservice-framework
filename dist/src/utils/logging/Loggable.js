"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Loggable = exports.LoggableError = exports.LogLevel = void 0;
exports.logMethod = logMethod;
const LogStrategy_1 = require("./LogStrategy");
const ConsoleStrategy_1 = require("./ConsoleStrategy");
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
        Loggable.setLogStrategy();
        if (!Loggable.isProcessing) {
            Loggable.startProcessing();
        }
    }
    /**
     * Sets the log strategy.
     * @param {LogStrategy} strategy - The new log strategy to use.
     */
    static setLogStrategy(strategy = new ConsoleStrategy_1.ConsoleStrategy()) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTG9nZ2FibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvdXRpbHMvbG9nZ2luZy9Mb2dnYWJsZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFrbEJTLDhCQUFTO0FBamxCbEIsK0NBQTRDO0FBQzVDLHVEQUFvRDtBQUNwRCwwRUFBdUU7QUFDdkUsZ0RBQXdCO0FBRXhCLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxDQUFDLENBQUMsOENBQThDO0FBQzlFLE1BQU0sU0FBUyxHQUFHLEVBQUUsQ0FBQyxDQUFDLG1DQUFtQztBQUV6RDs7O0dBR0c7QUFFSCxtQ0FBa0Q7QUFFbEQ7O0dBRUc7QUFDSCxJQUFZLFFBS1g7QUFMRCxXQUFZLFFBQVE7SUFDbEIseUNBQVMsQ0FBQTtJQUNULHVDQUFRLENBQUE7SUFDUix1Q0FBUSxDQUFBO0lBQ1IseUNBQVMsQ0FBQTtBQUNYLENBQUMsRUFMVyxRQUFRLHdCQUFSLFFBQVEsUUFLbkI7QUFnQ0QsU0FBUyxTQUFTO0lBQ2hCLE9BQU8sVUFDTCxNQUFXLEVBQ1gsV0FBbUIsRUFDbkIsVUFBOEI7UUFFOUIsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUN4QyxVQUFVLENBQUMsS0FBSyxHQUFHLFVBQVUsR0FBRyxJQUFXO1lBQ3pDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDO1lBQ3hDLE1BQU0sYUFBYSxHQUFHLHlCQUFXLENBQUMsb0JBQW9CLENBQUMsSUFBSSxDQUFDLENBQUM7WUFFN0QsTUFBTSxTQUFTLEdBQUcsQ0FBQyxNQUFXLEVBQUUsRUFBRTtnQkFDaEMsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO29CQUN2QyxNQUFNLGVBQWUsR0FBRyx5QkFBVyxDQUFDLG9CQUFvQixDQUFDLE1BQU0sQ0FBQyxDQUFDO29CQUNqRSxNQUFNLE9BQU8sR0FBRzt3QkFD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QUNILENBQUM7SUFFTSxNQUFNO1FBQ1gsT0FBTztZQUNMLElBQUksRUFBRSxJQUFJLENBQUMsSUFBSTtZQUNmLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztZQUNyQixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO1lBQ2pCLGFBQWEsRUFBRSxJQUFJLENBQUMsYUFBYTtnQkFDL0IsQ0FBQyxDQUFDO29CQUNFLElBQUksRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUk7b0JBQzdCLE9BQU8sRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLE9BQU87b0JBQ25DLEtBQUssRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUs7aUJBQ2hDO2dCQUNILENBQUMsQ0FBQyxTQUFTO1NBQ2QsQ0FBQztJQUNKLENBQUM7Q0FDRixDQUFDO0FBd1dKLFNBQVMsb0JBQW9CLENBQUMsT0FBbUI7SUFDL0MsTUFBTSxnQkFBZ0IsR0FBRyx5QkFBVyxDQUFDLG9CQUFvQixDQUFDLE9BQU8sQ0FBQyxPQUFPLENBQUMsQ0FBQztJQUUzRSxJQUFJLE9BQU8sQ0FBQyxJQUFJLEtBQUssTUFBTSxFQUFFLENBQUM7UUFDNUIsT0FBTyxnQkFBMEIsQ0FBQztJQUNwQyxDQUFDO0lBRUQsT0FBTyxjQUFJLENBQUMsT0FBTyxDQUFDLGdCQUFnQixFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztBQUN2RSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSVF1ZXVlU3RyYXRlZ3kgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgTG9nU3RyYXRlZ3kgfSBmcm9tIFwiLi9Mb2dTdHJhdGVneVwiO1xuaW1wb3J0IHsgQ29uc29sZVN0cmF0ZWd5IH0gZnJvbSBcIi4vQ29uc29sZVN0cmF0ZWd5XCI7XG5pbXBvcnQgeyBJbk1lbW9yeVF1ZXVlU3RyYXRlZ3kgfSBmcm9tIFwiLi4vcXVldWUvSW5NZW1vcnlRdWV1ZVN0cmF0ZWd5XCI7XG5pbXBvcnQgdXRpbCBmcm9tIFwidXRpbFwiO1xuXG5jb25zdCBNQVhfU1RSSU5HX0xFTkdUSCA9IDEwMDA7IC8vIE1heGltdW0gbGVuZ3RoIGZvciBpbmRpdmlkdWFsIHN0cmluZyB2YWx1ZXNcbmNvbnN0IE1BWF9ERVBUSCA9IDEwOyAvLyBNYXhpbXVtIGRlcHRoIGZvciBuZXN0ZWQgb2JqZWN0c1xuXG4vKipcbiAqIEBmaWxlb3ZlcnZpZXcgVGhpcyBtb2R1bGUgcHJvdmlkZXMgYSBsb2dnaW5nIHN5c3RlbSB3aXRoIGRpZmZlcmVudCBsb2cgbGV2ZWxzLFxuICogbm90aWZpY2F0aW9uIHN0cmF0ZWdpZXMsIGFuZCBxdWV1ZSBzdHJhdGVnaWVzLlxuICovXG5cbmltcG9ydCB7IHNldFRpbWVvdXQsIGNsZWFyVGltZW91dCB9IGZyb20gXCJ0aW1lcnNcIjtcblxuLyoqXG4gKiBFbnVtIHJlcHJlc2VudGluZyBkaWZmZXJlbnQgbG9nIGxldmVscy5cbiAqL1xuZXhwb3J0IGVudW0gTG9nTGV2ZWwge1xuICBERUJVRyA9IDAsXG4gIElORk8gPSAxLFxuICBXQVJOID0gMixcbiAgRVJST1IgPSAzLFxufVxuXG4vKipcbiAqIFR5cGUgcmVwcmVzZW50aW5nIHRoZSBwYXlsb2FkIHR5cGUgb2YgYSBsb2cgbWVzc2FnZS5cbiAqL1xuZXhwb3J0IHR5cGUgUGF5bG9hZFR5cGUgPSBcInRleHRcIiB8IFwianNvblwiO1xuXG4vKipcbiAqIEludGVyZmFjZSByZXByZXNlbnRpbmcgdGhlIHBheWxvYWQgb2YgYSBsb2cgbWVzc2FnZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2dQYXlsb2FkIHtcbiAgLyoqIFRoZSB0eXBlIG9mIHRoZSBwYXlsb2FkLiAqL1xuICB0eXBlOiBQYXlsb2FkVHlwZTtcbiAgLyoqIFRoZSBjb250ZW50IG9mIHRoZSBwYXlsb2FkLiAqL1xuICBjb250ZW50OiBzdHJpbmcgfCBvYmplY3Q7XG59XG5cbi8qKlxuICogSW50ZXJmYWNlIHJlcHJlc2VudGluZyBhIGxvZyBtZXNzYWdlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIExvZ01lc3NhZ2Uge1xuICBzZW5kZXI/OiBzdHJpbmc7XG4gIC8qKiBUaGUgdGltZXN0YW1wIG9mIHRoZSBsb2cgbWVzc2FnZS4gKi9cbiAgdGltZXN0YW1wOiBzdHJpbmc7XG4gIC8qKiBUaGUgbG9nIGxldmVsIG9mIHRoZSBtZXNzYWdlLiAqL1xuICBsZXZlbDogc3RyaW5nO1xuICAvKiogVGhlIGNvbnRlbnQgb2YgdGhlIGxvZyBtZXNzYWdlLiAqL1xuICBtZXNzYWdlOiBzdHJpbmc7XG4gIC8qKiBPcHRpb25hbCBwYXlsb2FkIGZvciBhZGRpdGlvbmFsIGluZm9ybWF0aW9uLiAqL1xuICBwYXlsb2FkPzogTG9nUGF5bG9hZDtcbn1cblxuZnVuY3Rpb24gbG9nTWV0aG9kKCkge1xuICByZXR1cm4gZnVuY3Rpb24gKFxuICAgIHRhcmdldDogYW55LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcsXG4gICAgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yXG4gICkge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICBjb25zdCBjbGFzc05hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgICBjb25zdCB0cnVuY2F0ZWRBcmdzID0gTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkoYXJncyk7XG5cbiAgICAgIGNvbnN0IGxvZ1Jlc3VsdCA9IChyZXN1bHQ6IGFueSkgPT4ge1xuICAgICAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLkRFQlVHKSkge1xuICAgICAgICAgIGNvbnN0IHRydW5jYXRlZFJlc3VsdCA9IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KHJlc3VsdCk7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgICAgICAgIGFyZ3M6IHRydW5jYXRlZEFyZ3MsXG4gICAgICAgICAgICByZXN1bHQ6IHRydW5jYXRlZFJlc3VsdCxcbiAgICAgICAgICB9O1xuICAgICAgICAgIExvZ2dhYmxlLmxvZ0RlYnVnKFxuICAgICAgICAgICAgYExvZ01ldGhvZERlY29yYXRvcjo6JHtjbGFzc05hbWV9Ojoke3Byb3BlcnR5S2V5fWAsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgY2xhc3NOYW1lXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfTtcblxuICAgICAgY29uc3QgbG9nRXJyb3IgPSAoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgJHtjbGFzc05hbWV9Ojoke3Byb3BlcnR5S2V5fSByZXN1bHRlZCBpbiBlcnJvcmA7XG4gICAgICAgIGNvbnN0IHRydW5jYXRlZEVycm9yID1cbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIExvZ2dhYmxlRXJyb3JcbiAgICAgICAgICAgID8gZXJyb3IudG9KU09OKClcbiAgICAgICAgICAgIDogTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkoZXJyb3IubWVzc2FnZSB8fCBlcnJvcik7XG5cbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgICAgICBhcmdzOiB0cnVuY2F0ZWRBcmdzLFxuICAgICAgICAgIGVycm9yOiB0cnVuY2F0ZWRFcnJvcixcbiAgICAgICAgfTtcbiAgICAgICAgTG9nZ2FibGUubG9nRXJyb3IoXG4gICAgICAgICAgYExvZ01ldGhvZERlY29yYXRvcjo6JHtlcnJvck1lc3NhZ2V9YCxcbiAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgIGNsYXNzTmFtZVxuICAgICAgICApO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpO1xuXG4gICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC50aGVuKGxvZ1Jlc3VsdCwgbG9nRXJyb3IpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBsb2dSZXN1bHQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICByZXR1cm4gbG9nRXJyb3IoZXJyb3IpO1xuICAgICAgfVxuICAgIH07XG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBMb2dnYWJsZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBwdWJsaWMgcmVhZG9ubHkgcGF5bG9hZDogYW55O1xuICBwdWJsaWMgcmVhZG9ubHkgb3JpZ2luYWxFcnJvcjogRXJyb3IgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogYW55LCBvcmlnaW5hbEVycm9yPzogRXJyb3IpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSBcIkxvZ2dhYmxlRXJyb3JcIjtcbiAgICB0aGlzLnBheWxvYWQgPSBwYXlsb2FkO1xuICAgIHRoaXMub3JpZ2luYWxFcnJvciA9IG9yaWdpbmFsRXJyb3I7XG5cbiAgICAvLyBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZVxuICAgIGlmIChFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSkge1xuICAgICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgTG9nZ2FibGVFcnJvcik7XG4gICAgfVxuXG4gICAgLy8gQXBwZW5kIHRoZSBvcmlnaW5hbCBlcnJvcidzIHN0YWNrIHRvIHRoaXMgZXJyb3IncyBzdGFja1xuICAgIGlmIChvcmlnaW5hbEVycm9yICYmIG9yaWdpbmFsRXJyb3Iuc3RhY2spIHtcbiAgICAgIHRoaXMuc3RhY2sgPSB0aGlzLnN0YWNrICsgXCJcXG5cXG5DYXVzZWQgYnk6XFxuXCIgKyBvcmlnaW5hbEVycm9yLnN0YWNrO1xuICAgIH1cblxuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBMb2dnYWJsZUVycm9yLnByb3RvdHlwZSk7XG4gIH1cblxuICBwcml2YXRlIGdldFRocm93aW5nQ2xhc3NOYW1lKCk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIEdldCB0aGUgc3RhY2sgdHJhY2VcbiAgICBjb25zdCBzdGFjayA9IHRoaXMuc3RhY2s/LnNwbGl0KFwiXFxuXCIpO1xuICAgIGlmICghc3RhY2sgfHwgc3RhY2subGVuZ3RoIDwgNCkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBUaGUgY29uc3RydWN0b3IgY2FsbCB3aWxsIGJlIHRoZSB0aGlyZCBsaW5lIGluIHRoZSBzdGFjayAoaW5kZXggMilcbiAgICBjb25zdCBjb25zdHJ1Y3RvckNhbGwgPSBzdGFja1syXTtcblxuICAgIC8vIEV4dHJhY3QgdGhlIGNsYXNzIG5hbWUgdXNpbmcgYSByZWd1bGFyIGV4cHJlc3Npb25cbiAgICBjb25zdCBtYXRjaCA9IGNvbnN0cnVjdG9yQ2FsbC5tYXRjaCgvYXRcXHMrKC4qPylcXHMrXFwoLyk7XG4gICAgaWYgKG1hdGNoICYmIG1hdGNoWzFdKSB7XG4gICAgICBjb25zdCBmdWxsTmFtZSA9IG1hdGNoWzFdO1xuICAgICAgLy8gSWYgaXQncyBhIG1ldGhvZCBjYWxsLCBleHRyYWN0IHRoZSBjbGFzcyBuYW1lXG4gICAgICBjb25zdCBsYXN0RG90SW5kZXggPSBmdWxsTmFtZS5sYXN0SW5kZXhPZihcIi5cIik7XG4gICAgICByZXR1cm4gbGFzdERvdEluZGV4ICE9PSAtMVxuICAgICAgICA/IGZ1bGxOYW1lLnN1YnN0cmluZygwLCBsYXN0RG90SW5kZXgpXG4gICAgICAgIDogZnVsbE5hbWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgdG9KU09OKCkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgICBtZXNzYWdlOiB0aGlzLm1lc3NhZ2UsXG4gICAgICBwYXlsb2FkOiB0aGlzLnBheWxvYWQsXG4gICAgICB0aHJvd2luZ0NsYXNzOiB0aGlzLmdldFRocm93aW5nQ2xhc3NOYW1lKCksXG4gICAgICBzdGFjazogdGhpcy5zdGFjayxcbiAgICB9O1xuICB9XG5cbiAgcHVibGljIHRvU3RyaW5nKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHRoaXMudG9KU09OKCksIG51bGwsIDIpO1xuICB9XG59XG5cbi8qKlxuICogQWJzdHJhY3QgYmFzZSBjbGFzcyBmb3Igb2JqZWN0cyB0aGF0IGNhbiBsb2cgbWVzc2FnZXMuXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBMb2dnYWJsZSB7XG4gIHB1YmxpYyBzdGF0aWMgbG9nU3RyYXRlZ3k6IExvZ1N0cmF0ZWd5O1xuICBwcml2YXRlIHN0YXRpYyBxdWV1ZVN0cmF0ZWd5OiBJUXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPiA9XG4gICAgbmV3IEluTWVtb3J5UXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPigpO1xuICBwcml2YXRlIHN0YXRpYyBsb2dMZXZlbDogTG9nTGV2ZWwgPSBMb2dMZXZlbC5JTkZPO1xuICBwcml2YXRlIHN0YXRpYyBpc1Byb2Nlc3Npbmc6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBzdGF0aWMgcHJvY2Vzc2luZ1RpbWVvdXQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHN0YXRpYyBMb2dMZXZlbCA9IExvZ0xldmVsO1xuICBwcm90ZWN0ZWQgc3RhdGljIExvZ2dhYmxlRXJyb3IgPSBMb2dnYWJsZUVycm9yO1xuICBwcm90ZWN0ZWQgc3RhdGljIERlZmF1bHRMb2dnYWJsZUVycm9yID0gY2xhc3MgZXh0ZW5kcyBFcnJvciB7XG4gICAgcHVibGljIHJlYWRvbmx5IHBheWxvYWQ6IGFueTtcbiAgICBwdWJsaWMgcmVhZG9ubHkgb3JpZ2luYWxFcnJvcjogRXJyb3IgfCB1bmRlZmluZWQ7XG5cbiAgICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBhbnksIG9yaWdpbmFsRXJyb3I/OiBFcnJvcikge1xuICAgICAgc3VwZXIobWVzc2FnZSk7XG4gICAgICB0aGlzLm5hbWUgPSBcIkRlZmF1bHRMb2dnYWJsZUVycm9yXCI7XG4gICAgICB0aGlzLnBheWxvYWQgPSBwYXlsb2FkO1xuICAgICAgdGhpcy5vcmlnaW5hbEVycm9yID0gb3JpZ2luYWxFcnJvcjtcblxuICAgICAgaWYgKEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKSB7XG4gICAgICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIHRoaXMuY29uc3RydWN0b3IpO1xuICAgICAgfVxuXG4gICAgICBpZiAob3JpZ2luYWxFcnJvciAmJiBvcmlnaW5hbEVycm9yLnN0YWNrKSB7XG4gICAgICAgIHRoaXMuc3RhY2sgPSB0aGlzLnN0YWNrICsgXCJcXG5cXG5DYXVzZWQgYnk6XFxuXCIgKyBvcmlnaW5hbEVycm9yLnN0YWNrO1xuICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyB0b0pTT04oKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgICAgIG1lc3NhZ2U6IHRoaXMubWVzc2FnZSxcbiAgICAgICAgcGF5bG9hZDogdGhpcy5wYXlsb2FkLFxuICAgICAgICBzdGFjazogdGhpcy5zdGFjayxcbiAgICAgICAgb3JpZ2luYWxFcnJvcjogdGhpcy5vcmlnaW5hbEVycm9yXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIG5hbWU6IHRoaXMub3JpZ2luYWxFcnJvci5uYW1lLFxuICAgICAgICAgICAgICBtZXNzYWdlOiB0aGlzLm9yaWdpbmFsRXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgc3RhY2s6IHRoaXMub3JpZ2luYWxFcnJvci5zdGFjayxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfVxuICB9O1xuXG4gIHB1YmxpYyBzdGF0aWMgRm9ybWF0TG9nTWVzc2FnZShtZXNzYWdlOiBMb2dNZXNzYWdlKTogc3RyaW5nIHtcbiAgICBsZXQgdGltZXN0YW1wOiBzdHJpbmc7XG4gICAgdHJ5IHtcbiAgICAgIHRpbWVzdGFtcCA9IG5ldyBEYXRlKG1lc3NhZ2UudGltZXN0YW1wKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIC01KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gSGFuZGxlIGludmFsaWQgZGF0ZVxuICAgICAgY29uc29sZS5lcnJvcihgSW52YWxpZCB0aW1lc3RhbXA6ICR7bWVzc2FnZS50aW1lc3RhbXB9YCwgbWVzc2FnZSk7XG4gICAgICB0aW1lc3RhbXAgPSBcIkludmFsaWQgRGF0ZVwiO1xuICAgIH1cblxuICAgIGxldCBmb3JtYXR0ZWRNZXNzYWdlID0gYFske3RpbWVzdGFtcH1dICR7XG4gICAgICBtZXNzYWdlLmxldmVsPy50b1VwcGVyQ2FzZSgpID8/IFwiVU5LTk9XTlwiXG4gICAgfTogJHttZXNzYWdlLm1lc3NhZ2V9YDtcblxuICAgIGlmIChtZXNzYWdlLnBheWxvYWQpIHtcbiAgICAgIGZvcm1hdHRlZE1lc3NhZ2UgKz0gXCJcXG5QYXlsb2FkOlwiO1xuICAgICAgZm9ybWF0dGVkTWVzc2FnZSArPSBgXFxuICBUeXBlOiAke21lc3NhZ2UucGF5bG9hZC50eXBlfWA7XG4gICAgICBmb3JtYXR0ZWRNZXNzYWdlICs9IGBcXG4gIENvbnRlbnQ6ICR7Zm9ybWF0UGF5bG9hZENvbnRlbnQoXG4gICAgICAgIG1lc3NhZ2UucGF5bG9hZFxuICAgICAgKX1gO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JtYXR0ZWRNZXNzYWdlO1xuICB9XG5cbiAgcHJvdGVjdGVkIHN0YXRpYyBoYW5kbGVFcnJvcnMoXG4gICAgdGFyZ2V0OiBhbnksXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyxcbiAgICBkZXNjcmlwdG9yOiBQcm9wZXJ0eURlc2NyaXB0b3JcbiAgKSB7XG4gICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSBkZXNjcmlwdG9yLnZhbHVlO1xuICAgIGRlc2NyaXB0b3IudmFsdWUgPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQuY2F0Y2goKGVycm9yOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgTG9nZ2FibGUpIHtcbiAgICAgICAgICAgICAgY29uc3QgdHJ1bmNhdGVkQXJncyA9IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KGFyZ3MsIDMwMCk7XG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLmxvZ0FuZFRocm93RXJyb3IoZXJyb3IsIHRydW5jYXRlZEFyZ3MpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgICAgICAgIGBoYW5kbGVFcnJvcnMgZGVjb3JhdG9yIHVzZWQgb24gbm9uLUxvZ2dhYmxlIGNsYXNzOiAke3RhcmdldC5jb25zdHJ1Y3Rvci5uYW1lfWBcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBMb2dnYWJsZSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmxvZ0FuZFRocm93RXJyb3IoZXJyb3IpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgIGBoYW5kbGVFcnJvcnMgZGVjb3JhdG9yIHVzZWQgb24gbm9uLUxvZ2dhYmxlIGNsYXNzOiAke3RhcmdldC5jb25zdHJ1Y3Rvci5uYW1lfWBcbiAgICAgICAgICApO1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm90ZWN0ZWQgY29uc3RydWN0b3IgdG8gZW5zdXJlIHRoZSBjbGFzcyBpcyBwcm9wZXJseSBpbml0aWFsaXplZC5cbiAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBjbGFzcyBpcyBub3QgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBwcm90ZWN0ZWQgY29uc3RydWN0b3IoKSB7XG4gICAgTG9nZ2FibGUuc2V0TG9nU3RyYXRlZ3koKTtcbiAgICBpZiAoIUxvZ2dhYmxlLmlzUHJvY2Vzc2luZykge1xuICAgICAgTG9nZ2FibGUuc3RhcnRQcm9jZXNzaW5nKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGxvZyBzdHJhdGVneS5cbiAgICogQHBhcmFtIHtMb2dTdHJhdGVneX0gc3RyYXRlZ3kgLSBUaGUgbmV3IGxvZyBzdHJhdGVneSB0byB1c2UuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHNldExvZ1N0cmF0ZWd5KFxuICAgIHN0cmF0ZWd5OiBMb2dTdHJhdGVneSA9IG5ldyBDb25zb2xlU3RyYXRlZ3koKVxuICApOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5sb2dTdHJhdGVneSA9IHN0cmF0ZWd5O1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIHF1ZXVlIHN0cmF0ZWd5LlxuICAgKiBAcGFyYW0ge0lRdWV1ZVN0cmF0ZWd5PExvZ01lc3NhZ2U+fSBzdHJhdGVneSAtIFRoZSBuZXcgcXVldWUgc3RyYXRlZ3kgdG8gdXNlLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBzZXRRdWV1ZVN0cmF0ZWd5KHN0cmF0ZWd5OiBJUXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPik6IHZvaWQge1xuICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kgPSBzdHJhdGVneTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBsb2cgbGV2ZWwuXG4gICAqIEBwYXJhbSB7TG9nTGV2ZWx9IGxldmVsIC0gVGhlIG5ldyBsb2cgbGV2ZWwgdG8gdXNlLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBzZXRMb2dMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5sb2dMZXZlbCA9IGxldmVsO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2dBbmRUaHJvd0Vycm9yKGVycm9yOiBhbnksIGFyZ3M6IGFueSA9IHt9KTogUHJvbWlzZTxuZXZlcj4ge1xuICAgIGNvbnN0IEVycm9yQ2xhc3MgPVxuICAgICAgKHRoaXMuY29uc3RydWN0b3IgYXMgdHlwZW9mIExvZ2dhYmxlKS5Mb2dnYWJsZUVycm9yIHx8XG4gICAgICBMb2dnYWJsZS5EZWZhdWx0TG9nZ2FibGVFcnJvcjtcblxuICAgIGxldCBsb2dnYWJsZUVycm9yOiBMb2dnYWJsZUVycm9yO1xuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3JDbGFzcykge1xuICAgICAgbG9nZ2FibGVFcnJvciA9IGVycm9yO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnYWJsZUVycm9yID0gbmV3IEVycm9yQ2xhc3MoXG4gICAgICAgIGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIHsgb3JpZ2luYWxBcmdzOiBhcmdzIH0sXG4gICAgICAgIGVycm9yXG4gICAgICApO1xuXG4gICAgICAvLyBQcmVzZXJ2ZSB0aGUgb3JpZ2luYWwgc3RhY2sgdHJhY2VcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLnN0YWNrKSB7XG4gICAgICAgIGxvZ2dhYmxlRXJyb3Iuc3RhY2sgPSBlcnJvci5zdGFjaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBZGQgdGhyb3dpbmcgY2xhc3MgaW5mb3JtYXRpb24gd2l0aG91dCBtb2RpZnlpbmcgdGhlIGVycm9yIG9iamVjdCBkaXJlY3RseVxuICAgIGNvbnN0IHRocm93aW5nQ2xhc3MgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgZXJyb3JJbmZvID0ge1xuICAgICAgLi4ubG9nZ2FibGVFcnJvci50b0pTT04oKSxcbiAgICAgIHRocm93aW5nQ2xhc3MsXG4gICAgfTtcblxuICAgIHRoaXMuZXJyb3IobG9nZ2FibGVFcnJvci5tZXNzYWdlLCBlcnJvckluZm8pO1xuICAgIGF3YWl0IExvZ2dhYmxlLndhaXRGb3JFbXB0eVF1ZXVlKCk7IC8vIEVuc3VyZSB0aGUgcXVldWUgaXMgZW1wdHkgYmVmb3JlIHRocm93aW5nXG4gICAgdGhyb3cgbG9nZ2FibGVFcnJvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgdGhlIHF1ZXVlIHRvIGJlIGVtcHR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgcXVldWUgaXMgZW1wdHkuXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyB3YWl0Rm9yRW1wdHlRdWV1ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IGNoZWNrUXVldWUgPSAoKSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICAhTG9nZ2FibGUuaXNQcm9jZXNzaW5nICYmXG4gICAgICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5kZXF1ZXVlKCkgPT09IHVuZGVmaW5lZFxuICAgICAgICApIHtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc2V0VGltZW91dChjaGVja1F1ZXVlLCAxMDApOyAvLyBDaGVjayBhZ2FpbiBhZnRlciAxMDBtc1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgY2hlY2tRdWV1ZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIG1lc3NhZ2Ugd2l0aCB0aGUgZ2l2ZW4gbGV2ZWwgc2hvdWxkIGJlIGxvZ2dlZC5cbiAgICogQHBhcmFtIHtMb2dMZXZlbH0gbWVzc2FnZUxldmVsIC0gVGhlIGxldmVsIG9mIHRoZSBtZXNzYWdlIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgbWVzc2FnZSBzaG91bGQgYmUgbG9nZ2VkLCBmYWxzZSBvdGhlcndpc2UuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHNob3VsZExvZyhtZXNzYWdlTGV2ZWw6IExvZ0xldmVsKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG1lc3NhZ2VMZXZlbCA+PSBMb2dnYWJsZS5sb2dMZXZlbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgdmFsdWUgYWZ0ZXIgZW5zdXJpbmcgYWxsIGxvZ3MgaGF2ZSBiZWVuIHByb2Nlc3NlZC5cbiAgICogQHBhcmFtIHtUfSB2YWx1ZSAtIFRoZSB2YWx1ZSB0byByZXR1cm4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSB2YWx1ZSBhZnRlciBhbGwgbG9ncyBhcmUgcHJvY2Vzc2VkLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIHJldHVybkFmdGVyTG9nZ2luZzxUPih2YWx1ZTogVCk6IFByb21pc2U8VD4ge1xuICAgIGF3YWl0IExvZ2dhYmxlLndhaXRGb3JFbXB0eVF1ZXVlKCk7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBsb2cgbWVzc2FnZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsZXZlbCAtIFRoZSBsb2cgbGV2ZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIGxvZyBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtjbGFzc05hbWVdIC0gT3B0aW9uYWwgY2xhc3MgbmFtZSBmb3IgY29udGV4dC5cbiAgICogQHJldHVybnMge0xvZ01lc3NhZ2V9IFRoZSBjcmVhdGVkIGxvZyBtZXNzYWdlIG9iamVjdC5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGNyZWF0ZUxvZ01lc3NhZ2UoXG4gICAgbGV2ZWw6IHN0cmluZyxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogTG9nTWVzc2FnZSB7XG4gICAgY29uc3QgcHJlZml4ZWRNZXNzYWdlID0gY2xhc3NOYW1lID8gYCR7Y2xhc3NOYW1lfTo6JHttZXNzYWdlfWAgOiBtZXNzYWdlO1xuICAgIGNvbnN0IGxvZ1BheWxvYWQ6IExvZ1BheWxvYWQgfCB1bmRlZmluZWQgPSBwYXlsb2FkXG4gICAgICA/IHtcbiAgICAgICAgICB0eXBlOiB0eXBlb2YgcGF5bG9hZCA9PT0gXCJzdHJpbmdcIiA/IFwidGV4dFwiIDogXCJqc29uXCIsXG4gICAgICAgICAgY29udGVudDogcGF5bG9hZCxcbiAgICAgICAgfVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBsZXZlbCxcbiAgICAgIG1lc3NhZ2U6IHByZWZpeGVkTWVzc2FnZSxcbiAgICAgIHBheWxvYWQ6IGxvZ1BheWxvYWQsXG4gICAgICBzZW5kZXI6IGNsYXNzTmFtZSB8fCBcIkxvZ2dhYmxlXCIsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGxvZ1dpdGhMZXZlbChcbiAgICBsZXZlbDogTG9nTGV2ZWwsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QsXG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICk6IHZvaWQge1xuICAgIGlmIChMb2dnYWJsZS5zaG91bGRMb2cobGV2ZWwpKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgTG9nTGV2ZWxbbGV2ZWxdLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwYXlsb2FkLFxuICAgICAgICBjbGFzc05hbWVcbiAgICAgICk7XG4gICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmVucXVldWUobG9nTWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHN0YXRpYyBsb2dEZWJ1ZyhcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nV2l0aExldmVsKExvZ0xldmVsLkRFQlVHLCBtZXNzYWdlLCBwYXlsb2FkLCBjbGFzc05hbWUpO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBsb2dFcnJvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nV2l0aExldmVsKExvZ0xldmVsLkVSUk9SLCBtZXNzYWdlLCBwYXlsb2FkLCBjbGFzc05hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYSBkZWJ1ZyBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgZGVidWcgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgZGVidWcobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0KTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nRGVidWcobWVzc2FnZSwgcGF5bG9hZCwgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGFuIGluZm8gbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIGluZm8gbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QpOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLklORk8pKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgXCJJTkZPXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhIHdhcm5pbmcgbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIHdhcm5pbmcgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgd2FybihtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QpOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLldBUk4pKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgXCJXQVJOXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhbiBlcnJvciBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBMb2dnYWJsZUVycm9yfSBtZXNzYWdlT3JFcnJvciAtIFRoZSBlcnJvciBtZXNzYWdlIG9yIExvZ2dhYmxlRXJyb3Igb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiAodXNlZCBvbmx5IGlmIG1lc3NhZ2UgaXMgYSBzdHJpbmcpLlxuICAgKi9cbiAgcHJvdGVjdGVkIGVycm9yKFxuICAgIG1lc3NhZ2VPckVycm9yOiBzdHJpbmcgfCBMb2dnYWJsZUVycm9yLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3RcbiAgKTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhMb2dMZXZlbC5FUlJPUikpIHtcbiAgICAgIGxldCBtZXNzYWdlOiBzdHJpbmc7XG4gICAgICBsZXQgZXJyb3JQYXlsb2FkOiBvYmplY3QgfCB1bmRlZmluZWQ7XG5cbiAgICAgIGlmIChtZXNzYWdlT3JFcnJvciBpbnN0YW5jZW9mIExvZ2dhYmxlRXJyb3IpIHtcbiAgICAgICAgbWVzc2FnZSA9IG1lc3NhZ2VPckVycm9yLm1lc3NhZ2U7XG4gICAgICAgIGVycm9yUGF5bG9hZCA9IG1lc3NhZ2VPckVycm9yLnRvSlNPTigpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWVzc2FnZSA9IG1lc3NhZ2VPckVycm9yO1xuICAgICAgICBlcnJvclBheWxvYWQgPSB0eXBlb2YgcGF5bG9hZCA9PT0gXCJvYmplY3RcIiA/IHBheWxvYWQgOiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBMb2dnYWJsZS5jcmVhdGVMb2dNZXNzYWdlKFxuICAgICAgICBcIkVSUk9SXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIGVycm9yUGF5bG9hZCxcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lXG4gICAgICApO1xuICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5lbnF1ZXVlKGxvZ01lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgdGhlIHF1ZXVlIG9mIGxvZyBtZXNzYWdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gcHJvY2Vzc2luZyBpcyBjb21wbGV0ZS5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGFzeW5jIHByb2Nlc3NRdWV1ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoTG9nZ2FibGUuaXNQcm9jZXNzaW5nKSByZXR1cm47XG5cbiAgICBMb2dnYWJsZS5pc1Byb2Nlc3NpbmcgPSB0cnVlO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gTG9nZ2FibGUucXVldWVTdHJhdGVneS5kZXF1ZXVlKCk7XG4gICAgICBpZiAoIW1lc3NhZ2UpIGJyZWFrO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBMb2dnYWJsZS5sb2dTdHJhdGVneS5zZW5kKG1lc3NhZ2UpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBzZW5kIG1lc3NhZ2U6XCIsIGVycm9yKTtcbiAgICAgICAgLy8gT3B0aW9uYWxseSByZS1lbnF1ZXVlIHRoZSBtZXNzYWdlIG9yIGltcGxlbWVudCByZXRyeSBsb2dpY1xuICAgICAgfVxuICAgIH1cbiAgICBMb2dnYWJsZS5pc1Byb2Nlc3NpbmcgPSBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgcHJvY2Vzc2luZyB0aGUgcXVldWUgb2YgbG9nIG1lc3NhZ2VzLlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgc3RhcnRQcm9jZXNzaW5nKCk6IHZvaWQge1xuICAgIGNvbnN0IHNjaGVkdWxlUHJvY2Vzc2luZyA9ICgpID0+IHtcbiAgICAgIExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIExvZ2dhYmxlLnByb2Nlc3NRdWV1ZSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICAgIHNjaGVkdWxlUHJvY2Vzc2luZygpO1xuICAgICAgICB9KTtcbiAgICAgIH0sIDEwMCk7IC8vIEFkanVzdCB0aGlzIGRlbGF5IGFzIG5lZWRlZFxuICAgIH07XG5cbiAgICBzY2hlZHVsZVByb2Nlc3NpbmcoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTaHV0cyBkb3duIHRoZSBsb2dnaW5nIHN5c3RlbS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgYXN5bmMgc2h1dGRvd24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQoTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgICAgYXdhaXQgTG9nZ2FibGUud2FpdEZvckVtcHR5UXVldWUoKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0UGF5bG9hZENvbnRlbnQocGF5bG9hZDogTG9nUGF5bG9hZCk6IHN0cmluZyB7XG4gIGNvbnN0IHRydW5jYXRlZENvbnRlbnQgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShwYXlsb2FkLmNvbnRlbnQpO1xuXG4gIGlmIChwYXlsb2FkLnR5cGUgPT09IFwidGV4dFwiKSB7XG4gICAgcmV0dXJuIHRydW5jYXRlZENvbnRlbnQgYXMgc3RyaW5nO1xuICB9XG5cbiAgcmV0dXJuIHV0aWwuaW5zcGVjdCh0cnVuY2F0ZWRDb250ZW50LCB7IGRlcHRoOiBudWxsLCBjb2xvcnM6IHRydWUgfSk7XG59XG5cbmV4cG9ydCB7IGxvZ01ldGhvZCB9O1xuIl19