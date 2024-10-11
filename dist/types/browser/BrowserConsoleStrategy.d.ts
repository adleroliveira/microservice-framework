import { IRequest } from "../interfaces";
import { LogLevel, LogStrategy } from "../logging/LogStrategy";
export declare class BrowserConsoleStrategy extends LogStrategy {
    private static readonly LOG_COLORS;
    constructor(maxStringLength?: number, maxDepth?: number);
    private isLogMessage;
    protected sendPackaged(packagedMessage: IRequest<any>, options?: Record<string, any>): Promise<void>;
    private formatLogMessage;
    private formatGenericMessage;
    log(message: any, logLevel?: LogLevel): Promise<void>;
    info(message: any, data?: any): Promise<void>;
    warn(message: any, data?: any): Promise<void>;
    error(message: any, data?: any): Promise<void>;
    debug(message: any, data?: any): Promise<void>;
}
