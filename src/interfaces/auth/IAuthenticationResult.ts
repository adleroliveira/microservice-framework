export interface IAuthenticationResult {
  success: boolean;
  userId?: string;
  username?: string;
  sessionId?: string;
  token?: string;
  refreshToken?: string;
  expiresAt?: Date;
  error?: string;
  metadata?: Record<string, unknown>;
}
