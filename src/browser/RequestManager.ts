import { v4 as uuidv4 } from "uuid";
import { IRequest, IResponse, IResponseData } from "../interfaces";
import EventEmitter from "eventemitter3";
import { WebSocketManager } from "./WebSocketManager";
import { BrowserConsoleStrategy } from "./BrowserConsoleStrategy";

export interface RequestManagerProps {
  webSocketManager: WebSocketManager;
  requestTimeout?: number;
}

export class RequestManager extends EventEmitter {
  private logger: BrowserConsoleStrategy;
  private pendingRequests: Map<string, (response: IResponse<any>) => void> =
    new Map();
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

  private handleIncomingRequest(request: IRequest<any>) {
    const { requestType } = request.header;
    if (requestType && this.listenerCount(requestType) > 0) {
      this.emit(requestType, request.body, (responseBody: any) => {
        const response: IResponse<any> = {
          requestHeader: request.header,
          responseHeader: {
            responderAddress: "RequestManager",
            timestamp: Date.now(),
          },
          body: {
            data: responseBody,
            success: true,
            error: null,
          },
        };
        this.webSocketManager.send(JSON.stringify(response));
      });
    } else {
      this.logger.warn(
        `No handlers registered for requestType: ${requestType}`
      );
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

  public setAuthToken(token: string) {
    this.authToken = token;
  }

  public clearAuthToken() {
    this.authToken = undefined;
  }
}
