import { Loggable, LogLevel } from "./utils/logging/Loggable";
import { MicroserviceFramework } from "./MicroserviceFramework";
export declare class ServerRunner extends Loggable {
    private serviceId;
    private serviceInstance;
    private logLevel;
    private logStrategy;
    constructor(serviceInstance: MicroserviceFramework<any, any>, logLevel?: LogLevel);
    private inititalize;
    private setLogStrategy;
    private handleSigint;
    private handleShutdown;
    private handleUnhandledRejection;
    stop(): void;
    start(): void;
}
