import { LogStrategy } from "./LogStrategy";
import { IRequest } from "../interfaces";
declare enum LogLevel {
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
    DEBUG = "DEBUG"
}
export declare class ConsoleStrategy extends LogStrategy {
    private static readonly LOG_COLORS;
    constructor(maxStringLength?: number, maxDepth?: number);
    private isLogMessage;
    protected sendPackaged(packagedMessage: IRequest<any>, options?: Record<string, any>): Promise<void>;
    private formatLogMessage;
    private formatGenericMessage;
    private formatPayload;
    log(message: any, logLevel?: LogLevel): Promise<void>;
    info(message: any): Promise<void>;
    warn(message: any): Promise<void>;
    error(message: any): Promise<void>;
    debug(message: any): Promise<void>;
}
export {};
