import { Server, Data } from "ws";
import { createServer, Server as HttpServer, IncomingMessage } from "http";
import { Duplex } from "stream";
import { ISessionData } from "../interfaces";

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

export interface WebSocketServerConfig extends IServerConfig {
  port: number;
  path?: string;
  maxConnections?: number;
  requiresAuthentication?: boolean;
  authProvider?: IAuthenticationProvider;
  sessionStore?: ISessionStore;
  authenticationMiddleware?: WebSocketAuthenticationMiddleware;
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
  private authProvider: IAuthenticationProvider | undefined;
  private sessionStore: ISessionStore | undefined;
  private authenticationMiddleware:
    | WebSocketAuthenticationMiddleware
    | undefined;
  private requiresAuthentication: boolean = false;

  constructor(backend: IBackEnd, config: WebSocketServerConfig) {
    super(backend, config);
    this.port = config.port;
    this.path = config.path || "/ws";
    this.maxConnections = config.maxConnections || 1000;

    this.server = createServer();
    this.wss = new Server({ noServer: true });
    this.authProvider = config.authProvider;
    this.sessionStore = config.sessionStore;
    this.requiresAuthentication = config.requiresAuthentication || false;
    if (this.requiresAuthentication === true) {
      if (!this.authProvider || !this.sessionStore) {
        throw new Error(
          "Authentication is required but no authentication middleware or session store was provided"
        );
      }
      const authMiddleware =
        config.authenticationMiddleware ||
        new WebSocketAuthenticationMiddleware(
          this.authProvider,
          this.sessionStore
        );
      this.authenticationMiddleware = authMiddleware;
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

        // Handle authentication before upgrading the connection
        if (this.requiresAuthentication) {
          try {
            // Create a temporary connection object for authentication
            const tempConnection = new WebsocketConnection(
              this.handleMessage.bind(this),
              this.handleClose.bind(this)
            );

            await this.authenticationMiddleware!.authenticateConnection(
              request,
              tempConnection
            );

            // If authentication succeeds, proceed with the upgrade
            this.upgradeConnection(request, socket, head, tempConnection);
          } catch (error: any) {
            this.warn("Authentication error", error);
            socket.write(
              "HTTP/1.1 401 Unauthorized\r\n" +
                "Connection: close\r\n" +
                "Content-Length: 21\r\n" +
                "Content-Type: text/plain\r\n" +
                "\r\n" +
                "Authentication failed\r\n"
            );

            // End the socket after writing the response
            socket.end();
            return;
          }
        } else {
          // If no authentication required, proceed with upgrade directly
          this.upgradeConnection(request, socket, head);
        }
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
          undefined, // default timeout
          undefined, // default rate limit
          this.handleWsEvents(),
          ws
        );
        this.connections.set(connection.getConnectionId(), connection);
      }
    });
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
    if (this.requiresAuthentication) {
      await connection.refreshSession(this.sessionStore!);
    }
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
        await this.sendOneWayMessage(
          JSON.stringify(response),
          response.requestHeader.requesterAddress,
          response.body
        );
        return;
      }

      if (detectionResult.payloadType == "IRequest") {
        const request = detectionResult.payload as IRequest<any>;
        // TODO: handle non-authenticated Requests
        // TODO: handle authorization
        const response = await this.makeRequest<any>({
          to: request.header.recipientAddress || this.serviceId,
          requestType: request.header.requestType || "unknown",
          body: {
            connectionId: connection.getConnectionId(),
            type: request.header.requestType || "unknown",
            body: request.body,
          },
          headers: {
            ...request.header,
            requestId: request.header.requestId,
            sessionId: connection.getSessionId(),
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

  private handleClose(connectionId: string) {
    this.connections.delete(connectionId);
    this.info(`WebSocket connection closed: ${connectionId}`);
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
    return new Promise(async (resolve) => {
      try {
        // Close all active connections and wait for them to complete
        this.info("Closing all active WebSocket connections...");
        await Promise.all(
          Array.from(this.connections.values()).map((connection) =>
            connection.close(1000, "Server shutting down")
          )
        );

        // Close the WebSocket server and HTTP server
        await new Promise<void>((resolveWss) => {
          this.wss.close(() => {
            this.server.close(() => {
              this.info("WebSocket server stopped");
              resolveWss();
            });
          });
        });

        resolve();
      } catch (error: any) {
        this.error("Error during shutdown:", error);
        resolve(); // Still resolve to ensure shutdown completes
      }
    });
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

  @RequestHandler<string>("raw")
  protected async rawMessageHandler(message: string): Promise<string> {
    this.warn(`Received raw message`, message);
    return "ERROR: Raw messages not supported. Please use CommunicationsManager";
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
    return this.sessionStore ? this.sessionStore.get(sessionId) : null;
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
        "body" in parsed &&
        typeof parsed.body === "object" &&
        "data" in parsed.body &&
        "success" in parsed.body &&
        "error" in parsed.body
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
