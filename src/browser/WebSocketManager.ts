import EventEmitter from "eventemitter3";
import { BrowserConsoleStrategy } from "./BrowserConsoleStrategy";

export enum WebSocketState {
  CONNECTING,
  OPEN,
  CLOSING,
  CLOSED,
}

export enum AuthMethod {
  TOKEN = "token",
  CREDENTIALS = "auth",
}

export interface IWebSocketAuthConfig {
  method: AuthMethod;
  token?: string;
  credentials?: {
    username: string;
    password: string;
  };
}

export interface IWebSocketManagerConfig {
  url: string;
  secure?: boolean;
  auth?: IWebSocketAuthConfig;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
  connectionTimeout?: number;
}

export class WebSocketManager extends EventEmitter {
  private logger: BrowserConsoleStrategy;
  private ws!: WebSocket;
  private url: string;
  private secure: boolean;
  private auth?: IWebSocketAuthConfig;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectInterval: number;
  private state: WebSocketState = WebSocketState.CLOSED;
  private connectionTimeout: number;
  private connectionTimer?: number;
  private protocols: string[] = [];

  constructor(config: IWebSocketManagerConfig) {
    super();
    this.logger = new BrowserConsoleStrategy();
    this.url = config.url;
    this.secure = config.secure || false;
    this.auth = config.auth;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
    this.reconnectInterval = config.reconnectInterval || 5000;
    this.connectionTimeout = config.connectionTimeout || 10000;

    this.setupAuthProtocols();
    this.connect();
  }

  private setupAuthProtocols() {
    if (!this.auth) return;
    switch (this.auth.method) {
      case AuthMethod.TOKEN:
        if (this.auth.token) {
          this.protocols.push(`token-${this.auth.token}`);
        }
        break;
      case AuthMethod.CREDENTIALS:
        if (this.auth.credentials) {
          const { username, password } = this.auth.credentials;
          const credentials = btoa(encodeURIComponent(password)).replace(
            /=/g,
            ""
          );
          this.protocols.push(`auth-${username}-${credentials}`);
          this.logger.debug(`Auth protocol`, this.protocols);
        }
        break;
    }
  }

  private connect() {
    this.state = WebSocketState.CONNECTING;

    const secureUrl = this.getSecureUrl(this.url, this.secure);

    // Add token to URL if using query parameter authentication
    const urlWithAuth =
      this.auth?.method === AuthMethod.TOKEN && this.auth.token
        ? `${secureUrl}?token=${this.auth.token}`
        : secureUrl;

    this.logger.info(`Attempting to connect to ${urlWithAuth}`);
    try {
      this.ws = new WebSocket(urlWithAuth, this.protocols);
      this.setHooks();
      this.setConnectionTimeout();
    } catch (error) {
      this.handleConnectionError(error);
    }
  }

  private handleConnectionError(error: any) {
    this.logger.error("Connection error:", error);
    this.emit("error", {
      type: "CONNECTION_ERROR",
      message: "Failed to establish WebSocket connection",
      error,
    });
  }

  private getSecureUrl(url: string, secure: boolean): string {
    return secure ? url.replace(/^ws:/, "wss:") : url;
  }

  private setHooks() {
    this.ws.onopen = () => {
      this.clearConnectionTimeout();
      this.state = WebSocketState.OPEN;
      this.reconnectAttempts = 0;
      this.logger.info(`WebSocket opened. ReadyState: ${this.ws.readyState}`);
      this.emit("open");
    };

    this.ws.onerror = (error: Event) => {
      const wsError = error.target as WebSocket;

      if (wsError.readyState === WebSocket.CLOSED) {
        const errorDetails = {
          type: "CONNECTION_ERROR",
          message: "Connection failed",
          readyState: wsError.readyState,
          url: wsError.url,
        };

        if (this.reconnectAttempts === 0) {
          // First connection attempt failed immediately - likely auth failure
          errorDetails.type = "AUTH_ERROR";
          errorDetails.message = "Authentication required";
        }

        this.logger.error("WebSocket error:", errorDetails);
        this.emit("error", errorDetails);
      } else {
        this.logger.error("WebSocket error:", error);
        this.emit("error", error);
      }
    };

    this.ws.onclose = (event) => {
      this.clearConnectionTimeout();
      this.state = WebSocketState.CLOSED;

      // Handle all potential authentication-related close codes
      if (
        event.code === 1001 || // Going Away
        event.code === 1006 || // Abnormal Closure (what browsers often use for 401)
        event.code === 1008
      ) {
        // Policy Violation
        const error = {
          type: "AUTH_ERROR",
          code: event.code,
          reason: event.reason || "Authentication required",
        };
        this.emit("error", error);
        return;
      }

      this.logger.info(
        `WebSocket closed. ReadyState: ${this.ws.readyState}. Code: ${event.code}, Reason: ${event.reason}`
      );
      this.emit("close", event);
      this.handleReconnection();
    };

    this.ws.onmessage = (event) => {
      const parsedData = this.parseMessage(event.data);
      this.emit("message", parsedData);
    };
  }

  private async checkAuthRequirement() {
    try {
      // Make a regular HTTP request to check auth requirements
      const response = await fetch(this.url.replace(/^ws/, "http"));

      if (response.status === 401) {
        const error = {
          type: "AUTH_ERROR",
          message: "Authentication required",
          status: response.status,
        };
        this.emit("error", error);
        return false;
      }
      return true;
    } catch (error) {
      // Network error or other issues - proceed with WebSocket connection
      return true;
    }
  }

  private handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const minDelay = 1000;
      const delay = Math.max(
        minDelay,
        this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1)
      );
      this.logger.info(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`
      );
      setTimeout(() => this.connect(), delay);
    } else {
      this.logger.error(
        "Max reconnection attempts reached. Please reconnect manually."
      );
      this.emit("maxReconnectAttemptsReached");
    }
  }

  private setConnectionTimeout() {
    this.connectionTimer = window.setTimeout(() => {
      if (this.state === WebSocketState.CONNECTING) {
        this.logger.error("Connection attempt timed out");
        this.ws.close();
      }
    }, this.connectionTimeout);
  }

  private clearConnectionTimeout() {
    if (this.connectionTimer) {
      window.clearTimeout(this.connectionTimer);
    }
  }

  private parseMessage(data: any): any {
    try {
      return JSON.parse(data);
    } catch (error) {
      return data;
    }
  }

  public send(message: string | object) {
    if (this.state === WebSocketState.OPEN) {
      const data =
        typeof message === "string" ? message : JSON.stringify(message);
      this.ws.send(data);
    } else {
      const error = new Error("WebSocket is not open");
      this.emit("error", error);
    }
  }

  public close() {
    this.state = WebSocketState.CLOSING;
    this.ws.close();
  }

  public reconnect() {
    this.logger.debug("Manual reconnection initiated.");
    this.reconnectAttempts = 0;
    this.close();
    this.connect();
  }

  public getState(): WebSocketState {
    return this.state;
  }

  public getReadyState(): number {
    return this.ws.readyState;
  }

  public setAuthConfig(authConfig: IWebSocketAuthConfig) {
    this.auth = authConfig;
    this.setupAuthProtocols();
  }

  public isAuthenticated(): boolean {
    return this.state === WebSocketState.OPEN;
  }

  public reconnectWithNewAuth(authConfig: IWebSocketAuthConfig) {
    this.setAuthConfig(authConfig);
    this.reconnect();
  }
}
