export interface ISessionData {
    sessionId: string;
    userId: string;
    createdAt: Date;
    expiresAt: Date;
    lastAccessedAt: Date;
    metadata: Record<string, unknown>;
}
