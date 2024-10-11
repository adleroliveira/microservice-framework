export interface ISortedSet<T = any> {
    add(key: string, score: number, member: T): Promise<void>;
    remove(key: string, member: T): Promise<void>;
    getRange(key: string, start: number, stop: number): Promise<T[]>;
    getRangeWithScores(key: string, start: number, stop: number): Promise<Array<{
        member: T;
        score: number;
    }>>;
    getScore(key: string, member: T): Promise<number | null>;
    incrementScore(key: string, member: T, increment: number): Promise<number>;
    count(key: string): Promise<number>;
    getAllKeys(): Promise<string[]>;
}
