import { MicroserviceFramework, IServerConfig } from "../../MicroserviceFramework";
import { IBackEnd } from "../../interfaces";
export declare class PongService extends MicroserviceFramework<string, string> {
    constructor(backend: IBackEnd, config: IServerConfig);
    private pong;
    private delay;
}
