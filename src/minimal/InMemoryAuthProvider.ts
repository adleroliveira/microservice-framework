import { CryptoUtil } from "../utils";
import {
  IAuthenticationProvider,
  IAuthenticationResult,
  InMemoryUser,
} from "../interfaces";

export class InMemoryAuthProvider implements IAuthenticationProvider {
  private users: Map<string, InMemoryUser> = new Map();
  private tokens: Map<
    string,
    {
      userId: string;
      expiresAt: Date;
      refreshToken?: string;
    }
  > = new Map();

  // Method to add users (for setup/testing)
  async addUser(username: string, password: string): Promise<string> {
    const userId = CryptoUtil.generateToken().slice(0, 8);
    const passwordHash = await CryptoUtil.hashPassword(password);

    this.users.set(username, {
      userId,
      username,
      passwordHash,
    });

    return userId;
  }

  async authenticate(credentials: {
    username: string;
    password: string;
  }): Promise<IAuthenticationResult> {
    const user = this.users.get(credentials.username);
    if (!user) {
      return { success: false, error: "User not found" };
    }

    const passwordHash = await CryptoUtil.hashPassword(credentials.password);
  
    if (passwordHash !== user.passwordHash) {
      return { success: false, error: "Invalid password" };
    }

    // Generate tokens
    const token = CryptoUtil.generateToken();
    const refreshToken = CryptoUtil.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    this.tokens.set(token, {
      userId: user.userId,
      expiresAt,
      refreshToken,
    });

    return {
      success: true,
      userId: user.userId,
      token,
      refreshToken,
      expiresAt,
      metadata: user.metadata,
    };
  }

  async validateToken(token: string): Promise<IAuthenticationResult> {
    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      return { success: false, error: "Invalid token" };
    }

    if (tokenData.expiresAt < new Date()) {
      this.tokens.delete(token);
      return { success: false, error: "Token expired" };
    }

    return {
      success: true,
      userId: tokenData.userId,
      token,
      expiresAt: tokenData.expiresAt,
    };
  }

  async refreshToken(refreshToken: string): Promise<IAuthenticationResult> {
    // Find token entry by refresh token
    const tokenEntry = Array.from(this.tokens.entries()).find(
      ([_, data]) => data.refreshToken === refreshToken
    );

    if (!tokenEntry) {
      return { success: false, error: "Invalid refresh token" };
    }

    // Generate new tokens
    const newToken = CryptoUtil.generateToken();
    const newRefreshToken = CryptoUtil.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Remove old token
    this.tokens.delete(tokenEntry[0]);

    // Store new tokens
    this.tokens.set(newToken, {
      userId: tokenEntry[1].userId,
      expiresAt,
      refreshToken: newRefreshToken,
    });

    return {
      success: true,
      userId: tokenEntry[1].userId,
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt,
    };
  }
}
