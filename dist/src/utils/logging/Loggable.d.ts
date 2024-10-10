import { IQueueStrategy } from "../../interfaces";
import { LogStrategy } from "./LogStrategy";
/**
 * Enum representing different log levels.
 */
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
/**
 * Type representing the payload type of a log message.
 */
export type PayloadType = "text" | "json";
/**
 * Interface representing the payload of a log message.
 */
export interface LogPayload {
    /** The type of the payload. */
    type: PayloadType;
    /** The content of the payload. */
    content: string | object;
}
/**
 * Interface representing a log message.
 */
export interface LogMessage {
    sender?: string;
    /** The timestamp of the log message. */
    timestamp: string;
    /** The log level of the message. */
    level: string;
    /** The content of the log message. */
    message: string;
    /** Optional payload for additional information. */
    payload?: LogPayload;
}
declare function logMethod(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor;
export declare class LoggableError extends Error {
    readonly payload: any;
    readonly originalError: Error | undefined;
    constructor(message: string, payload?: any, originalError?: Error);
    private getThrowingClassName;
    toJSON(): {
        name: string;
        message: string;
        payload: any;
        throwingClass: string | null;
        stack: string | undefined;
    };
    toString(): string;
}
/**
 * Abstract base class for objects that can log messages.
 */
export declare abstract class Loggable {
    static logStrategy: LogStrategy;
    private static queueStrategy;
    private static logLevel;
    private static isProcessing;
    private static processingTimeout;
    static LogLevel: typeof LogLevel;
    protected static LoggableError: typeof LoggableError;
    protected static DefaultLoggableError: {
        new (message: string, payload?: any, originalError?: Error): {
            readonly payload: any;
            readonly originalError: Error | undefined;
            toJSON(): {
                name: string;
                message: string;
                payload: any;
                stack: string | undefined;
                originalError: {
                    name: string;
                    message: string;
                    stack: string | undefined;
                } | undefined;
            };
            name: string;
            message: string;
            stack?: string;
        };
        captureStackTrace(targetObject: object, constructorOpt?: Function): void;
        prepareStackTrace?: ((err: Error, stackTraces: NodeJS.CallSite[]) => any) | undefined;
        stackTraceLimit: number;
    };
    static FormatLogMessage(message: LogMessage): string;
    protected static handleErrors(target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor;
    /**
     * Protected constructor to ensure the class is properly initialized.
     * @throws {Error} If the class is not initialized.
     */
    protected constructor();
    /**
     * Sets the log strategy.
     * @param {LogStrategy} strategy - The new log strategy to use.
     */
    static setLogStrategy(strategy?: LogStrategy): void;
    /**
     * Sets the queue strategy.
     * @param {IQueueStrategy<LogMessage>} strategy - The new queue strategy to use.
     */
    static setQueueStrategy(strategy: IQueueStrategy<LogMessage>): void;
    /**
     * Sets the log level.
     * @param {LogLevel} level - The new log level to use.
     */
    static setLogLevel(level: LogLevel): void;
    private logAndThrowError;
    /**
     * Waits for the queue to be empty.
     * @returns {Promise<void>} A promise that resolves when the queue is empty.
     */
    private static waitForEmptyQueue;
    /**
     * Checks if a message with the given level should be logged.
     * @param {LogLevel} messageLevel - The level of the message to check.
     * @returns {boolean} True if the message should be logged, false otherwise.
     */
    static shouldLog(messageLevel: LogLevel): boolean;
    /**
     * Returns a value after ensuring all logs have been processed.
     * @param {T} value - The value to return.
     * @returns {Promise<T>} A promise that resolves with the value after all logs are processed.
     */
    returnAfterLogging<T>(value: T): Promise<T>;
    /**
     * Creates a log message object.
     * @param {string} level - The log level.
     * @param {string} message - The log message.
     * @param {string | object} [payload] - Optional payload for additional information.
     * @param {string} [className] - Optional class name for context.
     * @returns {LogMessage} The created log message object.
     */
    private static createLogMessage;
    private static logWithLevel;
    static logDebug(message: string, payload?: string | object, className?: string): void;
    static logError(message: string, payload?: string | object, className?: string): void;
    /**
     * Logs a debug message for the current instance.
     * @param {string} message - The debug message.
     * @param {string | object} [payload] - Optional payload for additional information.
     */
    protected debug(message: string, payload?: string | object): void;
    /**
     * Logs an info message for the current instance.
     * @param {string} message - The info message.
     * @param {string | object} [payload] - Optional payload for additional information.
     */
    protected info(message: string, payload?: string | object): void;
    /**
     * Logs a warning message for the current instance.
     * @param {string} message - The warning message.
     * @param {string | object} [payload] - Optional payload for additional information.
     */
    protected warn(message: string, payload?: string | object): void;
    /**
     * Logs an error message for the current instance.
     * @param {string | LoggableError} messageOrError - The error message or LoggableError object.
     * @param {string | object} [payload] - Optional payload for additional information (used only if message is a string).
     */
    protected error(messageOrError: string | LoggableError, payload?: string | object): void;
    /**
     * Processes the queue of log messages.
     * @returns {Promise<void>} A promise that resolves when processing is complete.
     */
    private static processQueue;
    /**
     * Starts processing the queue of log messages.
     */
    private static startProcessing;
    /**
     * Shuts down the logging system.
     */
    static shutdown(): Promise<void>;
}
export { logMethod };
