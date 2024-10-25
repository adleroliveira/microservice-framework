import EventEmitter from "eventemitter3";
import { WebSocketState, AuthMethod, IWebSocketAuthConfig } from "./WebSocketManager";
import { IResponseData } from "../interfaces";
export interface ICommunicationsManagerConfig {
    url: string;
    secure?: boolean;
    auth?: {
        method: AuthMethod;
        token?: string;
        credentials?: {
            username: string;
            password: string;
        };
    };
    maxReconnectAttempts?: number;
    reconnectInterval?: number;
    heartbeatInterval?: number;
    requestTimeout?: number;
}
export declare class CommunicationsManager extends EventEmitter {
    private webSocketManager;
    private requestManager;
    private logger;
    private config;
    constructor(config: ICommunicationsManagerConfig);
    private initializeManagers;
    private cleanupCurrentState;
    private setupWebSocketHooks;
    authenticate(authConfig: IWebSocketAuthConfig): Promise<void>;
    switchToAnonymous(): Promise<void>;
    onOpen(callback: () => void): void;
    onClose(callback: (event: CloseEvent) => void): void;
    onError(callback: (error: Event) => void): void;
    onMessage(callback: (data: string) => void): void;
    private handleMaxReconnectAttemptsReached;
    private validateConfig;
    request<I, O>(requestType: string, body: I, to?: string): Promise<IResponseData<O>>;
    registerMessageHandler(messageType: string, handler: (data: any) => void): void;
    getConnectionState(): WebSocketState;
    updateAuthentication(auth: IWebSocketAuthConfig): void;
    isAuthenticated(): boolean;
    getCurrentMode(): "anonymous" | "authenticated";
    destroy(): void;
}
