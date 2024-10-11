import { MicroserviceFramework, IServerConfig } from "../MicroserviceFramework";
import { IBackEnd, IRequest } from "../interfaces";
export type HttpRequest = {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body: any;
};
export type HttpResponse = {
    statusCode: number;
    headers: Record<string, string>;
    body: any;
};
export interface WebServerConfig extends IServerConfig {
    port: number;
    maxBodySize?: number;
    timeout?: number;
    corsOrigin?: string;
    staticDir?: string;
}
export declare class WebServer extends MicroserviceFramework<HttpRequest, HttpResponse> {
    private server;
    private port;
    private maxBodySize;
    private timeout;
    private corsOrigin;
    private staticDir;
    constructor(backend: IBackEnd, config: WebServerConfig);
    private handleRequest;
    private serveStaticFile;
    private sendStaticResponse;
    private getContentType;
    private parseBody;
    private sendResponse;
    private negotiateContentEncoding;
    private processHttpRequest;
    protected startDependencies(): Promise<void>;
    protected stopDependencies(): Promise<void>;
    protected defaultMessageHandler(request: IRequest<HttpRequest>): Promise<HttpResponse>;
}
