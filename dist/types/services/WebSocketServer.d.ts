import { ISessionData } from "../interfaces";
import { MicroserviceFramework, IServerConfig } from "../MicroserviceFramework";
import { IBackEnd, IRequest, ISessionStore, IAuthenticationProvider } from "../interfaces";
import { WebsocketConnection } from "./WebsocketConnection";
import { WebSocketAuthenticationMiddleware } from "./WebSocketAuthenticationMiddleware";
export interface HeartbeatRequest {
    timestamp: number;
}
export interface HeartbeatResponse {
    requestTimestamp: number;
    responseTimestamp: number;
}
export interface HeartbeatConfig {
    enabled: boolean;
    interval: number;
    timeout: number;
}
export interface AnonymousSessionConfig {
    enabled: boolean;
    sessionDuration?: number;
    persistentIdentityEnabled?: boolean;
    metadata?: Record<string, unknown>;
}
export interface AuthenticationConfig {
    required: boolean;
    allowAnonymous: boolean;
    anonymousConfig?: AnonymousSessionConfig;
    authProvider?: IAuthenticationProvider;
    sessionStore: ISessionStore;
    authenticationMiddleware?: WebSocketAuthenticationMiddleware;
}
export interface WebSocketServerConfig extends IServerConfig {
    port: number;
    path?: string;
    maxConnections?: number;
    authentication: AuthenticationConfig;
    heartbeatConfig?: HeartbeatConfig;
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
    private authConfig;
    private authenticationMiddleware?;
    private heartbeatConfig;
    constructor(backend: IBackEnd, config: WebSocketServerConfig);
    private setupWebSocketServer;
    private upgradeConnection;
    private validateAuthenticationConfig;
    private handleAuthentication;
    private createAnonymousSession;
    private extractDeviceId;
    private handleWsEvents;
    private refreshSession;
    private handleMessage;
    private handleClose;
    protected startDependencies(): Promise<void>;
    protected stopDependencies(): Promise<void>;
    protected defaultMessageHandler(request: IRequest<WebSocketMessage>): Promise<WebSocketResponse>;
    protected getConnections(): Map<string, WebsocketConnection>;
    broadcast(message: IRequest<any>): void;
    getSessionById(sessionId: string): Promise<ISessionData | null>;
    protected rawMessageHandler(message: string): Promise<string>;
}
