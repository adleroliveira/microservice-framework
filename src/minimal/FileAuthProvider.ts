import {
  IAuthenticationProvider,
  InMemoryUser,
  IAuthenticationResult,
} from "../interfaces";
import { FileStore } from "./FileStore";
import { CryptoUtil } from "src/utils";

export class FileAuthProvider implements IAuthenticationProvider {
  private store: FileStore;
  private users: Map<string, InMemoryUser> = new Map();
  private tokens: Map<
    string,
    {
      userId: string;
      expiresAt: Date;
      refreshToken?: string;
    }
  > = new Map();

  constructor(dataDir: string = "./.auth-data") {
    this.store = new FileStore(dataDir);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();

    // Load users from file
    const userData = await this.store.read<{
      users: InMemoryUser[];
    }>("users");

    if (userData) {
      userData.users.forEach((user) => {
        this.users.set(user.username, user);
      });
    }

    // Load tokens from file
    const tokenData = await this.store.read<{
      tokens: Array<
        [
          string,
          {
            userId: string;
            expiresAt: string;
            refreshToken?: string;
          }
        ]
      >;
    }>("tokens");

    if (tokenData) {
      tokenData.tokens.forEach(([token, data]) => {
        this.tokens.set(token, {
          ...data,
          expiresAt: new Date(data.expiresAt),
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
        },
      ]),
    });
  }

  async addUser(username: string, password: string): Promise<string> {
    const userId = CryptoUtil.generateToken().slice(0, 8);
    const passwordHash = await CryptoUtil.hashPassword(password);

    this.users.set(username, {
      userId,
      username,
      passwordHash,
    });

    await this.persistUsers();
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

    const token = CryptoUtil.generateToken();
    const refreshToken = CryptoUtil.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    this.tokens.set(token, {
      userId: user.userId,
      expiresAt,
      refreshToken,
    });

    await this.persistTokens();

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
      await this.persistTokens();
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
    const tokenEntry = Array.from(this.tokens.entries()).find(
      ([_, data]) => data.refreshToken === refreshToken
    );

    if (!tokenEntry) {
      return { success: false, error: "Invalid refresh token" };
    }

    const newToken = CryptoUtil.generateToken();
    const newRefreshToken = CryptoUtil.generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    this.tokens.delete(tokenEntry[0]);
    this.tokens.set(newToken, {
      userId: tokenEntry[1].userId,
      expiresAt,
      refreshToken: newRefreshToken,
    });

    await this.persistTokens();

    return {
      success: true,
      userId: tokenEntry[1].userId,
      token: newToken,
      refreshToken: newRefreshToken,
      expiresAt,
    };
  }
}
