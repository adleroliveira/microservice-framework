import { FileStore } from "./FileStore";
import { ISessionData, ISessionStore } from "../interfaces";
import { CryptoUtil } from "../utils";

export class FileSessionStore implements ISessionStore {
  private store: FileStore;
  private sessions: Map<string, ISessionData> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(
    dataDir: string = "./.session-data",
    cleanupIntervalMs: number = 60000
  ) {
    this.store = new FileStore(dataDir);
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, cleanupIntervalMs);
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
    await this.loadSessions();
    await this.performInitialCleanup();
  }

  private async loadSessions() {
    // Load sessions from file
    const sessionData = await this.store.read<{
      sessions: Array<[string, ISessionData]>;
    }>("sessions");

    if (sessionData) {
      sessionData.sessions.forEach(([id, data]) => {
        this.sessions.set(id, {
          ...data,
          createdAt: new Date(data.createdAt),
          expiresAt: new Date(data.expiresAt),
          lastAccessedAt: new Date(data.lastAccessedAt),
        });
      });
    }
  }

  private async performInitialCleanup(): Promise<void> {
    const now = new Date();
    let changed = false;
  
    // Clean up expired sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    }
  
    // Clean up sessions that haven't been accessed in a long time (e.g., 30 days)
    const unusedThreshold = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastAccessedAt < unusedThreshold) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    }
  
    if (changed) {
      await this.persistSessions();
    }
  }

  private async persistSessions(): Promise<void> {
    await this.store.write("sessions", {
      sessions: Array.from(this.sessions.entries()).map(([id, data]) => [
        id,
        {
          ...data,
          createdAt: data.createdAt.toISOString(),
          expiresAt: data.expiresAt.toISOString(),
          lastAccessedAt: data.lastAccessedAt.toISOString(),
        },
      ]),
    });
  }

  async create(sessionData: ISessionData): Promise<string> {
    const sessionId = sessionData.sessionId || CryptoUtil.generateToken();
    this.sessions.set(sessionId, {
      ...sessionData,
      sessionId,
    });

    await this.persistSessions();
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

    await this.persistSessions();
    return true;
  }

  async delete(sessionId: string): Promise<boolean> {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      await this.persistSessions();
    }
    return deleted;
  }

  async cleanup(): Promise<void> {
    const now = new Date();
    let changed = false;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt < now) {
        this.sessions.delete(sessionId);
        changed = true;
      }
    }

    if (changed) {
      await this.persistSessions();
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
  }
}
