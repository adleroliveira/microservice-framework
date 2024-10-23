import EventEmitter from "eventemitter3";
export declare enum WebSocketState {
    CONNECTING = 0,
    OPEN = 1,
    CLOSING = 2,
    CLOSED = 3
}
export declare enum AuthMethod {
    TOKEN = "token",
    CREDENTIALS = "auth"
}
export interface IWebSocketAuthConfig {
    method: AuthMethod;
    token?: string;
    credentials?: {
        username: string;
        password: string;
    };
}
export interface IWebSocketManagerConfig {
    url: string;
    secure?: boolean;
    auth?: IWebSocketAuthConfig;
    maxReconnectAttempts?: number;
    reconnectInterval?: number;
    connectionTimeout?: number;
}
export declare class WebSocketManager extends EventEmitter {
    private logger;
    private ws;
    private url;
    private secure;
    private auth?;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectInterval;
    private state;
    private connectionTimeout;
    private connectionTimer?;
    private protocols;
    constructor(config: IWebSocketManagerConfig);
    private setupAuthProtocols;
    private connect;
    private handleConnectionError;
    private getSecureUrl;
    private setHooks;
    private checkAuthRequirement;
    private handleReconnection;
    private setConnectionTimeout;
    private clearConnectionTimeout;
    private parseMessage;
    send(message: string | object): void;
    close(): void;
    reconnect(): void;
    getState(): WebSocketState;
    getReadyState(): number;
    setAuthConfig(authConfig: IWebSocketAuthConfig): void;
    isAuthenticated(): boolean;
    reconnectWithNewAuth(authConfig: IWebSocketAuthConfig): void;
}
