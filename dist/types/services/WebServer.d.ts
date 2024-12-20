import http from "http";
import { MicroserviceFramework, IServerConfig } from "../MicroserviceFramework";
import { IBackEnd, IRequest, ISessionStore, IAuthenticationProvider } from "../interfaces";
export type HttpRequest = {
    method: string;
    path: string;
    query: Record<string, string>;
    headers: Record<string, string>;
    body?: any;
    rawRequest?: http.IncomingMessage;
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
    apiPrefix?: string;
    authProvider?: IAuthenticationProvider;
    sessionStore?: ISessionStore;
}
export declare class WebServer extends MicroserviceFramework<HttpRequest, HttpResponse> {
    private server;
    private port;
    private maxBodySize;
    private timeout;
    private corsOrigin;
    private staticDir;
    private apiPrefix;
    constructor(backend: IBackEnd, config: WebServerConfig);
    private handleRequest;
    private handleApiRequest;
    private handleStaticRequest;
    private serveStaticFile;
    private sendStaticResponse;
    private getContentType;
    private parseBody;
    private sendResponse;
    private negotiateContentEncoding;
    private compressContent;
    private processHttpRequest;
    protected startDependencies(): Promise<void>;
    shutdown(): Promise<void>;
    private isConnectionAlive;
    private destroyConnection;
    protected stopDependencies(): Promise<void>;
    protected defaultMessageHandler(request: IRequest<HttpRequest>): Promise<HttpResponse>;
}
