import WebSocket from "ws";
import { ISessionStore } from "../interfaces";
interface ConnectionEvents {
    onRateLimit: (connectionId: string) => void;
    onError: (connectionId: string, error: Error) => void;
    onSecurityViolation: (connectionId: string, violation: string) => void;
}
export declare class WebsocketConnection {
    private handleMessage;
    private handleClose;
    private inactivityTimeout;
    private maxMessagesPerMinute;
    private events?;
    private static readonly MAX_MESSAGE_SIZE;
    private static readonly SESSION_REFRESH_INTERVAL;
    private static readonly FORCED_CLOSE_TIMEOUT;
    private connectionId;
    private lastActivityTime;
    private messageCount;
    private authenticated;
    private metadata;
    private websocket;
    private eventListenersSetup;
    private closePromise;
    private sessionRefreshTimer?;
    private lastMessageHash;
    constructor(handleMessage: (data: WebSocket.Data, websocket: WebsocketConnection) => void, handleClose: (connectionId: string) => void, inactivityTimeout?: number, // 5 minutes
    maxMessagesPerMinute?: number, events?: ConnectionEvents | undefined, websocket?: WebSocket);
    setWebSocket(websocket: WebSocket): void;
    private cleanupExistingConnection;
    private setupEventListeners;
    private handleError;
    private handleUnexpectedResponse;
    private startInactivityTimer;
    private handlePong;
    send(message: string): void;
    private handleCloseConnection;
    private handleWebsocketMessages;
    private calculateMessageHash;
    private dataToString;
    private getDataSize;
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
    startSessionRefresh(sessionStore: ISessionStore): void;
    stopSessionRefresh(): void;
    static broadcast(message: string, connections: WebsocketConnection[]): void;
    getSessionId(): string | undefined;
}
export {};
