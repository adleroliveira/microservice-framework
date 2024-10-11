import { IResponseData } from "../interfaces";
import EventEmitter from "eventemitter3";
import { WebSocketManager } from "./WebSocketManager";
export interface RequestManagerProps {
    webSocketManager: WebSocketManager;
    requestTimeout?: number;
}
export declare class RequestManager extends EventEmitter {
    private logger;
    private pendingRequests;
    private requestTimeout;
    private webSocketManager;
    private authToken;
    constructor(props: RequestManagerProps);
    request<I, O>(requestType: string, body: I, to?: string): Promise<IResponseData<O>>;
    private createRequest;
    private handleMessage;
    private handleIncomingRequest;
    private handleResponse;
    setAuthToken(token: string): void;
    clearAuthToken(): void;
}
