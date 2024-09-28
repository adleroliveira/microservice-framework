import { IRequest, IRequestHeader } from "../../interfaces";
export declare abstract class LogStrategy {
    protected MAX_STRING_LENGTH?: number;
    protected MAX_DEPTH?: number;
    protected abstract sendPackaged(packagedMessage: IRequest<any>, options?: Record<string, any>): Promise<void>;
    send(message: any, options?: Record<string, any>): Promise<void>;
    protected createRequestHeader(): IRequestHeader;
    static truncateAndStringify(value: any, depth?: number, maxStringLength?: number, maxDepth?: number): any;
}
export declare class ConsoleStrategy extends LogStrategy {
    constructor(maxStringLength?: number, maxDepth?: number);
    protected sendPackaged(packagedMessage: IRequest<any>, options?: Record<string, any>): Promise<void>;
}
