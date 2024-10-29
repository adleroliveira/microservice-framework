import { v4 as uuidv4 } from "uuid";
import {
  IRequest,
  IResponse,
  IResponseData,
  IRequestHeader,
} from "../interfaces";
import EventEmitter from "eventemitter3";
import { WebSocketManager } from "./WebSocketManager";
import { BrowserConsoleStrategy } from "./BrowserConsoleStrategy";

export interface RequestManagerProps {
  webSocketManager: WebSocketManager;
  requestTimeout?: number;
}

type RequestHandler<T, R> = (
  payload: T,
  requestHeader: IRequestHeader
) => Promise<R> | R;

export class RequestManager extends EventEmitter {
  private logger: BrowserConsoleStrategy;
  private pendingRequests: Map<string, (response: IResponse<any>) => void> =
    new Map();
  private requestHandlers: Map<string, RequestHandler<any, any>> = new Map();
  private requestTimeout: number;
  private webSocketManager: WebSocketManager;
  private authToken: string | undefined;

  constructor(props: RequestManagerProps) {
    super();
    this.logger = new BrowserConsoleStrategy();
    this.requestTimeout = props.requestTimeout || 30000;
    this.webSocketManager = props.webSocketManager;
    this.webSocketManager.on("message", this.handleMessage.bind(this));
  }

  public async request<I, O>(
    requestType: string,
    body: I,
    to?: string
  ): Promise<IResponseData<O>> {
    return new Promise((resolve, reject) => {
      const request = this.createRequest<I>(requestType, body, to);
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request.header.requestId);
        reject(new Error("Request timeout"));
      }, this.requestTimeout);

      const requestCallback = (response: IResponse<O>) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(request.header.requestId);
        if (response.body.success) {
          resolve(response.body);
        } else {
          reject(response.body.error || response.body.data);
        }
      };

      this.pendingRequests.set(request.header.requestId, requestCallback);
      this.webSocketManager.send(JSON.stringify(request));
    });
  }

  private createRequest<T>(
    requestType: string,
    body: T,
    to?: string
  ): IRequest<T> {
    return {
      header: {
        timestamp: Date.now(),
        requestId: `RM-${uuidv4()}`,
        requesterAddress: "RequestManager",
        recipientAddress: to,
        requestType,
        authToken: this.authToken,
      },
      body,
    };
  }

  private handleMessage(parsed: any) {
    try {
      if (parsed.header && parsed.header.requestType) {
        this.handleIncomingRequest(parsed);
      } else if (parsed.requestHeader) {
        this.handleResponse(parsed);
      } else {
        this.logger.warn("Received message with unknown structure:", parsed);
      }
    } catch (error) {
      this.logger.error("Error parsing message:", error);
    }
  }

  private async handleIncomingRequest(request: IRequest<any>) {
    const { requestType } = request.header;

    if (!requestType) {
      this.logger.warn("Received request without requestType");
      return;
    }

    if (this.listenerCount(requestType) > 0) {
      // Pass both payload and header to ensure we can construct the response
      this.emit(requestType, request.body, request.header);
    } else {
      this.logger.warn(
        `No handlers registered for requestType: ${requestType}`
      );

      // Send error response for unhandled request types
      const errorResponse: IResponse<null> = {
        requestHeader: request.header,
        responseHeader: {
          responderAddress: "RequestManager",
          timestamp: Date.now(),
        },
        body: {
          data: null,
          success: false,
          error: new Error(
            `No handler registered for requestType: ${requestType}`
          ),
        },
      };
      this.webSocketManager.send(JSON.stringify(errorResponse));
    }
  }

  private handleResponse<T>(response: IResponse<T>) {
    const pendingRequest = this.pendingRequests.get(
      response.requestHeader.requestId
    );
    if (pendingRequest) {
      pendingRequest(response);
      this.pendingRequests.delete(response.requestHeader.requestId);
    }
  }

  // Method to register handlers for incoming requests
  public registerHandler<T, R>(
    requestType: string,
    handler: (payload: T, requestHeader: IRequestHeader) => Promise<R> | R
  ): void {
    if (this.requestHandlers.has(requestType)) {
      throw new Error(
        `Handler already registered for requestType: ${requestType}`
      );
    }

    this.requestHandlers.set(requestType, handler);

    // Set up the event listener that ensures responses go back through WebSocket
    this.on(requestType, async (payload: T, requestHeader: IRequestHeader) => {
      try {
        const result = await handler(payload, requestHeader);
        if (!requestHeader.requiresResponse) {
          return;
        }
        const response: IResponse<R> = {
          requestHeader,
          responseHeader: {
            responderAddress: "RequestManager",
            timestamp: Date.now(),
          },
          body: {
            data: result,
            success: true,
            error: null,
          },
        };
        this.webSocketManager.send(JSON.stringify(response));
      } catch (error) {
        if (!requestHeader.requiresResponse) {
          this.logger.warn(
            `Request error not sent. No response required for requestType: ${requestType}`,
            error
          );
          return;
        }
        const errorResponse: IResponse<null> = {
          requestHeader,
          responseHeader: {
            responderAddress: "RequestManager",
            timestamp: Date.now(),
          },
          body: {
            data: null,
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          },
        };
        this.webSocketManager.send(JSON.stringify(errorResponse));
      }
    });
  }

  // Method to remove handlers
  public removeHandler(requestType: string): void {
    this.requestHandlers.delete(requestType);
    this.removeAllListeners(requestType);
  }

  public setAuthToken(token: string) {
    this.authToken = token;
  }

  public clearAuthToken() {
    this.authToken = undefined;
  }

  public clearState(): void {
    // Clear pending requests but keep the manager alive
    for (const [requestId] of this.pendingRequests) {
      this.pendingRequests.delete(requestId);
    }
    this.clearAuthToken();
  }

  public destroy(): void {
    // Clear timeout for any pending requests
    for (const [requestId] of this.pendingRequests) {
      this.pendingRequests.delete(requestId);
    }

    // Remove WebSocket message listener
    this.webSocketManager.removeListener(
      "message",
      this.handleMessage.bind(this)
    );

    // Clear all event listeners
    this.removeAllListeners();

    // Clear auth token
    this.clearAuthToken();

    // Clear references
    this.webSocketManager = null!;
    this.logger = null!;
    this.pendingRequests = null!;
  }
}
