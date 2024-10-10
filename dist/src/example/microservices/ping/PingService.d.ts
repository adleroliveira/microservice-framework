import { MicroserviceFramework, IServerConfig, IBackEnd } from "../../../MicroserviceFramework";
export declare class PingService extends MicroserviceFramework<string, string> {
    constructor(backend: IBackEnd, config: IServerConfig);
    private ping;
}
