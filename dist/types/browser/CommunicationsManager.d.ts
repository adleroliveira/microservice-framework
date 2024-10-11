import EventEmitter from "eventemitter3";
import { IResponseData } from "../interfaces";
export interface ICommunicationsManagerConfig {
    url: string;
    secure?: boolean;
    authToken?: string;
    maxReconnectAttempts?: number;
    reconnectInterval?: number;
    heartbeatInterval?: number;
    requestTimeout?: number;
}
export declare class CommunicationsManager extends EventEmitter {
    private webSocketManager;
    private requestManager;
    private logger;
    constructor(config: ICommunicationsManagerConfig);
    private setupWebSocketHooks;
    onOpen(callback: () => void): void;
    onClose(callback: (event: CloseEvent) => void): void;
    onError(callback: (error: Event) => void): void;
    onMessage(callback: (data: string) => void): void;
    private handleMaxReconnectAttemptsReached;
    private validateConfig;
    request<I, O>(requestType: string, body: I, to?: string): Promise<IResponseData<O>>;
}
