import { Loggable, LogLevel } from "./utils/logging/Loggable";
import { MicroserviceFramework } from "./MicroserviceFramework";
export declare class ServerRunner extends Loggable {
    private services;
    private logLevel;
    private isStarted;
    constructor(serviceInstanceOrLogLevel?: MicroserviceFramework<any, any> | LogLevel, logLevel?: LogLevel);
    private initialize;
    private setLogStrategy;
    registerService(serviceInstance: MicroserviceFramework<any, any>): void;
    private handleSigint;
    private handleShutdown;
    private handleUnhandledRejection;
    stop(): Promise<void>;
    start(): Promise<void>;
}
