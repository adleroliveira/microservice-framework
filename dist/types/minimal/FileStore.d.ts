export declare class FileStore {
    private dataDir;
    private writeQueue;
    constructor(dataDir: string);
    initialize(): Promise<void>;
    private getFilePath;
    read<T>(filename: string): Promise<T | null>;
    write<T>(filename: string, data: T): Promise<void>;
}
