import {
  IAuthenticationProvider,
  InMemoryUser,
  IAuthenticationResult,
} from "../interfaces";
import { FileStore } from "./FileStore";
import { CryptoUtil } from "../utils";
import { Loggable } from "../logging";

interface TokenData {
  userId: string;
  expiresAt: Date;
  refreshToken?: string;
  lastUsed: Date;
}

export class FileAuthProvider extends Loggable implements IAuthenticationProvider {
  private store: FileStore;
  private users: Map<string, InMemoryUser> = new Map();
  private tokens: Map<string, TokenData> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    dataDir: string = "./.auth-data",
    cleanupIntervalMs: number = 60000 * 15 // 15 minutes
  ) {
    super();
    this.store = new FileStore(dataDir);
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, cleanupIntervalMs);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.loadUsers();
    await this.loadTokens();

    await this.performInitialCleanup();
  }

  private async performInitialCleanup(): Promise<void> {
    const now = new Date();
    let tokensChanged = false;
    let usersChanged = false;

    // Step 1: Clean up expired and unused tokens
    for (const [token, data] of this.tokens.entries()) {
      const unusedThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      if (data.expiresAt < now || data.lastUsed < unusedThreshold) {
        this.tokens.delete(token);
        tokensChanged = true;
      }
    }

    // Step 2: Clean up tokens with non-existent users (orphaned tokens)
    const validUserIds = new Set(Array.from(this.users.values()).map(u => u.userId));
    for (const [token, data] of this.tokens.entries()) {
      if (!validUserIds.has(data.userId)) {
        this.tokens.delete(token);
        tokensChanged = true;
      }
    }

    // Step 3: Clean up duplicate user tokens (keep only the most recent)
    const userTokens = new Map<string, { token: string; lastUsed: Date }>();
    for (const [token, data] of this.tokens.entries()) {
      const existing = userTokens.get(data.userId);
      if (!existing || existing.lastUsed < data.lastUsed) {
        if (existing) {
          this.tokens.delete(existing.token);
          tokensChanged = true;
        }
        userTokens.set(data.userId, { token, lastUsed: data.lastUsed });
      } else {
        this.tokens.delete(token);
        tokensChanged = true;
      }
    }

    // Persist changes if needed
    if (tokensChanged) {
      await this.persistTokens();
    }
    if (usersChanged) {
      await this.persistUsers();
    }

    this.info(`Initial cleanup completed. Tokens cleaned: ${tokensChanged}`);
  }

  private async loadUsers(): Promise<void> {
    const userData = await this.store.read<{
      users: InMemoryUser[];
    }>("users");

    if (userData) {
      userData.users.forEach((user) => {
        this.users.set(user.username.toLowerCase(), user);
      });
    }
  }

  private async loadTokens(): Promise<void> {
    const tokenData = await this.store.read<{
      tokens: Array<[string, TokenData & { expiresAt: string; lastUsed: string }]>;
    }>("tokens");

    if (tokenData) {
      tokenData.tokens.forEach(([token, data]) => {
        this.tokens.set(token, {
          ...data,
          expiresAt: new Date(data.expiresAt),
          lastUsed: new Date(data.lastUsed),
        });
      });
    }
  }

  private async persistUsers(): Promise<void> {
    await this.store.write("users", {
      users: Array.from(this.users.values()),
    });
  }

  private async persistTokens(): Promise<void> {
    await this.store.write("tokens", {
      tokens: Array.from(this.tokens.entries()).map(([token, data]) => [
        token,
        {
          ...data,
          expiresAt: data.expiresAt.toISOString(),
          lastUsed: data.lastUsed.toISOString(),
        },
      ]),
    });
  }

  async addUser(
    username: string,
    password: string,
    metadata?: Record<string, any>
  ): Promise<IAuthenticationResult> {
    if (!username || !password) {
      return { success: false, error: "Username and password are required" };
    }

    const normalizedUsername = username.toLowerCase();
    if (this.users.has(normalizedUsername)) {
      return { success: false, error: "Username already exists" };
    }

    if (password.length < 6) {
      return { success: false, error: "Password must be at least 6 characters" };
    }

    const userId = CryptoUtil.generateToken().slice(0, 8);
    const passwordHash = await CryptoUtil.hashPassword(password);

    const newUser: InMemoryUser = {
      userId,
      username: normalizedUsername,
      passwordHash,
      metadata,
      createdAt: new Date(),
    };

    this.users.set(normalizedUsername, newUser);
    await this.persistUsers();

    // Automatically authenticate the new user
    return this.authenticate({ username, password });
  }

  async authenticate(credentials: {
    username: string;
    password: string;
  }): Promise<IAuthenticationResult> {
    if (!credentials.username || !credentials.password) {
      return { success: false, error: "Username and password are required" };
    }

    const normalizedUsername = credentials.username.toLowerCase();
    const user = this.users.get(normalizedUsername);
    
    if (!user) {
      return { success: false, error: "Invalid credentials" };
    }

    const passwordHash = await CryptoUtil.hashPassword(credentials.password);
    if (passwordHash !== user.passwordHash) {
      return { success: false, error: "Invalid credentials" };
    }

    // Cleanup old tokens for this user
    await this.cleanupUserTokens(user.userId);

    const token = CryptoUtil.generateToken();
    const refreshToken = CryptoUtil.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    this.tokens.set(token, {
      userId: user.userId,
      expiresAt,
      refreshToken,
      lastUsed: new Date(),
    });

    await this.persistTokens();

    return {
      success: true,
      userId: user.userId,
      username: user.username,
      token,
      refreshToken,
      expiresAt,
      metadata: user.metadata,
    };
  }

  async validateToken(token: string): Promise<IAuthenticationResult> {
    if (!token) {
      return { success: false, error: "Token is required" };
    }

    const tokenData = this.tokens.get(token);
    if (!tokenData) {
      return { success: false, error: "Invalid token" };
    }

    if (tokenData.expiresAt < new Date()) {
      this.tokens.delete(token);
      await this.persistTokens();
      return { success: false, error: "Token expired" };
    }

    // Update last used timestamp
    tokenData.lastUsed = new Date();
    await this.persistTokens();

    const user = Array.from(this.users.values()).find(
      (u) => u.userId === tokenData.userId
    );

    if (!user) {
      return { success: false, error: "User not found" };
    }

    return {
      success: true,
      userId: tokenData.userId,
      username: user.username,
      token,
      expiresAt: tokenData.expiresAt,
      metadata: user.metadata,
    };
  }

  async refreshToken(refreshToken: string): Promise<IAuthenticationResult> {
    if (!refreshToken) {
      return { success: false, error: "Refresh token is required" };
    }

    const tokenEntry = Array.from(this.tokens.entries()).find(
      ([_, data]) => data.refreshToken === refreshToken
    );

    if (!tokenEntry) {
      return { success: false, error: "Invalid refresh token" };
    }

    const user = Array.from(this.users.values()).find(
      (u) => u.userId === tokenEntry[1].userId
    );

    if (!user) {
      return { success: false, error: "User not found" };
    }

    const newToken = CryptoUtil.generateToken();
    const newRefreshToken = CryptoUtil.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // Remove old token
    this.tokens.delete(tokenEntry[0]);
    
    // Set new token
    this.tokens.set(newToken, {
      userId: tokenEntry[1].userId,
      expiresAt,
      refreshToken: newRefreshToken,
      lastUsed: new Date(),
    });

    await this.persistTokens();

    return {
      success: true,
      userId: tokenEntry[1].userId,
      username: user.username,
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt,
      metadata: user.metadata,
    };
  }

  private async cleanupUserTokens(userId: string): Promise<void> {
    let changed = false;
    for (const [token, data] of this.tokens.entries()) {
      if (data.userId === userId) {
        this.tokens.delete(token);
        changed = true;
      }
    }

    if (changed) {
      await this.persistTokens();
    }
  }

  private async cleanupExpiredTokens(): Promise<void> {
    const now = new Date();
    let changed = false;

    for (const [token, data] of this.tokens.entries()) {
      // Remove tokens that are expired or haven't been used in 7 days
      const unusedThreshold = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      if (data.expiresAt < now || data.lastUsed < unusedThreshold) {
        this.tokens.delete(token);
        changed = true;
      }
    }

    if (changed) {
      await this.persistTokens();
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}