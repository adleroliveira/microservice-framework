import { ISessionData, ISessionStore } from "../interfaces";
export declare class FileSessionStore implements ISessionStore {
    private store;
    private sessions;
    private cleanupInterval;
    constructor(dataDir?: string, cleanupIntervalMs?: number);
    initialize(): Promise<void>;
    private loadSessions;
    private performInitialCleanup;
    private persistSessions;
    create(sessionData: ISessionData): Promise<string>;
    get(sessionId: string): Promise<ISessionData | null>;
    update(sessionId: string, sessionData: Partial<ISessionData>): Promise<boolean>;
    delete(sessionId: string): Promise<boolean>;
    cleanup(): Promise<void>;
    destroy(): void;
}
