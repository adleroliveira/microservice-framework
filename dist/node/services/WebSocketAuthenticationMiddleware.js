"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSocketAuthenticationMiddleware = void 0;
const AuthenticationMiddleware_1 = require("../core/AuthenticationMiddleware");
const logging_1 = require("../logging");
class WebSocketAuthenticationMiddleware extends AuthenticationMiddleware_1.AuthenticationMiddleware {
    async authenticateConnection(request, connection) {
        try {
            // Try token authentication first
            const token = await this.extractToken(request);
            if (token) {
                const result = await this.authProvider.validateToken(token);
                if (result.success) {
                    await this.attachSessionToConnection(connection, result);
                    return result;
                }
            }
            this.warn("Token authentication failed (No token provided), falling back to credentials");
            // Fall back to credentials if no token or token invalid
            const credentials = await this.extractCredentials(request);
            const result = await this.authProvider.authenticate(credentials);
            this.debug("Authentication Result", result);
            if (result.success) {
                await this.attachSessionToConnection(connection, result);
                return result;
            }
            await this.handleAuthenticationFailure(request, "Authentication failed");
            return { success: false, error: "Authentication failed" };
        }
        catch (error) {
            await this.handleAuthenticationFailure(request, error.message);
            return { success: false, error: error.message };
        }
    }
    async attachSessionToConnection(connection, authResult) {
        const sessionData = {
            sessionId: authResult.sessionId || crypto.randomUUID(),
            userId: authResult.userId,
            createdAt: new Date(),
            expiresAt: authResult.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
            lastAccessedAt: new Date(),
            metadata: authResult.metadata || {},
        };
        await this.sessionStore.create(sessionData);
        connection.setMetadata("sessionId", sessionData.sessionId);
        connection.setMetadata("userId", sessionData.userId);
        connection.setAuthenticated(true);
    }
    async extractCredentials(request) {
        // Extract auth data from the Sec-WebSocket-Protocol header
        const protocols = request.headers["sec-websocket-protocol"];
        if (!protocols)
            throw new logging_1.LoggableError("No authentication protocol provided");
        // Protocol format: "auth-username-base64credentials"
        const authProtocol = protocols
            .split(",")
            .find((p) => p.trim().startsWith("auth-"));
        if (!authProtocol)
            throw new logging_1.LoggableError("Auth protocol not found");
        const [_, username, credentials] = authProtocol.split("-");
        let paddedCredentials = credentials;
        while (paddedCredentials.length % 4) {
            paddedCredentials += "=";
        }
        return {
            username,
            credentials: decodeURIComponent(atob(paddedCredentials)),
        };
    }
    async extractToken(request) {
        const protocols = request.headers["sec-websocket-protocol"];
        // Check if token has been sent using: WebSocket Subprotocol Authentication
        if (protocols) {
            // Protocol format: "token-jwt_token_here"
            const tokenProtocol = protocols
                .split(",")
                .find((p) => p.trim().startsWith("token-"));
            if (!tokenProtocol)
                return null;
            const [_, token] = tokenProtocol.split("-");
            return token;
        }
        // WebSocket Subprotocol Authentication not found. Fall back to query parameters
        const url = new URL(request.url, `http://${request.headers.host}`);
        const queryToken = url.searchParams.get("token");
        if (queryToken)
            return queryToken;
        // Check authorization header
        const authHeader = request.headers["authorization"];
        if (authHeader?.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }
        return null;
    }
    async handleAuthenticationFailure(request, error) {
        throw new AuthenticationMiddleware_1.AuthenticationError(AuthenticationMiddleware_1.AuthenticationErrorType.INVALID_CREDENTIALS, error, { request });
    }
}
exports.WebSocketAuthenticationMiddleware = WebSocketAuthenticationMiddleware;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrRUFJMEM7QUFJMUMsd0NBQTJDO0FBTzNDLE1BQWEsaUNBQWtDLFNBQVEsbURBQXdCO0lBQzdFLEtBQUssQ0FBQyxzQkFBc0IsQ0FDMUIsT0FBd0IsRUFDeEIsVUFBK0I7UUFFL0IsSUFBSSxDQUFDO1lBQ0gsaUNBQWlDO1lBQ2pDLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMvQyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUNWLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzVELElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO29CQUNuQixNQUFNLElBQUksQ0FBQyx5QkFBeUIsQ0FBQyxVQUFVLEVBQUUsTUFBTSxDQUFDLENBQUM7b0JBQ3pELE9BQU8sTUFBTSxDQUFDO2dCQUNoQixDQUFDO1lBQ0gsQ0FBQztZQUVELElBQUksQ0FBQyxJQUFJLENBQ1AsOEVBQThFLENBQy9FLENBQUM7WUFFRix3REFBd0Q7WUFDeEQsTUFBTSxXQUFXLEdBQUcsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQUMsT0FBTyxDQUFDLENBQUM7WUFDM0QsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxDQUFDLFlBQVksQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUNqRSxJQUFJLENBQUMsS0FBSyxDQUFDLHVCQUF1QixFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQzVDLElBQUksTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDO2dCQUNuQixNQUFNLElBQUksQ0FB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QztDQUNGO0FBeEhELDhFQXdIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEF1dGhlbnRpY2F0aW9uRXJyb3IsXG4gIEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSxcbiAgQXV0aGVudGljYXRpb25FcnJvclR5cGUsXG59IGZyb20gXCIuLi9jb3JlL0F1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVwiO1xuaW1wb3J0IHsgSUF1dGhlbnRpY2F0aW9uUmVzdWx0LCBJU2Vzc2lvbkRhdGEgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgV2Vic29ja2V0Q29ubmVjdGlvbiB9IGZyb20gXCIuL1dlYnNvY2tldENvbm5lY3Rpb25cIjtcbmltcG9ydCB7IEluY29taW5nTWVzc2FnZSB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQgeyBMb2dnYWJsZUVycm9yIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcblxuaW50ZXJmYWNlIENyZWRlbnRpYWxzIHtcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgY3JlZGVudGlhbHM6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSBleHRlbmRzIEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB7XG4gIGFzeW5jIGF1dGhlbnRpY2F0ZUNvbm5lY3Rpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLFxuICAgIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKTogUHJvbWlzZTxJQXV0aGVudGljYXRpb25SZXN1bHQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gVHJ5IHRva2VuIGF1dGhlbnRpY2F0aW9uIGZpcnN0XG4gICAgICBjb25zdCB0b2tlbiA9IGF3YWl0IHRoaXMuZXh0cmFjdFRva2VuKHJlcXVlc3QpO1xuICAgICAgaWYgKHRva2VuKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXV0aFByb3ZpZGVyLnZhbGlkYXRlVG9rZW4odG9rZW4pO1xuICAgICAgICBpZiAocmVzdWx0LnN1Y2Nlc3MpIHtcbiAgICAgICAgICBhd2FpdCB0aGlzLmF0dGFjaFNlc3Npb25Ub0Nvbm5lY3Rpb24oY29ubmVjdGlvbiwgcmVzdWx0KTtcbiAgICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMud2FybihcbiAgICAgICAgXCJUb2tlbiBhdXRoZW50aWNhdGlvbiBmYWlsZWQgKE5vIHRva2VuIHByb3ZpZGVkKSwgZmFsbGluZyBiYWNrIHRvIGNyZWRlbnRpYWxzXCJcbiAgICAgICk7XG5cbiAgICAgIC8vIEZhbGwgYmFjayB0byBjcmVkZW50aWFscyBpZiBubyB0b2tlbiBvciB0b2tlbiBpbnZhbGlkXG4gICAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IHRoaXMuZXh0cmFjdENyZWRlbnRpYWxzKHJlcXVlc3QpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hdXRoUHJvdmlkZXIuYXV0aGVudGljYXRlKGNyZWRlbnRpYWxzKTtcbiAgICAgIHRoaXMuZGVidWcoXCJBdXRoZW50aWNhdGlvbiBSZXN1bHRcIiwgcmVzdWx0KTtcbiAgICAgIGlmIChyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICBhd2FpdCB0aGlzLmF0dGFjaFNlc3Npb25Ub0Nvbm5lY3Rpb24oY29ubmVjdGlvbiwgcmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVBdXRoZW50aWNhdGlvbkZhaWx1cmUocmVxdWVzdCwgXCJBdXRoZW50aWNhdGlvbiBmYWlsZWRcIik7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IFwiQXV0aGVudGljYXRpb24gZmFpbGVkXCIgfTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUF1dGhlbnRpY2F0aW9uRmFpbHVyZShyZXF1ZXN0LCBlcnJvci5tZXNzYWdlKTtcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyb3IubWVzc2FnZSB9O1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXR0YWNoU2Vzc2lvblRvQ29ubmVjdGlvbihcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uLFxuICAgIGF1dGhSZXN1bHQ6IElBdXRoZW50aWNhdGlvblJlc3VsdFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzZXNzaW9uRGF0YTogSVNlc3Npb25EYXRhID0ge1xuICAgICAgc2Vzc2lvbklkOiBhdXRoUmVzdWx0LnNlc3Npb25JZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpLFxuICAgICAgdXNlcklkOiBhdXRoUmVzdWx0LnVzZXJJZCEsXG4gICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBleHBpcmVzQXQ6XG4gICAgICAgIGF1dGhSZXN1bHQuZXhwaXJlc0F0IHx8IG5ldyBEYXRlKERhdGUubm93KCkgKyAyNCAqIDYwICogNjAgKiAxMDAwKSxcbiAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgbWV0YWRhdGE6IGF1dGhSZXN1bHQubWV0YWRhdGEgfHwge30sXG4gICAgfTtcblxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvblN0b3JlLmNyZWF0ZShzZXNzaW9uRGF0YSk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInNlc3Npb25JZFwiLCBzZXNzaW9uRGF0YS5zZXNzaW9uSWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJ1c2VySWRcIiwgc2Vzc2lvbkRhdGEudXNlcklkKTtcbiAgICBjb25uZWN0aW9uLnNldEF1dGhlbnRpY2F0ZWQodHJ1ZSk7XG4gIH1cblxuICBhc3luYyBleHRyYWN0Q3JlZGVudGlhbHMocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlKTogUHJvbWlzZTxDcmVkZW50aWFscz4ge1xuICAgIC8vIEV4dHJhY3QgYXV0aCBkYXRhIGZyb20gdGhlIFNlYy1XZWJTb2NrZXQtUHJvdG9jb2wgaGVhZGVyXG4gICAgY29uc3QgcHJvdG9jb2xzID0gcmVxdWVzdC5oZWFkZXJzW1wic2VjLXdlYnNvY2tldC1wcm90b2NvbFwiXTtcbiAgICBpZiAoIXByb3RvY29scylcbiAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKFwiTm8gYXV0aGVudGljYXRpb24gcHJvdG9jb2wgcHJvdmlkZWRcIik7XG5cbiAgICAvLyBQcm90b2NvbCBmb3JtYXQ6IFwiYXV0aC11c2VybmFtZS1iYXNlNjRjcmVkZW50aWFsc1wiXG4gICAgY29uc3QgYXV0aFByb3RvY29sID0gcHJvdG9jb2xzXG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAuZmluZCgocCkgPT4gcC50cmltKCkuc3RhcnRzV2l0aChcImF1dGgtXCIpKTtcbiAgICBpZiAoIWF1dGhQcm90b2NvbCkgdGhyb3cgbmV3IExvZ2dhYmxlRXJyb3IoXCJBdXRoIHByb3RvY29sIG5vdCBmb3VuZFwiKTtcblxuICAgIGNvbnN0IFtfLCB1c2VybmFtZSwgY3JlZGVudGlhbHNdID0gYXV0aFByb3RvY29sLnNwbGl0KFwiLVwiKTtcblxuICAgIGxldCBwYWRkZWRDcmVkZW50aWFscyA9IGNyZWRlbnRpYWxzO1xuXG4gICAgd2hpbGUgKHBhZGRlZENyZWRlbnRpYWxzLmxlbmd0aCAlIDQpIHtcbiAgICAgIHBhZGRlZENyZWRlbnRpYWxzICs9IFwiPVwiO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICB1c2VybmFtZSxcbiAgICAgIGNyZWRlbnRpYWxzOiBkZWNvZGVVUklDb21wb25lbnQoYXRvYihwYWRkZWRDcmVkZW50aWFscykpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBleHRyYWN0VG9rZW4ocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgY29uc3QgcHJvdG9jb2xzID0gcmVxdWVzdC5oZWFkZXJzW1wic2VjLXdlYnNvY2tldC1wcm90b2NvbFwiXTtcbiAgICAvLyBDaGVjayBpZiB0b2tlbiBoYXMgYmVlbiBzZW50IHVzaW5nOiBXZWJTb2NrZXQgU3VicHJvdG9jb2wgQXV0aGVudGljYXRpb25cbiAgICBpZiAocHJvdG9jb2xzKSB7XG4gICAgICAvLyBQcm90b2NvbCBmb3JtYXQ6IFwidG9rZW4tand0X3Rva2VuX2hlcmVcIlxuICAgICAgY29uc3QgdG9rZW5Qcm90b2NvbCA9IHByb3RvY29sc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5maW5kKChwKSA9PiBwLnRyaW0oKS5zdGFydHNXaXRoKFwidG9rZW4tXCIpKTtcbiAgICAgIGlmICghdG9rZW5Qcm90b2NvbCkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBbXywgdG9rZW5dID0gdG9rZW5Qcm90b2NvbC5zcGxpdChcIi1cIik7XG4gICAgICByZXR1cm4gdG9rZW47XG4gICAgfVxuXG4gICAgLy8gV2ViU29ja2V0IFN1YnByb3RvY29sIEF1dGhlbnRpY2F0aW9uIG5vdCBmb3VuZC4gRmFsbCBiYWNrIHRvIHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKHJlcXVlc3QudXJsISwgYGh0dHA6Ly8ke3JlcXVlc3QuaGVhZGVycy5ob3N0fWApO1xuICAgIGNvbnN0IHF1ZXJ5VG9rZW4gPSB1cmwuc2VhcmNoUGFyYW1zLmdldChcInRva2VuXCIpO1xuICAgIGlmIChxdWVyeVRva2VuKSByZXR1cm4gcXVlcnlUb2tlbjtcblxuICAgIC8vIENoZWNrIGF1dGhvcml6YXRpb24gaGVhZGVyXG4gICAgY29uc3QgYXV0aEhlYWRlciA9IHJlcXVlc3QuaGVhZGVyc1tcImF1dGhvcml6YXRpb25cIl07XG4gICAgaWYgKGF1dGhIZWFkZXI/LnN0YXJ0c1dpdGgoXCJCZWFyZXIgXCIpKSB7XG4gICAgICByZXR1cm4gYXV0aEhlYWRlci5zdWJzdHJpbmcoNyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBhc3luYyBoYW5kbGVBdXRoZW50aWNhdGlvbkZhaWx1cmUoXG4gICAgcmVxdWVzdDogdW5rbm93bixcbiAgICBlcnJvcjogc3RyaW5nXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRocm93IG5ldyBBdXRoZW50aWNhdGlvbkVycm9yKFxuICAgICAgQXV0aGVudGljYXRpb25FcnJvclR5cGUuSU5WQUxJRF9DUkVERU5USUFMUyxcbiAgICAgIGVycm9yLFxuICAgICAgeyByZXF1ZXN0IH1cbiAgICApO1xuICB9XG59XG4iXX0=