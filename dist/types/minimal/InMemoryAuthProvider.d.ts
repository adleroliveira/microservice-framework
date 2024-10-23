import { IAuthenticationProvider, IAuthenticationResult } from "../interfaces";
export declare class InMemoryAuthProvider implements IAuthenticationProvider {
    private users;
    private tokens;
    addUser(username: string, password: string): Promise<string>;
    authenticate(credentials: {
        username: string;
        password: string;
    }): Promise<IAuthenticationResult>;
    validateToken(token: string): Promise<IAuthenticationResult>;
    refreshToken(refreshToken: string): Promise<IAuthenticationResult>;
}
