import { MicroserviceFramework, IServerConfig } from "../../MicroserviceFramework";
import { IBackEnd } from "../../interfaces";
export declare class PingService extends MicroserviceFramework<string, string> {
    constructor(backend: IBackEnd, config: IServerConfig);
    protected startDependencies(): Promise<void>;
    private ping;
}
