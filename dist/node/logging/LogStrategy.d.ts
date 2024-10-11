import { IRequest, IRequestHeader } from "../interfaces";
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
export declare abstract class LogStrategy {
    protected MAX_STRING_LENGTH?: number;
    protected MAX_DEPTH?: number;
    protected abstract sendPackaged(packagedMessage: IRequest<any>, options?: Record<string, any>): Promise<void>;
    constructor();
    send(message: any, options?: Record<string, any>): Promise<void>;
    protected createRequestHeader(): IRequestHeader;
    static truncateAndStringify(value: any, depth?: number, maxStringLength?: number, maxDepth?: number): any;
    private static isBufferOrArrayBufferView;
}
