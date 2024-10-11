import { WebServer, HttpRequest, HttpResponse, WebServerConfig } from "../../services/WebServer";
import { IBackEnd } from "../../interfaces";
export declare class ExampleWebServer extends WebServer {
    constructor(backend: IBackEnd, config: WebServerConfig);
    exampleHandler(request: HttpRequest): Promise<HttpResponse>;
    serviceStatus(request: HttpRequest): Promise<HttpResponse>;
    echoHandler(request: HttpRequest): Promise<HttpResponse>;
}
