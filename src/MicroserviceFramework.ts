import { IBackEnd, ChannelBinding } from "./interfaces";
import {
  RateLimitedTaskScheduler,
  TaskOutput,
} from "./core//RateLimitedTaskScheduler";
import { Loggable, LoggableError, LogMessage } from "./logging";
import { ServiceDiscoveryManager } from "./core//ServiceDiscoveryManager";
import { IRequest, IResponse, IRequestHeader } from "./interfaces";
import "reflect-metadata";
import { v4 as uuidv4 } from "uuid";
import { LogStrategy } from "./logging/LogStrategy";
import chalk from "chalk";

const REQUEST_HANDLER_METADATA_KEY = Symbol("requestHandler");

interface RequestHandlerMetadata {
  requestType: string;
  method: string;
  acceptsFullRequest: boolean;
  isAsync: boolean;
}

type IsFullRequest<T> = T extends IRequest<any> ? true : false;

// Helper function to determine if the handler accepts full request
function isFullRequestHandler<T>(): boolean {
  return {} as IsFullRequest<T> as boolean;
}
// Decorator
export function RequestHandler<T>(requestType: string) {
  return function <M extends (arg: T) => Promise<any> | any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<M>
  ) {
    const acceptsFullRequest = isFullRequestHandler<T>();
    const isAsync = descriptor.value?.constructor.name === "AsyncFunction";
    Reflect.defineMetadata(
      REQUEST_HANDLER_METADATA_KEY,
      { requestType, method: propertyKey, acceptsFullRequest, isAsync },
      target,
      propertyKey
    );
  };
}

// Helper function to get all methods with the RequestHandler decorator
function getRequestHandlers(target: any): Map<string, RequestHandlerMetadata> {
  const handlers = new Map<string, RequestHandlerMetadata>();

  let currentTarget = target.prototype;
  while (currentTarget) {
    for (const propertyName of Object.getOwnPropertyNames(currentTarget)) {
      const metadata: RequestHandlerMetadata | undefined = Reflect.getMetadata(
        REQUEST_HANDLER_METADATA_KEY,
        currentTarget,
        propertyName
      );
      if (metadata) {
        handlers.set(metadata.requestType, metadata);
      }
    }

    currentTarget = Object.getPrototypeOf(currentTarget);
  }

  return handlers;
}

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
  handleStatusUpdate?: (
    request: IRequest<any>,
    status: StatusUpdate
  ) => Promise<void>;
  timeoutCallback?: () => void;
  timeout?: number;
  headers?: IRequestHeader;
  isBroadcast?: boolean;
}

export type CallbackFunction<T> = (response: IResponse<T>) => Promise<void>;
export type CallbackObject<T> = {
  callback: CallbackFunction<T>;
  timeoutCallback: () => void;
  handleStatusUpdate: (
    request: IRequest<T>,
    status: StatusUpdate
  ) => Promise<void>;
  timeOutId: NodeJS.Timeout;
};

export class MicroserviceLogStrategy extends LogStrategy {
  constructor(private logChannel: ChannelBinding<IRequest<LogMessage>>) {
    super();
  }

  protected async sendPackaged(
    packagedMessage: IRequest<any>,
    options?: Record<string, any>
  ): Promise<void> {
    this.logChannel.send(packagedMessage);
  }
}

export abstract class MicroserviceFramework<
  TRequestBody,
  TResponseData
> extends RateLimitedTaskScheduler<
  IRequest<TRequestBody>,
  IResponse<TResponseData>
