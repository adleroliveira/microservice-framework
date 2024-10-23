export interface IAuthenticationMetadata {
  sessionId?: string;
  userId?: string;
  roles?: string[];
  permissions?: string[];
  scope?: string[];
  issuer?: string;
  expiresAt?: number;
  [key: string]: unknown;
}
