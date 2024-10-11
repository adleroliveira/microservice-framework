import { WebSocketServer, WebSocketServerConfig } from "../../services";
import { IBackEnd, IRequest } from "../../interfaces";
export declare class ExampleWebSocketServer extends WebSocketServer {
    constructor(backend: IBackEnd, config: WebSocketServerConfig);
    exampleHandler(request: IRequest<string>): Promise<string>;
}
