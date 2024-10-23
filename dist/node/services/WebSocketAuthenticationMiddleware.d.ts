import { AuthenticationMiddleware } from "../core/AuthenticationMiddleware";
import { IAuthenticationResult } from "../interfaces";
import { WebsocketConnection } from "./WebsocketConnection";
import { IncomingMessage } from "http";
interface Credentials {
    username: string;
    password: string;
}
export declare class WebSocketAuthenticationMiddleware extends AuthenticationMiddleware {
    authenticateConnection(request: IncomingMessage, connection: WebsocketConnection): Promise<IAuthenticationResult>;
    private attachSessionToConnection;
    extractCredentials(request: IncomingMessage): Promise<Credentials>;
    extractToken(request: IncomingMessage): Promise<string | null>;
    handleAuthenticationFailure(request: unknown, error: string): Promise<void>;
}
export {};
