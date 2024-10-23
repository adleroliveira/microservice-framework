import { ISessionStore, ISessionData } from "../interfaces";
export declare class InMemorySessionStore implements ISessionStore {
    private sessions;
    private cleanupInterval;
    constructor(cleanupIntervalMs?: number);
    create(sessionData: ISessionData): Promise<string>;
    get(sessionId: string): Promise<ISessionData | null>;
    update(sessionId: string, sessionData: Partial<ISessionData>): Promise<boolean>;
    delete(sessionId: string): Promise<boolean>;
    cleanup(): Promise<void>;
    destroy(): void;
}
