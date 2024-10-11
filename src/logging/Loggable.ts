import { IQueueStrategy } from "../interfaces";
import { LogStrategy } from "./LogStrategy";
import { InMemoryQueueStrategy } from "../core/InMemoryQueueStrategy";
import { LogLevel, LogMessage, LogPayload } from "./LogStrategy";
import util from "util";

/**
 * @fileoverview This module provides a logging system with different log levels,
 * notification strategies, and queue strategies.
 */

import { setTimeout, clearTimeout } from "timers";

/**
 * Enum representing different log levels.
 */

function logMethod() {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const className = this.constructor.name;
      const truncatedArgs = LogStrategy.truncateAndStringify(args);

      const logResult = (result: any) => {
        if (Loggable.shouldLog(LogLevel.DEBUG)) {
          const truncatedResult = LogStrategy.truncateAndStringify(result);
          const message = {
            args: truncatedArgs,
            result: truncatedResult,
          };
          Loggable.logDebug(
            `LogMethodDecorator::${className}::${propertyKey}`,
            message,
            className
          );
        }
        return result;
      };

      const logError = (error: any) => {
        const errorMessage = `${className}::${propertyKey} resulted in error`;
        const truncatedError =
          error instanceof LoggableError
            ? error.toJSON()
            : LogStrategy.truncateAndStringify(error.message || error);

        const message = {
          args: truncatedArgs,
          error: truncatedError,
        };
        Loggable.logError(
          `LogMethodDecorator::${errorMessage}`,
          message,
          className
        );
        throw error;
      };

      try {
        const result = originalMethod.apply(this, args);

        if (result instanceof Promise) {
          return result.then(logResult, logError);
        } else {
          return logResult(result);
        }
      } catch (error: any) {
        return logError(error);
      }
    };
    return descriptor;
  };
}

export class LoggableError extends Error {
  public readonly payload: any;
  public readonly originalError: Error | undefined;

