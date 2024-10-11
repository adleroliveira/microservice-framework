import { Server, Data } from "ws";
import { createServer, Server as HttpServer } from "http";
import {
  MicroserviceFramework,
  IServerConfig,
  StatusUpdate,
  RequestHandler,
} from "../MicroserviceFramework";
import { IBackEnd, IRequest, IResponse } from "../interfaces";
import { WebsocketConnection } from "./WebsocketConnection";

type PayloadType = "object" | "string" | "IRequest" | "IResponse";

interface DetectionResult<T> {
  payloadType: PayloadType;
  payload: T;
}

export interface WebSocketServerConfig extends IServerConfig {
  port: number;
  path?: string;
  maxConnections?: number;
}

export type WebSocketMessage = {
  type: string;
  data: any;
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

  constructor(backend: IBackEnd, config: WebSocketServerConfig) {
    super(backend, config);
    this.port = config.port;
    this.path = config.path || "/ws";
    this.maxConnections = config.maxConnections || 1000;

    this.server = createServer();
    this.wss = new Server({ noServer: true });

    this.setupWebSocketServer();
  }

  private setupWebSocketServer() {
    this.server.on("upgrade", (request, socket, head) => {
      if (request.url === this.path) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          if (this.connections.size >= this.maxConnections) {
            ws.close(1013, "Maximum number of connections reached");
            return;
          }

          const connection = new WebsocketConnection(
            ws,
            this.handleMessage.bind(this),
            this.handleClose.bind(this)
          );

          this.connections.set(connection.getConnectionId(), connection);
          this.info(
            `New WebSocket connection: ${connection.getConnectionId()}`
          );
        });
      } else {
        socket.destroy();
      }
    });
  }

  private async handleMessage(data: Data, connection: WebsocketConnection) {
    try {
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
        const response = await this.makeRequest<any>({
          to: request.header.recipientAddress || this.serviceId,
          requestType: request.header.requestType || "unknown",
          body: request.body,
          headers: { ...request.header, requestId: request.header.requestId },
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
    return new Promise((resolve) => {
      // Close all active connections
      this.info("Closing all active WebSocket connections...");
      for (const connection of this.connections.values()) {
        connection.close(1000, "Server shutting down");
      }

      // Wait for a short time to allow connections to close
      setTimeout(() => {
        // Close the WebSocket server
        this.wss.close(() => {
          // Close the HTTP server
          this.server.close(() => {
            this.info("WebSocket server stopped");
            resolve();
          });
        });
      }, 1000); // Wait for 1 second before closing servers
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

  @RequestHandler<string>("raw")
  protected async rawMessageHandler(message: string): Promise<string> {
    this.warn(`Received raw message`, message);
    return "ERROR: Raw messages not supported. Please use CommunicationsManager";
  }

  public broadcast(message: WebSocketMessage): void {
    const messageString = JSON.stringify(message);
    this.connections.forEach((connection) => {
      connection.send(messageString);
    });
  }

  public sendToConnection(
    connectionId: string,
    message: WebSocketMessage
  ): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      connection.send(JSON.stringify(message));
    } else {
      this.warn(`Connection not found: ${connectionId}`);
    }
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
