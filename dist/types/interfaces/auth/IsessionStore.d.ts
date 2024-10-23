import { ISessionData } from "./ISessionData";
export interface ISessionStore {
    create(sessionData: ISessionData): Promise<string>;
    get(sessionId: string): Promise<ISessionData | null>;
    update(sessionId: string, sessionData: Partial<ISessionData>): Promise<boolean>;
    delete(sessionId: string): Promise<boolean>;
    cleanup(): Promise<void>;
}
