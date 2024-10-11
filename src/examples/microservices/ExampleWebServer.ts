import {
  WebServer,
  HttpRequest,
  HttpResponse,
  WebServerConfig,
} from "../../services/WebServer";
import { RequestHandler } from "../../MicroserviceFramework";
import { IBackEnd } from "../../interfaces";

export class ExampleWebServer extends WebServer {
  constructor(backend: IBackEnd, config: WebServerConfig) {
    super(backend, config);
  }

  @RequestHandler<HttpRequest>("GET:/example")
  public async exampleHandler(request: HttpRequest): Promise<HttpResponse> {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: { message: "This is a get example" },
    };
  }

  @RequestHandler<HttpRequest>("GET:/status")
  public async serviceStatus(request: HttpRequest): Promise<HttpResponse> {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: this.getServerStatus(),
    };
  }

  @RequestHandler<HttpRequest>("POST:/echo")
  public async echoHandler(request: HttpRequest): Promise<HttpResponse> {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: { message: request.body.body },
    };
  }
}
