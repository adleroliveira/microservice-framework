import WebSocket from "ws";
import { ISessionStore } from "../interfaces";
export declare class WebsocketConnection {
    private handleMessage;
    private handleClose;
    private inactivityTimeout;
    private maxMessagesPerMinute;
    private connectionId;
    private lastActivityTime;
    private messageCount;
    private authenticated;
    private metadata;
    private websocket;
    private eventListenersSetup;
    private closePromise;
    constructor(handleMessage: (data: WebSocket.Data, websocket: WebsocketConnection) => void, handleClose: (connectionId: string) => void, inactivityTimeout?: number, // 5 minutes
    maxMessagesPerMinute?: number, websocket?: WebSocket);
    setWebSocket(websocket: WebSocket): void;
    private setupEventListeners;
    private startInactivityTimer;
    private handlePong;
    send(message: string): void;
    private handleCloseConnection;
    private handleWebsocketMessages;
    private isRateLimited;
    getConnectionId(): string;
    setAuthenticated(value: boolean): void;
    isAuthenticated(): boolean;
    close(code?: number, reason?: string): Promise<void>;
    ping(): void;
    isConnected(): boolean;
    setMetadata(key: string, value: any): void;
    getMetadata(key: string): any;
    refreshSession(sessionStore: ISessionStore): Promise<boolean>;
    static broadcast(message: string, connections: WebsocketConnection[]): void;
    getSessionId(): string | undefined;
}
