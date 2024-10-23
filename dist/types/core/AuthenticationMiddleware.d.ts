import { IAuthenticationProvider, ISessionStore, IRequest, IResponse, IAuthenticationMetadata } from "../interfaces";
import { LoggableError, Loggable } from "../logging";
export declare abstract class AuthenticationMiddleware extends Loggable {
    protected authProvider: IAuthenticationProvider;
    protected sessionStore: ISessionStore;
    constructor(authProvider: IAuthenticationProvider, sessionStore: ISessionStore);
    abstract extractCredentials(request: unknown): Promise<unknown>;
    abstract extractToken(request: unknown): Promise<string | null>;
    abstract handleAuthenticationFailure(request: unknown, error: string): Promise<void>;
}
export declare enum AuthenticationErrorType {
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
    EXPIRED_TOKEN = "EXPIRED_TOKEN",
    INVALID_TOKEN = "INVALID_TOKEN",
    SESSION_EXPIRED = "SESSION_EXPIRED",
    INSUFFICIENT_PERMISSIONS = "INSUFFICIENT_PERMISSIONS",
    AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED"
}
export declare class AuthenticationError extends LoggableError {
    type: AuthenticationErrorType;
    metadata?: Record<string, unknown> | undefined;
    constructor(type: AuthenticationErrorType, message: string, metadata?: Record<string, unknown> | undefined);
}
export declare class AuthenticationHelper {
    static isAuthenticationRequired(response: IResponse<unknown>): boolean;
    static isSessionExpired(response: IResponse<unknown>): boolean;
    static getAuthenticationError(response: IResponse<unknown>): string | undefined;
    static hasValidSession(request: IRequest<unknown>): boolean;
    static createAuthenticationResponse<T>(request: IRequest<unknown>, error: AuthenticationError): IResponse<T>;
    static addAuthToRequest<T>(request: IRequest<T>, authToken: string, sessionId: string, metadata?: IAuthenticationMetadata): IRequest<T>;
}
