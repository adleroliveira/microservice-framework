import { IAuthenticationProvider, IAuthenticationResult } from "../interfaces";
export declare class FileAuthProvider implements IAuthenticationProvider {
    private store;
    private users;
    private tokens;
    constructor(dataDir?: string);
    initialize(): Promise<void>;
    private persistUsers;
    private persistTokens;
    addUser(username: string, password: string): Promise<string>;
    authenticate(credentials: {
        username: string;
        password: string;
    }): Promise<IAuthenticationResult>;
    validateToken(token: string): Promise<IAuthenticationResult>;
    refreshToken(refreshToken: string): Promise<IAuthenticationResult>;
}
