import WebSocket from "ws";
import { ISessionStore } from "../interfaces";

export class WebsocketConnection {
  private connectionId: string;
  private lastActivityTime: number;
  private messageCount: number = 0;
  private authenticated: boolean = false;
  private metadata: Map<string, any> = new Map();
  private websocket: WebSocket | null = null;
  private eventListenersSetup: boolean = false;

  constructor(
    private handleMessage: (
      data: WebSocket.Data,
      websocket: WebsocketConnection
    ) => void,
    private handleClose: (connectionId: string) => void,
    private inactivityTimeout: number = 300000, // 5 minutes
    private maxMessagesPerMinute: number = 100,
    websocket?: WebSocket
  ) {
    this.connectionId = crypto.randomUUID();
    this.lastActivityTime = Date.now();

    if (websocket) {
      this.setWebSocket(websocket);
    }

    this.startInactivityTimer();
  }

  public setWebSocket(websocket: WebSocket) {
    this.websocket = websocket;
    this.setupEventListeners();
    this.lastActivityTime = Date.now();
  }

  private setupEventListeners() {
    if (!this.websocket || this.eventListenersSetup) {
      return;
    }

    this.websocket.on("message", this.handleWebsocketMessages.bind(this));
    this.websocket.on("close", this.handleCloseConnection.bind(this));
    this.websocket.on("pong", this.handlePong.bind(this));

    this.eventListenersSetup = true;
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
    if (!this.websocket) {
      throw new Error("Cannot send message: WebSocket not initialized");
    }
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
    if (this.websocket) {
      this.websocket.close(code, reason);
    }
  }

  public ping() {
    if (this.websocket) {
      this.websocket.ping();
    }
  }

  public isConnected(): boolean {
    return (
      this.websocket !== null && this.websocket.readyState === WebSocket.OPEN
    );
  }

  setMetadata(key: string, value: any): void {
    this.metadata.set(key, value);
  }

  getMetadata(key: string): any {
    return this.metadata.get(key);
  }

  async refreshSession(sessionStore: ISessionStore): Promise<boolean> {
    const sessionId = this.getMetadata("sessionId");
    if (!sessionId) return false;

    const session = await sessionStore.get(sessionId);
    if (!session) return false;

    session.lastAccessedAt = new Date();
    return sessionStore.update(sessionId, session);
  }

  // Static method for broadcasting to multiple connections
  public static broadcast(message: string, connections: WebsocketConnection[]) {
    connections.forEach((connection) => {
      if (connection.isConnected()) {
        connection.send(message);
      }
    });
  }
}
