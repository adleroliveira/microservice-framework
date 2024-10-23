import { IAuthenticationResult } from "./IAuthenticationResult";

export interface IAuthenticationProvider {
  authenticate(credentials: unknown): Promise<IAuthenticationResult>;
  validateToken(token: string): Promise<IAuthenticationResult>;
  refreshToken(token: string): Promise<IAuthenticationResult>;
}
