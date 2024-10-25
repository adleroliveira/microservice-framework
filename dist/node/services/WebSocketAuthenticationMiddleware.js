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
                if (!result.success) {
                    throw new AuthenticationMiddleware_1.AuthenticationError(AuthenticationMiddleware_1.AuthenticationErrorType.INVALID_TOKEN, `Token authentication failed: ${result.error}`);
                }
                await this.attachSessionToConnection(connection, result);
                return result;
            }
            this.warn("Token authentication failed (No token provided), falling back to credentials");
            // Fall back to credentials if no token or token invalid
            const credentials = await this.extractCredentials(request);
            const result = await this.authProvider.authenticate(credentials);
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
            password: decodeURIComponent(atob(paddedCredentials)),
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
            const token = tokenProtocol.trim().substring(6);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrRUFJMEM7QUFJMUMsd0NBQTJDO0FBTzNDLE1BQWEsaUNBQWtDLFNBQVEsbURBQXdCO0lBQzdFLEtBQUssQ0FBQyxzQkFBc0IsQ0FDMUIsT0FBd0IsRUFDeEIsVUFBK0I7UUFFL0IsSUFBSSxDQUFDO1lBQ0gsaUNBQWlDO1lBQ2pDLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMvQyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUNWLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzVELElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQ3BCLE1BQU0sSUFBSSw4Q0FBbUIsQ0FDM0Isa0RBQXVCLENBQUMsYUFBYSxFQUNyQyxnQ0FBZ0MsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUMvQyxDQUFDO2dCQUNKLENBQUM7Z0JBQ0QsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUN6RCxPQUFPLE1BQU0sQ0FBQztZQUNoQixDQUFDO1lBRUQsSUFBSSxDQUFDLElBQUksQ0FDUCw4RUFBOEUsQ0FDL0UsQ0FBQztZQUVGLHdEQUF3RDtZQUN4RCxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMzRCxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBRWpFLElBQUksTUFB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QUNMLEVBQUUsT0FBTyxFQUFFLENBQ1osQ0FBQztJQUNKLENBQUM7Q0FDRjtBQTVIRCw4RUE0SEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBBdXRoZW50aWNhdGlvbkVycm9yLFxuICBBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUsXG4gIEF1dGhlbnRpY2F0aW9uRXJyb3JUeXBlLFxufSBmcm9tIFwiLi4vY29yZS9BdXRoZW50aWNhdGlvbk1pZGRsZXdhcmVcIjtcbmltcG9ydCB7IElBdXRoZW50aWNhdGlvblJlc3VsdCwgSVNlc3Npb25EYXRhIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IFdlYnNvY2tldENvbm5lY3Rpb24gfSBmcm9tIFwiLi9XZWJzb2NrZXRDb25uZWN0aW9uXCI7XG5pbXBvcnQgeyBJbmNvbWluZ01lc3NhZ2UgfSBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHsgTG9nZ2FibGVFcnJvciB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5cbmludGVyZmFjZSBDcmVkZW50aWFscyB7XG4gIHVzZXJuYW1lOiBzdHJpbmc7XG4gIHBhc3N3b3JkOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgZXh0ZW5kcyBBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUge1xuICBhc3luYyBhdXRoZW50aWNhdGVDb25uZWN0aW9uKFxuICAgIHJlcXVlc3Q6IEluY29taW5nTWVzc2FnZSxcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uXG4gICk6IFByb21pc2U8SUF1dGhlbnRpY2F0aW9uUmVzdWx0PiB7XG4gICAgdHJ5IHtcbiAgICAgIC8vIFRyeSB0b2tlbiBhdXRoZW50aWNhdGlvbiBmaXJzdFxuICAgICAgY29uc3QgdG9rZW4gPSBhd2FpdCB0aGlzLmV4dHJhY3RUb2tlbihyZXF1ZXN0KTtcbiAgICAgIGlmICh0b2tlbikge1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmF1dGhQcm92aWRlci52YWxpZGF0ZVRva2VuKHRva2VuKTtcbiAgICAgICAgaWYgKCFyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICAgIHRocm93IG5ldyBBdXRoZW50aWNhdGlvbkVycm9yKFxuICAgICAgICAgICAgQXV0aGVudGljYXRpb25FcnJvclR5cGUuSU5WQUxJRF9UT0tFTixcbiAgICAgICAgICAgIGBUb2tlbiBhdXRoZW50aWNhdGlvbiBmYWlsZWQ6ICR7cmVzdWx0LmVycm9yfWBcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIGF3YWl0IHRoaXMuYXR0YWNoU2Vzc2lvblRvQ29ubmVjdGlvbihjb25uZWN0aW9uLCByZXN1bHQpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfVxuXG4gICAgICB0aGlzLndhcm4oXG4gICAgICAgIFwiVG9rZW4gYXV0aGVudGljYXRpb24gZmFpbGVkIChObyB0b2tlbiBwcm92aWRlZCksIGZhbGxpbmcgYmFjayB0byBjcmVkZW50aWFsc1wiXG4gICAgICApO1xuXG4gICAgICAvLyBGYWxsIGJhY2sgdG8gY3JlZGVudGlhbHMgaWYgbm8gdG9rZW4gb3IgdG9rZW4gaW52YWxpZFxuICAgICAgY29uc3QgY3JlZGVudGlhbHMgPSBhd2FpdCB0aGlzLmV4dHJhY3RDcmVkZW50aWFscyhyZXF1ZXN0KTtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXV0aFByb3ZpZGVyLmF1dGhlbnRpY2F0ZShjcmVkZW50aWFscyk7XG5cbiAgICAgIGlmIChyZXN1bHQuc3VjY2Vzcykge1xuICAgICAgICBhd2FpdCB0aGlzLmF0dGFjaFNlc3Npb25Ub0Nvbm5lY3Rpb24oY29ubmVjdGlvbiwgcmVzdWx0KTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH1cblxuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVBdXRoZW50aWNhdGlvbkZhaWx1cmUocmVxdWVzdCwgXCJBdXRoZW50aWNhdGlvbiBmYWlsZWRcIik7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IFwiQXV0aGVudGljYXRpb24gZmFpbGVkXCIgfTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUF1dGhlbnRpY2F0aW9uRmFpbHVyZShyZXF1ZXN0LCBlcnJvci5tZXNzYWdlKTtcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogZXJyb3IubWVzc2FnZSB9O1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXR0YWNoU2Vzc2lvblRvQ29ubmVjdGlvbihcbiAgICBjb25uZWN0aW9uOiBXZWJzb2NrZXRDb25uZWN0aW9uLFxuICAgIGF1dGhSZXN1bHQ6IElBdXRoZW50aWNhdGlvblJlc3VsdFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzZXNzaW9uRGF0YTogSVNlc3Npb25EYXRhID0ge1xuICAgICAgc2Vzc2lvbklkOiBhdXRoUmVzdWx0LnNlc3Npb25JZCB8fCBjcnlwdG8ucmFuZG9tVVVJRCgpLFxuICAgICAgdXNlcklkOiBhdXRoUmVzdWx0LnVzZXJJZCEsXG4gICAgICBjcmVhdGVkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBleHBpcmVzQXQ6XG4gICAgICAgIGF1dGhSZXN1bHQuZXhwaXJlc0F0IHx8IG5ldyBEYXRlKERhdGUubm93KCkgKyAyNCAqIDYwICogNjAgKiAxMDAwKSxcbiAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLFxuICAgICAgbWV0YWRhdGE6IGF1dGhSZXN1bHQubWV0YWRhdGEgfHwge30sXG4gICAgfTtcblxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvblN0b3JlLmNyZWF0ZShzZXNzaW9uRGF0YSk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInNlc3Npb25JZFwiLCBzZXNzaW9uRGF0YS5zZXNzaW9uSWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0TWV0YWRhdGEoXCJ1c2VySWRcIiwgc2Vzc2lvbkRhdGEudXNlcklkKTtcbiAgICBjb25uZWN0aW9uLnNldEF1dGhlbnRpY2F0ZWQodHJ1ZSk7XG4gIH1cblxuICBhc3luYyBleHRyYWN0Q3JlZGVudGlhbHMocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlKTogUHJvbWlzZTxDcmVkZW50aWFscz4ge1xuICAgIC8vIEV4dHJhY3QgYXV0aCBkYXRhIGZyb20gdGhlIFNlYy1XZWJTb2NrZXQtUHJvdG9jb2wgaGVhZGVyXG4gICAgY29uc3QgcHJvdG9jb2xzID0gcmVxdWVzdC5oZWFkZXJzW1wic2VjLXdlYnNvY2tldC1wcm90b2NvbFwiXTtcbiAgICBpZiAoIXByb3RvY29scylcbiAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKFwiTm8gYXV0aGVudGljYXRpb24gcHJvdG9jb2wgcHJvdmlkZWRcIik7XG5cbiAgICAvLyBQcm90b2NvbCBmb3JtYXQ6IFwiYXV0aC11c2VybmFtZS1iYXNlNjRjcmVkZW50aWFsc1wiXG4gICAgY29uc3QgYXV0aFByb3RvY29sID0gcHJvdG9jb2xzXG4gICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAuZmluZCgocCkgPT4gcC50cmltKCkuc3RhcnRzV2l0aChcImF1dGgtXCIpKTtcbiAgICBpZiAoIWF1dGhQcm90b2NvbCkgdGhyb3cgbmV3IExvZ2dhYmxlRXJyb3IoXCJBdXRoIHByb3RvY29sIG5vdCBmb3VuZFwiKTtcblxuICAgIGNvbnN0IFtfLCB1c2VybmFtZSwgY3JlZGVudGlhbHNdID0gYXV0aFByb3RvY29sLnNwbGl0KFwiLVwiKTtcblxuICAgIGxldCBwYWRkZWRDcmVkZW50aWFscyA9IGNyZWRlbnRpYWxzO1xuXG4gICAgd2hpbGUgKHBhZGRlZENyZWRlbnRpYWxzLmxlbmd0aCAlIDQpIHtcbiAgICAgIHBhZGRlZENyZWRlbnRpYWxzICs9IFwiPVwiO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICB1c2VybmFtZSxcbiAgICAgIHBhc3N3b3JkOiBkZWNvZGVVUklDb21wb25lbnQoYXRvYihwYWRkZWRDcmVkZW50aWFscykpLFxuICAgIH07XG4gIH1cblxuICBhc3luYyBleHRyYWN0VG9rZW4ocmVxdWVzdDogSW5jb21pbmdNZXNzYWdlKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgY29uc3QgcHJvdG9jb2xzID0gcmVxdWVzdC5oZWFkZXJzW1wic2VjLXdlYnNvY2tldC1wcm90b2NvbFwiXTtcbiAgICAvLyBDaGVjayBpZiB0b2tlbiBoYXMgYmVlbiBzZW50IHVzaW5nOiBXZWJTb2NrZXQgU3VicHJvdG9jb2wgQXV0aGVudGljYXRpb25cbiAgICBpZiAocHJvdG9jb2xzKSB7XG4gICAgICAvLyBQcm90b2NvbCBmb3JtYXQ6IFwidG9rZW4tand0X3Rva2VuX2hlcmVcIlxuICAgICAgY29uc3QgdG9rZW5Qcm90b2NvbCA9IHByb3RvY29sc1xuICAgICAgICAuc3BsaXQoXCIsXCIpXG4gICAgICAgIC5maW5kKChwKSA9PiBwLnRyaW0oKS5zdGFydHNXaXRoKFwidG9rZW4tXCIpKTtcbiAgICAgIGlmICghdG9rZW5Qcm90b2NvbCkgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCB0b2tlbiA9IHRva2VuUHJvdG9jb2wudHJpbSgpLnN1YnN0cmluZyg2KTtcbiAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbiAgICAvLyBXZWJTb2NrZXQgU3VicHJvdG9jb2wgQXV0aGVudGljYXRpb24gbm90IGZvdW5kLiBGYWxsIGJhY2sgdG8gcXVlcnkgcGFyYW1ldGVyc1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG4gICAgY29uc3QgcXVlcnlUb2tlbiA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidG9rZW5cIik7XG4gICAgaWYgKHF1ZXJ5VG9rZW4pIHJldHVybiBxdWVyeVRva2VuO1xuXG4gICAgLy8gQ2hlY2sgYXV0aG9yaXphdGlvbiBoZWFkZXJcbiAgICBjb25zdCBhdXRoSGVhZGVyID0gcmVxdWVzdC5oZWFkZXJzW1wiYXV0aG9yaXphdGlvblwiXTtcbiAgICBpZiAoYXV0aEhlYWRlcj8uc3RhcnRzV2l0aChcIkJlYXJlciBcIikpIHtcbiAgICAgIHJldHVybiBhdXRoSGVhZGVyLnN1YnN0cmluZyg3KTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIGhhbmRsZUF1dGhlbnRpY2F0aW9uRmFpbHVyZShcbiAgICByZXF1ZXN0OiB1bmtub3duLFxuICAgIGVycm9yOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhyb3cgbmV3IEF1dGhlbnRpY2F0aW9uRXJyb3IoXG4gICAgICBBdXRoZW50aWNhdGlvbkVycm9yVHlwZS5JTlZBTElEX0NSRURFTlRJQUxTLFxuICAgICAgZXJyb3IsXG4gICAgICB7IHJlcXVlc3QgfVxuICAgICk7XG4gIH1cbn1cbiJdfQ==