> {
  private lobby: ChannelBinding<IRequest<any>>;
  private serviceChannel: ChannelBinding<IRequest<any>>;
  private statusUpdateTimeoutId: NodeJS.Timeout | null = null;
  private pendingRequests: Map<string, CallbackObject<any>> = new Map();
  private requestHandlers: Map<string, RequestHandlerMetadata>;
  protected broadcastChannel: ChannelBinding<IRequest<any>>;
  protected backend: IBackEnd;
  protected serverConfig: IServerConfig;
  protected serviceId: string;
  protected running: boolean = false;
  protected statusUpdateInterval: number = 120000;
  protected requestCallbackTimeout: number = 30000;
  readonly address: string;
  readonly serviceDiscoveryManager: ServiceDiscoveryManager;
  readonly namespace: string;

  constructor(backend: IBackEnd, config: IServerConfig) {
    super(
      config.concurrencyLimit || 100,
      config.requestsPerInterval || 100,
      config.interval || 1000
    );
    this.namespace = config.namespace;
    this.serverConfig = config;
    this.backend = backend;
    this.serviceId = config.serviceId;
    this.statusUpdateInterval = config.statusUpdateInterval || 120000;
    this.address = `${this.namespace}:${this.serviceId}:${this.instanceId}`;
    this.requestCallbackTimeout =
      config.requestCallbackTimeout || this.requestCallbackTimeout;
    this.requestHandlers = getRequestHandlers(this.constructor);
    this.serviceDiscoveryManager = new ServiceDiscoveryManager(
      this.backend.serviceRegistry
    );
  }

  // @Loggable.handleErrors
  async initialize() {
    this.serviceChannel = this.backend.pubSubConsumer.bindChannel(
      `${this.namespace}:${this.serviceId}`,
      this.handleServiceMessages.bind(this)
    );
    this.broadcastChannel = this.backend.pubSubConsumer.bindChannel(
      `${this.namespace}:${this.serviceId}:broadcast`
    );
    this.lobby = this.backend.pubSubConsumer.bindChannel(
      `${this.namespace}:lobby`,
      this.handleLobbyMessages.bind(this)
    );
    const logChannel = this.backend.pubSubConsumer.bindChannel(
      `${this.namespace}:${this.serviceId}:logs`
    );
    if (!this.serverConfig.logStrategy) {
      Loggable.setLogStrategy(
        this.serverConfig.logStrategy || new MicroserviceLogStrategy(logChannel)
      );
      console.warn(
        chalk.yellow(`
[WARNING]
Log Strategy is set to MicroserviceLogStrategy.
MicroserviceFramework will stream logs to ${this.namespace}:${this.serviceId}:logs channel
If you are not seeing any logs, try adding the following to MicroserviceFramework configuration object:

import { ConsoleStrategy } from "microservice-framework";
config = {
  ...,
  logStrategy: new ConsoleStrategy()
}
      `)
      );
    } else {
      Loggable.setLogStrategy(this.serverConfig.logStrategy);
    }
    this.backend.pubSubConsumer.bindChannel(
      this.address,
      this.handleIncomingMessage.bind(this)
    );
    await this.serviceDiscoveryManager.registerNode(
      this.serviceId,
      this.instanceId,
      this.queue.size()
    );
    await this.lobby.send(
      MicroserviceFramework.createRequest(
        this.address,
        "CHECKIN",
        this.getServerStatus()
      )
    );
    this.onTaskComplete(this.processAndNotify.bind(this));
    this.scheduleNextLoadLevelUpdate();
    this.info(`Service ${this.serviceId} [${this.instanceId}] initialized.`);
  }

  private async updateLoadLevel() {
    await this.serviceDiscoveryManager.updateNodeLoad(
      this.serviceId,
      this.instanceId,
      this.queue.size()
    );
    this.scheduleNextLoadLevelUpdate();
  }

  protected async startDependencies() {
    this.info(
      `Service: ${this.serviceId} started successfully. InstanceID: ${this.instanceId}`
    );
  }
  protected async stopDependencies() {}

  static createRequest<T>(
    requesterAddress: string,
    requestType: string,
    body: T,
    recipientAddress?: string
  ): IRequest<T> {
    return {
      header: {
        timestamp: Date.now(),
        requestId: uuidv4(),
        requesterAddress,
        recipientAddress,
        requestType,
      },
      body,
    };
  }

  static createResponse<T>(
    request: IRequest<any>,
    responderAddress: string,
    data: T,
    success: boolean = true,
    error: Error | null = null
  ): IResponse<T> {
    return {
      requestHeader: request.header,
      responseHeader: {
        responderAddress,
        timestamp: Date.now(),
      },
      body: {
        data,
        success,
        error,
      },
    };
  }

  protected getServerStatus(): ServiceStatus {
    const status = {
      namespace: this.namespace,
      instanceId: this.instanceId,
      pendingRequests: this.pendingRequests.size,
      queueSize: this.queue.size(),
      runningTasks: this.runningTasks,
      timestamp: Date.now(),
      address: this.address,
      concurrencyLimit: this.concurrencyLimit,
      requestsPerInterval: this.serverConfig.requestsPerInterval,
      interval: this.interval,
      serviceId: this.serviceId,
      requestCallbackTimeout: this.requestCallbackTimeout,
      statusUpdateInterval: this.statusUpdateInterval,
    };

    return status;
  }

  public getserviceId(): string {
    return this.serviceId;
  }

  public getBackend(): IBackEnd {
    return this.backend;
  }

  protected handleServiceMessages<T>(message: T) {}

  protected async handleLobbyMessages(
    message: IRequest<any> | IResponse<any>
  ): Promise<void> {
    if (this.isServiceStatusRequest(message)) {
      if (message.header.requestType === "CHECKIN") {
        this.info(`Received CHECKIN from ${message.header.requesterAddress}`);
      }
    }
  }

  protected async defaultMessageHandler(
    request: IRequest<TRequestBody>
  ): Promise<TResponseData> {
    throw new Error(
      `No handler found for request type: ${request.header.requestType}`
    );
  }

  private isServiceStatusRequest(
    message: IRequest<any> | IResponse<any>
  ): message is IRequest<ServiceStatus> {
    return "header" in message && "requestType" in message.header;
  }

  private scheduleNextLoadLevelUpdate() {
    if (this.statusUpdateTimeoutId) {
      clearTimeout(this.statusUpdateTimeoutId);
    }
    this.statusUpdateTimeoutId = setTimeout(() => {
      this.updateLoadLevel();
      this.scheduleNextLoadLevelUpdate();
    }, this.statusUpdateInterval);
  }

  private async processRequest(
    input: IRequest<TRequestBody>
  ): Promise<TResponseData> {
    const requestType = input.header.requestType;
    if (!requestType) {
      throw new Error("Request type not specified");
    }

    const handlerMetadata = this.requestHandlers.get(requestType);
    if (!handlerMetadata) {
      return await this.defaultMessageHandler(input);
    }

    // Call the handler method
    const handlerMethod = (this as any)[handlerMetadata.method].bind(this);
    const args = handlerMetadata.acceptsFullRequest ? input : input.body;

    const handlerResponse = handlerMetadata.isAsync
      ? await handlerMethod(args)
      : handlerMethod(args);

    return handlerResponse;
  }

  private async wrapAndProcessRequest(
    input: IRequest<TRequestBody>
  ): Promise<IResponse<TResponseData>> {
    try {
      const result = await this.processRequest(input);
      let response = this.makeResponse(result, input, null);
      response = this.enrichResponse(response, input);
      return response;
    } catch (error) {
      let response = this.makeResponse(
        {} as TResponseData,
        input,
        error as Error
      );
      response = this.enrichResponse(response, input);
      return response;
    }
  }

  protected async handleStatusUpdate(
    request: IRequest<TRequestBody>,
    status: StatusUpdate
  ): Promise<void> {}

  protected enrichResponse(
    response: IResponse<TResponseData>,
    originalRequest: IRequest<TRequestBody>
  ): IResponse<TResponseData> {
    // Default implementation does nothing
    // Concrete classes can override this method to add custom enrichment
    // FIXME: For now, logging within this method causes infinite loop.
    return response;
  }

  protected enrichRequest(header: IRequestHeader, body: any): IRequestHeader {
    // Default implementation: return the header unchanged
    return header;
  }

  private async handleIncomingMessage(
    payload: IRequest<TRequestBody> | IResponse<any>
  ): Promise<void> {
    // right now we don't wait to see if the acknowledgement succeeded.
    // we might want to do this in the future.
    await this.backend.pubSubConsumer.ack(payload);
    this.processIncomingMessage(payload);
  }

  private async processIncomingMessage(
    payload: IRequest<TRequestBody> | IResponse<any>
  ): Promise<void> {
    if (this.isResponse(payload)) {
      await this.handleResponse(payload);
    } else {
      if (
        payload.header.requestType === "MicroserviceFramework::StatusUpdate"
      ) {
        const requestId = payload.header.requestId;
        const status = payload.body as StatusUpdate;
        const callbackObject = this.pendingRequests.get(requestId);
        if (callbackObject) {
          const { callback, timeoutCallback, timeOutId, handleStatusUpdate } =
            callbackObject;
          clearTimeout(timeOutId);
          const newTimeOut = setTimeout(
            timeoutCallback,
            this.requestCallbackTimeout
          );
          this.pendingRequests.set(requestId, {
            callback,
            timeoutCallback,
            timeOutId: newTimeOut,
            handleStatusUpdate,
          });
          await handleStatusUpdate(payload, status);
          return;
        }
      }
      this.scheduleNewMessage(payload as IRequest<TRequestBody>);
    }
  }

  private isResponse(
    payload: IRequest<TRequestBody> | IResponse<any>
  ): payload is IResponse<any> {
    return "responseHeader" in payload;
  }

  private async handleResponse(response: IResponse<any>) {
    const requestId = response.requestHeader.requestId;
    const callbackObject = this.pendingRequests.get(requestId);
    if (callbackObject) {
      try {
        await callbackObject.callback(response);
      } catch (error: any) {
        this.error(`Error executing callback for request ${requestId}`, error);
      } finally {
        this.pendingRequests.delete(requestId);
      }
    } else {
      this.warn(`Received response for unknown request: ${requestId}`);
    }
  }

  private scheduleNewMessage(message: IRequest<TRequestBody>) {
    this.scheduleTask(
      async (input) => await this.wrapAndProcessRequest(input),
      message
    );
  }

  @Loggable.handleErrors
  async start(): Promise<void> {
    await this.startDependencies();
    this.running = true;
  }

  @Loggable.handleErrors
  async stop(): Promise<void> {
    await this.lobby.send(
      MicroserviceFramework.createRequest(
        this.address,
        "CHECKOUT",
        this.getServerStatus()
      )
    );
    this.info(`Service ${this.serviceId} [${this.instanceId}] checked out`);
    await this.stopDependencies();
    await this.serviceDiscoveryManager.unregisterNode(
      this.serviceId,
      this.instanceId
    );

    this.running = false;
  }

  private async processAndNotify(
    output: TaskOutput<IResponse<TResponseData>>
  ): Promise<void> {
    // FIXME: DO NOT LOG WITHIN THIS METHOD, it causes infinite loop!
    if (output.result) {
      const recipientAddress = output.result.requestHeader.recipientAddress;
      if (recipientAddress) {
        await this.sendNotification(output.result);
      }
    }
  }

  private async sendNotification(
    response: IResponse<TResponseData>
  ): Promise<void> {
    const recipientId = response.requestHeader.recipientAddress;
    if (recipientId) {
      const [_namespace, serviceId, _instanceId] = recipientId.split(":");
      if (serviceId && serviceId === this.serviceId) {
        this.processIncomingMessage(response);
        return;
      }
      const peer = this.backend.pubSubConsumer.bindChannel(recipientId);
      peer.send(response);
      // TODO: validate if peer exists before sending message
      // Throw if peer not found.
    }
  }

  protected async sendStatusUpdate(
    request: IRequest<TRequestBody>,
    status: StatusUpdate
  ): Promise<void> {
    await this.sendOneWayMessage(
      "MicroserviceFramework::StatusUpdate",
      request.header.requesterAddress,
      status,
      request.header.requestId
    );
  }

  protected makeResponse(
    data: TResponseData,
    request: IRequest<TRequestBody>,
    error: Error | null
  ): IResponse<TResponseData> {
    const response = {
      requestHeader: request.header,
      responseHeader: {
        timestamp: Date.now(),
        responderAddress: this.address,
      },
      body: {
        data,
        success: error === null,
        error,
      },
    };

    if (
      request.header.recipientAddress &&
      (!data || (typeof data === "object" && Object.keys(data).length === 0)) &&
      !error
    ) {
      this.error(
        `Attempting to send empty data for ${
          request.header.requestType
        }. Data: ${JSON.stringify(data)}`,
        { request, error }
      );
      error = new Error("Empty response data");
    }

    return response;
  }

  protected async sendOneWayMessage(
    messageType: string,
    to: string,
    body: any,
    requestId?: string
  ): Promise<void> {
    requestId = requestId || this.generateRequestId();

    let peerAddress = "";
    if (to.startsWith(`${this.namespace}:`)) {
      peerAddress = to;
    } else {
      const nodeId = await this.serviceDiscoveryManager.getLeastLoadedNode(to);
      if (!nodeId) {
        throw new LoggableError(`No nodes available for service ${to}.`);
      }
      peerAddress = `${this.namespace}:${to}:${nodeId}`;
    }

    const peer = this.backend.pubSubConsumer.bindChannel(peerAddress);

    let header: IRequestHeader = {
      timestamp: Date.now(),
      requestId,
      requesterAddress: this.serviceId,
      requestType: messageType,
      // Note: recipientAddress is intentionally omitted
    };

    header = this.enrichRequest(header, body);

    const message: IRequest<any> = {
      header,
      body,
    };

    try {
      await peer.send(message);
    } catch (error) {
      this.error(`Failed to send one-way message to ${to}`, {
        error,
        requestId,
        messageType,
      });
      throw new LoggableError(`Failed to send one-way message to ${to}`, error);
    }
  }

  protected async makeRequest<T>(props: RequestProps): Promise<IResponse<T>> {
    const {
      to,
      requestType,
      body,
      replyTo,
      handleStatusUpdate,
      headers,
      timeout,
      timeoutCallback,
    } = props;
    return new Promise(async (resolve, reject) => {
      const requestId = headers?.requestId || this.generateRequestId();

      let peerAddress = "";
      if (to.startsWith(`${this.namespace}:`)) {
        peerAddress = to;
      } else {
        const nodeId = await this.serviceDiscoveryManager.getLeastLoadedNode(
          to
        );
        if (!nodeId) {
          reject(new LoggableError(`No nodes available for service ${to}.`));
          return;
        }
        peerAddress = `${this.namespace}:${to}:${nodeId}`;
      }

      let header: IRequestHeader = {
        ...{
          timestamp: Date.now(),
          requestId,
          requesterAddress: this.address,
          recipientAddress: replyTo || this.address,
          requestType,
        },
        ...headers,
      };

      header = this.enrichRequest(header, body);

      const request: IRequest<any> = {
        header,
        body,
      };

      const callback: CallbackFunction<T> = async (response) => {
        try {
          if (response.body.success) {
            resolve(response);
          } else {
            this.error(`Request to ${to} failed`, {
              requestId,
              error: response.body.error,
              requestType,
              to,
              replyTo,
            });
            reject(
              new LoggableError(`Request to ${to} failed`, {
                request,
                response,
              })
            );
          }
        } catch (error: any) {
          this.error(`Error in callback for request ${requestId}`, error);
          reject(
            new LoggableError(`Error processing response from ${to}`, error)
          );
        }
      };

      const timeoutMs = timeout || this.requestCallbackTimeout;
      const timeoutCb =
        timeoutCallback ||
        (() => {
          if (this.pendingRequests.has(requestId)) {
            this.pendingRequests.delete(requestId);
            this.warn(`Request to ${to} timed out`, {
              requestId,
              timeoutMs,
              requestType,
            });
            reject(
              new LoggableError(
                `Request to ${to} timed out after ${timeoutMs}ms`
              )
            );
          }
        });
      const timeOutId = setTimeout(timeoutCb, timeoutMs);
      this.pendingRequests.set(requestId, {
        callback,
        timeoutCallback: timeoutCb,
        timeOutId,
        handleStatusUpdate:
          handleStatusUpdate || this.handleStatusUpdate.bind(this),
      });
      const peer = this.backend.pubSubConsumer.bindChannel(peerAddress);
      const sendMethod =
        to == this.serviceId
          ? this.processIncomingMessage.bind(this)
          : peer.send;
      sendMethod(request).catch((error: any) => {
        this.pendingRequests.delete(requestId);
        this.error(`Failed to send request to ${to}`, {
          error,
          requestId,
          requestType,
        });
        reject(new LoggableError(`Failed to send request to ${to}`, error));
      });
    });
  }

  private generateRequestId(): string {
    return `${this.serviceId}-${Date.now()}-${Math.random()
      .toString(36)
      .substr(2, 9)}`;
  }
}
