import WebSocket from "ws";
import { ISessionStore } from "../interfaces";
import { createHash } from "crypto";

interface ConnectionEvents {
  onRateLimit: (connectionId: string) => void;
  onError: (connectionId: string, error: Error) => void;
  onSecurityViolation: (connectionId: string, violation: string) => void;
}

export class WebsocketConnection {
  private static readonly MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB
  private static readonly SESSION_REFRESH_INTERVAL = 60000; // 1 minute
  private static readonly FORCED_CLOSE_TIMEOUT = 5000; // 5 seconds

  private connectionId: string;
  private lastActivityTime: number;
  private messageCount: number = 0;
  private authenticated: boolean = false;
  private metadata: Map<string, any> = new Map();
  private websocket: WebSocket | null = null;
  private eventListenersSetup: boolean = false;
  private closePromise: Promise<void> | null = null;
  private sessionRefreshTimer?: NodeJS.Timeout;
  private lastMessageHash: string = "";

  constructor(
    private handleMessage: (
      data: WebSocket.Data,
      websocket: WebsocketConnection
    ) => void,
    private handleClose: (connectionId: string) => Promise<void>,
    private inactivityTimeout: number = 300000, // 5 minutes
    private maxMessagesPerMinute: number = 100,
    private events?: ConnectionEvents,
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
    if (this.websocket) {
      // Clean up existing connection first
      this.cleanupExistingConnection();
    }

    this.websocket = websocket;
    this.setupEventListeners();
    this.lastActivityTime = Date.now();

    (this.websocket as any).maxPayload = WebsocketConnection.MAX_MESSAGE_SIZE;
  }

  private cleanupExistingConnection() {
    if (this.websocket) {
      try {
        this.websocket.removeAllListeners();
        this.websocket.terminate();
      } catch (error) {
        this.events?.onError(this.connectionId, error as Error);
      }
    }
  }

  private setupEventListeners() {
    if (!this.websocket || this.eventListenersSetup) {
      return;
    }

    this.websocket.on("message", this.handleWebsocketMessages.bind(this));
    this.websocket.on("close", this.handleCloseConnection.bind(this));
    this.websocket.on("pong", this.handlePong.bind(this));
    this.websocket.on("error", this.handleError.bind(this));

    this.websocket.on(
      "unexpected-response",
      this.handleUnexpectedResponse.bind(this)
    );

    this.eventListenersSetup = true;
  }

  private handleError(error: Error) {
    this.events?.onError(this.connectionId, error);
    this.close(1006, "Internal error occurred");
  }

  private handleUnexpectedResponse() {
    this.events?.onSecurityViolation(
      this.connectionId,
      "Unexpected response received"
    );
    this.close(1006, "Unexpected response");
  }

  private startInactivityTimer() {
    setInterval(() => {
      const now = Date.now();
      if (now - this.lastActivityTime > this.inactivityTimeout) {
        this.close(1000, "Connection timed out due to inactivity");
      }
    }, 60000); // check every minute
  }

  private handlePong() {
    this.lastActivityTime = Date.now();
  }

  public send(message: string) {
    if (!this.websocket) {
      throw new Error("Cannot send message: WebSocket not initialized");
    }

    try {
      // Check message size before sending
      const messageSize = Buffer.byteLength(message);
      if (messageSize > WebsocketConnection.MAX_MESSAGE_SIZE) {
        throw new Error("Message exceeds maximum size limit");
      }

      this.websocket.send(message);
      this.lastActivityTime = Date.now();
    } catch (error) {
      this.events?.onError(this.connectionId, error as Error);
      throw error;
    }
  }

  private async handleCloseConnection() {
    try {
      this.closePromise = new Promise<void>((resolve) => {
        setTimeout(async () => {
          await this.handleClose(this.connectionId);
          resolve();
        }, WebsocketConnection.FORCED_CLOSE_TIMEOUT);
      });

      await this.closePromise;
    } catch (error) {
      this.events?.onError(this.connectionId, error as Error);
    } finally {
      this.closePromise = null;
    }
  }

