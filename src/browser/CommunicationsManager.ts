import EventEmitter from "eventemitter3";
import { WebSocketManager, WebSocketState } from "./WebSocketManager";
import { BrowserConsoleStrategy } from "./BrowserConsoleStrategy";
import { RequestManager } from "./RequestManager";
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

export class CommunicationsManager extends EventEmitter {
  private webSocketManager: WebSocketManager;
  private requestManager: RequestManager;
  private logger = new BrowserConsoleStrategy();

  constructor(config: ICommunicationsManagerConfig) {
    super();
    this.validateConfig(config);

    try {
      this.webSocketManager = new WebSocketManager(
        config.url,
        config.secure,
        config.maxReconnectAttempts,
        config.reconnectInterval
      );

      this.requestManager = new RequestManager({
        webSocketManager: this.webSocketManager,
        requestTimeout: config.requestTimeout,
      });

      this.setupWebSocketHooks();
    } catch (error) {
      this.logger.error("Error initializing CommunicationsManager", { error });
      throw new Error("Failed to initialize CommunicationsManager");
    }
  }

  private setupWebSocketHooks() {
    this.webSocketManager.on(
      "maxReconnectAttemptsReached",
      this.handleMaxReconnectAttemptsReached.bind(this)
    );
  }

  public onOpen(callback: () => void) {
    this.logger.info("onOpen callback registered");
    this.webSocketManager.on("open", callback);
  }

  public onClose(callback: (event: CloseEvent) => void) {
    this.logger.info("onClose callback registered");
    this.webSocketManager.on("close", callback);
  }

  public onError(callback: (error: Event) => void) {
    this.logger.info("onError callback registered");
    this.webSocketManager.on("error", callback);
  }

  public onMessage(callback: (data: string) => void) {
    this.logger.info("onMessage callback registered");
    this.webSocketManager.on("message", callback);
  }

  private handleMaxReconnectAttemptsReached() {
    this.logger.error(
      "Maximum reconnection attempts reached. To try again, please refresh the page."
    );
  }

  private validateConfig(config: ICommunicationsManagerConfig): void {
    if (!config.url) {
      throw new Error("URL is required in the configuration");
    }
  }

  public async request<I, O>(
    requestType: string,
    body: I,
    to?: string
  ): Promise<IResponseData<O>> {
    try {
      return this.requestManager.request(requestType, body, to);
    } catch (error) {
      this.logger.error("Error making request", { requestType, error });
      throw error;
    }
  }

  public registerMessageHandler(
    messageType: string,
    handler: (data: any) => void
  ) {
    this.requestManager.on(messageType, handler);
  }

  public getConnectionState(): WebSocketState {
    return this.webSocketManager.getState();
  }
}
