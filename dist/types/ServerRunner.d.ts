import { Loggable, LogLevel } from "./logging";
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
