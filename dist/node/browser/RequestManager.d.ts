import { IResponseData, IRequestHeader } from "../interfaces";
import EventEmitter from "eventemitter3";
import { WebSocketManager } from "./WebSocketManager";
export interface RequestManagerProps {
    webSocketManager: WebSocketManager;
    requestTimeout?: number;
}
export declare class RequestManager extends EventEmitter {
    private logger;
    private pendingRequests;
    private requestHandlers;
    private requestTimeout;
    private webSocketManager;
    private authToken;
    constructor(props: RequestManagerProps);
    request<I, O>(requestType: string, body: I, to?: string): Promise<IResponseData<O>>;
    private createRequest;
    private handleMessage;
    private handleIncomingRequest;
    private handleResponse;
    registerHandler<T, R>(requestType: string, handler: (payload: T, requestHeader: IRequestHeader) => Promise<R> | R): void;
    removeHandler(requestType: string): void;
    setAuthToken(token: string): void;
    clearAuthToken(): void;
    clearState(): void;
    destroy(): void;
}
