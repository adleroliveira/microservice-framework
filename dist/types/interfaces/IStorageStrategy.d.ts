export interface IStorageStrategy {
    get(key: string): Promise<any | null>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
    update(key: string, field: string, value: any): Promise<void>;
    append(key: string, value: any): Promise<void>;
    getAll(pattern: string): Promise<Map<string, any>>;
    exists(key: string): Promise<boolean>;
    addToSortedSet(key: string, score: number, member: string): Promise<void>;
    removeFromSortedSet(key: string, member: string): Promise<void>;
    getRangeFromSortedSet(key: string, start: number, stop: number): Promise<string[]>;
    getRangeWithScoresFromSortedSet(key: string, start: number, stop: number): Promise<Array<{
        member: string;
        score: number;
    }>>;
    addToList(key: string, value: any): Promise<void>;
    getListItems(key: string, start: number, stop: number): Promise<any[]>;
    removeFromList(key: string, value: any): Promise<void>;
}
