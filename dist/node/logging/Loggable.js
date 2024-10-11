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
Loggable.logLevel = LogStrategy_2.LogLevel.INFO;
Loggable.isProcessing = false;
Loggable.processingTimeout = null;
Loggable.LogLevel = LogStrategy_2.LogLevel;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTG9nZ2FibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9Mb2dnYWJsZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUF3aUJTLDhCQUFTO0FBdmlCbEIsK0NBQTRDO0FBQzVDLHlFQUFzRTtBQUN0RSwrQ0FBaUU7QUFDakUsZ0RBQXdCO0FBRXhCOzs7R0FHRztBQUVILG1DQUFrRDtBQUVsRDs7R0FFRztBQUVILFNBQVMsU0FBUztJQUNoQixPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQThCO1FBRTlCLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsVUFBVSxDQUFDLEtBQUssR0FBRyxVQUFVLEdBQUcsSUFBVztZQUN6QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztZQUN4QyxNQUFNLGFBQWEsR0FBRyx5QkFBVyxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFDO1lBRTdELE1BQU0sU0FBUyxHQUFHLENBQUMsTUFBVyxFQUFFLEVBQUU7Z0JBQ2hDLElBQUksUUFBUSxDQUFDLFNBQVMsQ0FBQyxzQkFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQ3ZDLE1BQU0sZUFBZSxHQUFHLHlCQUFXLENBQUMsb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7b0JBQ2pFLE1BQU0sT0FBTyxHQUFHO3dCQUNkLElBQUksRUFBRSxhQUFhO3dCQUNuQixNQUFNLEVBQUUsZUFBZTtxQkFDeEIsQ0FBQztvQkFDRixRQUFRLENBQUMsUUFBUSxDQUNmLHVCQUF1QixTQUFTLEtBQUssV0FBVyxFQUFFLEVBQ2xELE9BQU8sRUFDUCxTQUFTLENBQ1YsQ0FBQztnQkFDSixDQUFDO2dCQUNELE9BQU8sTUFBTSxDQUFDO1lBQ2hCLENBQUMsQ0FBQztZQUVGLE1BQU0sUUFBUSxHQUFHLENBQUMsS0FBVSxFQUFFLEVBQUU7Z0JBQzlCLE1BQU0sWUFBWSxHQUFHLEdBQUcsU0FBUyxLQUFLLFdBQVcsb0JBQW9CLENBQUM7Z0JBQ3RFLE1BQU0sY0FBYyxHQUNsQixLQUFLLFlBQVksYUFBYTtvQkFDNUIsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUU7b0JBQ2hCLENBQUMsQ0FBQyx5QkFBVyxDQUFDLG9CQUFvQixDQUFDLEtBQUssQ0FBQyxPQUFPLElBQUksS0FBSyxDQUFDLENBQUM7Z0JBRS9ELE1BQU0sT0FBTyxHQUFHO29CQUNkLElBQUksRUFBRSxhQUFhO29CQUNuQixLQUFLLEVBQUUsY0FBYztpQkFDdEIsQ0FBQztnQkFDRixRQUFRLENBQUMsUUFBUSxDQUNmLHVCQUF1QixZQUFZLEVBQUUsRUFDckMsT0FBTyxFQUNQLFNBQVMsQ0FDVixDQUFDO2dCQUNGLE1BQU0sS0FBSyxDQUFDO1lBQ2QsQ0FBQyxDQUFDO1lBRUYsSUFBSSxDQUFDO2dCQUNILE1BQU0sTUFBTSxHQUFHLGNBQWMsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO2dCQUVoRCxJQUFJLE1BQU0sWUFBWSxPQUFPLEVBQUUsQ0FBQztvQkFDOUIsT0FBTyxNQUFNLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxRQUFRLENBQUMsQ0FBQztnQkFDMUMsQ0FBQztxQkFBTSxDQUFDO29CQUNOLE9BQU8sU0FBUyxDQUFDLE1BQU0sQ0FBQyxDQUFDO2dCQUMzQixDQUFDO1lBQ0gsQ0FBQztZQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7Z0JBQ3BCLE9BQU8sUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3pCLENBQUM7UUFDSCxDQUFDLENBQUM7UUFDRixPQUFPLFVBQVUsQ0FBQztJQUNwQixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsTUFBYSxhQUFjLFNBQVEsS0FBSztJQUl0QyxZQUFZLE9BQWUsRUFBRSxPQUFhLEVBQUUsYUFBcUI7UUFDL0QsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBQ2YsSUFBSSxDQUFDLElBQUksR0FBRyxlQUFlLENBQUM7UUFDNUIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUM7UUFFbkMsMEJBQTBCO1FBQzFCLElBQUksS0FBSyxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDNUIsS0FBSyxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRSxhQUFhLENBQUMsQ0FBQztRQUMvQyxDQUFDO1FBRUQsMERBQTBEO1FBQzFELElBQUksYUFBYSxJQUFJLGFBQWEsQ0FBQyxLQUFLLEVBQUUsQ0FBQztZQUN6QyxJQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLEdBQUcsa0JBQWtCLEdBQUcsYUFBYSxDQUFDLEtBQUssQ0FBQztRQUNyRSxDQUFDO1FBRUQsTUFBTSxDQUFDLGNBQWMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3ZELENBQUM7SUFFTyxvQkFBb0I7UUFDMUIsc0JBQXNCO1FBQ3RCLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBQ3RDLElBQUksQ0FBQyxLQUFLLElBQUksS0FBSyxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUM7UUFFNUMscUVBQXFFO1FBQ3JFLE1BQU0sZUFBZSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUVqQyxvREFBb0Q7UUFDcEQsTUFBTSxLQUFLLEdBQUcsZUFBZSxDQUFDLEtBQUssQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQ3ZELElBQUksS0FBSyxJQUFJLEtBQUssQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1lBQ3RCLE1BQU0sUUFBUSxHQUFHLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztZQUMxQixnREFBZ0Q7WUFDaEQsTUFBTSxZQUFZLEdBQUcsUUFBUSxDQUFDLFdBQVcsQ0FBQyxHQUFHLENBQUMsQ0FBQztZQUMvQyxPQUFPLFlBQVksS0FBSyxDQUFDLENBQUM7Z0JBQ3hCLENBQUMsQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUMsRUFBRSxZQUFZLENBQUM7Z0JBQ3JDLENBQUMsQ0FBQyxRQUFRLENBQUM7UUFDZixDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU0sTUFBTTtRQUNYLE9BQU87WUFDTCxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDZixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLGFBQWEsRUFBRSxJQUFJLENBQUMsb0JBQW9CLEVBQUU7WUFDMUMsS0FBSyxFQUFFLElBQUksQ0FBQyxLQUFLO1NBQ2xCLENBQUM7SUFDSixDQUFDO0lBRU0sUUFBUTtRQUNiLE9BQU8sSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQ2hELENBQUM7Q0FDRjtBQTFERCxzQ0EwREM7QUFFRDs7R0FFRztBQUNILE1BQXNCLFFBQVE7SUE2Q3JCLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxPQUFtQjtRQUNoRCxJQUFJLFNBQWlCLENBQUM7UUFDdEIsSUFBSSxDQUFDO1lBQ0gsU0FBUyxHQUFHLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxTQUFTLENBQUMsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxLQUFLLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7UUFDckUsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixzQkFBc0I7WUFDdEIsT0FBTyxDQUFDLEtBQUssQ0FBQyxzQkFBc0IsT0FBTyxDQUFDLFNBQVMsRUFBRSxFQUFFLE9BQU8sQ0FBQyxDQUFDO1lBQ2xFLFNBQVMsR0FBRyxjQUFjLENBQUM7UUFDN0IsQ0FBQztRQUVELElBQUksZ0JBQWdCLEdBQUcsSUFBSSxTQUFTLEtBQ2xDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsV0FBVyxFQUFFLElBQUksU0FDbEMsS0FBSyxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFFdkIsSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7WUFDcEIsZ0JBQWdCLElBQUksWUFBWSxDQUFDO1lBQ2pDLGdCQUFnQixJQUFJLGFBQWEsT0FBTyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUN4RCxnQkFBZ0IsSUFBSSxnQkFBZ0Isb0JBQW9CLENBQ3RELE9BQU8sQ0FBQyxPQUFPLENBQ2hCLEVBQUUsQ0FBQztRQUNOLENBQUM7UUFFRCxPQUFPLGdCQUFnQixDQUFDO0lBQzFCLENBQUM7SUFFUyxNQUFNLENBQUMsWUFBWSxDQUMzQixNQUFXLEVBQ1gsV0FBbUIsRUFDbkIsVUFBOEI7UUFFOUIsTUFBTSxjQUFjLEdBQUcsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUN4QyxVQUFVLENBQUMsS0FBSyxHQUFHLFVBQVUsR0FBRyxJQUFXO1lBQ3pDLElBQUksQ0FBQztnQkFDSCxNQUFNLE1BQU0sR0FBRyxjQUFjLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztnQkFDaEQsSUFBSSxNQUFNLFlBQVksT0FBTyxFQUFFLENBQUM7b0JBQzlCLE9BQU8sTUFBTSxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQVUsRUFBRSxFQUFFO3dCQUNqQyxJQUFJLElBQUksWUFBWSxRQUFRLEVBQUUsQ0FBQzs0QkFDN0IsTUFBTSxhQUFhLEdBQUcseUJBQVcsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUM7NEJBQ2xFLE9BQU8sSUFBSSxDQUFDLGdCQUFnQixDQUFDLEtBQUssRUFBRSxhQUFhLENBQUMsQ0FBQzt3QkFDckQsQ0FBQzs2QkFBTSxDQUFDOzRCQUNOLE9BQU8sQ0FBQyxJQUFJLENBQ1Ysc0RBQXNELE1BQU0sQ0FBQyxXQUFXLENBQUMsSUFBSSxFQUFFLENBQ2hGLENBQUM7NEJBQ0YsTUFBTSxLQUFLLENBQUM7d0JBQ2QsQ0FBQztvQkFDSCxDQUFDLENBQUMsQ0FBQztnQkFDTCxDQUFDO2dCQUNELE9BQU8sTUFBTSxDQUFDO1lBQ2hCLENBQUM7WUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO2dCQUNwQixJQUFJLElBQUksWUFBWSxRQUFRLEVBQUUsQ0FBQztvQkFDN0IsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQ3RDLENBQUM7cUJBQU0sQ0FBQztvQkFDTixPQUFPLENBQUMsSUFBSSxDQUNWLHNEQUFzRCxNQUFNLENBQUMsV0FBVyxDQUFDLElBQUksRUFBRSxDQUNoRixDQUFDO29CQUNGLE1BQU0sS0FBSyxDQUFDO2dCQUNkLENBQUM7WUFDSCxDQUFDO1FBQ0gsQ0FBQyxDQUFDO1FBQ0YsT0FBTyxVQUFVLENBQUM7SUFDcEIsQ0FBQztJQUVEOzs7T0FHRztJQUNIO1FBQ0UsSUFBSSxDQUFDLFFBQVEsQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUMzQixRQUFRLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDN0IsQ0FBQztJQUNILENBQUM7SUFFRDs7O09BR0c7SUFDSSxNQUFNLENBQUMsY0FBYyxDQUFDLFFBQXFCO1FBQ2hELFFBQVEsQ0FBQyxXQUFXLEdBQUcsUUFBUSxDQUFDO0lBQ2xDLENBQUM7SUFFRDs7O09BR0c7SUFDSSxNQUFNLENBQUMsZ0JBQWdCLENBQUMsUUFBb0M7UUFDakUsUUFBUSxDQUFDLGFBQWEsR0FBRyxRQUFRLENBQUM7SUFDcEMsQ0FBQztJQUVEOzs7T0FHRztJQUNJLE1BQU0sQ0FBQyxXQUFXLENBQUMsS0FBZTtRQUN2QyxRQUFRLENBQUMsUUFBUSxHQUFHLEtBQUssQ0FBQztJQUM1QixDQUFDO0lBRU8sS0FBSyxDQUFDLGdCQUFnQixDQUFDLEtBQVUsRUFBRSxPQUFZLEVBQUU7UUFDdkQsTUFBTSxVQUFVLEdBQ2IsSUFBSSxDQUFDLFdBQStCLENBQUMsYUFBYTtZQUNuRCxRQUFRLENBQUMsb0JBQW9CLENBQUM7UUFFaEMsSUFBSSxhQUE0QixDQUFDO1FBRWpDLElBQUksS0FBSyxZQUFZLFVBQVUsRUFBRSxDQUFDO1lBQ2hDLGFBQWEsR0FBRyxLQUFLLENBQUM7UUFDeEIsQ0FBQzthQUFNLENBQUM7WUFDTixhQUFhLEdBQUcsSUFBSSxVQUFVLENBQzVCLEtBQUssQ0FBQyxPQUFPLEVBQ2IsRUFBRSxZQUFZLEVBQUUsSUFBSSxFQUFFLEVBQ3RCLEtBQUssQ0FDTixDQUFDO1lBRUYsb0NBQW9DO1lBQ3BDLElBQUksS0FBSyxZQUFZLEtBQUssSUFBSSxLQUFLLENBQUMsS0FBSyxFQUFFLENBQUM7Z0JBQzFDLGFBQWEsQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDLEtBQUssQ0FBQztZQUNwQyxDQUFDO1FBQ0gsQ0FBQztRQUVELDZFQUE2RTtRQUM3RSxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztRQUM1QyxNQUFNLFNBQVMsR0FBRztZQUNoQixHQUFHLGFBQWEsQ0FBQyxNQUFNLEVBQUU7WUFDekIsYUFBYTtTQUNkLENBQUM7UUFFRixJQUFJLENBQUMsS0FBSyxDQUFDLGFBQWEsQ0FBQyxPQUFPLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDN0MsTUFBTSxRQUFRLENBQUMsaUJBQWlCLEVBQUUsQ0FBQyxDQUFDLDRDQUE0QztRQUNoRixNQUFNLGFBQWEsQ0FBQztJQUN0QixDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssTUFBTSxDQUFDLGlCQUFpQjtRQUM5QixPQUFPLElBQUksT0FBTyxDQUFPLENBQUMsT0FBTyxFQUFFLEVBQUU7WUFDbkMsTUFBTSxVQUFVLEdBQUcsR0FBRyxFQUFFO2dCQUN0QixJQUNFLENBQUMsUUFBUSxDQUFDLFlBQVk7b0JBQ3RCLFFBQVEsQ0FBQyxhQUFhLENBQUMsT0FBTyxFQUFFLEtBQUssU0FBUyxFQUM5QyxDQUFDO29CQUNELE9BQU8sRUFBRSxDQUFDO2dCQUNaLENBQUM7cUJBQU0sQ0FBQztvQkFDTixJQUFBLG1CQUFVLEVBQUMsVUFBVSxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsMEJBQTBCO2dCQUN6RCxDQUFDO1lBQ0gsQ0FBQyxDQUFDO1lBQ0YsVUFBVSxFQUFFLENBQUM7UUFDZixDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksTUFBTSxDQUFDLFNBQVMsQ0FBQyxZQUFzQjtRQUM1QyxPQUFPLFlBQVksSUFBSSxRQUFRLENBQUMsUUFBUSxDQUFDO0lBQzNDLENBQUM7SUFFRDs7OztPQUlHO0lBQ0ksS0FBSyxDQUFDLGtCQUFrQixDQUFJLEtBQVE7UUFDekMsTUFBTSxRQUFRLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztRQUNuQyxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRDs7Ozs7OztPQU9HO0lBQ0ssTUFBTSxDQUFDLGdCQUFnQixDQUM3QixLQUFhLEVBQ2IsT0FBZSxFQUNmLE9BQXlCLEVBQ3pCLFNBQWtCO1FBRWxCLE1BQU0sZUFBZSxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsR0FBRyxTQUFTLEtBQUssT0FBTyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQztRQUN6RSxNQUFNLFVBQVUsR0FBMkIsT0FBTztZQUNoRCxDQUFDLENBQUM7Z0JBQ0UsSUFBSSxFQUFFLE9BQU8sT0FBTyxLQUFLLFFBQVEsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxNQUFNO2dCQUNuRCxPQUFPLEVBQUUsT0FBTzthQUNqQjtZQUNILENBQUMsQ0FBQyxTQUFTLENBQUM7UUFFZCxPQUFPO1lBQ0wsU0FBUyxFQUFFLElBQUksSUFBSSxFQUFFLENBQUMsV0FBVyxFQUFFO1lBQ25DLEtBQUs7WUFDTCxPQUFPLEVBQUUsZUFBZTtZQUN4QixPQUFPLEVBQUUsVUFBVTtZQUNuQixNQUFNLEVBQUUsU0FBUyxJQUFJLFVBQVU7U0FDaEMsQ0FBQztJQUNKLENBQUM7SUFFTyxNQUFNLENBQUMsWUFBWSxDQUN6QixLQUFlLEVBQ2YsT0FBZSxFQUNmLE9BQXlCLEVBQ3pCLFNBQWtCO1FBRWxCLElBQUksUUFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDO1lBQzlCLE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FDMUMsc0JBQVEsQ0FBQyxLQUFLLENBQUMsRUFDZixPQUFPLEVBQ1AsT0FBTyxFQUNQLFNBQVMsQ0FDVixDQUFDO1lBQ0YsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDN0MsQ0FBQztJQUNILENBQUM7SUFFTSxNQUFNLENBQUMsUUFBUSxDQUNwQixPQUFlLEVBQ2YsT0FBeUIsRUFDekIsU0FBa0I7UUFFbEIsUUFBUSxDQUFDLFlBQVksQ0FBQyxzQkFBUSxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7SUFFTSxNQUFNLENBQUMsUUFBUSxDQUNwQixPQUFlLEVBQ2YsT0FBeUIsRUFDekIsU0FBa0I7UUFFbEIsUUFBUSxDQUFDLFlBQVksQ0FBQyxzQkFBUSxDQUFDLEtBQUssRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLFNBQVMsQ0FBQyxDQUFDO0lBQ3JFLENBQUM7SUFFRDs7OztPQUlHO0lBQ08sS0FBSyxDQUFDLE9BQWUsRUFBRSxPQUF5QjtRQUN4RCxRQUFRLENBQUMsUUFBUSxDQUFDLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUM3RCxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNPLElBQUksQ0FBQyxPQUFlLEVBQUUsT0FBeUI7UUFDdkQsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLHNCQUFRLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQztZQUN0QyxNQUFNLFVBQVUsR0FBRyxRQUFRLENBQUMsZ0JBQWdCLENBQzFDLE1BQU0sRUFDTixPQUFPLEVBQ1AsT0FBTyxFQUNQLElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUN0QixDQUFDO1lBQ0YsUUFBUSxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUMsVUFBVSxDQUFDLENBQUM7UUFDN0MsQ0FBQztJQUNILENBQUM7SUFFRDs7OztPQUlHO0lBQ08sSUFBSSxDQUFDLE9BQWUsRUFBRSxPQUF5QjtRQUN2RCxJQUFJLFFBQVEsQ0FBQyxTQUFTLENBQUMsc0JBQVEsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO1lBQ3RDLE1BQU0sVUFBVSxHQUFHLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FDMUMsTUFBTSxFQUNOLE9BQU8sRUFDUCxPQUFPLEVBQ1AsSUFBSSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQ3RCLENBQUM7WUFDRixRQUFRLENBQUMsYUFBYSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUM3QyxDQUFDO0lBQ0gsQ0FBQztJQUVEOzs7O09BSUc7SUFDTyxLQUFLLENBQ2IsY0FBc0MsRUFDdEMsT0FBeUI7UUFFekIsSUFBSSxRQUFRLENBQUMsU0FBUyxDQUFDLHNCQUFRLENBQUMsS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUN2QyxJQUFJLE9BQWUsQ0FBQztZQUNwQixJQUFJLFlBQWdDLENBQUM7WUFFckMsSUFBSSxjQUFjLFlBQVksYUFBYSxFQUFFLENBQUM7Z0JBQzVDLE9BQU8sR0FBRyxjQUFjLENBQUMsT0FBTyxDQUFDO2dCQUNqQyxZQUFZLEdBQUcsY0FBYyxDQUFDLE1BQU0sRUFBRSxDQUFDO1lBQ3pDLENBQUM7aUJBQU0sQ0FBQztnQkFDTixPQUFPLEdBQUcsY0FBYyxDQUFDO2dCQUN6QixZQUFZLEdBQUcsT0FBTyxPQUFPLEtBQUssUUFBUSxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLFNBQVMsQ0FBQztZQUNuRSxDQUFDO1lBRUQsTUFBTSxVQUFVLEdBQUcsUUFBUSxDQUFDLGdCQUFnQixDQUMxQyxPQUFPLEVBQ1AsT0FBTyxFQUNQLFlBQVksRUFDWixJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FDdEIsQ0FBQztZQUNGLFFBQVEsQ0FBQyxhQUFhLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxDQUFDO1FBQzdDLENBQUM7SUFDSCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0ssTUFBTSxDQUFDLEtBQUssQ0FBQyxZQUFZO1FBQy9CLElBQUksUUFBUSxDQUFDLFlBQVk7WUFBRSxPQUFPO1FBRWxDLFFBQVEsQ0FBQyxZQUFZLEdBQUcsSUFBSSxDQUFDO1FBQzdCLE9BQU8sSUFBSSxFQUFFLENBQUM7WUFDWixNQUFNLE9BQU8sR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxDQUFDO1lBQ2pELElBQUksQ0FBQyxPQUFPO2dCQUFFLE1BQU07WUFFcEIsSUFBSSxDQUFDO2dCQUNILE1BQU0sUUFBUSxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDM0MsQ0FBQztZQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7Z0JBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx5QkFBeUIsRUFBRSxLQUFLLENBQUMsQ0FBQztnQkFDaEQsNkRBQTZEO1lBQy9ELENBQUM7UUFDSCxDQUFDO1FBQ0QsUUFBUSxDQUFDLFlBQVksR0FBRyxLQUFLLENBQUM7SUFDaEMsQ0FBQztJQUVEOztPQUVHO0lBQ0ssTUFBTSxDQUFDLGVBQWU7UUFDNUIsTUFBTSxrQkFBa0IsR0FBRyxHQUFHLEVBQUU7WUFDOUIsUUFBUSxDQUFDLGlCQUFpQixHQUFHLElBQUEsbUJBQVUsRUFBQyxHQUFHLEVBQUU7Z0JBQzNDLFFBQVEsQ0FBQyxZQUFZLEVBQUUsQ0FBQyxPQUFPLENBQUMsR0FBRyxFQUFFO29CQUNuQyxrQkFBa0IsRUFBRSxDQUFDO2dCQUN2QixDQUFDLENBQUMsQ0FBQztZQUNMLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLDhCQUE4QjtRQUN6QyxDQUFDLENBQUM7UUFFRixrQkFBa0IsRUFBRSxDQUFDO0lBQ3ZCLENBQUM7SUFFRDs7T0FFRztJQUNJLE1BQU0sQ0FBQyxLQUFLLENBQUMsUUFBUTtRQUMxQixJQUFJLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1lBQy9CLElBQUEscUJBQVksRUFBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUN6QyxNQUFNLFFBQVEsQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQ3JDLENBQUM7SUFDSCxDQUFDOztBQTdZSCw0QkE4WUM7QUE1WWdCLHNCQUFhLEdBQzFCLElBQUksNkNBQXFCLEVBQWMsQ0FBQztBQUMzQixpQkFBUSxHQUFhLHNCQUFRLENBQUMsSUFBSSxDQUFDO0FBQ25DLHFCQUFZLEdBQVksS0FBSyxDQUFDO0FBQzlCLDBCQUFpQixHQUEwQixJQUFJLENBQUM7QUFDeEQsaUJBQVEsR0FBRyxzQkFBUSxDQUFDO0FBQ1Ysc0JBQWEsR0FBRyxhQUFhLENBQUM7QUFDOUIsNkJBQW9CLEdBQUcsS0FBTSxTQUFRLEtBQUs7SUFJekQsWUFBWSxPQUFlLEVBQUUsT0FBYSxFQUFFLGFBQXFCO1FBQy9ELEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNmLElBQUksQ0FBQyxJQUFJLEdBQUcsc0JBQXNCLENBQUM7UUFDbkMsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUM7UUFFbkMsSUFBSSxLQUFLLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztZQUM1QixLQUFLLENBQUMsaUJBQWlCLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUNsRCxDQUFDO1FBRUQsSUFBSSxhQUFhLElBQUksYUFBYSxDQUFDLEtBQUssRUFBRSxDQUFDO1lBQ3pDLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLEtBQUssR0FBRyxrQkFBa0IsR0FBRyxhQUFhLENBQUMsS0FBSyxDQUFDO1FBQ3JFLENBQUM7SUFDSCxDQUFDO0lBRU0sTUFBTTtRQUNYLE9BQU87WUFDTCxJQUFJLEVBQUUsSUFBSSxDQUFDLElBQUk7WUFDZixPQUFPLEVBQUUsSUFBSSxDQUFDLE9BQU87WUFDckIsT0FBTyxFQUFFLElBQUksQ0FBQyxPQUFPO1lBQ3JCLEtBQUssRUFBRSxJQUFJLENBQUMsS0FBSztZQUNqQixhQUFhLEVBQUUsSUFBSSxDQUFDLGFBQWE7Z0JBQy9CLENBQUMsQ0FBQztvQkFDRSxJQUFJLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJO29CQUM3QixPQUFPLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxPQUFPO29CQUNuQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxLQUFLO2lCQUNoQztnQkFDSCxDQUFDLENBQUMsU0FBUztTQUNkLENBQUM7SUFDSixDQUFDO0NBQ0YsQ0FBQztBQXFXSixTQUFTLG9CQUFvQixDQUFDLE9BQW1CO0lBQy9DLE1BQU0sZ0JBQWdCLEdBQUcseUJBQVcsQ0FBQyxvQkFBb0IsQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUM7SUFFM0UsSUFBSSxPQUFPLENBQUMsSUFBSSxLQUFLLE1BQU0sRUFBRSxDQUFDO1FBQzVCLE9BQU8sZ0JBQTBCLENBQUM7SUFDcEMsQ0FBQztJQUVELE9BQU8sY0FBSSxDQUFDLE9BQU8sQ0FBQyxnQkFBZ0IsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7QUFDdkUsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElRdWV1ZVN0cmF0ZWd5IH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IExvZ1N0cmF0ZWd5IH0gZnJvbSBcIi4vTG9nU3RyYXRlZ3lcIjtcbmltcG9ydCB7IEluTWVtb3J5UXVldWVTdHJhdGVneSB9IGZyb20gXCIuLi9jb3JlL0luTWVtb3J5UXVldWVTdHJhdGVneVwiO1xuaW1wb3J0IHsgTG9nTGV2ZWwsIExvZ01lc3NhZ2UsIExvZ1BheWxvYWQgfSBmcm9tIFwiLi9Mb2dTdHJhdGVneVwiO1xuaW1wb3J0IHV0aWwgZnJvbSBcInV0aWxcIjtcblxuLyoqXG4gKiBAZmlsZW92ZXJ2aWV3IFRoaXMgbW9kdWxlIHByb3ZpZGVzIGEgbG9nZ2luZyBzeXN0ZW0gd2l0aCBkaWZmZXJlbnQgbG9nIGxldmVscyxcbiAqIG5vdGlmaWNhdGlvbiBzdHJhdGVnaWVzLCBhbmQgcXVldWUgc3RyYXRlZ2llcy5cbiAqL1xuXG5pbXBvcnQgeyBzZXRUaW1lb3V0LCBjbGVhclRpbWVvdXQgfSBmcm9tIFwidGltZXJzXCI7XG5cbi8qKlxuICogRW51bSByZXByZXNlbnRpbmcgZGlmZmVyZW50IGxvZyBsZXZlbHMuXG4gKi9cblxuZnVuY3Rpb24gbG9nTWV0aG9kKCkge1xuICByZXR1cm4gZnVuY3Rpb24gKFxuICAgIHRhcmdldDogYW55LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcsXG4gICAgZGVzY3JpcHRvcjogUHJvcGVydHlEZXNjcmlwdG9yXG4gICkge1xuICAgIGNvbnN0IG9yaWdpbmFsTWV0aG9kID0gZGVzY3JpcHRvci52YWx1ZTtcbiAgICBkZXNjcmlwdG9yLnZhbHVlID0gZnVuY3Rpb24gKC4uLmFyZ3M6IGFueVtdKSB7XG4gICAgICBjb25zdCBjbGFzc05hbWUgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgICBjb25zdCB0cnVuY2F0ZWRBcmdzID0gTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkoYXJncyk7XG5cbiAgICAgIGNvbnN0IGxvZ1Jlc3VsdCA9IChyZXN1bHQ6IGFueSkgPT4ge1xuICAgICAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLkRFQlVHKSkge1xuICAgICAgICAgIGNvbnN0IHRydW5jYXRlZFJlc3VsdCA9IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KHJlc3VsdCk7XG4gICAgICAgICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgICAgICAgIGFyZ3M6IHRydW5jYXRlZEFyZ3MsXG4gICAgICAgICAgICByZXN1bHQ6IHRydW5jYXRlZFJlc3VsdCxcbiAgICAgICAgICB9O1xuICAgICAgICAgIExvZ2dhYmxlLmxvZ0RlYnVnKFxuICAgICAgICAgICAgYExvZ01ldGhvZERlY29yYXRvcjo6JHtjbGFzc05hbWV9Ojoke3Byb3BlcnR5S2V5fWAsXG4gICAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgICAgY2xhc3NOYW1lXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfTtcblxuICAgICAgY29uc3QgbG9nRXJyb3IgPSAoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICBjb25zdCBlcnJvck1lc3NhZ2UgPSBgJHtjbGFzc05hbWV9Ojoke3Byb3BlcnR5S2V5fSByZXN1bHRlZCBpbiBlcnJvcmA7XG4gICAgICAgIGNvbnN0IHRydW5jYXRlZEVycm9yID1cbiAgICAgICAgICBlcnJvciBpbnN0YW5jZW9mIExvZ2dhYmxlRXJyb3JcbiAgICAgICAgICAgID8gZXJyb3IudG9KU09OKClcbiAgICAgICAgICAgIDogTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkoZXJyb3IubWVzc2FnZSB8fCBlcnJvcik7XG5cbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IHtcbiAgICAgICAgICBhcmdzOiB0cnVuY2F0ZWRBcmdzLFxuICAgICAgICAgIGVycm9yOiB0cnVuY2F0ZWRFcnJvcixcbiAgICAgICAgfTtcbiAgICAgICAgTG9nZ2FibGUubG9nRXJyb3IoXG4gICAgICAgICAgYExvZ01ldGhvZERlY29yYXRvcjo6JHtlcnJvck1lc3NhZ2V9YCxcbiAgICAgICAgICBtZXNzYWdlLFxuICAgICAgICAgIGNsYXNzTmFtZVxuICAgICAgICApO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpO1xuXG4gICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC50aGVuKGxvZ1Jlc3VsdCwgbG9nRXJyb3IpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBsb2dSZXN1bHQocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICByZXR1cm4gbG9nRXJyb3IoZXJyb3IpO1xuICAgICAgfVxuICAgIH07XG4gICAgcmV0dXJuIGRlc2NyaXB0b3I7XG4gIH07XG59XG5cbmV4cG9ydCBjbGFzcyBMb2dnYWJsZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBwdWJsaWMgcmVhZG9ubHkgcGF5bG9hZDogYW55O1xuICBwdWJsaWMgcmVhZG9ubHkgb3JpZ2luYWxFcnJvcjogRXJyb3IgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogYW55LCBvcmlnaW5hbEVycm9yPzogRXJyb3IpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSBcIkxvZ2dhYmxlRXJyb3JcIjtcbiAgICB0aGlzLnBheWxvYWQgPSBwYXlsb2FkO1xuICAgIHRoaXMub3JpZ2luYWxFcnJvciA9IG9yaWdpbmFsRXJyb3I7XG5cbiAgICAvLyBDYXB0dXJlIHRoZSBzdGFjayB0cmFjZVxuICAgIGlmIChFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSkge1xuICAgICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgTG9nZ2FibGVFcnJvcik7XG4gICAgfVxuXG4gICAgLy8gQXBwZW5kIHRoZSBvcmlnaW5hbCBlcnJvcidzIHN0YWNrIHRvIHRoaXMgZXJyb3IncyBzdGFja1xuICAgIGlmIChvcmlnaW5hbEVycm9yICYmIG9yaWdpbmFsRXJyb3Iuc3RhY2spIHtcbiAgICAgIHRoaXMuc3RhY2sgPSB0aGlzLnN0YWNrICsgXCJcXG5cXG5DYXVzZWQgYnk6XFxuXCIgKyBvcmlnaW5hbEVycm9yLnN0YWNrO1xuICAgIH1cblxuICAgIE9iamVjdC5zZXRQcm90b3R5cGVPZih0aGlzLCBMb2dnYWJsZUVycm9yLnByb3RvdHlwZSk7XG4gIH1cblxuICBwcml2YXRlIGdldFRocm93aW5nQ2xhc3NOYW1lKCk6IHN0cmluZyB8IG51bGwge1xuICAgIC8vIEdldCB0aGUgc3RhY2sgdHJhY2VcbiAgICBjb25zdCBzdGFjayA9IHRoaXMuc3RhY2s/LnNwbGl0KFwiXFxuXCIpO1xuICAgIGlmICghc3RhY2sgfHwgc3RhY2subGVuZ3RoIDwgNCkgcmV0dXJuIG51bGw7XG5cbiAgICAvLyBUaGUgY29uc3RydWN0b3IgY2FsbCB3aWxsIGJlIHRoZSB0aGlyZCBsaW5lIGluIHRoZSBzdGFjayAoaW5kZXggMilcbiAgICBjb25zdCBjb25zdHJ1Y3RvckNhbGwgPSBzdGFja1syXTtcblxuICAgIC8vIEV4dHJhY3QgdGhlIGNsYXNzIG5hbWUgdXNpbmcgYSByZWd1bGFyIGV4cHJlc3Npb25cbiAgICBjb25zdCBtYXRjaCA9IGNvbnN0cnVjdG9yQ2FsbC5tYXRjaCgvYXRcXHMrKC4qPylcXHMrXFwoLyk7XG4gICAgaWYgKG1hdGNoICYmIG1hdGNoWzFdKSB7XG4gICAgICBjb25zdCBmdWxsTmFtZSA9IG1hdGNoWzFdO1xuICAgICAgLy8gSWYgaXQncyBhIG1ldGhvZCBjYWxsLCBleHRyYWN0IHRoZSBjbGFzcyBuYW1lXG4gICAgICBjb25zdCBsYXN0RG90SW5kZXggPSBmdWxsTmFtZS5sYXN0SW5kZXhPZihcIi5cIik7XG4gICAgICByZXR1cm4gbGFzdERvdEluZGV4ICE9PSAtMVxuICAgICAgICA/IGZ1bGxOYW1lLnN1YnN0cmluZygwLCBsYXN0RG90SW5kZXgpXG4gICAgICAgIDogZnVsbE5hbWU7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwdWJsaWMgdG9KU09OKCkge1xuICAgIHJldHVybiB7XG4gICAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgICBtZXNzYWdlOiB0aGlzLm1lc3NhZ2UsXG4gICAgICBwYXlsb2FkOiB0aGlzLnBheWxvYWQsXG4gICAgICB0aHJvd2luZ0NsYXNzOiB0aGlzLmdldFRocm93aW5nQ2xhc3NOYW1lKCksXG4gICAgICBzdGFjazogdGhpcy5zdGFjayxcbiAgICB9O1xuICB9XG5cbiAgcHVibGljIHRvU3RyaW5nKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KHRoaXMudG9KU09OKCksIG51bGwsIDIpO1xuICB9XG59XG5cbi8qKlxuICogQWJzdHJhY3QgYmFzZSBjbGFzcyBmb3Igb2JqZWN0cyB0aGF0IGNhbiBsb2cgbWVzc2FnZXMuXG4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBMb2dnYWJsZSB7XG4gIHB1YmxpYyBzdGF0aWMgbG9nU3RyYXRlZ3k6IExvZ1N0cmF0ZWd5O1xuICBwcml2YXRlIHN0YXRpYyBxdWV1ZVN0cmF0ZWd5OiBJUXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPiA9XG4gICAgbmV3IEluTWVtb3J5UXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPigpO1xuICBwcml2YXRlIHN0YXRpYyBsb2dMZXZlbDogTG9nTGV2ZWwgPSBMb2dMZXZlbC5JTkZPO1xuICBwcml2YXRlIHN0YXRpYyBpc1Byb2Nlc3Npbmc6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBzdGF0aWMgcHJvY2Vzc2luZ1RpbWVvdXQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHN0YXRpYyBMb2dMZXZlbCA9IExvZ0xldmVsO1xuICBwcm90ZWN0ZWQgc3RhdGljIExvZ2dhYmxlRXJyb3IgPSBMb2dnYWJsZUVycm9yO1xuICBwcm90ZWN0ZWQgc3RhdGljIERlZmF1bHRMb2dnYWJsZUVycm9yID0gY2xhc3MgZXh0ZW5kcyBFcnJvciB7XG4gICAgcHVibGljIHJlYWRvbmx5IHBheWxvYWQ6IGFueTtcbiAgICBwdWJsaWMgcmVhZG9ubHkgb3JpZ2luYWxFcnJvcjogRXJyb3IgfCB1bmRlZmluZWQ7XG5cbiAgICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBhbnksIG9yaWdpbmFsRXJyb3I/OiBFcnJvcikge1xuICAgICAgc3VwZXIobWVzc2FnZSk7XG4gICAgICB0aGlzLm5hbWUgPSBcIkRlZmF1bHRMb2dnYWJsZUVycm9yXCI7XG4gICAgICB0aGlzLnBheWxvYWQgPSBwYXlsb2FkO1xuICAgICAgdGhpcy5vcmlnaW5hbEVycm9yID0gb3JpZ2luYWxFcnJvcjtcblxuICAgICAgaWYgKEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKSB7XG4gICAgICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIHRoaXMuY29uc3RydWN0b3IpO1xuICAgICAgfVxuXG4gICAgICBpZiAob3JpZ2luYWxFcnJvciAmJiBvcmlnaW5hbEVycm9yLnN0YWNrKSB7XG4gICAgICAgIHRoaXMuc3RhY2sgPSB0aGlzLnN0YWNrICsgXCJcXG5cXG5DYXVzZWQgYnk6XFxuXCIgKyBvcmlnaW5hbEVycm9yLnN0YWNrO1xuICAgICAgfVxuICAgIH1cblxuICAgIHB1YmxpYyB0b0pTT04oKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBuYW1lOiB0aGlzLm5hbWUsXG4gICAgICAgIG1lc3NhZ2U6IHRoaXMubWVzc2FnZSxcbiAgICAgICAgcGF5bG9hZDogdGhpcy5wYXlsb2FkLFxuICAgICAgICBzdGFjazogdGhpcy5zdGFjayxcbiAgICAgICAgb3JpZ2luYWxFcnJvcjogdGhpcy5vcmlnaW5hbEVycm9yXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIG5hbWU6IHRoaXMub3JpZ2luYWxFcnJvci5uYW1lLFxuICAgICAgICAgICAgICBtZXNzYWdlOiB0aGlzLm9yaWdpbmFsRXJyb3IubWVzc2FnZSxcbiAgICAgICAgICAgICAgc3RhY2s6IHRoaXMub3JpZ2luYWxFcnJvci5zdGFjayxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfVxuICB9O1xuXG4gIHB1YmxpYyBzdGF0aWMgRm9ybWF0TG9nTWVzc2FnZShtZXNzYWdlOiBMb2dNZXNzYWdlKTogc3RyaW5nIHtcbiAgICBsZXQgdGltZXN0YW1wOiBzdHJpbmc7XG4gICAgdHJ5IHtcbiAgICAgIHRpbWVzdGFtcCA9IG5ldyBEYXRlKG1lc3NhZ2UudGltZXN0YW1wKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIC01KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgLy8gSGFuZGxlIGludmFsaWQgZGF0ZVxuICAgICAgY29uc29sZS5lcnJvcihgSW52YWxpZCB0aW1lc3RhbXA6ICR7bWVzc2FnZS50aW1lc3RhbXB9YCwgbWVzc2FnZSk7XG4gICAgICB0aW1lc3RhbXAgPSBcIkludmFsaWQgRGF0ZVwiO1xuICAgIH1cblxuICAgIGxldCBmb3JtYXR0ZWRNZXNzYWdlID0gYFske3RpbWVzdGFtcH1dICR7XG4gICAgICBtZXNzYWdlLmxldmVsPy50b1VwcGVyQ2FzZSgpID8/IFwiVU5LTk9XTlwiXG4gICAgfTogJHttZXNzYWdlLm1lc3NhZ2V9YDtcblxuICAgIGlmIChtZXNzYWdlLnBheWxvYWQpIHtcbiAgICAgIGZvcm1hdHRlZE1lc3NhZ2UgKz0gXCJcXG5QYXlsb2FkOlwiO1xuICAgICAgZm9ybWF0dGVkTWVzc2FnZSArPSBgXFxuICBUeXBlOiAke21lc3NhZ2UucGF5bG9hZC50eXBlfWA7XG4gICAgICBmb3JtYXR0ZWRNZXNzYWdlICs9IGBcXG4gIENvbnRlbnQ6ICR7Zm9ybWF0UGF5bG9hZENvbnRlbnQoXG4gICAgICAgIG1lc3NhZ2UucGF5bG9hZFxuICAgICAgKX1gO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JtYXR0ZWRNZXNzYWdlO1xuICB9XG5cbiAgcHJvdGVjdGVkIHN0YXRpYyBoYW5kbGVFcnJvcnMoXG4gICAgdGFyZ2V0OiBhbnksXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyxcbiAgICBkZXNjcmlwdG9yOiBQcm9wZXJ0eURlc2NyaXB0b3JcbiAgKSB7XG4gICAgY29uc3Qgb3JpZ2luYWxNZXRob2QgPSBkZXNjcmlwdG9yLnZhbHVlO1xuICAgIGRlc2NyaXB0b3IudmFsdWUgPSBmdW5jdGlvbiAoLi4uYXJnczogYW55W10pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IG9yaWdpbmFsTWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQuY2F0Y2goKGVycm9yOiBhbnkpID0+IHtcbiAgICAgICAgICAgIGlmICh0aGlzIGluc3RhbmNlb2YgTG9nZ2FibGUpIHtcbiAgICAgICAgICAgICAgY29uc3QgdHJ1bmNhdGVkQXJncyA9IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KGFyZ3MsIDMwMCk7XG4gICAgICAgICAgICAgIHJldHVybiB0aGlzLmxvZ0FuZFRocm93RXJyb3IoZXJyb3IsIHRydW5jYXRlZEFyZ3MpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgICAgICAgIGBoYW5kbGVFcnJvcnMgZGVjb3JhdG9yIHVzZWQgb24gbm9uLUxvZ2dhYmxlIGNsYXNzOiAke3RhcmdldC5jb25zdHJ1Y3Rvci5uYW1lfWBcbiAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBMb2dnYWJsZSkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmxvZ0FuZFRocm93RXJyb3IoZXJyb3IpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnNvbGUud2FybihcbiAgICAgICAgICAgIGBoYW5kbGVFcnJvcnMgZGVjb3JhdG9yIHVzZWQgb24gbm9uLUxvZ2dhYmxlIGNsYXNzOiAke3RhcmdldC5jb25zdHJ1Y3Rvci5uYW1lfWBcbiAgICAgICAgICApO1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcbiAgICByZXR1cm4gZGVzY3JpcHRvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm90ZWN0ZWQgY29uc3RydWN0b3IgdG8gZW5zdXJlIHRoZSBjbGFzcyBpcyBwcm9wZXJseSBpbml0aWFsaXplZC5cbiAgICogQHRocm93cyB7RXJyb3J9IElmIHRoZSBjbGFzcyBpcyBub3QgaW5pdGlhbGl6ZWQuXG4gICAqL1xuICBwcm90ZWN0ZWQgY29uc3RydWN0b3IoKSB7XG4gICAgaWYgKCFMb2dnYWJsZS5pc1Byb2Nlc3NpbmcpIHtcbiAgICAgIExvZ2dhYmxlLnN0YXJ0UHJvY2Vzc2luZygpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBsb2cgc3RyYXRlZ3kuXG4gICAqIEBwYXJhbSB7TG9nU3RyYXRlZ3l9IHN0cmF0ZWd5IC0gVGhlIG5ldyBsb2cgc3RyYXRlZ3kgdG8gdXNlLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBzZXRMb2dTdHJhdGVneShzdHJhdGVneTogTG9nU3RyYXRlZ3kpOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5sb2dTdHJhdGVneSA9IHN0cmF0ZWd5O1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIHF1ZXVlIHN0cmF0ZWd5LlxuICAgKiBAcGFyYW0ge0lRdWV1ZVN0cmF0ZWd5PExvZ01lc3NhZ2U+fSBzdHJhdGVneSAtIFRoZSBuZXcgcXVldWUgc3RyYXRlZ3kgdG8gdXNlLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBzZXRRdWV1ZVN0cmF0ZWd5KHN0cmF0ZWd5OiBJUXVldWVTdHJhdGVneTxMb2dNZXNzYWdlPik6IHZvaWQge1xuICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kgPSBzdHJhdGVneTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBsb2cgbGV2ZWwuXG4gICAqIEBwYXJhbSB7TG9nTGV2ZWx9IGxldmVsIC0gVGhlIG5ldyBsb2cgbGV2ZWwgdG8gdXNlLlxuICAgKi9cbiAgcHVibGljIHN0YXRpYyBzZXRMb2dMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiB2b2lkIHtcbiAgICBMb2dnYWJsZS5sb2dMZXZlbCA9IGxldmVsO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBsb2dBbmRUaHJvd0Vycm9yKGVycm9yOiBhbnksIGFyZ3M6IGFueSA9IHt9KTogUHJvbWlzZTxuZXZlcj4ge1xuICAgIGNvbnN0IEVycm9yQ2xhc3MgPVxuICAgICAgKHRoaXMuY29uc3RydWN0b3IgYXMgdHlwZW9mIExvZ2dhYmxlKS5Mb2dnYWJsZUVycm9yIHx8XG4gICAgICBMb2dnYWJsZS5EZWZhdWx0TG9nZ2FibGVFcnJvcjtcblxuICAgIGxldCBsb2dnYWJsZUVycm9yOiBMb2dnYWJsZUVycm9yO1xuXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3JDbGFzcykge1xuICAgICAgbG9nZ2FibGVFcnJvciA9IGVycm9yO1xuICAgIH0gZWxzZSB7XG4gICAgICBsb2dnYWJsZUVycm9yID0gbmV3IEVycm9yQ2xhc3MoXG4gICAgICAgIGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIHsgb3JpZ2luYWxBcmdzOiBhcmdzIH0sXG4gICAgICAgIGVycm9yXG4gICAgICApO1xuXG4gICAgICAvLyBQcmVzZXJ2ZSB0aGUgb3JpZ2luYWwgc3RhY2sgdHJhY2VcbiAgICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIEVycm9yICYmIGVycm9yLnN0YWNrKSB7XG4gICAgICAgIGxvZ2dhYmxlRXJyb3Iuc3RhY2sgPSBlcnJvci5zdGFjaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBBZGQgdGhyb3dpbmcgY2xhc3MgaW5mb3JtYXRpb24gd2l0aG91dCBtb2RpZnlpbmcgdGhlIGVycm9yIG9iamVjdCBkaXJlY3RseVxuICAgIGNvbnN0IHRocm93aW5nQ2xhc3MgPSB0aGlzLmNvbnN0cnVjdG9yLm5hbWU7XG4gICAgY29uc3QgZXJyb3JJbmZvID0ge1xuICAgICAgLi4ubG9nZ2FibGVFcnJvci50b0pTT04oKSxcbiAgICAgIHRocm93aW5nQ2xhc3MsXG4gICAgfTtcblxuICAgIHRoaXMuZXJyb3IobG9nZ2FibGVFcnJvci5tZXNzYWdlLCBlcnJvckluZm8pO1xuICAgIGF3YWl0IExvZ2dhYmxlLndhaXRGb3JFbXB0eVF1ZXVlKCk7IC8vIEVuc3VyZSB0aGUgcXVldWUgaXMgZW1wdHkgYmVmb3JlIHRocm93aW5nXG4gICAgdGhyb3cgbG9nZ2FibGVFcnJvcjtcbiAgfVxuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgdGhlIHF1ZXVlIHRvIGJlIGVtcHR5LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gQSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiB0aGUgcXVldWUgaXMgZW1wdHkuXG4gICAqL1xuICBwcml2YXRlIHN0YXRpYyB3YWl0Rm9yRW1wdHlRdWV1ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2U8dm9pZD4oKHJlc29sdmUpID0+IHtcbiAgICAgIGNvbnN0IGNoZWNrUXVldWUgPSAoKSA9PiB7XG4gICAgICAgIGlmIChcbiAgICAgICAgICAhTG9nZ2FibGUuaXNQcm9jZXNzaW5nICYmXG4gICAgICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5kZXF1ZXVlKCkgPT09IHVuZGVmaW5lZFxuICAgICAgICApIHtcbiAgICAgICAgICByZXNvbHZlKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgc2V0VGltZW91dChjaGVja1F1ZXVlLCAxMDApOyAvLyBDaGVjayBhZ2FpbiBhZnRlciAxMDBtc1xuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgY2hlY2tRdWV1ZSgpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIENoZWNrcyBpZiBhIG1lc3NhZ2Ugd2l0aCB0aGUgZ2l2ZW4gbGV2ZWwgc2hvdWxkIGJlIGxvZ2dlZC5cbiAgICogQHBhcmFtIHtMb2dMZXZlbH0gbWVzc2FnZUxldmVsIC0gVGhlIGxldmVsIG9mIHRoZSBtZXNzYWdlIHRvIGNoZWNrLlxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgbWVzc2FnZSBzaG91bGQgYmUgbG9nZ2VkLCBmYWxzZSBvdGhlcndpc2UuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHNob3VsZExvZyhtZXNzYWdlTGV2ZWw6IExvZ0xldmVsKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIG1lc3NhZ2VMZXZlbCA+PSBMb2dnYWJsZS5sb2dMZXZlbDtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgdmFsdWUgYWZ0ZXIgZW5zdXJpbmcgYWxsIGxvZ3MgaGF2ZSBiZWVuIHByb2Nlc3NlZC5cbiAgICogQHBhcmFtIHtUfSB2YWx1ZSAtIFRoZSB2YWx1ZSB0byByZXR1cm4uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFQ+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aXRoIHRoZSB2YWx1ZSBhZnRlciBhbGwgbG9ncyBhcmUgcHJvY2Vzc2VkLlxuICAgKi9cbiAgcHVibGljIGFzeW5jIHJldHVybkFmdGVyTG9nZ2luZzxUPih2YWx1ZTogVCk6IFByb21pc2U8VD4ge1xuICAgIGF3YWl0IExvZ2dhYmxlLndhaXRGb3JFbXB0eVF1ZXVlKCk7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBsb2cgbWVzc2FnZSBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBsZXZlbCAtIFRoZSBsb2cgbGV2ZWwuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIGxvZyBtZXNzYWdlLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbi5cbiAgICogQHBhcmFtIHtzdHJpbmd9IFtjbGFzc05hbWVdIC0gT3B0aW9uYWwgY2xhc3MgbmFtZSBmb3IgY29udGV4dC5cbiAgICogQHJldHVybnMge0xvZ01lc3NhZ2V9IFRoZSBjcmVhdGVkIGxvZyBtZXNzYWdlIG9iamVjdC5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGNyZWF0ZUxvZ01lc3NhZ2UoXG4gICAgbGV2ZWw6IHN0cmluZyxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogTG9nTWVzc2FnZSB7XG4gICAgY29uc3QgcHJlZml4ZWRNZXNzYWdlID0gY2xhc3NOYW1lID8gYCR7Y2xhc3NOYW1lfTo6JHttZXNzYWdlfWAgOiBtZXNzYWdlO1xuICAgIGNvbnN0IGxvZ1BheWxvYWQ6IExvZ1BheWxvYWQgfCB1bmRlZmluZWQgPSBwYXlsb2FkXG4gICAgICA/IHtcbiAgICAgICAgICB0eXBlOiB0eXBlb2YgcGF5bG9hZCA9PT0gXCJzdHJpbmdcIiA/IFwidGV4dFwiIDogXCJqc29uXCIsXG4gICAgICAgICAgY29udGVudDogcGF5bG9hZCxcbiAgICAgICAgfVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICByZXR1cm4ge1xuICAgICAgdGltZXN0YW1wOiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICBsZXZlbCxcbiAgICAgIG1lc3NhZ2U6IHByZWZpeGVkTWVzc2FnZSxcbiAgICAgIHBheWxvYWQ6IGxvZ1BheWxvYWQsXG4gICAgICBzZW5kZXI6IGNsYXNzTmFtZSB8fCBcIkxvZ2dhYmxlXCIsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIGxvZ1dpdGhMZXZlbChcbiAgICBsZXZlbDogTG9nTGV2ZWwsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QsXG4gICAgY2xhc3NOYW1lPzogc3RyaW5nXG4gICk6IHZvaWQge1xuICAgIGlmIChMb2dnYWJsZS5zaG91bGRMb2cobGV2ZWwpKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgTG9nTGV2ZWxbbGV2ZWxdLFxuICAgICAgICBtZXNzYWdlLFxuICAgICAgICBwYXlsb2FkLFxuICAgICAgICBjbGFzc05hbWVcbiAgICAgICk7XG4gICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmVucXVldWUobG9nTWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHN0YXRpYyBsb2dEZWJ1ZyhcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nV2l0aExldmVsKExvZ0xldmVsLkRFQlVHLCBtZXNzYWdlLCBwYXlsb2FkLCBjbGFzc05hbWUpO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBsb2dFcnJvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nV2l0aExldmVsKExvZ0xldmVsLkVSUk9SLCBtZXNzYWdlLCBwYXlsb2FkLCBjbGFzc05hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYSBkZWJ1ZyBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgZGVidWcgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgZGVidWcobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0KTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nRGVidWcobWVzc2FnZSwgcGF5bG9hZCwgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGFuIGluZm8gbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIGluZm8gbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QpOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLklORk8pKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgXCJJTkZPXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhIHdhcm5pbmcgbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIHdhcm5pbmcgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgd2FybihtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QpOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLldBUk4pKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgXCJXQVJOXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhbiBlcnJvciBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBMb2dnYWJsZUVycm9yfSBtZXNzYWdlT3JFcnJvciAtIFRoZSBlcnJvciBtZXNzYWdlIG9yIExvZ2dhYmxlRXJyb3Igb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiAodXNlZCBvbmx5IGlmIG1lc3NhZ2UgaXMgYSBzdHJpbmcpLlxuICAgKi9cbiAgcHJvdGVjdGVkIGVycm9yKFxuICAgIG1lc3NhZ2VPckVycm9yOiBzdHJpbmcgfCBMb2dnYWJsZUVycm9yLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3RcbiAgKTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhMb2dMZXZlbC5FUlJPUikpIHtcbiAgICAgIGxldCBtZXNzYWdlOiBzdHJpbmc7XG4gICAgICBsZXQgZXJyb3JQYXlsb2FkOiBvYmplY3QgfCB1bmRlZmluZWQ7XG5cbiAgICAgIGlmIChtZXNzYWdlT3JFcnJvciBpbnN0YW5jZW9mIExvZ2dhYmxlRXJyb3IpIHtcbiAgICAgICAgbWVzc2FnZSA9IG1lc3NhZ2VPckVycm9yLm1lc3NhZ2U7XG4gICAgICAgIGVycm9yUGF5bG9hZCA9IG1lc3NhZ2VPckVycm9yLnRvSlNPTigpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWVzc2FnZSA9IG1lc3NhZ2VPckVycm9yO1xuICAgICAgICBlcnJvclBheWxvYWQgPSB0eXBlb2YgcGF5bG9hZCA9PT0gXCJvYmplY3RcIiA/IHBheWxvYWQgOiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBMb2dnYWJsZS5jcmVhdGVMb2dNZXNzYWdlKFxuICAgICAgICBcIkVSUk9SXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIGVycm9yUGF5bG9hZCxcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lXG4gICAgICApO1xuICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5lbnF1ZXVlKGxvZ01lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgdGhlIHF1ZXVlIG9mIGxvZyBtZXNzYWdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gcHJvY2Vzc2luZyBpcyBjb21wbGV0ZS5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGFzeW5jIHByb2Nlc3NRdWV1ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoTG9nZ2FibGUuaXNQcm9jZXNzaW5nKSByZXR1cm47XG5cbiAgICBMb2dnYWJsZS5pc1Byb2Nlc3NpbmcgPSB0cnVlO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gTG9nZ2FibGUucXVldWVTdHJhdGVneS5kZXF1ZXVlKCk7XG4gICAgICBpZiAoIW1lc3NhZ2UpIGJyZWFrO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBMb2dnYWJsZS5sb2dTdHJhdGVneS5zZW5kKG1lc3NhZ2UpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihcIkZhaWxlZCB0byBzZW5kIG1lc3NhZ2U6XCIsIGVycm9yKTtcbiAgICAgICAgLy8gT3B0aW9uYWxseSByZS1lbnF1ZXVlIHRoZSBtZXNzYWdlIG9yIGltcGxlbWVudCByZXRyeSBsb2dpY1xuICAgICAgfVxuICAgIH1cbiAgICBMb2dnYWJsZS5pc1Byb2Nlc3NpbmcgPSBmYWxzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgcHJvY2Vzc2luZyB0aGUgcXVldWUgb2YgbG9nIG1lc3NhZ2VzLlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgc3RhcnRQcm9jZXNzaW5nKCk6IHZvaWQge1xuICAgIGNvbnN0IHNjaGVkdWxlUHJvY2Vzc2luZyA9ICgpID0+IHtcbiAgICAgIExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIExvZ2dhYmxlLnByb2Nlc3NRdWV1ZSgpLmZpbmFsbHkoKCkgPT4ge1xuICAgICAgICAgIHNjaGVkdWxlUHJvY2Vzc2luZygpO1xuICAgICAgICB9KTtcbiAgICAgIH0sIDEwMCk7IC8vIEFkanVzdCB0aGlzIGRlbGF5IGFzIG5lZWRlZFxuICAgIH07XG5cbiAgICBzY2hlZHVsZVByb2Nlc3NpbmcoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTaHV0cyBkb3duIHRoZSBsb2dnaW5nIHN5c3RlbS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgYXN5bmMgc2h1dGRvd24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQoTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgICAgYXdhaXQgTG9nZ2FibGUud2FpdEZvckVtcHR5UXVldWUoKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0UGF5bG9hZENvbnRlbnQocGF5bG9hZDogTG9nUGF5bG9hZCk6IHN0cmluZyB7XG4gIGNvbnN0IHRydW5jYXRlZENvbnRlbnQgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShwYXlsb2FkLmNvbnRlbnQpO1xuXG4gIGlmIChwYXlsb2FkLnR5cGUgPT09IFwidGV4dFwiKSB7XG4gICAgcmV0dXJuIHRydW5jYXRlZENvbnRlbnQgYXMgc3RyaW5nO1xuICB9XG5cbiAgcmV0dXJuIHV0aWwuaW5zcGVjdCh0cnVuY2F0ZWRDb250ZW50LCB7IGRlcHRoOiBudWxsLCBjb2xvcnM6IHRydWUgfSk7XG59XG5cbmV4cG9ydCB7IGxvZ01ldGhvZCB9O1xuIl19