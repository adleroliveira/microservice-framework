import { WebSocketServer, WebSocketServerConfig } from "../../services";

import { RequestHandler } from "../../MicroserviceFramework";
import { IBackEnd, IRequest } from "../../interfaces";

interface Config extends WebSocketServerConfig {}

export class ExampleWebSocketServer extends WebSocketServer {
  constructor(backend: IBackEnd, config: WebSocketServerConfig) {
    super(backend, config);
  }

  @RequestHandler<IRequest<string>>("/echo")
  public async exampleHandler(request: IRequest<string>): Promise<string> {
    this.info("Request", request);
    return request.body;
  }
}
