import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

export class WebsocketConnection {
  private connectionId: string;
  private lastActivityTime: number;
  private messageCount: number = 0;
  private authenticated: boolean = false;

  constructor(
    private websocket: WebSocket,
    private handleMessage: (
      data: WebSocket.Data,
      websocket: WebsocketConnection
    ) => void,
    private handleClose: (connectionId: string) => void,
    private inactivityTimeout: number = 300000, // 5 minutes
    private maxMessagesPerMinute: number = 100
  ) {
    this.connectionId = uuidv4();
    this.lastActivityTime = Date.now();
    this.setupEventListeners();
    this.startInactivityTimer();
  }

  private setupEventListeners() {
    this.websocket.on("message", this.handleWebsocketMessages.bind(this));
    this.websocket.on("close", this.handleCloseConnection.bind(this));
    this.websocket.on("pong", this.handlePong.bind(this));
  }

  private startInactivityTimer() {
    setInterval(() => {
      if (Date.now() - this.lastActivityTime > this.inactivityTimeout) {
        this.close(1000, "Connection timed out due to inactivity");
      }
    }, 60000); // Check every minute
  }

  private handlePong() {
    this.lastActivityTime = Date.now();
  }

  public send(message: string) {
    this.websocket.send(message);
    this.lastActivityTime = Date.now();
  }

  private handleCloseConnection() {
    this.handleClose(this.connectionId);
  }

  private handleWebsocketMessages(message: WebSocket.Data) {
    this.lastActivityTime = Date.now();
    if (this.isRateLimited()) {
      this.send("Rate limit exceeded. Please slow down.");
      return;
    }
    this.messageCount++;
    this.handleMessage(message, this);
  }

  private isRateLimited(): boolean {
    const oneMinuteAgo = Date.now() - 60000;
    if (
      this.messageCount > this.maxMessagesPerMinute &&
      this.lastActivityTime > oneMinuteAgo
    ) {
      return true;
    }
    if (this.lastActivityTime <= oneMinuteAgo) {
      this.messageCount = 0;
    }
    return false;
  }

  public getConnectionId() {
    return this.connectionId;
  }

  public setAuthenticated(value: boolean) {
    this.authenticated = value;
  }

  public isAuthenticated(): boolean {
    return this.authenticated;
  }

  public close(code?: number, reason?: string) {
    this.websocket.close(code, reason);
  }

  public ping() {
    this.websocket.ping();
  }

  // Static method for broadcasting to multiple connections
  public static broadcast(message: string, connections: WebsocketConnection[]) {
    connections.forEach((connection) => connection.send(message));
  }
}