  constructor(message: string, payload?: any, originalError?: Error) {
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

  private getThrowingClassName(): string | null {
    // Get the stack trace
    const stack = this.stack?.split("\n");
    if (!stack || stack.length < 4) return null;

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

  public toJSON() {
    return {
      name: this.name,
      message: this.message,
      payload: this.payload,
      throwingClass: this.getThrowingClassName(),
      stack: this.stack,
    };
  }

  public toString(): string {
    return JSON.stringify(this.toJSON(), null, 2);
  }
}

/**
 * Abstract base class for objects that can log messages.
 */
export abstract class Loggable {
  public static logStrategy: LogStrategy;
  private static queueStrategy: IQueueStrategy<LogMessage> =
    new InMemoryQueueStrategy<LogMessage>();
  private static logLevel: LogLevel = LogLevel.INFO;
  private static isProcessing: boolean = false;
  private static processingTimeout: NodeJS.Timeout | null = null;
  static LogLevel = LogLevel;
  protected static LoggableError = LoggableError;
  protected static DefaultLoggableError = class extends Error {
    public readonly payload: any;
    public readonly originalError: Error | undefined;

    constructor(message: string, payload?: any, originalError?: Error) {
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

    public toJSON() {
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

  public static FormatLogMessage(message: LogMessage): string {
    let timestamp: string;
    try {
      timestamp = new Date(message.timestamp).toISOString().slice(0, -5);
    } catch (error) {
      // Handle invalid date
      console.error(`Invalid timestamp: ${message.timestamp}`, message);
      timestamp = "Invalid Date";
    }

    let formattedMessage = `[${timestamp}] ${
      message.level?.toUpperCase() ?? "UNKNOWN"
    }: ${message.message}`;

    if (message.payload) {
      formattedMessage += "\nPayload:";
      formattedMessage += `\n  Type: ${message.payload.type}`;
      formattedMessage += `\n  Content: ${formatPayloadContent(
        message.payload
      )}`;
    }

    return formattedMessage;
  }

  protected static handleErrors(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any[]) {
      try {
        const result = originalMethod.apply(this, args);
        if (result instanceof Promise) {
          return result.catch((error: any) => {
            if (this instanceof Loggable) {
              const truncatedArgs = LogStrategy.truncateAndStringify(args, 300);
              return this.logAndThrowError(error, truncatedArgs);
            } else {
              console.warn(
                `handleErrors decorator used on non-Loggable class: ${target.constructor.name}`
              );
              throw error;
            }
          });
        }
        return result;
      } catch (error: any) {
        if (this instanceof Loggable) {
          return this.logAndThrowError(error);
        } else {
          console.warn(
            `handleErrors decorator used on non-Loggable class: ${target.constructor.name}`
          );
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
  protected constructor() {
    if (!Loggable.isProcessing) {
      Loggable.startProcessing();
    }
  }

  /**
   * Sets the log strategy.
   * @param {LogStrategy} strategy - The new log strategy to use.
   */
  public static setLogStrategy(strategy: LogStrategy): void {
    Loggable.logStrategy = strategy;
  }

  /**
   * Sets the queue strategy.
   * @param {IQueueStrategy<LogMessage>} strategy - The new queue strategy to use.
   */
  public static setQueueStrategy(strategy: IQueueStrategy<LogMessage>): void {
    Loggable.queueStrategy = strategy;
  }

  /**
   * Sets the log level.
   * @param {LogLevel} level - The new log level to use.
   */
  public static setLogLevel(level: LogLevel): void {
    Loggable.logLevel = level;
  }

  private async logAndThrowError(error: any, args: any = {}): Promise<never> {
    const ErrorClass =
      (this.constructor as typeof Loggable).LoggableError ||
      Loggable.DefaultLoggableError;

    let loggableError: LoggableError;

    if (error instanceof ErrorClass) {
      loggableError = error;
    } else {
      loggableError = new ErrorClass(
        error.message,
        { originalArgs: args },
        error
      );

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
  private static waitForEmptyQueue(): Promise<void> {
    return new Promise<void>((resolve) => {
      const checkQueue = () => {
        if (
          !Loggable.isProcessing &&
          Loggable.queueStrategy.dequeue() === undefined
        ) {
          resolve();
        } else {
          setTimeout(checkQueue, 100); // Check again after 100ms
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
  public static shouldLog(messageLevel: LogLevel): boolean {
    return messageLevel >= Loggable.logLevel;
  }

  /**
   * Returns a value after ensuring all logs have been processed.
   * @param {T} value - The value to return.
   * @returns {Promise<T>} A promise that resolves with the value after all logs are processed.
   */
  public async returnAfterLogging<T>(value: T): Promise<T> {
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
  private static createLogMessage(
    level: string,
    message: string,
    payload?: string | object,
    className?: string
  ): LogMessage {
    const prefixedMessage = className ? `${className}::${message}` : message;
    const logPayload: LogPayload | undefined = payload
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

  private static logWithLevel(
    level: LogLevel,
    message: string,
    payload?: string | object,
    className?: string
  ): void {
    if (Loggable.shouldLog(level)) {
      const logMessage = Loggable.createLogMessage(
        LogLevel[level],
        message,
        payload,
        className
      );
      Loggable.queueStrategy.enqueue(logMessage);
    }
  }

  public static logDebug(
    message: string,
    payload?: string | object,
    className?: string
  ): void {
    Loggable.logWithLevel(LogLevel.DEBUG, message, payload, className);
  }

  public static logError(
    message: string,
    payload?: string | object,
    className?: string
  ): void {
    Loggable.logWithLevel(LogLevel.ERROR, message, payload, className);
  }

  /**
   * Logs a debug message for the current instance.
   * @param {string} message - The debug message.
   * @param {string | object} [payload] - Optional payload for additional information.
   */
  protected debug(message: string, payload?: string | object): void {
    Loggable.logDebug(message, payload, this.constructor.name);
  }

  /**
   * Logs an info message for the current instance.
   * @param {string} message - The info message.
   * @param {string | object} [payload] - Optional payload for additional information.
   */
  protected info(message: string, payload?: string | object): void {
    if (Loggable.shouldLog(LogLevel.INFO)) {
      const logMessage = Loggable.createLogMessage(
        "INFO",
        message,
        payload,
        this.constructor.name
      );
      Loggable.queueStrategy.enqueue(logMessage);
    }
  }

  /**
   * Logs a warning message for the current instance.
   * @param {string} message - The warning message.
   * @param {string | object} [payload] - Optional payload for additional information.
   */
  protected warn(message: string, payload?: string | object): void {
    if (Loggable.shouldLog(LogLevel.WARN)) {
      const logMessage = Loggable.createLogMessage(
        "WARN",
        message,
        payload,
        this.constructor.name
      );
      Loggable.queueStrategy.enqueue(logMessage);
    }
  }

  /**
   * Logs an error message for the current instance.
   * @param {string | LoggableError} messageOrError - The error message or LoggableError object.
   * @param {string | object} [payload] - Optional payload for additional information (used only if message is a string).
   */
  protected error(
    messageOrError: string | LoggableError,
    payload?: string | object
  ): void {
    if (Loggable.shouldLog(LogLevel.ERROR)) {
      let message: string;
      let errorPayload: object | undefined;

      if (messageOrError instanceof LoggableError) {
        message = messageOrError.message;
        errorPayload = messageOrError.toJSON();
      } else {
        message = messageOrError;
        errorPayload = typeof payload === "object" ? payload : undefined;
      }

      const logMessage = Loggable.createLogMessage(
        "ERROR",
        message,
        errorPayload,
        this.constructor.name
      );
      Loggable.queueStrategy.enqueue(logMessage);
    }
  }

  /**
   * Processes the queue of log messages.
   * @returns {Promise<void>} A promise that resolves when processing is complete.
   */
  private static async processQueue(): Promise<void> {
    if (Loggable.isProcessing) return;

    Loggable.isProcessing = true;
    while (true) {
      const message = Loggable.queueStrategy.dequeue();
      if (!message) break;

      try {
        await Loggable.logStrategy.send(message);
      } catch (error) {
        console.error("Failed to send message:", error);
        // Optionally re-enqueue the message or implement retry logic
      }
    }
    Loggable.isProcessing = false;
  }

  /**
   * Starts processing the queue of log messages.
   */
  private static startProcessing(): void {
    const scheduleProcessing = () => {
      Loggable.processingTimeout = setTimeout(() => {
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
  public static async shutdown(): Promise<void> {
    if (Loggable.processingTimeout) {
      clearTimeout(Loggable.processingTimeout);
      await Loggable.waitForEmptyQueue();
    }
  }
}

function formatPayloadContent(payload: LogPayload): string {
  const truncatedContent = LogStrategy.truncateAndStringify(payload.content);

  if (payload.type === "text") {
    return truncatedContent as string;
  }

  return util.inspect(truncatedContent, { depth: null, colors: true });
}

export { logMethod };
