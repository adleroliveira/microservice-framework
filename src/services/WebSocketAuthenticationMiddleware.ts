import {
  AuthenticationError,
  AuthenticationMiddleware,
  AuthenticationErrorType,
} from "../core/AuthenticationMiddleware";
import { IAuthenticationResult, ISessionData } from "../interfaces";
import { WebsocketConnection } from "./WebsocketConnection";
import { IncomingMessage } from "http";
import { LoggableError } from "../logging";

interface Credentials {
  username: string;
  password: string;
}

export class WebSocketAuthenticationMiddleware extends AuthenticationMiddleware {
  async authenticateConnection(
    request: IncomingMessage,
    connection: WebsocketConnection
  ): Promise<IAuthenticationResult> {
    try {
      // Try token authentication first
      const token = await this.extractToken(request);
      if (token) {
        const result = await this.authProvider.validateToken(token);
        if (!result.success) {
          throw new AuthenticationError(
            AuthenticationErrorType.INVALID_TOKEN,
            `Token authentication failed: ${result.error}`
          );
        }
        await this.attachSessionToConnection(connection, result);
        return result;
      }

      this.warn(
        "Token authentication failed (No token provided), falling back to credentials"
      );

      // Fall back to credentials if no token or token invalid
      const credentials = await this.extractCredentials(request);
      const result = await this.authProvider.authenticate(credentials);

      if (result.success) {
        await this.attachSessionToConnection(connection, result);
        return result;
      }

      await this.handleAuthenticationFailure(request, "Authentication failed");
      return { success: false, error: "Authentication failed" };
    } catch (error: any) {
      await this.handleAuthenticationFailure(request, error.message);
      return { success: false, error: error.message };
    }
  }

  private async attachSessionToConnection(
    connection: WebsocketConnection,
    authResult: IAuthenticationResult
  ): Promise<void> {
    const sessionData: ISessionData = {
      sessionId: authResult.sessionId || crypto.randomUUID(),
      userId: authResult.userId!,
      createdAt: new Date(),
      expiresAt:
        authResult.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
      lastAccessedAt: new Date(),
      metadata: authResult.metadata || {},
    };

    await this.sessionStore.create(sessionData);
    connection.setMetadata("sessionId", sessionData.sessionId);
    connection.setMetadata("userId", sessionData.userId);
    connection.setAuthenticated(true);
  }

  async extractCredentials(request: IncomingMessage): Promise<Credentials> {
    // Extract auth data from the Sec-WebSocket-Protocol header
    const protocols = request.headers["sec-websocket-protocol"];
    if (!protocols)
      throw new LoggableError("No authentication protocol provided");

    // Protocol format: "auth-username-base64credentials"
    const authProtocol = protocols
      .split(",")
      .find((p) => p.trim().startsWith("auth-"));
    if (!authProtocol) throw new LoggableError("Auth protocol not found");

    const [_, username, credentials] = authProtocol.split("-");

    let paddedCredentials = credentials;

    while (paddedCredentials.length % 4) {
      paddedCredentials += "=";
    }

    return {
      username,
      password: decodeURIComponent(atob(paddedCredentials)),
    };
  }

  async extractToken(request: IncomingMessage): Promise<string | null> {
    const protocols = request.headers["sec-websocket-protocol"];
    // Check if token has been sent using: WebSocket Subprotocol Authentication
    if (protocols) {
      // Protocol format: "token-jwt_token_here"
      const tokenProtocol = protocols
        .split(",")
        .find((p) => p.trim().startsWith("token-"));
      if (!tokenProtocol) return null;
      const [_, token] = tokenProtocol.split("-");
      return token;
    }

    // WebSocket Subprotocol Authentication not found. Fall back to query parameters
    const url = new URL(request.url!, `http://${request.headers.host}`);
    const queryToken = url.searchParams.get("token");
    if (queryToken) return queryToken;

    // Check authorization header
    const authHeader = request.headers["authorization"];
    if (authHeader?.startsWith("Bearer ")) {
      return authHeader.substring(7);
    }

    return null;
  }

  async handleAuthenticationFailure(
    request: unknown,
    error: string
  ): Promise<void> {
    throw new AuthenticationError(
      AuthenticationErrorType.INVALID_CREDENTIALS,
      error,
      { request }
    );
  }
}