  private async handleWebsocketMessages(message: WebSocket.Data) {
    try {
      this.lastActivityTime = Date.now();

      // Size check
      const messageSize = this.getDataSize(message);
      if (messageSize > WebsocketConnection.MAX_MESSAGE_SIZE) {
        this.events?.onSecurityViolation(
          this.connectionId,
          "Message size exceeded"
        );
        this.send(JSON.stringify({ error: "Message too large" }));
        return;
      }

      // Rate limiting
      if (this.isRateLimited()) {
        this.events?.onRateLimit(this.connectionId);
        this.send(JSON.stringify({ error: "Rate limit exceeded" }));
        return;
      }

      // Detect message replay attacks
      const messageString = this.dataToString(message);
      const messageHash = this.calculateMessageHash(messageString);
      if (messageHash === this.lastMessageHash) {
        this.events?.onSecurityViolation(
          this.connectionId,
          "Possible replay attack"
        );
        return;
      }
      this.lastMessageHash = messageHash;

      this.messageCount++;
      this.handleMessage(message, this);
    } catch (error) {
      this.events?.onError(this.connectionId, error as Error);
    }
  }

  private calculateMessageHash(message: string): string {
    return createHash("sha256").update(message).digest("hex");
  }

  private dataToString(data: WebSocket.Data): string {
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof Buffer) {
      return data.toString();
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString();
    }
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString();
    }
    return "";
  }

  private getDataSize(data: WebSocket.Data): number {
    if (typeof data === "string") {
      return Buffer.byteLength(data);
    }
    if (data instanceof Buffer) {
      return data.length;
    }
    if (data instanceof ArrayBuffer) {
      return data.byteLength;
    }
    if (Array.isArray(data)) {
      return data.reduce((acc, buf) => acc + buf.length, 0);
    }
    return 0;
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

  public close(code?: number, reason?: string): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = new Promise<void>((resolve) => {
        this.stopSessionRefresh();

        if (!this.websocket) {
          resolve();
          return;
        }

        if (this.websocket.readyState === WebSocket.CLOSED) {
          resolve();
          return;
        }

        let isResolved = false;
        const cleanup = () => {
          if (!isResolved) {
            isResolved = true;
            this.cleanupExistingConnection();
            resolve();
          }
        };

        // Handle normal close
        this.websocket.on("close", cleanup);

        // Initiate close
        this.websocket.close(code, reason);

        // Force close after timeout
        const timeoutId = setTimeout(() => {
          this.websocket?.removeListener("close", cleanup);
          cleanup();
        }, WebsocketConnection.FORCED_CLOSE_TIMEOUT);

        // If closed normally, clear the timeout
        this.websocket.once("close", () => {
          clearTimeout(timeoutId);
        });
      });
    }

    return this.closePromise;
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

  public async refreshSession(sessionStore: ISessionStore): Promise<boolean> {
    try {
      const sessionId = this.getMetadata("sessionId");
      if (!sessionId) return false;

      const session = await sessionStore.get(sessionId);
      if (!session) {
        // Session invalid - close connection
        this.close(1008, "Session expired");
        return false;
      }

      session.lastAccessedAt = new Date();
      return sessionStore.update(sessionId, session);
    } catch (error) {
      this.events?.onError(this.connectionId, error as Error);
      return false;
    }
  }

  public startSessionRefresh(sessionStore: ISessionStore) {
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
    }

    this.sessionRefreshTimer = setInterval(
      () => this.refreshSession(sessionStore),
      WebsocketConnection.SESSION_REFRESH_INTERVAL
    );
  }

  public stopSessionRefresh() {
    if (this.sessionRefreshTimer) {
      clearInterval(this.sessionRefreshTimer);
      this.sessionRefreshTimer = undefined;
    }
  }

  // Static method for broadcasting to multiple connections
  public static broadcast(message: string, connections: WebsocketConnection[]) {
    connections.forEach((connection) => {
      if (connection.isConnected()) {
        connection.send(message);
      }
    });
  }

  public getSessionId(): string | undefined {
    return this.getMetadata("sessionId");
  }
}
