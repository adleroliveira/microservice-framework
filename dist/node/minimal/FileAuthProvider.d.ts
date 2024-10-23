import { IAuthenticationProvider, IAuthenticationResult } from "../interfaces";
import { Loggable } from "../logging";
export declare class FileAuthProvider extends Loggable implements IAuthenticationProvider {
    private store;
    private users;
    private tokens;
    private cleanupInterval;
    constructor(dataDir?: string, cleanupIntervalMs?: number);
    initialize(): Promise<void>;
    private performInitialCleanup;
    private loadUsers;
    private loadTokens;
    private persistUsers;
    private persistTokens;
    addUser(username: string, password: string, metadata?: Record<string, any>): Promise<IAuthenticationResult>;
    authenticate(credentials: {
        username: string;
        password: string;
    }): Promise<IAuthenticationResult>;
    validateToken(token: string): Promise<IAuthenticationResult>;
    refreshToken(refreshToken: string): Promise<IAuthenticationResult>;
    private cleanupUserTokens;
    private cleanupExpiredTokens;
    destroy(): void;
}
