import { MicroserviceFramework, IServerConfig, IBackEnd } from "../../../MicroserviceFramework";
export declare class PongService extends MicroserviceFramework<string, string> {
    constructor(backend: IBackEnd, config: IServerConfig);
    private pong;
    private delay;
}
