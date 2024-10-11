import WebSocket from "ws";
export declare class WebsocketConnection {
    private websocket;
    private handleMessage;
    private handleClose;
    private inactivityTimeout;
    private maxMessagesPerMinute;
    private connectionId;
    private lastActivityTime;
    private messageCount;
    private authenticated;
    constructor(websocket: WebSocket, handleMessage: (data: WebSocket.Data, websocket: WebsocketConnection) => void, handleClose: (connectionId: string) => void, inactivityTimeout?: number, // 5 minutes
    maxMessagesPerMinute?: number);
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
    close(code?: number, reason?: string): void;
    ping(): void;
    static broadcast(message: string, connections: WebsocketConnection[]): void;
}
