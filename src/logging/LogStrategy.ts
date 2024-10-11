import { IRequest, IRequestHeader } from "../interfaces";
import { v4 as uuidv4 } from "uuid";

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
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

export abstract class LogStrategy {
  protected MAX_STRING_LENGTH?: number;
  protected MAX_DEPTH?: number;
  protected abstract sendPackaged(
    packagedMessage: IRequest<any>,
    options?: Record<string, any>
  ): Promise<void>;

  constructor() {}

  async send(message: any, options?: Record<string, any>): Promise<void> {
    const truncatedMessage = LogStrategy.truncateAndStringify(
      message,
      0,
      this.MAX_STRING_LENGTH,
      this.MAX_DEPTH
    );

    const packagedMessage: IRequest<any> = {
      header: this.createRequestHeader(),
      body: truncatedMessage,
    };

    await this.sendPackaged(packagedMessage, options);
  }

  protected createRequestHeader(): IRequestHeader {
    return {
      timestamp: Date.now(),
      requestId: uuidv4(),
      requesterAddress: "log-strategy",
      requestType: "LOG::MESSAGE",
    };
  }

  static truncateAndStringify(
    value: any,
    depth: number = 0,
    maxStringLength = 5000,
    maxDepth = 10
  ): any {
    if (depth > maxDepth) {
      return "[Object depth limit exceeded]";
    }

    if (value === undefined || value === null) {
      return value;
    }

    if (typeof value === "string") {
      return value.length > maxStringLength
        ? value.substring(0, maxStringLength) + "..."
        : value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.truncateAndStringify(value.message),
        stack: this.truncateAndStringify(value.stack),
      };
    }

    if (this.isBufferOrArrayBufferView(value)) {
      return `[Binary data of length ${value.byteLength}]`;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.truncateAndStringify(item, depth + 1));
    }

    if (typeof value === "object") {
      const truncatedObject: { [key: string]: any } = {};
      for (const [key, prop] of Object.entries(value)) {
        truncatedObject[key] = this.truncateAndStringify(prop, depth + 1);
      }
      return truncatedObject;
    }

    return "[Unserializable data]";
  }

  private static isBufferOrArrayBufferView(value: any): boolean {
    // Check for Buffer in Node.js environment
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return true;
    }

    // Check for ArrayBuffer view in browser environment
    if (ArrayBuffer.isView(value)) {
      return true;
    }

    // Check if value is an ArrayBuffer
    if (value instanceof ArrayBuffer) {
      return true;
    }

    return false;
  }
}
