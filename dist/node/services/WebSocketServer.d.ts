import { MicroserviceFramework, IServerConfig } from "../MicroserviceFramework";
import { IBackEnd, IRequest } from "../interfaces";
export interface WebSocketServerConfig extends IServerConfig {
    port: number;
    path?: string;
    maxConnections?: number;
}
export type WebSocketMessage = {
    type: string;
    data: any;
};
export interface WebSocketResponse {
}
export declare class WebSocketServer extends MicroserviceFramework<WebSocketMessage, WebSocketResponse> {
    private server;
    private wss;
    private connections;
    private port;
    private path;
    private maxConnections;
    constructor(backend: IBackEnd, config: WebSocketServerConfig);
    private setupWebSocketServer;
    private handleMessage;
    private handleClose;
    protected startDependencies(): Promise<void>;
    protected stopDependencies(): Promise<void>;
    protected defaultMessageHandler(request: IRequest<WebSocketMessage>): Promise<WebSocketResponse>;
    protected rawMessageHandler(message: string): Promise<string>;
    broadcast(message: WebSocketMessage): void;
    sendToConnection(connectionId: string, message: WebSocketMessage): void;
}
