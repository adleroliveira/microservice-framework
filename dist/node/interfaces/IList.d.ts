export interface IList<T = any> {
    append(key: string, value: T): Promise<void>;
    getItems(key: string, start: number, stop: number): Promise<T[]>;
    removeItem(key: string, value: T): Promise<void>;
    length(key: string): Promise<number>;
    getAllKeys(): Promise<string[]>;
}
