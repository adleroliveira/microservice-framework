import { IBackEnd, ChannelBinding } from "./interfaces";
import { RateLimitedTaskScheduler } from "./RateLimitedTaskScheduler";
import { Loggable, logMethod } from "./utils/logging/Loggable";
import { ConsoleStrategy } from "./utils/logging/ConsoleStrategy";
import { ServiceDiscoveryManager } from "./ServiceDiscoveryManager";
import { IRequest, IResponse, IRequestHeader } from "./interfaces";
import "reflect-metadata";
import { LogStrategy } from "./utils/logging/LogStrategy";
import { ServerRunner } from "./ServerRunner";
import { PubSubConsumer, PubSubConsumerOptions, MessageHandler } from "./PubSubConsumer";
export declare function RequestHandler<T>(requestType: string): <M extends (arg: T) => Promise<any> | any>(target: any, propertyKey: string, descriptor: TypedPropertyDescriptor<M>) => void;
export interface IServerConfig {
    namespace: string;
    concurrencyLimit?: number;
    requestsPerInterval?: number;
    interval?: number;
    tpsInterval?: number;
    serviceId: string;
    requestCallbackTimeout?: number;
    logStrategy?: LogStrategy;
    statusUpdateInterval?: number;
}
export interface ServiceStatus extends IServerConfig {
    instanceId: string;
    pendingRequests: number;
    queueSize: number;
    runningTasks: number;
    timestamp: number;
    address: string;
}
export interface StatusUpdate {
    status: string;
    progress?: number;
    metadata?: any;
}
export interface RequestProps {
    requestType: string;
    to: string;
    body: any;
    replyTo?: string;
    handleStatusUpdate?: (request: IRequest<any>, status: StatusUpdate) => Promise<void>;
    timeoutCallback?: () => void;
    timeout?: number;
    headers?: IRequestHeader;
    isBroadcast?: boolean;
}
export declare abstract class MicroserviceFramework<TRequestBody, TResponseData> extends RateLimitedTaskScheduler<IRequest<TRequestBody>, IResponse<TResponseData>> {
    private lobby;
    private serviceChannel;
    private statusUpdateTimeoutId;
    private pendingRequests;
    private requestHandlers;
    protected broadcastChannel: ChannelBinding<IRequest<any>>;
    protected backend: IBackEnd;
    protected serverConfig: IServerConfig;
    protected serviceId: string;
    protected isExecuting: boolean;
    protected statusUpdateInterval: number;
    protected requestCallbackTimeout: number;
    readonly address: string;
    readonly serviceDiscoveryManager: ServiceDiscoveryManager;
    readonly namespace: string;
    constructor(backend: IBackEnd, config: IServerConfig);
    initialize(): Promise<void>;
    private updateLoadLevel;
    protected startDependencies(): Promise<void>;
    protected stopDependencies(): Promise<void>;
    static createRequest<T>(requesterAddress: string, requestType: string, body: T, recipientAddress?: string): IRequest<T>;
    static createResponse<T>(request: IRequest<any>, responderAddress: string, data: T, success?: boolean, error?: Error | null): IResponse<T>;
    private getServerStatus;
    getserviceId(): string;
    getBackend(): IBackEnd;
    protected handleServiceMessages<T>(message: T): void;
    protected handleLobbyMessages(message: IRequest<any> | IResponse<any>): Promise<void>;
    private isServiceStatusRequest;
    private scheduleNextLoadLevelUpdate;
    private processRequest;
    private wrapAndProcessRequest;
    protected handleStatusUpdate(request: IRequest<TRequestBody>, status: StatusUpdate): Promise<void>;
    protected enrichResponse(response: IResponse<TResponseData>, originalRequest: IRequest<TRequestBody>): IResponse<TResponseData>;
    protected enrichRequest(header: IRequestHeader, body: any): IRequestHeader;
    private handleIncomingMessage;
    private isResponse;
    private handleResponse;
    private scheduleNewMessage;
    start(): Promise<void>;
    stop(): Promise<void>;
    private processAndNotify;
    private sendNotification;
    protected sendStatusUpdate(request: IRequest<TRequestBody>, status: StatusUpdate): Promise<void>;
    protected makeResponse(data: TResponseData, request: IRequest<TRequestBody>, error: Error | null): IResponse<TResponseData>;
    protected sendOneWayMessage(messageType: string, to: string, body: any, requestId?: string): Promise<void>;
    protected makeRequest<T>(props: RequestProps): Promise<IResponse<T>>;
    private generateRequestId;
}
export { ServerRunner, PubSubConsumer, PubSubConsumerOptions, MessageHandler, Loggable, ConsoleStrategy, logMethod, };
export * from "./interfaces";
