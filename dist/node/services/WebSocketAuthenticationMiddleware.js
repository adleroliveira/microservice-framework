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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU29ja2V0QXV0aGVudGljYXRpb25NaWRkbGV3YXJlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSwrRUFJMEM7QUFJMUMsd0NBQTJDO0FBTzNDLE1BQWEsaUNBQWtDLFNBQVEsbURBQXdCO0lBQzdFLEtBQUssQ0FBQyxzQkFBc0IsQ0FDMUIsT0FBd0IsRUFDeEIsVUFBK0I7UUFFL0IsSUFBSSxDQUFDO1lBQ0gsaUNBQWlDO1lBQ2pDLE1BQU0sS0FBSyxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMvQyxJQUFJLEtBQUssRUFBRSxDQUFDO2dCQUNWLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxhQUFhLENBQUMsS0FBSyxDQUFDLENBQUM7Z0JBQzVELElBQUksQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7b0JBQ3BCLE1BQU0sSUFBSSw4Q0FBbUIsQ0FDM0Isa0RBQXVCLENBQUMsYUFBYSxFQUNyQyxnQ0FBZ0MsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUMvQyxDQUFDO2dCQUNKLENBQUM7Z0JBQ0QsTUFBTSxJQUFJLENBQUMseUJBQXlCLENBQUMsVUFBVSxFQUFFLE1BQU0sQ0FBQyxDQUFDO2dCQUN6RCxPQUFPLE1BQU0sQ0FBQztZQUNoQixDQUFDO1lBRUQsSUFBSSxDQUFDLElBQUksQ0FDUCw4RUFBOEUsQ0FDL0UsQ0FBQztZQUVGLHdEQUF3RDtZQUN4RCxNQUFNLFdBQVcsR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxPQUFPLENBQUMsQ0FBQztZQUMzRCxNQUFNLE1BQU0sR0FBRyxNQUFNLElBQUksQ0FBQyxZQUFZLENBQUMsWUFBWSxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBRWpFLElBQUksTUFB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QUFLLEVBQ0wsRUFBRSxPQUFPLEVBQUUsQ0FDWixDQUFDO0lBQ0osQ0FBQztDQUNGO0FBNUhELDhFQTRIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIEF1dGhlbnRpY2F0aW9uRXJyb3IsXG4gIEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSxcbiAgQXV0aGVudGljYXRpb25FcnJvclR5cGUsXG59IGZyb20gXCIuLi9jb3JlL0F1dGhlbnRpY2F0aW9uTWlkZGxld2FyZVwiO1xuaW1wb3J0IHsgSUF1dGhlbnRpY2F0aW9uUmVzdWx0LCBJU2Vzc2lvbkRhdGEgfSBmcm9tIFwiLi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHsgV2Vic29ja2V0Q29ubmVjdGlvbiB9IGZyb20gXCIuL1dlYnNvY2tldENvbm5lY3Rpb25cIjtcbmltcG9ydCB7IEluY29taW5nTWVzc2FnZSB9IGZyb20gXCJodHRwXCI7XG5pbXBvcnQgeyBMb2dnYWJsZUVycm9yIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcblxuaW50ZXJmYWNlIENyZWRlbnRpYWxzIHtcbiAgdXNlcm5hbWU6IHN0cmluZztcbiAgcGFzc3dvcmQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSBleHRlbmRzIEF1dGhlbnRpY2F0aW9uTWlkZGxld2FyZSB7XG4gIGFzeW5jIGF1dGhlbnRpY2F0ZUNvbm5lY3Rpb24oXG4gICAgcmVxdWVzdDogSW5jb21pbmdNZXNzYWdlLFxuICAgIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb25cbiAgKTogUHJvbWlzZTxJQXV0aGVudGljYXRpb25SZXN1bHQ+IHtcbiAgICB0cnkge1xuICAgICAgLy8gVHJ5IHRva2VuIGF1dGhlbnRpY2F0aW9uIGZpcnN0XG4gICAgICBjb25zdCB0b2tlbiA9IGF3YWl0IHRoaXMuZXh0cmFjdFRva2VuKHJlcXVlc3QpO1xuICAgICAgaWYgKHRva2VuKSB7XG4gICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuYXV0aFByb3ZpZGVyLnZhbGlkYXRlVG9rZW4odG9rZW4pO1xuICAgICAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEF1dGhlbnRpY2F0aW9uRXJyb3IoXG4gICAgICAgICAgICBBdXRoZW50aWNhdGlvbkVycm9yVHlwZS5JTlZBTElEX1RPS0VOLFxuICAgICAgICAgICAgYFRva2VuIGF1dGhlbnRpY2F0aW9uIGZhaWxlZDogJHtyZXN1bHQuZXJyb3J9YFxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgYXdhaXQgdGhpcy5hdHRhY2hTZXNzaW9uVG9Db25uZWN0aW9uKGNvbm5lY3Rpb24sIHJlc3VsdCk7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9XG5cbiAgICAgIHRoaXMud2FybihcbiAgICAgICAgXCJUb2tlbiBhdXRoZW50aWNhdGlvbiBmYWlsZWQgKE5vIHRva2VuIHByb3ZpZGVkKSwgZmFsbGluZyBiYWNrIHRvIGNyZWRlbnRpYWxzXCJcbiAgICAgICk7XG5cbiAgICAgIC8vIEZhbGwgYmFjayB0byBjcmVkZW50aWFscyBpZiBubyB0b2tlbiBvciB0b2tlbiBpbnZhbGlkXG4gICAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IHRoaXMuZXh0cmFjdENyZWRlbnRpYWxzKHJlcXVlc3QpO1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5hdXRoUHJvdmlkZXIuYXV0aGVudGljYXRlKGNyZWRlbnRpYWxzKTtcblxuICAgICAgaWYgKHJlc3VsdC5zdWNjZXNzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXR0YWNoU2Vzc2lvblRvQ29ubmVjdGlvbihjb25uZWN0aW9uLCByZXN1bHQpO1xuICAgICAgICByZXR1cm4gcmVzdWx0O1xuICAgICAgfVxuXG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUF1dGhlbnRpY2F0aW9uRmFpbHVyZShyZXF1ZXN0LCBcIkF1dGhlbnRpY2F0aW9uIGZhaWxlZFwiKTtcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogXCJBdXRoZW50aWNhdGlvbiBmYWlsZWRcIiB9O1xuICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQXV0aGVudGljYXRpb25GYWlsdXJlKHJlcXVlc3QsIGVycm9yLm1lc3NhZ2UpO1xuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBlcnJvci5tZXNzYWdlIH07XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhdHRhY2hTZXNzaW9uVG9Db25uZWN0aW9uKFxuICAgIGNvbm5lY3Rpb246IFdlYnNvY2tldENvbm5lY3Rpb24sXG4gICAgYXV0aFJlc3VsdDogSUF1dGhlbnRpY2F0aW9uUmVzdWx0XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNlc3Npb25EYXRhOiBJU2Vzc2lvbkRhdGEgPSB7XG4gICAgICBzZXNzaW9uSWQ6IGF1dGhSZXN1bHQuc2Vzc2lvbklkIHx8IGNyeXB0by5yYW5kb21VVUlEKCksXG4gICAgICB1c2VySWQ6IGF1dGhSZXN1bHQudXNlcklkISxcbiAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoKSxcbiAgICAgIGV4cGlyZXNBdDpcbiAgICAgICAgYXV0aFJlc3VsdC5leHBpcmVzQXQgfHwgbmV3IERhdGUoRGF0ZS5ub3coKSArIDI0ICogNjAgKiA2MCAqIDEwMDApLFxuICAgICAgbGFzdEFjY2Vzc2VkQXQ6IG5ldyBEYXRlKCksXG4gICAgICBtZXRhZGF0YTogYXV0aFJlc3VsdC5tZXRhZGF0YSB8fCB7fSxcbiAgICB9O1xuXG4gICAgYXdhaXQgdGhpcy5zZXNzaW9uU3RvcmUuY3JlYXRlKHNlc3Npb25EYXRhKTtcbiAgICBjb25uZWN0aW9uLnNldE1ldGFkYXRhKFwic2Vzc2lvbklkXCIsIHNlc3Npb25EYXRhLnNlc3Npb25JZCk7XG4gICAgY29ubmVjdGlvbi5zZXRNZXRhZGF0YShcInVzZXJJZFwiLCBzZXNzaW9uRGF0YS51c2VySWQpO1xuICAgIGNvbm5lY3Rpb24uc2V0QXV0aGVudGljYXRlZCh0cnVlKTtcbiAgfVxuXG4gIGFzeW5jIGV4dHJhY3RDcmVkZW50aWFscyhyZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPENyZWRlbnRpYWxzPiB7XG4gICAgLy8gRXh0cmFjdCBhdXRoIGRhdGEgZnJvbSB0aGUgU2VjLVdlYlNvY2tldC1Qcm90b2NvbCBoZWFkZXJcbiAgICBjb25zdCBwcm90b2NvbHMgPSByZXF1ZXN0LmhlYWRlcnNbXCJzZWMtd2Vic29ja2V0LXByb3RvY29sXCJdO1xuICAgIGlmICghcHJvdG9jb2xzKVxuICAgICAgdGhyb3cgbmV3IExvZ2dhYmxlRXJyb3IoXCJObyBhdXRoZW50aWNhdGlvbiBwcm90b2NvbCBwcm92aWRlZFwiKTtcblxuICAgIC8vIFByb3RvY29sIGZvcm1hdDogXCJhdXRoLXVzZXJuYW1lLWJhc2U2NGNyZWRlbnRpYWxzXCJcbiAgICBjb25zdCBhdXRoUHJvdG9jb2wgPSBwcm90b2NvbHNcbiAgICAgIC5zcGxpdChcIixcIilcbiAgICAgIC5maW5kKChwKSA9PiBwLnRyaW0oKS5zdGFydHNXaXRoKFwiYXV0aC1cIikpO1xuICAgIGlmICghYXV0aFByb3RvY29sKSB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihcIkF1dGggcHJvdG9jb2wgbm90IGZvdW5kXCIpO1xuXG4gICAgY29uc3QgW18sIHVzZXJuYW1lLCBjcmVkZW50aWFsc10gPSBhdXRoUHJvdG9jb2wuc3BsaXQoXCItXCIpO1xuXG4gICAgbGV0IHBhZGRlZENyZWRlbnRpYWxzID0gY3JlZGVudGlhbHM7XG5cbiAgICB3aGlsZSAocGFkZGVkQ3JlZGVudGlhbHMubGVuZ3RoICUgNCkge1xuICAgICAgcGFkZGVkQ3JlZGVudGlhbHMgKz0gXCI9XCI7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIHVzZXJuYW1lLFxuICAgICAgcGFzc3dvcmQ6IGRlY29kZVVSSUNvbXBvbmVudChhdG9iKHBhZGRlZENyZWRlbnRpYWxzKSksXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIGV4dHJhY3RUb2tlbihyZXF1ZXN0OiBJbmNvbWluZ01lc3NhZ2UpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBjb25zdCBwcm90b2NvbHMgPSByZXF1ZXN0LmhlYWRlcnNbXCJzZWMtd2Vic29ja2V0LXByb3RvY29sXCJdO1xuICAgIC8vIENoZWNrIGlmIHRva2VuIGhhcyBiZWVuIHNlbnQgdXNpbmc6IFdlYlNvY2tldCBTdWJwcm90b2NvbCBBdXRoZW50aWNhdGlvblxuICAgIGlmIChwcm90b2NvbHMpIHtcbiAgICAgIC8vIFByb3RvY29sIGZvcm1hdDogXCJ0b2tlbi1qd3RfdG9rZW5faGVyZVwiXG4gICAgICBjb25zdCB0b2tlblByb3RvY29sID0gcHJvdG9jb2xzXG4gICAgICAgIC5zcGxpdChcIixcIilcbiAgICAgICAgLmZpbmQoKHApID0+IHAudHJpbSgpLnN0YXJ0c1dpdGgoXCJ0b2tlbi1cIikpO1xuICAgICAgaWYgKCF0b2tlblByb3RvY29sKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IFtfLCB0b2tlbl0gPSB0b2tlblByb3RvY29sLnNwbGl0KFwiLVwiKTtcbiAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbiAgICAvLyBXZWJTb2NrZXQgU3VicHJvdG9jb2wgQXV0aGVudGljYXRpb24gbm90IGZvdW5kLiBGYWxsIGJhY2sgdG8gcXVlcnkgcGFyYW1ldGVyc1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwocmVxdWVzdC51cmwhLCBgaHR0cDovLyR7cmVxdWVzdC5oZWFkZXJzLmhvc3R9YCk7XG4gICAgY29uc3QgcXVlcnlUb2tlbiA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KFwidG9rZW5cIik7XG4gICAgaWYgKHF1ZXJ5VG9rZW4pIHJldHVybiBxdWVyeVRva2VuO1xuXG4gICAgLy8gQ2hlY2sgYXV0aG9yaXphdGlvbiBoZWFkZXJcbiAgICBjb25zdCBhdXRoSGVhZGVyID0gcmVxdWVzdC5oZWFkZXJzW1wiYXV0aG9yaXphdGlvblwiXTtcbiAgICBpZiAoYXV0aEhlYWRlcj8uc3RhcnRzV2l0aChcIkJlYXJlciBcIikpIHtcbiAgICAgIHJldHVybiBhdXRoSGVhZGVyLnN1YnN0cmluZyg3KTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIGFzeW5jIGhhbmRsZUF1dGhlbnRpY2F0aW9uRmFpbHVyZShcbiAgICByZXF1ZXN0OiB1bmtub3duLFxuICAgIGVycm9yOiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhyb3cgbmV3IEF1dGhlbnRpY2F0aW9uRXJyb3IoXG4gICAgICBBdXRoZW50aWNhdGlvbkVycm9yVHlwZS5JTlZBTElEX0NSRURFTlRJQUxTLFxuICAgICAgZXJyb3IsXG4gICAgICB7IHJlcXVlc3QgfVxuICAgICk7XG4gIH1cbn1cbiJdfQ==