import { promises as fs } from "fs";
import { join } from "path";

// File-based storage manager
export class FileStore {
  private dataDir: string;
  private writeQueue: Map<string, Promise<void>> = new Map();

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (error: any) {
      throw new Error(`Failed to create data directory: ${error.message}`);
    }
  }

  private getFilePath(filename: string): string {
    return join(this.dataDir, `${filename}.json`);
  }

  async read<T>(filename: string): Promise<T | null> {
    try {
      const filePath = this.getFilePath(filename);
      const data = await fs.readFile(filePath, "utf8");
      return JSON.parse(data) as T;
    } catch (error: any) {
      if (error.code === "ENOENT") return null;
      throw new Error(`Failed to read file ${filename}: ${error.message}`);
    }
  }

  async write<T>(filename: string, data: T): Promise<void> {
    const filePath = this.getFilePath(filename);

    // Queue writes to prevent concurrent file access
    const writeOperation = async () => {
      try {
        const jsonData = JSON.stringify(data, null, 2);
        await fs.writeFile(filePath, jsonData, "utf8");
      } catch (error: any) {
        throw new Error(`Failed to write file ${filename}: ${error.message}`);
      }
    };

    // Add to queue and wait for completion
    const currentWrite = this.writeQueue.get(filename) || Promise.resolve();
    const nextWrite = currentWrite.then(writeOperation);
    this.writeQueue.set(filename, nextWrite);
    await nextWrite;
  }
}
