"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthenticationHelper = exports.AuthenticationError = exports.AuthenticationErrorType = exports.AuthenticationMiddleware = void 0;
const logging_1 = require("../logging");
class AuthenticationMiddleware extends logging_1.Loggable {
    constructor(authProvider, sessionStore) {
        super();
        this.authProvider = authProvider;
        this.sessionStore = sessionStore;
    }
}
exports.AuthenticationMiddleware = AuthenticationMiddleware;
var AuthenticationErrorType;
(function (AuthenticationErrorType) {
    AuthenticationErrorType["INVALID_CREDENTIALS"] = "INVALID_CREDENTIALS";
    AuthenticationErrorType["EXPIRED_TOKEN"] = "EXPIRED_TOKEN";
    AuthenticationErrorType["INVALID_TOKEN"] = "INVALID_TOKEN";
    AuthenticationErrorType["SESSION_EXPIRED"] = "SESSION_EXPIRED";
    AuthenticationErrorType["INSUFFICIENT_PERMISSIONS"] = "INSUFFICIENT_PERMISSIONS";
    AuthenticationErrorType["AUTHENTICATION_REQUIRED"] = "AUTHENTICATION_REQUIRED";
})(AuthenticationErrorType || (exports.AuthenticationErrorType = AuthenticationErrorType = {}));
class AuthenticationError extends logging_1.LoggableError {
    constructor(type, message, metadata) {
        super(message);
        this.type = type;
        this.metadata = metadata;
        this.name = "AuthenticationError";
    }
}
exports.AuthenticationError = AuthenticationError;
class AuthenticationHelper {
    static isAuthenticationRequired(response) {
        return response.body.authenticationRequired === true;
    }
    static isSessionExpired(response) {
        return response.body.sessionExpired === true;
    }
    static getAuthenticationError(response) {
        return response.body.authenticationError;
    }
    static hasValidSession(request) {
        return !!(request.header.sessionId && request.header.authToken);
    }
    static createAuthenticationResponse(request, error) {
        return {
            requestHeader: request.header,
            responseHeader: {
                responderAddress: "auth-service",
                timestamp: Date.now(),
            },
            body: {
                data: null,
                success: false,
                error,
                authenticationRequired: true,
                authenticationError: error.message,
                sessionExpired: error.type === AuthenticationErrorType.SESSION_EXPIRED,
            },
        };
    }
    static addAuthToRequest(request, authToken, sessionId, metadata) {
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
exports.AuthenticationHelper = AuthenticationHelper;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQXV0aGVudGljYXRpb25NaWRkbGV3YXJlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2NvcmUvQXV0aGVudGljYXRpb25NaWRkbGV3YXJlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQU9BLHdDQUFxRDtBQUVyRCxNQUFzQix3QkFBeUIsU0FBUSxrQkFBUTtJQUM3RCxZQUNZLFlBQXFDLEVBQ3JDLFlBQTJCO1FBRXJDLEtBQUssRUFBRSxDQUFDO1FBSEUsaUJBQVksR0FBWixZQUFZLENBQXlCO1FBQ3JDLGlCQUFZLEdBQVosWUFBWSxDQUFlO0lBR3ZDLENBQUM7Q0FRRjtBQWRELDREQWNDO0FBRUQsSUFBWSx1QkFPWDtBQVBELFdBQVksdUJBQXVCO0lBQ2pDLHNFQUEyQyxDQUFBO0lBQzNDLDBEQUErQixDQUFBO0lBQy9CLDBEQUErQixDQUFBO0lBQy9CLDhEQUFtQyxDQUFBO0lBQ25DLGdGQUFxRCxDQUFBO0lBQ3JELDhFQUFtRCxDQUFBO0FBQ3JELENBQUMsRUFQVyx1QkFBdUIsdUNBQXZCLHVCQUF1QixRQU9sQztBQUVELE1BQWEsbUJBQW9CLFNBQVEsdUJBQWE7SUFDcEQsWUFDUyxJQUE2QixFQUNwQyxPQUFlLEVBQ1IsUUFBa0M7UUFFekMsS0FBSyxDQUFDLE9BQU8sQ0FBQyxDQUFDO1FBSlIsU0FBSSxHQUFKLElBQUksQ0FBeUI7UUFFN0IsYUFBUSxHQUFSLFFBQVEsQ0FBMEI7UUFHekMsSUFBSSxDQUFDLElBQUksR0FBRyxxQkFBcUIsQ0FBQztJQUNwQyxDQUFDO0NBQ0Y7QUFURCxrREFTQztBQUVELE1BQWEsb0JBQW9CO0lBQy9CLE1BQU0sQ0FBQyx3QkFBd0IsQ0FBQyxRQUE0QjtRQUMxRCxPQUFPLFFBQVEsQ0FBQyxJQUFJLENBQUMsc0JBQXNCLEtBQUssSUFBSSxDQUFDO0lBQ3ZELENBQUM7SUFFRCxNQUFNLENBQUMsZ0JBQWdCLENBQUMsUUFBNEI7UUFDbEQsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLGNBQWMsS0FBSyxJQUFJLENBQUM7SUFDL0MsQ0FBQztJQUVELE1BQU0sQ0FBQyxzQkFBc0IsQ0FDM0IsUUFBNEI7UUFFNUIsT0FBTyxRQUFRLENBQUMsSUFBSSxDQUFDLG1CQUFtQixDQUFDO0lBQzNDLENBQUM7SUFFRCxNQUFNLENBQUMsZUFBZSxDQUFDLE9BQTBCO1FBQy9DLE9BQU8sQ0FBQyxDQUFDLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLElBQUksT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNsRSxDQUFDO0lBRUQsTUFBTSxDQUFDLDRCQUE0QixDQUNqQyxPQUEwQixFQUMxQixLQUEwQjtRQUUxQixPQUFPO1lBQ0wsYUFBYSxFQUFFLE9BQU8sQ0FBQyxNQUFNO1lBQzdCLGNBQWMsRUFBRTtnQkFDZCxnQkFBZ0IsRUFBRSxjQUFjO2dCQUNoQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTthQUN0QjtZQUNELElBQUksRUFBRTtnQkFDSixJQUFJLEVBQUUsSUFBUztnQkFDZixPQUFPLEVBQUUsS0FBSztnQkFDZCxLQUFLO2dCQUNMLHNCQUFzQixFQUFFLElBQUk7Z0JBQzVCLG1CQUFtQixFQUFFLEtBQUssQ0FBQyxPQUFPO2dCQUNsQyxjQUFjLEVBQUUsS0FBSyxDQUFDLElBQUksS0FBSyx1QkFBdUIsQ0FBQyxlQUFlO2FBQ3ZFO1NBQ0YsQ0FBQztJQUNKLENBQUM7SUFFRCxNQUFNLENBQUMsZ0JBQWdCLENBQ3JCLE9BQW9CLEVBQ3BCLFNBQWlCLEVBQ2pCLFNBQWlCLEVBQ2pCLFFBQWtDO1FBRWxDLE9BQU87WUFDTCxHQUFHLE9BQU87WUFDVixNQUFNLEVBQUU7Z0JBQ04sR0FBRyxPQUFPLENBQUMsTUFBTTtnQkFDakIsU0FBUztnQkFDVCxTQUFTO2dCQUNULFlBQVksRUFBRSxRQUFRO2FBQ3ZCO1NBQ0YsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQXhERCxvREF3REMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbiAgSVNlc3Npb25TdG9yZSxcbiAgSVJlcXVlc3QsXG4gIElSZXNwb25zZSxcbiAgSUF1dGhlbnRpY2F0aW9uTWV0YWRhdGEsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBMb2dnYWJsZUVycm9yLCBMb2dnYWJsZSB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBBdXRoZW50aWNhdGlvbk1pZGRsZXdhcmUgZXh0ZW5kcyBMb2dnYWJsZSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByb3RlY3RlZCBhdXRoUHJvdmlkZXI6IElBdXRoZW50aWNhdGlvblByb3ZpZGVyLFxuICAgIHByb3RlY3RlZCBzZXNzaW9uU3RvcmU6IElTZXNzaW9uU3RvcmVcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGFic3RyYWN0IGV4dHJhY3RDcmVkZW50aWFscyhyZXF1ZXN0OiB1bmtub3duKTogUHJvbWlzZTx1bmtub3duPjtcbiAgYWJzdHJhY3QgZXh0cmFjdFRva2VuKHJlcXVlc3Q6IHVua25vd24pOiBQcm9taXNlPHN0cmluZyB8IG51bGw+O1xuICBhYnN0cmFjdCBoYW5kbGVBdXRoZW50aWNhdGlvbkZhaWx1cmUoXG4gICAgcmVxdWVzdDogdW5rbm93bixcbiAgICBlcnJvcjogc3RyaW5nXG4gICk6IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBlbnVtIEF1dGhlbnRpY2F0aW9uRXJyb3JUeXBlIHtcbiAgSU5WQUxJRF9DUkVERU5USUFMUyA9IFwiSU5WQUxJRF9DUkVERU5USUFMU1wiLFxuICBFWFBJUkVEX1RPS0VOID0gXCJFWFBJUkVEX1RPS0VOXCIsXG4gIElOVkFMSURfVE9LRU4gPSBcIklOVkFMSURfVE9LRU5cIixcbiAgU0VTU0lPTl9FWFBJUkVEID0gXCJTRVNTSU9OX0VYUElSRURcIixcbiAgSU5TVUZGSUNJRU5UX1BFUk1JU1NJT05TID0gXCJJTlNVRkZJQ0lFTlRfUEVSTUlTU0lPTlNcIixcbiAgQVVUSEVOVElDQVRJT05fUkVRVUlSRUQgPSBcIkFVVEhFTlRJQ0FUSU9OX1JFUVVJUkVEXCIsXG59XG5cbmV4cG9ydCBjbGFzcyBBdXRoZW50aWNhdGlvbkVycm9yIGV4dGVuZHMgTG9nZ2FibGVFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyB0eXBlOiBBdXRoZW50aWNhdGlvbkVycm9yVHlwZSxcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcHVibGljIG1ldGFkYXRhPzogUmVjb3JkPHN0cmluZywgdW5rbm93bj5cbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gXCJBdXRoZW50aWNhdGlvbkVycm9yXCI7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIEF1dGhlbnRpY2F0aW9uSGVscGVyIHtcbiAgc3RhdGljIGlzQXV0aGVudGljYXRpb25SZXF1aXJlZChyZXNwb25zZTogSVJlc3BvbnNlPHVua25vd24+KTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHJlc3BvbnNlLmJvZHkuYXV0aGVudGljYXRpb25SZXF1aXJlZCA9PT0gdHJ1ZTtcbiAgfVxuXG4gIHN0YXRpYyBpc1Nlc3Npb25FeHBpcmVkKHJlc3BvbnNlOiBJUmVzcG9uc2U8dW5rbm93bj4pOiBib29sZWFuIHtcbiAgICByZXR1cm4gcmVzcG9uc2UuYm9keS5zZXNzaW9uRXhwaXJlZCA9PT0gdHJ1ZTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRBdXRoZW50aWNhdGlvbkVycm9yKFxuICAgIHJlc3BvbnNlOiBJUmVzcG9uc2U8dW5rbm93bj5cbiAgKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gcmVzcG9uc2UuYm9keS5hdXRoZW50aWNhdGlvbkVycm9yO1xuICB9XG5cbiAgc3RhdGljIGhhc1ZhbGlkU2Vzc2lvbihyZXF1ZXN0OiBJUmVxdWVzdDx1bmtub3duPik6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIShyZXF1ZXN0LmhlYWRlci5zZXNzaW9uSWQgJiYgcmVxdWVzdC5oZWFkZXIuYXV0aFRva2VuKTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVBdXRoZW50aWNhdGlvblJlc3BvbnNlPFQ+KFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PHVua25vd24+LFxuICAgIGVycm9yOiBBdXRoZW50aWNhdGlvbkVycm9yXG4gICk6IElSZXNwb25zZTxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgcmVzcG9uZGVyQWRkcmVzczogXCJhdXRoLXNlcnZpY2VcIixcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZGF0YTogbnVsbCBhcyBULFxuICAgICAgICBzdWNjZXNzOiBmYWxzZSxcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIGF1dGhlbnRpY2F0aW9uUmVxdWlyZWQ6IHRydWUsXG4gICAgICAgIGF1dGhlbnRpY2F0aW9uRXJyb3I6IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIHNlc3Npb25FeHBpcmVkOiBlcnJvci50eXBlID09PSBBdXRoZW50aWNhdGlvbkVycm9yVHlwZS5TRVNTSU9OX0VYUElSRUQsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBzdGF0aWMgYWRkQXV0aFRvUmVxdWVzdDxUPihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUPixcbiAgICBhdXRoVG9rZW46IHN0cmluZyxcbiAgICBzZXNzaW9uSWQ6IHN0cmluZyxcbiAgICBtZXRhZGF0YT86IElBdXRoZW50aWNhdGlvbk1ldGFkYXRhXG4gICk6IElSZXF1ZXN0PFQ+IHtcbiAgICByZXR1cm4ge1xuICAgICAgLi4ucmVxdWVzdCxcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICAuLi5yZXF1ZXN0LmhlYWRlcixcbiAgICAgICAgYXV0aFRva2VuLFxuICAgICAgICBzZXNzaW9uSWQsXG4gICAgICAgIGF1dGhNZXRhZGF0YTogbWV0YWRhdGEsXG4gICAgICB9LFxuICAgIH07XG4gIH1cbn1cbiJdfQ==