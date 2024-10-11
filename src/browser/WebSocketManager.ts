import EventEmitter from "eventemitter3";
import { BrowserConsoleStrategy } from "./BrowserConsoleStrategy";

export enum WebSocketState {
  CONNECTING,
  OPEN,
  CLOSING,
  CLOSED,
}

export class WebSocketManager extends EventEmitter {
  private logger: BrowserConsoleStrategy;
  private ws!: WebSocket;
  private url: string;
  private secure: boolean;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number;
  private reconnectInterval: number;
  private state: WebSocketState = WebSocketState.CLOSED;
  private connectionTimeout: number;
  private connectionTimer?: number;

  constructor(
    url: string,
    secure: boolean = false,
    maxReconnectAttempts: number = 5,
    reconnectInterval: number = 5000,
    connectionTimeout: number = 10000
  ) {
    super();
    this.logger = new BrowserConsoleStrategy();
    this.url = url;
    this.secure = secure;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.reconnectInterval = reconnectInterval;
    this.connectionTimeout = connectionTimeout;
    this.connect();
  }

  private connect() {
    this.state = WebSocketState.CONNECTING;
    const secureUrl = this.getSecureUrl(this.url, this.secure);
    this.logger.info(`Attempting to connect to ${secureUrl}`);
    this.ws = new WebSocket(secureUrl);
    this.setHooks();
    this.setConnectionTimeout();
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
    this.ws.onclose = (event) => {
      this.clearConnectionTimeout();
      this.state = WebSocketState.CLOSED;
      this.logger.info(
        `WebSocket closed. ReadyState: ${this.ws.readyState}. Code: ${event.code}, Reason: ${event.reason}`
      );
      this.emit("close", event);
      this.handleReconnection();
    };
    this.ws.onerror = (error) => {
      this.logger.error(error);
      this.emit("error", error);
    };
    this.ws.onmessage = (event) => {
      const parsedData = this.parseMessage(event.data);
      this.emit("message", parsedData);
    };
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
}
