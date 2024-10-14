import { MicroserviceFramework, IServerConfig } from "../MicroserviceFramework";
import { IBackEnd, IRequest, IResponse } from "../interfaces";
import { WebsocketConnection } from "./WebsocketConnection";
export interface WebSocketServerConfig extends IServerConfig {
    port: number;
    path?: string;
    maxConnections?: number;
}
export type WebSocketMessage = {
    type: string;
    data: any;
    connectionId: string;
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
    protected getConnections(): Map<string, WebsocketConnection>;
    protected rawMessageHandler(message: string): Promise<string>;
    broadcast(message: IRequest<WebSocketMessage>): void;
    sendToConnection(connectionId: string, message: IResponse<WebSocketMessage>): void;
}
