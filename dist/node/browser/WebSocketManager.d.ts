import EventEmitter from "eventemitter3";
export declare enum WebSocketState {
    CONNECTING = 0,
    OPEN = 1,
    CLOSING = 2,
    CLOSED = 3
}
export declare class WebSocketManager extends EventEmitter {
    private logger;
    private ws;
    private url;
    private secure;
    private reconnectAttempts;
    private maxReconnectAttempts;
    private reconnectInterval;
    private state;
    private connectionTimeout;
    private connectionTimer?;
    constructor(url: string, secure?: boolean, maxReconnectAttempts?: number, reconnectInterval?: number, connectionTimeout?: number);
    private connect;
    private getSecureUrl;
    private setHooks;
    private handleReconnection;
    private setConnectionTimeout;
    private clearConnectionTimeout;
    private parseMessage;
    send(message: string | object): void;
    close(): void;
    reconnect(): void;
    getState(): WebSocketState;
    getReadyState(): number;
}
