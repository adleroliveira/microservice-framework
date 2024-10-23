import {
  IAuthenticationProvider,
  ISessionStore,
  IRequest,
  IResponse,
  IAuthenticationMetadata,
} from "../interfaces";
import { LoggableError, Loggable } from "../logging";

export abstract class AuthenticationMiddleware extends Loggable {
  constructor(
    protected authProvider: IAuthenticationProvider,
    protected sessionStore: ISessionStore
  ) {
    super();
  }

  abstract extractCredentials(request: unknown): Promise<unknown>;
  abstract extractToken(request: unknown): Promise<string | null>;
  abstract handleAuthenticationFailure(
    request: unknown,
    error: string
  ): Promise<void>;
}

export enum AuthenticationErrorType {
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  EXPIRED_TOKEN = "EXPIRED_TOKEN",
  INVALID_TOKEN = "INVALID_TOKEN",
  SESSION_EXPIRED = "SESSION_EXPIRED",
  INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
  AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED",
}

export class AuthenticationError extends LoggableError {
  constructor(
    public type: AuthenticationErrorType,
    message: string,
    public metadata?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthenticationHelper {
  static isAuthenticationRequired(response: IResponse<unknown>): boolean {
    return response.body.authenticationRequired === true;
  }

  static isSessionExpired(response: IResponse<unknown>): boolean {
    return response.body.sessionExpired === true;
  }

  static getAuthenticationError(
    response: IResponse<unknown>
  ): string | undefined {
    return response.body.authenticationError;
  }

  static hasValidSession(request: IRequest<unknown>): boolean {
    return !!(request.header.sessionId && request.header.authToken);
  }

  static createAuthenticationResponse<T>(
    request: IRequest<unknown>,
    error: AuthenticationError
  ): IResponse<T> {
    return {
      requestHeader: request.header,
      responseHeader: {
        responderAddress: "auth-service",
        timestamp: Date.now(),
      },
      body: {
        data: null as T,
        success: false,
        error,
        authenticationRequired: true,
        authenticationError: error.message,
        sessionExpired: error.type === AuthenticationErrorType.SESSION_EXPIRED,
      },
    };
  }

  static addAuthToRequest<T>(
    request: IRequest<T>,
    authToken: string,
    sessionId: string,
    metadata?: IAuthenticationMetadata
  ): IRequest<T> {
    return {
      ...request,
      header: {
        ...request.header,
        authToken,
        sessionId,
        authMetadata: metadata,
      },
    };
  }
}
