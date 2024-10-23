import { IRequestHeader } from "./IRequest";
import { IAuthenticationMetadata } from "./auth";

export interface IResponseData<T> {
  data: T;
  success: boolean;
  error: Error | null;
  authenticationRequired?: boolean;
  authenticationError?: string;
  sessionExpired?: boolean;
}

export interface IResponseHeader {
  responderAddress: string;
  timestamp: number;
  newAuthToken?: string;
  newRefreshToken?: string;
  authMetadata?: IAuthenticationMetadata;
}

export interface IResponse<T> {
  requestHeader: IRequestHeader;
  responseHeader: IResponseHeader;
  body: IResponseData<T>;
}

export interface IAuthenticationResponse
  extends IResponse<{
    userId?: string;
    sessionId?: string;
    metadata?: Record<string, unknown>;
  }> {}
