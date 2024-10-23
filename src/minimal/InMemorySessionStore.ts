import { CryptoUtil } from "../utils";
import { ISessionStore, ISessionData } from "../interfaces";

export class InMemorySessionStore implements ISessionStore {
  private sessions: Map<string, ISessionData> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(cleanupIntervalMs: number = 60000) {
    // Default 1 minute cleanup
    // Periodically clean expired sessions
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async create(sessionData: ISessionData): Promise<string> {
    const sessionId = sessionData.sessionId || CryptoUtil.generateToken();
    this.sessions.set(sessionId, {
      ...sessionData,
      sessionId,
    });
    return sessionId;
  }

  async get(sessionId: string): Promise<ISessionData | null> {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (new Date() > session.expiresAt) {
      await this.delete(sessionId);
      return null;
    }

    return session;
  }

  async update(
    sessionId: string,
    sessionData: Partial<ISessionData>
  ): Promise<boolean> {
    const existingSession = await this.get(sessionId);
    if (!existingSession) return false;

    this.sessions.set(sessionId, {
      ...existingSession,
      ...sessionData,
      lastAccessedAt: new Date(),
    });

    return true;
  }

  async delete(sessionId: string): Promise<boolean> {
    return this.sessions.delete(sessionId);
  }

  async cleanup(): Promise<void> {
    const now = new Date();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  // Clean up interval when no longer needed
  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
