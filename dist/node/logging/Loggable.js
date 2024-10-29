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
const ConsoleStrategy_1 = require("./ConsoleStrategy");
/**
 * Enum representing different log levels.
 */
const DEFAULT_LOG_STRATEGY = new ConsoleStrategy_1.ConsoleStrategy();
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
                await (Loggable.logStrategy || DEFAULT_LOG_STRATEGY).send(message);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTG9nZ2FibGUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbG9nZ2luZy9Mb2dnYWJsZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFrbEJTLDhCQUFTO0FBamxCbEIsK0NBQTRDO0FBQzVDLHlFQUFzRTtBQUN0RSwrQ0FBaUU7QUFDakUsZ0RBQXdCO0FBRXhCOzs7R0FHRztBQUVILG1DQUFrRDtBQUNsRCx1REFBb0Q7QUFFcEQ7O0dBRUc7QUFFSCxNQUFNLG9CQUFvQixHQUFHLElBQUksaUNBQWUsRUFBRSxDQUFDO0FBRW5ELFNBQVMsU0FBUztJQUNoQixPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQThCO1FBRTlCLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFDeEMsVUFBVSxDQUFDLEtBQUssR0FBRyxVQUFVLEdBQUcsSUFBVztZQUN6QyxNQUFNLFNBQVMsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQztZQUN4QyxNQUFNLGFBQWEsR0FBRyx5QkFBVyxDQUFDLG9CQUFvQixDQUFDLElBQUksQ0FBQyxDQUFDO1lBRTdELE1BQU0sU0FBUyxHQUFHLENBQUMsTUFBVyxFQUFFLEVBQUU7Z0JBQ2hDLElBQUksUUFBUSxDQUFDLFNBQVMsQ0FBQyxzQkFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUM7b0JBQ3ZDLE1BQU0sZUFBZSxHQUFHLHlCQUFXLENBQUMsb0JBQW9CLENBQUMsTUFBTSxDQUFDLENBQUM7b0JBQ2pFLE1BQU0sT0FBTyxHQUFHO3dCQUNkLElBQUksRUFBRSxhQUFhO3dCQUNuQixNQUFNLEVBQUUsZUFBZTtxQkFDeEIsQ0FBQztvQkFDRixRQUFRLENBQUMsUUFBUSxDQUNmLHVCQUF1QixTQUFTLEtBQUssV0FBVyxFQUFFLEVBQ2xELE9BQU8sRUFDUCxTQUFTLENBQ1YsQ0FBQztnQkFDSixDQUFDO2dCQUNELE9BQU8sTUFBTSxDQUFDO1lBQ2hC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SztpQkFDaEM7Z0JBQ0gsQ0FBQyxDQUFDLFNBQVM7U0FDZCxDQUFDO0lBQ0osQ0FBQztDQUNGLENBQUM7QUE4WGEsd0JBQWUsR0FBZSxHQUFHLEVBQUUsR0FBRSxDQUFDLENBQUM7QUFheEQsU0FBUyxvQkFBb0IsQ0FBQyxPQUFtQjtJQUMvQyxNQUFNLGdCQUFnQixHQUFHLHlCQUFXLENBQUMsb0JBQW9CLENBQUMsT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBRTNFLElBQUksT0FBTyxDQUFDLElBQUksS0FBSyxNQUFNLEVBQUUsQ0FBQztRQUM1QixPQUFPLGdCQUEwQixDQUFDO0lBQ3BDLENBQUM7SUFFRCxPQUFPLGNBQUksQ0FBQyxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsRUFBRSxLQUFLLEVBQUUsSUFBSSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDO0FBQ3ZFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBJUXVldWVTdHJhdGVneSB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBMb2dTdHJhdGVneSB9IGZyb20gXCIuL0xvZ1N0cmF0ZWd5XCI7XG5pbXBvcnQgeyBJbk1lbW9yeVF1ZXVlU3RyYXRlZ3kgfSBmcm9tIFwiLi4vY29yZS9Jbk1lbW9yeVF1ZXVlU3RyYXRlZ3lcIjtcbmltcG9ydCB7IExvZ0xldmVsLCBMb2dNZXNzYWdlLCBMb2dQYXlsb2FkIH0gZnJvbSBcIi4vTG9nU3RyYXRlZ3lcIjtcbmltcG9ydCB1dGlsIGZyb20gXCJ1dGlsXCI7XG5cbi8qKlxuICogQGZpbGVvdmVydmlldyBUaGlzIG1vZHVsZSBwcm92aWRlcyBhIGxvZ2dpbmcgc3lzdGVtIHdpdGggZGlmZmVyZW50IGxvZyBsZXZlbHMsXG4gKiBub3RpZmljYXRpb24gc3RyYXRlZ2llcywgYW5kIHF1ZXVlIHN0cmF0ZWdpZXMuXG4gKi9cblxuaW1wb3J0IHsgc2V0VGltZW91dCwgY2xlYXJUaW1lb3V0IH0gZnJvbSBcInRpbWVyc1wiO1xuaW1wb3J0IHsgQ29uc29sZVN0cmF0ZWd5IH0gZnJvbSBcIi4vQ29uc29sZVN0cmF0ZWd5XCI7XG5cbi8qKlxuICogRW51bSByZXByZXNlbnRpbmcgZGlmZmVyZW50IGxvZyBsZXZlbHMuXG4gKi9cblxuY29uc3QgREVGQVVMVF9MT0dfU1RSQVRFR1kgPSBuZXcgQ29uc29sZVN0cmF0ZWd5KCk7XG5cbmZ1bmN0aW9uIGxvZ01ldGhvZCgpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChcbiAgICB0YXJnZXQ6IGFueSxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nLFxuICAgIGRlc2NyaXB0b3I6IFByb3BlcnR5RGVzY3JpcHRvclxuICApIHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgY29uc3QgY2xhc3NOYW1lID0gdGhpcy5jb25zdHJ1Y3Rvci5uYW1lO1xuICAgICAgY29uc3QgdHJ1bmNhdGVkQXJncyA9IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KGFyZ3MpO1xuXG4gICAgICBjb25zdCBsb2dSZXN1bHQgPSAocmVzdWx0OiBhbnkpID0+IHtcbiAgICAgICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhMb2dMZXZlbC5ERUJVRykpIHtcbiAgICAgICAgICBjb25zdCB0cnVuY2F0ZWRSZXN1bHQgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShyZXN1bHQpO1xuICAgICAgICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICAgICAgICBhcmdzOiB0cnVuY2F0ZWRBcmdzLFxuICAgICAgICAgICAgcmVzdWx0OiB0cnVuY2F0ZWRSZXN1bHQsXG4gICAgICAgICAgfTtcbiAgICAgICAgICBMb2dnYWJsZS5sb2dEZWJ1ZyhcbiAgICAgICAgICAgIGBMb2dNZXRob2REZWNvcmF0b3I6OiR7Y2xhc3NOYW1lfTo6JHtwcm9wZXJ0eUtleX1gLFxuICAgICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICAgIGNsYXNzTmFtZVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGxvZ0Vycm9yID0gKGVycm9yOiBhbnkpID0+IHtcbiAgICAgICAgY29uc3QgZXJyb3JNZXNzYWdlID0gYCR7Y2xhc3NOYW1lfTo6JHtwcm9wZXJ0eUtleX0gcmVzdWx0ZWQgaW4gZXJyb3JgO1xuICAgICAgICBjb25zdCB0cnVuY2F0ZWRFcnJvciA9XG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBMb2dnYWJsZUVycm9yXG4gICAgICAgICAgICA/IGVycm9yLnRvSlNPTigpXG4gICAgICAgICAgICA6IExvZ1N0cmF0ZWd5LnRydW5jYXRlQW5kU3RyaW5naWZ5KGVycm9yLm1lc3NhZ2UgfHwgZXJyb3IpO1xuXG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSB7XG4gICAgICAgICAgYXJnczogdHJ1bmNhdGVkQXJncyxcbiAgICAgICAgICBlcnJvcjogdHJ1bmNhdGVkRXJyb3IsXG4gICAgICAgIH07XG4gICAgICAgIExvZ2dhYmxlLmxvZ0Vycm9yKFxuICAgICAgICAgIGBMb2dNZXRob2REZWNvcmF0b3I6OiR7ZXJyb3JNZXNzYWdlfWAsXG4gICAgICAgICAgbWVzc2FnZSxcbiAgICAgICAgICBjbGFzc05hbWVcbiAgICAgICAgKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9O1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBvcmlnaW5hbE1ldGhvZC5hcHBseSh0aGlzLCBhcmdzKTtcblxuICAgICAgICBpZiAocmVzdWx0IGluc3RhbmNlb2YgUHJvbWlzZSkge1xuICAgICAgICAgIHJldHVybiByZXN1bHQudGhlbihsb2dSZXN1bHQsIGxvZ0Vycm9yKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gbG9nUmVzdWx0KHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgcmV0dXJuIGxvZ0Vycm9yKGVycm9yKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9O1xufVxuXG5leHBvcnQgY2xhc3MgTG9nZ2FibGVFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgcHVibGljIHJlYWRvbmx5IHBheWxvYWQ6IGFueTtcbiAgcHVibGljIHJlYWRvbmx5IG9yaWdpbmFsRXJyb3I6IEVycm9yIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgcGF5bG9hZD86IGFueSwgb3JpZ2luYWxFcnJvcj86IEVycm9yKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gXCJMb2dnYWJsZUVycm9yXCI7XG4gICAgdGhpcy5wYXlsb2FkID0gcGF5bG9hZDtcbiAgICB0aGlzLm9yaWdpbmFsRXJyb3IgPSBvcmlnaW5hbEVycm9yO1xuXG4gICAgLy8gQ2FwdHVyZSB0aGUgc3RhY2sgdHJhY2VcbiAgICBpZiAoRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UpIHtcbiAgICAgIEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKHRoaXMsIExvZ2dhYmxlRXJyb3IpO1xuICAgIH1cblxuICAgIC8vIEFwcGVuZCB0aGUgb3JpZ2luYWwgZXJyb3IncyBzdGFjayB0byB0aGlzIGVycm9yJ3Mgc3RhY2tcbiAgICBpZiAob3JpZ2luYWxFcnJvciAmJiBvcmlnaW5hbEVycm9yLnN0YWNrKSB7XG4gICAgICB0aGlzLnN0YWNrID0gdGhpcy5zdGFjayArIFwiXFxuXFxuQ2F1c2VkIGJ5OlxcblwiICsgb3JpZ2luYWxFcnJvci5zdGFjaztcbiAgICB9XG5cbiAgICBPYmplY3Quc2V0UHJvdG90eXBlT2YodGhpcywgTG9nZ2FibGVFcnJvci5wcm90b3R5cGUpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRUaHJvd2luZ0NsYXNzTmFtZSgpOiBzdHJpbmcgfCBudWxsIHtcbiAgICAvLyBHZXQgdGhlIHN0YWNrIHRyYWNlXG4gICAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YWNrPy5zcGxpdChcIlxcblwiKTtcbiAgICBpZiAoIXN0YWNrIHx8IHN0YWNrLmxlbmd0aCA8IDQpIHJldHVybiBudWxsO1xuXG4gICAgLy8gVGhlIGNvbnN0cnVjdG9yIGNhbGwgd2lsbCBiZSB0aGUgdGhpcmQgbGluZSBpbiB0aGUgc3RhY2sgKGluZGV4IDIpXG4gICAgY29uc3QgY29uc3RydWN0b3JDYWxsID0gc3RhY2tbMl07XG5cbiAgICAvLyBFeHRyYWN0IHRoZSBjbGFzcyBuYW1lIHVzaW5nIGEgcmVndWxhciBleHByZXNzaW9uXG4gICAgY29uc3QgbWF0Y2ggPSBjb25zdHJ1Y3RvckNhbGwubWF0Y2goL2F0XFxzKyguKj8pXFxzK1xcKC8pO1xuICAgIGlmIChtYXRjaCAmJiBtYXRjaFsxXSkge1xuICAgICAgY29uc3QgZnVsbE5hbWUgPSBtYXRjaFsxXTtcbiAgICAgIC8vIElmIGl0J3MgYSBtZXRob2QgY2FsbCwgZXh0cmFjdCB0aGUgY2xhc3MgbmFtZVxuICAgICAgY29uc3QgbGFzdERvdEluZGV4ID0gZnVsbE5hbWUubGFzdEluZGV4T2YoXCIuXCIpO1xuICAgICAgcmV0dXJuIGxhc3REb3RJbmRleCAhPT0gLTFcbiAgICAgICAgPyBmdWxsTmFtZS5zdWJzdHJpbmcoMCwgbGFzdERvdEluZGV4KVxuICAgICAgICA6IGZ1bGxOYW1lO1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHVibGljIHRvSlNPTigpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbmFtZTogdGhpcy5uYW1lLFxuICAgICAgbWVzc2FnZTogdGhpcy5tZXNzYWdlLFxuICAgICAgcGF5bG9hZDogdGhpcy5wYXlsb2FkLFxuICAgICAgdGhyb3dpbmdDbGFzczogdGhpcy5nZXRUaHJvd2luZ0NsYXNzTmFtZSgpLFxuICAgICAgc3RhY2s6IHRoaXMuc3RhY2ssXG4gICAgfTtcbiAgfVxuXG4gIHB1YmxpYyB0b1N0cmluZygpOiBzdHJpbmcge1xuICAgIHJldHVybiBKU09OLnN0cmluZ2lmeSh0aGlzLnRvSlNPTigpLCBudWxsLCAyKTtcbiAgfVxufVxuXG4vKipcbiAqIEFic3RyYWN0IGJhc2UgY2xhc3MgZm9yIG9iamVjdHMgdGhhdCBjYW4gbG9nIG1lc3NhZ2VzLlxuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgTG9nZ2FibGUge1xuICBwdWJsaWMgc3RhdGljIGxvZ1N0cmF0ZWd5OiBMb2dTdHJhdGVneTtcbiAgcHJpdmF0ZSBzdGF0aWMgcXVldWVTdHJhdGVneTogSVF1ZXVlU3RyYXRlZ3k8TG9nTWVzc2FnZT4gPVxuICAgIG5ldyBJbk1lbW9yeVF1ZXVlU3RyYXRlZ3k8TG9nTWVzc2FnZT4oKTtcbiAgcHJpdmF0ZSBzdGF0aWMgbG9nTGV2ZWw6IExvZ0xldmVsID0gTG9nTGV2ZWwuSU5GTztcbiAgcHJpdmF0ZSBzdGF0aWMgaXNQcm9jZXNzaW5nOiBib29sZWFuID0gZmFsc2U7XG4gIHByaXZhdGUgc3RhdGljIHByb2Nlc3NpbmdUaW1lb3V0OiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBzdGF0aWMgTG9nTGV2ZWwgPSBMb2dMZXZlbDtcbiAgcHJvdGVjdGVkIHN0YXRpYyBMb2dnYWJsZUVycm9yID0gTG9nZ2FibGVFcnJvcjtcbiAgcHJpdmF0ZSBzdGF0aWMgc2h1dGRvd25Qcm9taXNlOiBQcm9taXNlPHZvaWQ+IHwgbnVsbCA9IG51bGw7XG4gIHByb3RlY3RlZCBzdGF0aWMgRGVmYXVsdExvZ2dhYmxlRXJyb3IgPSBjbGFzcyBleHRlbmRzIEVycm9yIHtcbiAgICBwdWJsaWMgcmVhZG9ubHkgcGF5bG9hZDogYW55O1xuICAgIHB1YmxpYyByZWFkb25seSBvcmlnaW5hbEVycm9yOiBFcnJvciB8IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgcGF5bG9hZD86IGFueSwgb3JpZ2luYWxFcnJvcj86IEVycm9yKSB7XG4gICAgICBzdXBlcihtZXNzYWdlKTtcbiAgICAgIHRoaXMubmFtZSA9IFwiRGVmYXVsdExvZ2dhYmxlRXJyb3JcIjtcbiAgICAgIHRoaXMucGF5bG9hZCA9IHBheWxvYWQ7XG4gICAgICB0aGlzLm9yaWdpbmFsRXJyb3IgPSBvcmlnaW5hbEVycm9yO1xuXG4gICAgICBpZiAoRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UpIHtcbiAgICAgICAgRXJyb3IuY2FwdHVyZVN0YWNrVHJhY2UodGhpcywgdGhpcy5jb25zdHJ1Y3Rvcik7XG4gICAgICB9XG5cbiAgICAgIGlmIChvcmlnaW5hbEVycm9yICYmIG9yaWdpbmFsRXJyb3Iuc3RhY2spIHtcbiAgICAgICAgdGhpcy5zdGFjayA9IHRoaXMuc3RhY2sgKyBcIlxcblxcbkNhdXNlZCBieTpcXG5cIiArIG9yaWdpbmFsRXJyb3Iuc3RhY2s7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcHVibGljIHRvSlNPTigpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIG5hbWU6IHRoaXMubmFtZSxcbiAgICAgICAgbWVzc2FnZTogdGhpcy5tZXNzYWdlLFxuICAgICAgICBwYXlsb2FkOiB0aGlzLnBheWxvYWQsXG4gICAgICAgIHN0YWNrOiB0aGlzLnN0YWNrLFxuICAgICAgICBvcmlnaW5hbEVycm9yOiB0aGlzLm9yaWdpbmFsRXJyb3JcbiAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgbmFtZTogdGhpcy5vcmlnaW5hbEVycm9yLm5hbWUsXG4gICAgICAgICAgICAgIG1lc3NhZ2U6IHRoaXMub3JpZ2luYWxFcnJvci5tZXNzYWdlLFxuICAgICAgICAgICAgICBzdGFjazogdGhpcy5vcmlnaW5hbEVycm9yLnN0YWNrLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9XG4gIH07XG5cbiAgcHVibGljIHN0YXRpYyBGb3JtYXRMb2dNZXNzYWdlKG1lc3NhZ2U6IExvZ01lc3NhZ2UpOiBzdHJpbmcge1xuICAgIGxldCB0aW1lc3RhbXA6IHN0cmluZztcbiAgICB0cnkge1xuICAgICAgdGltZXN0YW1wID0gbmV3IERhdGUobWVzc2FnZS50aW1lc3RhbXApLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgLTUpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAvLyBIYW5kbGUgaW52YWxpZCBkYXRlXG4gICAgICBjb25zb2xlLmVycm9yKGBJbnZhbGlkIHRpbWVzdGFtcDogJHttZXNzYWdlLnRpbWVzdGFtcH1gLCBtZXNzYWdlKTtcbiAgICAgIHRpbWVzdGFtcCA9IFwiSW52YWxpZCBEYXRlXCI7XG4gICAgfVxuXG4gICAgbGV0IGZvcm1hdHRlZE1lc3NhZ2UgPSBgWyR7dGltZXN0YW1wfV0gJHtcbiAgICAgIG1lc3NhZ2UubGV2ZWw/LnRvVXBwZXJDYXNlKCkgPz8gXCJVTktOT1dOXCJcbiAgICB9OiAke21lc3NhZ2UubWVzc2FnZX1gO1xuXG4gICAgaWYgKG1lc3NhZ2UucGF5bG9hZCkge1xuICAgICAgZm9ybWF0dGVkTWVzc2FnZSArPSBcIlxcblBheWxvYWQ6XCI7XG4gICAgICBmb3JtYXR0ZWRNZXNzYWdlICs9IGBcXG4gIFR5cGU6ICR7bWVzc2FnZS5wYXlsb2FkLnR5cGV9YDtcbiAgICAgIGZvcm1hdHRlZE1lc3NhZ2UgKz0gYFxcbiAgQ29udGVudDogJHtmb3JtYXRQYXlsb2FkQ29udGVudChcbiAgICAgICAgbWVzc2FnZS5wYXlsb2FkXG4gICAgICApfWA7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZvcm1hdHRlZE1lc3NhZ2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgc3RhdGljIGhhbmRsZUVycm9ycyhcbiAgICB0YXJnZXQ6IGFueSxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nLFxuICAgIGRlc2NyaXB0b3I6IFByb3BlcnR5RGVzY3JpcHRvclxuICApIHtcbiAgICBjb25zdCBvcmlnaW5hbE1ldGhvZCA9IGRlc2NyaXB0b3IudmFsdWU7XG4gICAgZGVzY3JpcHRvci52YWx1ZSA9IGZ1bmN0aW9uICguLi5hcmdzOiBhbnlbXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gb3JpZ2luYWxNZXRob2QuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIGlmIChyZXN1bHQgaW5zdGFuY2VvZiBQcm9taXNlKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdC5jYXRjaCgoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICAgICAgaWYgKHRoaXMgaW5zdGFuY2VvZiBMb2dnYWJsZSkge1xuICAgICAgICAgICAgICBjb25zdCB0cnVuY2F0ZWRBcmdzID0gTG9nU3RyYXRlZ3kudHJ1bmNhdGVBbmRTdHJpbmdpZnkoYXJncywgMzAwKTtcbiAgICAgICAgICAgICAgcmV0dXJuIHRoaXMubG9nQW5kVGhyb3dFcnJvcihlcnJvciwgdHJ1bmNhdGVkQXJncyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgICAgICAgICAgYGhhbmRsZUVycm9ycyBkZWNvcmF0b3IgdXNlZCBvbiBub24tTG9nZ2FibGUgY2xhc3M6ICR7dGFyZ2V0LmNvbnN0cnVjdG9yLm5hbWV9YFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICBpZiAodGhpcyBpbnN0YW5jZW9mIExvZ2dhYmxlKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMubG9nQW5kVGhyb3dFcnJvcihlcnJvcik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICAgICAgYGhhbmRsZUVycm9ycyBkZWNvcmF0b3IgdXNlZCBvbiBub24tTG9nZ2FibGUgY2xhc3M6ICR7dGFyZ2V0LmNvbnN0cnVjdG9yLm5hbWV9YFxuICAgICAgICAgICk7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIHJldHVybiBkZXNjcmlwdG9yO1xuICB9XG5cbiAgLyoqXG4gICAqIFByb3RlY3RlZCBjb25zdHJ1Y3RvciB0byBlbnN1cmUgdGhlIGNsYXNzIGlzIHByb3Blcmx5IGluaXRpYWxpemVkLlxuICAgKiBAdGhyb3dzIHtFcnJvcn0gSWYgdGhlIGNsYXNzIGlzIG5vdCBpbml0aWFsaXplZC5cbiAgICovXG4gIHByb3RlY3RlZCBjb25zdHJ1Y3RvcigpIHtcbiAgICBpZiAoIUxvZ2dhYmxlLmlzUHJvY2Vzc2luZykge1xuICAgICAgTG9nZ2FibGUuc3RhcnRQcm9jZXNzaW5nKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGxvZyBzdHJhdGVneS5cbiAgICogQHBhcmFtIHtMb2dTdHJhdGVneX0gc3RyYXRlZ3kgLSBUaGUgbmV3IGxvZyBzdHJhdGVneSB0byB1c2UuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHNldExvZ1N0cmF0ZWd5KHN0cmF0ZWd5OiBMb2dTdHJhdGVneSk6IHZvaWQge1xuICAgIExvZ2dhYmxlLmxvZ1N0cmF0ZWd5ID0gc3RyYXRlZ3k7XG4gIH1cblxuICAvKipcbiAgICogU2V0cyB0aGUgcXVldWUgc3RyYXRlZ3kuXG4gICAqIEBwYXJhbSB7SVF1ZXVlU3RyYXRlZ3k8TG9nTWVzc2FnZT59IHN0cmF0ZWd5IC0gVGhlIG5ldyBxdWV1ZSBzdHJhdGVneSB0byB1c2UuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHNldFF1ZXVlU3RyYXRlZ3koc3RyYXRlZ3k6IElRdWV1ZVN0cmF0ZWd5PExvZ01lc3NhZ2U+KTogdm9pZCB7XG4gICAgTG9nZ2FibGUucXVldWVTdHJhdGVneSA9IHN0cmF0ZWd5O1xuICB9XG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGxvZyBsZXZlbC5cbiAgICogQHBhcmFtIHtMb2dMZXZlbH0gbGV2ZWwgLSBUaGUgbmV3IGxvZyBsZXZlbCB0byB1c2UuXG4gICAqL1xuICBwdWJsaWMgc3RhdGljIHNldExvZ0xldmVsKGxldmVsOiBMb2dMZXZlbCk6IHZvaWQge1xuICAgIExvZ2dhYmxlLmxvZ0xldmVsID0gbGV2ZWw7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGxvZ0FuZFRocm93RXJyb3IoZXJyb3I6IGFueSwgYXJnczogYW55ID0ge30pOiBQcm9taXNlPG5ldmVyPiB7XG4gICAgY29uc3QgRXJyb3JDbGFzcyA9XG4gICAgICAodGhpcy5jb25zdHJ1Y3RvciBhcyB0eXBlb2YgTG9nZ2FibGUpLkxvZ2dhYmxlRXJyb3IgfHxcbiAgICAgIExvZ2dhYmxlLkRlZmF1bHRMb2dnYWJsZUVycm9yO1xuXG4gICAgbGV0IGxvZ2dhYmxlRXJyb3I6IExvZ2dhYmxlRXJyb3I7XG5cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvckNsYXNzKSB7XG4gICAgICBsb2dnYWJsZUVycm9yID0gZXJyb3I7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dhYmxlRXJyb3IgPSBuZXcgRXJyb3JDbGFzcyhcbiAgICAgICAgZXJyb3IubWVzc2FnZSxcbiAgICAgICAgeyBvcmlnaW5hbEFyZ3M6IGFyZ3MgfSxcbiAgICAgICAgZXJyb3JcbiAgICAgICk7XG5cbiAgICAgIC8vIFByZXNlcnZlIHRoZSBvcmlnaW5hbCBzdGFjayB0cmFjZVxuICAgICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IgJiYgZXJyb3Iuc3RhY2spIHtcbiAgICAgICAgbG9nZ2FibGVFcnJvci5zdGFjayA9IGVycm9yLnN0YWNrO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEFkZCB0aHJvd2luZyBjbGFzcyBpbmZvcm1hdGlvbiB3aXRob3V0IG1vZGlmeWluZyB0aGUgZXJyb3Igb2JqZWN0IGRpcmVjdGx5XG4gICAgY29uc3QgdGhyb3dpbmdDbGFzcyA9IHRoaXMuY29uc3RydWN0b3IubmFtZTtcbiAgICBjb25zdCBlcnJvckluZm8gPSB7XG4gICAgICAuLi5sb2dnYWJsZUVycm9yLnRvSlNPTigpLFxuICAgICAgdGhyb3dpbmdDbGFzcyxcbiAgICB9O1xuXG4gICAgdGhpcy5lcnJvcihsb2dnYWJsZUVycm9yLm1lc3NhZ2UsIGVycm9ySW5mbyk7XG4gICAgYXdhaXQgTG9nZ2FibGUud2FpdEZvckVtcHR5UXVldWUoKTsgLy8gRW5zdXJlIHRoZSBxdWV1ZSBpcyBlbXB0eSBiZWZvcmUgdGhyb3dpbmdcbiAgICB0aHJvdyBsb2dnYWJsZUVycm9yO1xuICB9XG5cbiAgLyoqXG4gICAqIFdhaXRzIGZvciB0aGUgcXVldWUgdG8gYmUgZW1wdHkuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSBBIHByb21pc2UgdGhhdCByZXNvbHZlcyB3aGVuIHRoZSBxdWV1ZSBpcyBlbXB0eS5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIHdhaXRGb3JFbXB0eVF1ZXVlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgY29uc3QgY2hlY2tRdWV1ZSA9ICgpID0+IHtcbiAgICAgICAgaWYgKFxuICAgICAgICAgICFMb2dnYWJsZS5pc1Byb2Nlc3NpbmcgJiZcbiAgICAgICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmRlcXVldWUoKSA9PT0gdW5kZWZpbmVkXG4gICAgICAgICkge1xuICAgICAgICAgIHJlc29sdmUoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBzZXRUaW1lb3V0KGNoZWNrUXVldWUsIDEwMCk7IC8vIENoZWNrIGFnYWluIGFmdGVyIDEwMG1zXG4gICAgICAgIH1cbiAgICAgIH07XG4gICAgICBjaGVja1F1ZXVlKCk7XG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgbWVzc2FnZSB3aXRoIHRoZSBnaXZlbiBsZXZlbCBzaG91bGQgYmUgbG9nZ2VkLlxuICAgKiBAcGFyYW0ge0xvZ0xldmVsfSBtZXNzYWdlTGV2ZWwgLSBUaGUgbGV2ZWwgb2YgdGhlIG1lc3NhZ2UgdG8gY2hlY2suXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSBtZXNzYWdlIHNob3VsZCBiZSBsb2dnZWQsIGZhbHNlIG90aGVyd2lzZS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgc2hvdWxkTG9nKG1lc3NhZ2VMZXZlbDogTG9nTGV2ZWwpOiBib29sZWFuIHtcbiAgICByZXR1cm4gbWVzc2FnZUxldmVsID49IExvZ2dhYmxlLmxvZ0xldmVsO1xuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSB2YWx1ZSBhZnRlciBlbnN1cmluZyBhbGwgbG9ncyBoYXZlIGJlZW4gcHJvY2Vzc2VkLlxuICAgKiBAcGFyYW0ge1R9IHZhbHVlIC0gVGhlIHZhbHVlIHRvIHJldHVybi5cbiAgICogQHJldHVybnMge1Byb21pc2U8VD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdpdGggdGhlIHZhbHVlIGFmdGVyIGFsbCBsb2dzIGFyZSBwcm9jZXNzZWQuXG4gICAqL1xuICBwdWJsaWMgYXN5bmMgcmV0dXJuQWZ0ZXJMb2dnaW5nPFQ+KHZhbHVlOiBUKTogUHJvbWlzZTxUPiB7XG4gICAgYXdhaXQgTG9nZ2FibGUud2FpdEZvckVtcHR5UXVldWUoKTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlcyBhIGxvZyBtZXNzYWdlIG9iamVjdC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGxldmVsIC0gVGhlIGxvZyBsZXZlbC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgbG9nIG1lc3NhZ2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nIHwgb2JqZWN0fSBbcGF5bG9hZF0gLSBPcHRpb25hbCBwYXlsb2FkIGZvciBhZGRpdGlvbmFsIGluZm9ybWF0aW9uLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2NsYXNzTmFtZV0gLSBPcHRpb25hbCBjbGFzcyBuYW1lIGZvciBjb250ZXh0LlxuICAgKiBAcmV0dXJucyB7TG9nTWVzc2FnZX0gVGhlIGNyZWF0ZWQgbG9nIG1lc3NhZ2Ugb2JqZWN0LlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgY3JlYXRlTG9nTWVzc2FnZShcbiAgICBsZXZlbDogc3RyaW5nLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0LFxuICAgIGNsYXNzTmFtZT86IHN0cmluZ1xuICApOiBMb2dNZXNzYWdlIHtcbiAgICBjb25zdCBwcmVmaXhlZE1lc3NhZ2UgPSBjbGFzc05hbWUgPyBgJHtjbGFzc05hbWV9Ojoke21lc3NhZ2V9YCA6IG1lc3NhZ2U7XG4gICAgY29uc3QgbG9nUGF5bG9hZDogTG9nUGF5bG9hZCB8IHVuZGVmaW5lZCA9IHBheWxvYWRcbiAgICAgID8ge1xuICAgICAgICAgIHR5cGU6IHR5cGVvZiBwYXlsb2FkID09PSBcInN0cmluZ1wiID8gXCJ0ZXh0XCIgOiBcImpzb25cIixcbiAgICAgICAgICBjb250ZW50OiBwYXlsb2FkLFxuICAgICAgICB9XG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIHJldHVybiB7XG4gICAgICB0aW1lc3RhbXA6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIGxldmVsLFxuICAgICAgbWVzc2FnZTogcHJlZml4ZWRNZXNzYWdlLFxuICAgICAgcGF5bG9hZDogbG9nUGF5bG9hZCxcbiAgICAgIHNlbmRlcjogY2xhc3NOYW1lIHx8IFwiTG9nZ2FibGVcIixcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBzdGF0aWMgbG9nV2l0aExldmVsKFxuICAgIGxldmVsOiBMb2dMZXZlbCxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhsZXZlbCkpIHtcbiAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBMb2dnYWJsZS5jcmVhdGVMb2dNZXNzYWdlKFxuICAgICAgICBMb2dMZXZlbFtsZXZlbF0sXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIGNsYXNzTmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICAgIExvZ2dhYmxlLndha2VVcFF1ZXVlKCk7XG4gICAgfVxuICB9XG5cbiAgcHVibGljIHN0YXRpYyBsb2dEZWJ1ZyhcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nV2l0aExldmVsKExvZ0xldmVsLkRFQlVHLCBtZXNzYWdlLCBwYXlsb2FkLCBjbGFzc05hbWUpO1xuICB9XG5cbiAgcHVibGljIHN0YXRpYyBsb2dFcnJvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcGF5bG9hZD86IHN0cmluZyB8IG9iamVjdCxcbiAgICBjbGFzc05hbWU/OiBzdHJpbmdcbiAgKTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nV2l0aExldmVsKExvZ0xldmVsLkVSUk9SLCBtZXNzYWdlLCBwYXlsb2FkLCBjbGFzc05hbWUpO1xuICB9XG5cbiAgLyoqXG4gICAqIExvZ3MgYSBkZWJ1ZyBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IG1lc3NhZ2UgLSBUaGUgZGVidWcgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgZGVidWcobWVzc2FnZTogc3RyaW5nLCBwYXlsb2FkPzogc3RyaW5nIHwgb2JqZWN0KTogdm9pZCB7XG4gICAgTG9nZ2FibGUubG9nRGVidWcobWVzc2FnZSwgcGF5bG9hZCwgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2dzIGFuIGluZm8gbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIGluZm8gbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgaW5mbyhtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QpOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLklORk8pKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgXCJJTkZPXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhIHdhcm5pbmcgbWVzc2FnZSBmb3IgdGhlIGN1cnJlbnQgaW5zdGFuY2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBtZXNzYWdlIC0gVGhlIHdhcm5pbmcgbWVzc2FnZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBvYmplY3R9IFtwYXlsb2FkXSAtIE9wdGlvbmFsIHBheWxvYWQgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4gICAqL1xuICBwcm90ZWN0ZWQgd2FybihtZXNzYWdlOiBzdHJpbmcsIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3QpOiB2b2lkIHtcbiAgICBpZiAoTG9nZ2FibGUuc2hvdWxkTG9nKExvZ0xldmVsLldBUk4pKSB7XG4gICAgICBjb25zdCBsb2dNZXNzYWdlID0gTG9nZ2FibGUuY3JlYXRlTG9nTWVzc2FnZShcbiAgICAgICAgXCJXQVJOXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIHBheWxvYWQsXG4gICAgICAgIHRoaXMuY29uc3RydWN0b3IubmFtZVxuICAgICAgKTtcbiAgICAgIExvZ2dhYmxlLnF1ZXVlU3RyYXRlZ3kuZW5xdWV1ZShsb2dNZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogTG9ncyBhbiBlcnJvciBtZXNzYWdlIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBMb2dnYWJsZUVycm9yfSBtZXNzYWdlT3JFcnJvciAtIFRoZSBlcnJvciBtZXNzYWdlIG9yIExvZ2dhYmxlRXJyb3Igb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IG9iamVjdH0gW3BheWxvYWRdIC0gT3B0aW9uYWwgcGF5bG9hZCBmb3IgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiAodXNlZCBvbmx5IGlmIG1lc3NhZ2UgaXMgYSBzdHJpbmcpLlxuICAgKi9cbiAgcHJvdGVjdGVkIGVycm9yKFxuICAgIG1lc3NhZ2VPckVycm9yOiBzdHJpbmcgfCBMb2dnYWJsZUVycm9yLFxuICAgIHBheWxvYWQ/OiBzdHJpbmcgfCBvYmplY3RcbiAgKTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnNob3VsZExvZyhMb2dMZXZlbC5FUlJPUikpIHtcbiAgICAgIGxldCBtZXNzYWdlOiBzdHJpbmc7XG4gICAgICBsZXQgZXJyb3JQYXlsb2FkOiBvYmplY3QgfCB1bmRlZmluZWQ7XG5cbiAgICAgIGlmIChtZXNzYWdlT3JFcnJvciBpbnN0YW5jZW9mIExvZ2dhYmxlRXJyb3IpIHtcbiAgICAgICAgbWVzc2FnZSA9IG1lc3NhZ2VPckVycm9yLm1lc3NhZ2U7XG4gICAgICAgIGVycm9yUGF5bG9hZCA9IG1lc3NhZ2VPckVycm9yLnRvSlNPTigpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWVzc2FnZSA9IG1lc3NhZ2VPckVycm9yO1xuICAgICAgICBlcnJvclBheWxvYWQgPSB0eXBlb2YgcGF5bG9hZCA9PT0gXCJvYmplY3RcIiA/IHBheWxvYWQgOiB1bmRlZmluZWQ7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGxvZ01lc3NhZ2UgPSBMb2dnYWJsZS5jcmVhdGVMb2dNZXNzYWdlKFxuICAgICAgICBcIkVSUk9SXCIsXG4gICAgICAgIG1lc3NhZ2UsXG4gICAgICAgIGVycm9yUGF5bG9hZCxcbiAgICAgICAgdGhpcy5jb25zdHJ1Y3Rvci5uYW1lXG4gICAgICApO1xuICAgICAgTG9nZ2FibGUucXVldWVTdHJhdGVneS5lbnF1ZXVlKGxvZ01lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9jZXNzZXMgdGhlIHF1ZXVlIG9mIGxvZyBtZXNzYWdlcy5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IEEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gcHJvY2Vzc2luZyBpcyBjb21wbGV0ZS5cbiAgICovXG4gIHByaXZhdGUgc3RhdGljIGFzeW5jIHByb2Nlc3NRdWV1ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoTG9nZ2FibGUuaXNQcm9jZXNzaW5nKSByZXR1cm47XG5cbiAgICBMb2dnYWJsZS5pc1Byb2Nlc3NpbmcgPSB0cnVlO1xuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gTG9nZ2FibGUucXVldWVTdHJhdGVneS5kZXF1ZXVlKCk7XG4gICAgICBpZiAoIW1lc3NhZ2UpIGJyZWFrO1xuXG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCAoTG9nZ2FibGUubG9nU3RyYXRlZ3kgfHwgREVGQVVMVF9MT0dfU1RSQVRFR1kpLnNlbmQobWVzc2FnZSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zb2xlLmVycm9yKFwiRmFpbGVkIHRvIHNlbmQgbWVzc2FnZTpcIiwgZXJyb3IpO1xuICAgICAgICAvLyBPcHRpb25hbGx5IHJlLWVucXVldWUgdGhlIG1lc3NhZ2Ugb3IgaW1wbGVtZW50IHJldHJ5IGxvZ2ljXG4gICAgICB9XG4gICAgfVxuICAgIExvZ2dhYmxlLmlzUHJvY2Vzc2luZyA9IGZhbHNlO1xuXG4gICAgLy8gSWYgdGhlcmUncyBubyBtb3JlIG1lc3NhZ2VzIGFuZCB3ZSdyZSBzaHV0dGluZyBkb3duLCByZXNvbHZlIHRoZSBzaHV0ZG93biBwcm9taXNlXG4gICAgaWYgKFxuICAgICAgTG9nZ2FibGUuc2h1dGRvd25Qcm9taXNlICYmXG4gICAgICBMb2dnYWJsZS5xdWV1ZVN0cmF0ZWd5LmRlcXVldWUoKSA9PT0gdW5kZWZpbmVkXG4gICAgKSB7XG4gICAgICBMb2dnYWJsZS5yZXNvbHZlU2h1dGRvd24oKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gU2NoZWR1bGUgdGhlIG5leHQgcHJvY2Vzc2luZyBjeWNsZVxuICAgICAgTG9nZ2FibGUuc2NoZWR1bGVOZXh0UHJvY2Vzc2luZygpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHNjaGVkdWxlTmV4dFByb2Nlc3NpbmcoKTogdm9pZCB7XG4gICAgaWYgKExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQoTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgIH1cbiAgICBMb2dnYWJsZS5wcm9jZXNzaW5nVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgTG9nZ2FibGUucHJvY2Vzc1F1ZXVlKCk7XG4gICAgfSwgMTAwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBTdGFydHMgcHJvY2Vzc2luZyB0aGUgcXVldWUgb2YgbG9nIG1lc3NhZ2VzLlxuICAgKi9cbiAgcHJpdmF0ZSBzdGF0aWMgc3RhcnRQcm9jZXNzaW5nKCk6IHZvaWQge1xuICAgIGlmICghTG9nZ2FibGUuaXNQcm9jZXNzaW5nICYmICFMb2dnYWJsZS5wcm9jZXNzaW5nVGltZW91dCkge1xuICAgICAgTG9nZ2FibGUuc2NoZWR1bGVOZXh0UHJvY2Vzc2luZygpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTaHV0cyBkb3duIHRoZSBsb2dnaW5nIHN5c3RlbS5cbiAgICovXG4gIHB1YmxpYyBzdGF0aWMgYXN5bmMgc2h1dGRvd24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKExvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0KSB7XG4gICAgICBjbGVhclRpbWVvdXQoTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQpO1xuICAgICAgTG9nZ2FibGUucHJvY2Vzc2luZ1RpbWVvdXQgPSBudWxsO1xuICAgIH1cblxuICAgIGlmICghTG9nZ2FibGUuc2h1dGRvd25Qcm9taXNlKSB7XG4gICAgICBMb2dnYWJsZS5zaHV0ZG93blByb21pc2UgPSBuZXcgUHJvbWlzZTx2b2lkPigocmVzb2x2ZSkgPT4ge1xuICAgICAgICBMb2dnYWJsZS5yZXNvbHZlU2h1dGRvd24gPSByZXNvbHZlO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIFByb2Nlc3MgYW55IHJlbWFpbmluZyBtZXNzYWdlc1xuICAgICAgYXdhaXQgTG9nZ2FibGUucHJvY2Vzc1F1ZXVlKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIExvZ2dhYmxlLnNodXRkb3duUHJvbWlzZTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhdGljIHJlc29sdmVTaHV0ZG93bjogKCkgPT4gdm9pZCA9ICgpID0+IHt9O1xuXG4gIHB1YmxpYyBzdGF0aWMgd2FrZVVwUXVldWUoKTogdm9pZCB7XG4gICAgaWYgKFxuICAgICAgIUxvZ2dhYmxlLmlzUHJvY2Vzc2luZyAmJlxuICAgICAgIUxvZ2dhYmxlLnByb2Nlc3NpbmdUaW1lb3V0ICYmXG4gICAgICAhTG9nZ2FibGUuc2h1dGRvd25Qcm9taXNlXG4gICAgKSB7XG4gICAgICBMb2dnYWJsZS5zdGFydFByb2Nlc3NpbmcoKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gZm9ybWF0UGF5bG9hZENvbnRlbnQocGF5bG9hZDogTG9nUGF5bG9hZCk6IHN0cmluZyB7XG4gIGNvbnN0IHRydW5jYXRlZENvbnRlbnQgPSBMb2dTdHJhdGVneS50cnVuY2F0ZUFuZFN0cmluZ2lmeShwYXlsb2FkLmNvbnRlbnQpO1xuXG4gIGlmIChwYXlsb2FkLnR5cGUgPT09IFwidGV4dFwiKSB7XG4gICAgcmV0dXJuIHRydW5jYXRlZENvbnRlbnQgYXMgc3RyaW5nO1xuICB9XG5cbiAgcmV0dXJuIHV0aWwuaW5zcGVjdCh0cnVuY2F0ZWRDb250ZW50LCB7IGRlcHRoOiBudWxsLCBjb2xvcnM6IHRydWUgfSk7XG59XG5cbmV4cG9ydCB7IGxvZ01ldGhvZCB9O1xuIl19