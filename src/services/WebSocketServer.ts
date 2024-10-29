import { Server, Data } from "ws";
import { createServer, Server as HttpServer, IncomingMessage } from "http";
import { Duplex } from "stream";
import { IAuthenticationMetadata, ISessionData } from "../interfaces";

import {
  MicroserviceFramework,
  IServerConfig,
  StatusUpdate,
  RequestHandler,
} from "../MicroserviceFramework";
import {
  IBackEnd,
  IRequest,
  IResponse,
  ISessionStore,
  IAuthenticationProvider,
} from "../interfaces";
import { WebsocketConnection } from "./WebsocketConnection";
import { WebSocketAuthenticationMiddleware } from "./WebSocketAuthenticationMiddleware";

type PayloadType = "object" | "string" | "IRequest" | "IResponse";

interface DetectionResult<T> {
  payloadType: PayloadType;
  payload: T;
}

export interface HeartbeatRequest {
  timestamp: number;
}

export interface HeartbeatResponse {
  requestTimestamp: number;
  responseTimestamp: number;
}

export interface HeartbeatConfig {
  enabled: boolean;
  interval: number; // How often to send heartbeats (ms)
  timeout: number; // How long to wait for response (ms)
}

export interface AnonymousSessionConfig {
  enabled: boolean;
  sessionDuration?: number; // Duration in milliseconds
  persistentIdentityEnabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuthenticationConfig {
  required: boolean;
  allowAnonymous: boolean;
  anonymousConfig?: AnonymousSessionConfig;
  authProvider?: IAuthenticationProvider;
  sessionStore: ISessionStore;
  authenticationMiddleware?: WebSocketAuthenticationMiddleware;
}

export interface WebSocketServerConfig extends IServerConfig {
  port: number;
  path?: string;
  maxConnections?: number;
  authentication: AuthenticationConfig;
  heartbeatConfig?: HeartbeatConfig;
}

export type WebSocketMessage = {
  type: string;
  data: any;
  connectionId: string;
};

export interface WebSocketResponse {}

export class WebSocketServer extends MicroserviceFramework<
  WebSocketMessage,
  WebSocketResponse
> {
  private server: HttpServer;
  private wss: Server;
  private connections: Map<string, WebsocketConnection> = new Map();
  private port: number;
  private path: string;
  private maxConnections: number;
  private authConfig: AuthenticationConfig;
  private authenticationMiddleware?: WebSocketAuthenticationMiddleware;

  private heartbeatConfig: HeartbeatConfig = {
    enabled: true,
    interval: 30000, // 30 seconds
    timeout: 5000, // 5 seconds
  };

  constructor(backend: IBackEnd, config: WebSocketServerConfig) {
    super(backend, config);

    this.validateAuthenticationConfig(config.authentication);

    this.port = config.port;
    this.path = config.path || "/ws";
    this.maxConnections = config.maxConnections || 1000;
    this.authConfig = config.authentication;
    this.heartbeatConfig = config.heartbeatConfig || this.heartbeatConfig;
    this.server = createServer();
    this.wss = new Server({ noServer: true });

    if (this.authConfig.required || this.authConfig.allowAnonymous) {
      if (!this.authConfig.sessionStore) {
        throw new Error(
          "Session store is required for both authenticated and anonymous connections"
        );
      }

      if (this.authConfig.required && !this.authConfig.authProvider) {
        throw new Error(
          "Authentication provider is required when authentication is required"
        );
      }

      this.authenticationMiddleware =
        config.authentication.authenticationMiddleware ||
        new WebSocketAuthenticationMiddleware(
          this.authConfig.authProvider!,
          this.authConfig.sessionStore
        );
    }

    this.setupWebSocketServer();
  }

  private setupWebSocketServer() {
    this.server.on(
      "upgrade",
      async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
        // Prevent memory leaks by handling socket errors
        socket.on("error", (err) => {
          this.error("Socket error:", err);
          socket.destroy();
        });

        // Parse the URL to get just the pathname
        const url = new URL(request.url!, `http://${request.headers.host}`);

        if (url.pathname !== this.path) {
          socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
          socket.destroy();
          this.warn(`Invalid path: ${request.url}`);
          return;
        }

        const connection = await this.handleAuthentication(request);
        if (!connection) {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\n" +
              "Connection: close\r\n" +
              "Content-Type: text/plain\r\n\r\n" +
              "Authentication failed\r\n"
          );
          socket.end();
          return;
        }

        this.upgradeConnection(request, socket, head, connection);
      }
    );
  }

  private upgradeConnection(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    authenticatedConnection?: WebsocketConnection
  ) {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      if (this.connections.size >= this.maxConnections) {
        ws.close(1013, "Maximum number of connections reached");
        return;
      }

      if (authenticatedConnection) {
        // Set the WebSocket instance on the existing connection
        authenticatedConnection.setWebSocket(ws);
        this.connections.set(
          authenticatedConnection.getConnectionId(),
          authenticatedConnection
        );
      } else {
        // Create new connection with WebSocket instance
        const connection = new WebsocketConnection(
          this.handleMessage.bind(this),
          this.handleClose.bind(this),
          undefined, // default rate limit
          this.handleWsEvents(),
          ws,
          this.heartbeatConfig.interval,
          this.heartbeatConfig.timeout
        );
        this.connections.set(connection.getConnectionId(), connection);
      }
    });
  }

  private validateAuthenticationConfig(config: AuthenticationConfig): void {
    // Check for invalid configuration where no connections would be possible
    if (!config.required && !config.allowAnonymous) {
      throw new Error(
        "Invalid authentication configuration: " +
          "When authentication is not required, you must either enable anonymous connections " +
          "or set required to true. Current configuration would prevent any connections."
      );
    }

    // Additional validation checks
    if (config.required && !config.authProvider) {
      throw new Error(
        "Invalid authentication configuration: " +
          "Authentication provider is required when authentication is required"
      );
    }

    if (config.allowAnonymous && !config.sessionStore) {
      throw new Error(
        "Invalid authentication configuration: " +
          "Session store is required when anonymous connections are allowed"
      );
    }

    // Validate anonymous config if anonymous connections are allowed
    if (config.allowAnonymous && config.anonymousConfig) {
      if (
        config.anonymousConfig.sessionDuration !== undefined &&
        config.anonymousConfig.sessionDuration <= 0
      ) {
        throw new Error(
          "Invalid anonymous session configuration: " +
            "Session duration must be positive"
        );
      }
    }
  }

  private async handleAuthentication(
    request: IncomingMessage
  ): Promise<WebsocketConnection | null> {
    try {
      // First, try to authenticate if credentials are provided
      const connection = new WebsocketConnection(
        this.handleMessage.bind(this),
        this.handleClose.bind(this)
      );

      // Try token/credentials authentication first if middleware exists
      if (this.authenticationMiddleware) {
        try {
          const authResult =
            await this.authenticationMiddleware.authenticateConnection(
              request,
              connection
            );
          if (authResult.success) {
            for (const [key, value] of Object.entries(authResult)) {
              if (value) connection.setMetadata(key, value);
            }
            return connection;
          }
        } catch (error) {
          // Authentication failed, but we might still allow anonymous access
          if (this.authConfig.required) {
            throw error;
          }
        }
      }

      // If we reach here and anonymous access is allowed, create anonymous session
      if (this.authConfig.allowAnonymous) {
        await this.createAnonymousSession(connection, request);
        return connection;
      }

      // If we reach here, neither authentication succeeded nor anonymous access is allowed
      return null;
    } catch (error: any) {
      this.error("Authentication error:", error);
      return null;
    }
  }

  private async createAnonymousSession(
    connection: WebsocketConnection,
    request: IncomingMessage
  ): Promise<void> {
    const config = this.authConfig.anonymousConfig || {
      enabled: true,
      sessionDuration: 24 * 60 * 60 * 1000, // 24 hours default
    };

    const deviceId = this.extractDeviceId(request);

    const sessionData: ISessionData = {
      sessionId: crypto.randomUUID(),
      userId: deviceId || crypto.randomUUID(), // Use device ID as userId if available
      createdAt: new Date(),
      expiresAt: new Date(
        Date.now() + (config.sessionDuration || 24 * 60 * 60 * 1000)
      ),
      lastAccessedAt: new Date(),
      metadata: {
        ...config.metadata,
        isAnonymous: true,
        deviceId,
      },
    };

    await this.authConfig.sessionStore.create(sessionData);
    connection.setMetadata("sessionId", sessionData.sessionId);
    connection.setMetadata("userId", sessionData.userId);
    connection.setMetadata("isAnonymous", true);
    connection.setAuthenticated(false);
  }

  private extractDeviceId(request: IncomingMessage): string | null {
    // Try to extract device ID from various sources
    const url = new URL(request.url!, `http://${request.headers.host}`);

    // Check query parameters
    const deviceId = url.searchParams.get("deviceId");
    if (deviceId) return deviceId;

    // Check headers
    const deviceIdHeader = request.headers["x-device-id"];
    if (deviceIdHeader) return deviceIdHeader.toString();

    // Check cookies
    const cookies = request.headers.cookie
      ?.split(";")
      .map((cookie) => cookie.trim().split("="))
      .find(([key]) => key === "deviceId");

    return cookies ? cookies[1] : null;
  }

  private handleWsEvents() {
    return {
      onRateLimit: (connectionId: string) => {
        this.warn(`Rate limit exceeded for connection ${connectionId}`);
        const connection = this.connections.get(connectionId);
        if (connection) {
          connection.close(1008, "Rate limit exceeded");
          this.connections.delete(connectionId);
        }
      },
      onError: (connectionId: string, error: Error) => {
        this.warn(`Error for connection ${connectionId}: ${error.message}`);
        // TODO: handle connection erros
      },
      onSecurityViolation: (connectionId: string, violation: string) => {
        this.warn(
          `Security violation for connection ${connectionId}: ${violation}`
        );
        const connection = this.connections.get(connectionId);
        if (connection) {
          connection.close(1008, "Security violation");
          this.connections.delete(connectionId);
        }
      },
    };
  }

  private async refreshSession(connection: WebsocketConnection): Promise<void> {
    await connection.refreshSession(this.authConfig.sessionStore);
  }

  private async handleMessage(
    data: Data,
    connection: WebsocketConnection
  ): Promise<void> {
    try {
      await this.refreshSession(connection);
      // TODO: handle expired sessions
      const strData = data.toString();
      const detectionResult = detectAndCategorizeMessage(strData);
      let requestType: string = "";

      if (
        detectionResult.payloadType == "string" ||
        detectionResult.payloadType == "object"
      ) {
        requestType = "raw";
        const response = await this.makeRequest<any>({
          to: this.serviceId,
          requestType: "raw",
          body: detectionResult.payload,
        });
        connection.send(JSON.stringify(response));
        return;
      }

      if (detectionResult.payloadType == "IResponse") {
        const response = detectionResult.payload as IResponse<any>;
        if (
          response.requestHeader.requestType &&
          response.requestHeader.recipientAddress &&
          response.requestHeader.recipientAddress !=
            response.responseHeader.responderAddress
        ) {
          await this.sendOneWayMessage(
            response.requestHeader.requestType,
            response.requestHeader.recipientAddress,
            JSON.stringify(response.body),
            response.requestHeader.requestId
          );
        }
        return;
      }

      if (detectionResult.payloadType == "IRequest") {
        const request = detectionResult.payload as IRequest<any>;
        // TODO: handle non-authenticated Requests
        // TODO: handle authorization

        let authMetadata: IAuthenticationMetadata = {};
        authMetadata.isAuthenticated = connection.isAuthenticated();
        if (connection.isAuthenticated()) {
          authMetadata.sessionId = connection.getSessionId();
          authMetadata.userId = connection.getMetadata("userId");
          authMetadata.connectionId = connection.getConnectionId();
        }

        const response = await this.makeRequest<any>({
          to: request.header.recipientAddress || this.serviceId,
          requestType: request.header.requestType || "unknown",
          body: request.body,
          headers: {
            ...request.header,
            requestId: request.header.requestId,
            sessionId: connection.getSessionId(),
            authMetadata,
          },
          handleStatusUpdate: async (
            updateRequest: IRequest<any>,
            status: StatusUpdate
          ) => {
            const statusUpdate = MicroserviceFramework.createResponse(
              updateRequest,
              updateRequest.header.requesterAddress,
              status
            );
            connection.send(JSON.stringify(statusUpdate));
          },
        });
        connection.send(JSON.stringify(response));
      }
    } catch (error: any) {
      this.error(`Error processing WebSocket message`, error);
      connection.send(JSON.stringify({ error: "Invalid message format" }));
    }
  }

  private async handleClose(connectionId: string) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      await connection.close(1000, "Connection closed");
      this.connections.delete(connectionId);
      const sessionId = connection.getSessionId();
      if (sessionId) {
        await this.authConfig.sessionStore.delete(sessionId);
      }
      this.info(`WebSocket connection closed: ${connectionId}`);
    }
  }

  protected async startDependencies(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.info(`WebSocket server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  protected async stopDependencies(): Promise<void> {
    try {
      // First, stop accepting new connections
      this.server.close();

      // Close all active connections
      this.info("Closing all active WebSocket connections...");
      await Promise.all(
        Array.from(this.connections.values()).map((connection) =>
          connection.close(1000, "Server shutting down")
        )
      );

      // Wait for the WSS to close properly
      await new Promise<void>((resolve, reject) => {
        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
          reject(new Error("WSS close timeout"));
        }, 5000);

        this.wss.close(() => {
          clearTimeout(timeout);
          this.info("WebSocket server stopped");
          resolve();
        });
      });
    } catch (error: any) {
      this.error("Error during shutdown:", error);
      // Force close everything
      this.wss.clients.forEach((client) => {
        try {
          client.terminate();
        } catch (e) {
          // Ignore errors during force termination
        }
      });
      throw error; // Re-throw to indicate shutdown failure
    }
  }

  protected async defaultMessageHandler(
    request: IRequest<WebSocketMessage>
  ): Promise<WebSocketResponse> {
    this.warn(
      `Unhandled WebSocket message type: ${request.header.requestType}`,
      request
    );
    return {
      success: false,
      error: `"Unhandled message type" ${request.header.requestType}`,
    };
  }

  protected getConnections(): Map<string, WebsocketConnection> {
    return this.connections;
  }

  public broadcast(message: IRequest<WebSocketMessage>): void {
    const messageString = JSON.stringify(message);
    this.connections.forEach((connection) => {
      connection.send(messageString);
    });
  }

  public sendToConnection(
    connectionId: string,
    message: IResponse<WebSocketMessage>
  ): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.send(JSON.stringify(message));
    } else {
      this.warn(`Connection not found: ${connectionId}`);
    }
  }

  async getSessionById(sessionId: string): Promise<ISessionData | null> {
    return this.authConfig.sessionStore.get(sessionId);
  }

  @RequestHandler<string>("raw")
  protected async rawMessageHandler(message: string): Promise<string> {
    this.warn(`Received raw message`, message);
    return "ERROR: Raw messages not supported. Please use CommunicationsManager";
  }
}

function detectAndCategorizeMessage(message: string): DetectionResult<unknown> {
  // First, check if the message is likely JSON or a JavaScript-like object
  if (message.trim().startsWith("{") || message.trim().startsWith("[")) {
    try {
      const parsed = JSON.parse(message);

      // Check if it's likely an IRequest
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "header" in parsed &&
        "body" in parsed &&
        typeof parsed.header === "object" &&
        "timestamp" in parsed.header &&
        "requestId" in parsed.header &&
        "requesterAddress" in parsed.header
      ) {
        return {
          payloadType: "IRequest",
          payload: parsed as IRequest<unknown>,
        };
      }

      // Check if it's likely an IResponse
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "requestHeader" in parsed &&
        "responseHeader" in parsed &&
        "body" in parsed
      ) {
        return {
          payloadType: "IResponse",
          payload: parsed as IResponse<unknown>,
        };
      }

      // If it's a parsed object but not IRequest or IResponse
      return { payloadType: "object", payload: parsed };
    } catch (error) {
      // If parsing fails, treat it as a string
      return { payloadType: "string", payload: message };
    }
  } else {
    // If it doesn't look like JSON, treat it as a string
    return { payloadType: "string", payload: message };
  }
}
