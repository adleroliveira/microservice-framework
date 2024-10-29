import EventEmitter from "eventemitter3";
import {
  WebSocketManager,
  WebSocketState,
  AuthMethod,
  IWebSocketAuthConfig,
} from "./WebSocketManager";
import { BrowserConsoleStrategy } from "./BrowserConsoleStrategy";
import { RequestManager } from "./RequestManager";
import {
  IResponseData,
  IRequest,
  IResponse,
  IRequestHeader,
} from "../interfaces";
import { HeartbeatRequest, HeartbeatResponse } from "../services";

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

export class CommunicationsManager extends EventEmitter {
  private webSocketManager: WebSocketManager;
  private requestManager: RequestManager;
  private logger = new BrowserConsoleStrategy();
  private config: ICommunicationsManagerConfig;
  private lastHeartbeatTimestamp: number = 0;

  constructor(config: ICommunicationsManagerConfig) {
    super();
    this.config = config;
    this.validateConfig(config);

    try {
      this.initializeManagers(config);
    } catch (error) {
      this.logger.error("Error initializing CommunicationsManager", { error });
      throw new Error("Failed to initialize CommunicationsManager");
    }
  }

  private initializeManagers(config: ICommunicationsManagerConfig) {
    this.webSocketManager = new WebSocketManager({
      url: config.url,
      secure: config.secure,
      auth: config.auth,
      maxReconnectAttempts: config.maxReconnectAttempts,
      reconnectInterval: config.reconnectInterval,
    });

    this.requestManager = new RequestManager({
      webSocketManager: this.webSocketManager,
      requestTimeout: config.requestTimeout,
    });

    this.setupWebSocketHooks();
  }

  private async cleanupCurrentState(): Promise<void> {
    // Remove event listeners but keep the manager instances
    this.webSocketManager.removeAllListeners();
    this.requestManager.removeAllListeners();

    // Close current WebSocket connection
    if (this.webSocketManager) {
      await new Promise<void>((resolve) => {
        this.webSocketManager.once("close", () => resolve());
        this.webSocketManager.close();
      });
    }

    // Clear request manager state
    if (this.requestManager) {
      this.requestManager.clearState();
    }
  }

  private setupWebSocketHooks() {
    this.webSocketManager.on(
      "maxReconnectAttemptsReached",
      this.handleMaxReconnectAttemptsReached.bind(this)
    );

    this.webSocketManager.on("authError", (error) => {
      this.logger.error("Authentication error", error);
      this.emit("authError", error);
    });

    this.registerMessageHandler(
      "heartbeat",
      async (heartbeat: HeartbeatRequest, header: IRequestHeader) => {
        // Emit heartbeat event for monitoring
        const latency = Date.now() - heartbeat.timestamp;
        this.lastHeartbeatTimestamp = Date.now();
        this.emit("heartbeat", { latency });

        return {
          requestTimestamp: heartbeat.timestamp,
          responseTimestamp: Date.now(),
        };
      }
    );
  }

  public async authenticate(authConfig: IWebSocketAuthConfig): Promise<void> {
    try {
      await this.cleanupCurrentState();

      // Create new config with authentication
      const newConfig = {
        ...this.config,
        auth: authConfig,
      };

      // Reinitialize with authenticated config
      this.initializeManagers(newConfig);

      this.logger.info("Switched to authenticated mode");
      this.emit("modeChanged", "authenticated");
    } catch (error) {
      this.logger.error("Error switching to authenticated mode", error);
      throw error;
    }
  }

  public async switchToAnonymous(): Promise<void> {
    try {
      // Clear current state but don't destroy everything
      await this.cleanupCurrentState();

      // Create new config for anonymous connection
      const anonymousConfig = {
        ...this.config,
        auth: {
          method: AuthMethod.ANONYMOUS,
        },
      };

      // Reinitialize with anonymous config
      this.initializeManagers(anonymousConfig);

      this.logger.info("Switched to anonymous mode");
      this.emit("modeChanged", "anonymous");
    } catch (error) {
      this.logger.error("Error switching to anonymous mode", error);
      throw error;
    }
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

  public registerMessageHandler<T, R>(
    messageType: string,
    handler: (data: T, header: IRequestHeader) => Promise<R> | R
  ) {
    this.requestManager.registerHandler(
      messageType,
      async (payload: T, header) => {
        try {
          return await handler(payload, header);
        } catch (error) {
          // Proper error handling while maintaining the contract
          throw error instanceof Error ? error : new Error(String(error));
        }
      }
    );
  }

  public getConnectionState(): WebSocketState {
    return this.webSocketManager.getState();
  }

  public updateAuthentication(auth: IWebSocketAuthConfig) {
    this.webSocketManager.reconnectWithNewAuth(auth);
  }

  public isAuthenticated(): boolean {
    return this.webSocketManager.isAuthenticated();
  }

  public getCurrentMode(): "anonymous" | "authenticated" {
    return this.config.auth?.method === AuthMethod.ANONYMOUS
      ? "anonymous"
      : "authenticated";
  }

  public destroy(): void {
    this.removeAllListeners();

    if (this.webSocketManager) {
      this.webSocketManager.destroy();
      this.webSocketManager = null!;
    }

    if (this.requestManager) {
      this.requestManager.destroy();
      this.requestManager = null!;
    }

    this.logger = null!;
    this.config = null!;
  }

  public getConnectionHealth(): {
    connected: boolean;
    lastHeartbeat?: number;
  } {
    return {
      connected: this.webSocketManager.getState() === WebSocketState.OPEN,
      lastHeartbeat: this.lastHeartbeatTimestamp,
    };
  }
}
