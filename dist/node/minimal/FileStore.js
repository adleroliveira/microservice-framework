"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileStore = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
// File-based storage manager
class FileStore {
    constructor(dataDir) {
        this.writeQueue = new Map();
        this.dataDir = dataDir;
    }
    async initialize() {
        try {
            await fs_1.promises.mkdir(this.dataDir, { recursive: true });
        }
        catch (error) {
            throw new Error(`Failed to create data directory: ${error.message}`);
        }
    }
    getFilePath(filename) {
        return (0, path_1.join)(this.dataDir, `${filename}.json`);
    }
    async read(filename) {
        try {
            const filePath = this.getFilePath(filename);
            const data = await fs_1.promises.readFile(filePath, "utf8");
            return JSON.parse(data);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return null;
            throw new Error(`Failed to read file ${filename}: ${error.message}`);
        }
    }
    async write(filename, data) {
        const filePath = this.getFilePath(filename);
        // Queue writes to prevent concurrent file access
        const writeOperation = async () => {
            try {
                const jsonData = JSON.stringify(data, null, 2);
                await fs_1.promises.writeFile(filePath, jsonData, "utf8");
            }
            catch (error) {
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
exports.FileStore = FileStore;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRmlsZVN0b3JlLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL21pbmltYWwvRmlsZVN0b3JlLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDJCQUFvQztBQUNwQywrQkFBNEI7QUFFNUIsNkJBQTZCO0FBQzdCLE1BQWEsU0FBUztJQUlwQixZQUFZLE9BQWU7UUFGbkIsZUFBVSxHQUErQixJQUFJLEdBQUcsRUFBRSxDQUFDO1FBR3pELElBQUksQ0FBQyxPQUFPLEdBQUcsT0FBTyxDQUFDO0lBQ3pCLENBQUM7SUFFRCxLQUFLLENBQUMsVUFBVTtRQUNkLElBQUksQ0FBQztZQUNILE1BQU0sYUFBRSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxDQUFDLENBQUM7UUFDcEQsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsTUFBTSxJQUFJLEtBQUssQ0FBQyxvQ0FBb0MsS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7UUFDdkUsQ0FBQztJQUNILENBQUM7SUFFTyxXQUFXLENBQUMsUUFBZ0I7UUFDbEMsT0FBTyxJQUFBLFdBQUksRUFBQyxJQUFJLENBQUMsT0FBTyxFQUFFLEdBQUcsUUFBUSxPQUFPLENBQUMsQ0FBQztJQUNoRCxDQUFDO0lBRUQsS0FBSyxDQUFDLElBQUksQ0FBSSxRQUFnQjtRQUM1QixJQUFJLENBQUM7WUFDSCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQzVDLE1BQU0sSUFBSSxHQUFHLE1BQU0sYUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLEVBQUUsTUFBTSxDQUFDLENBQUM7WUFDakQsT0FBTyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBTSxDQUFDO1FBQy9CLENBQUM7UUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO1lBQ3BCLElBQUksS0FBSyxDQUFDLElBQUksS0FBSyxRQUFRO2dCQUFFLE9BQU8sSUFBSSxDQUFDO1lBQ3pDLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLFFBQVEsS0FBSyxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUMsQ0FBQztRQUN2RSxDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxLQUFLLENBQUksUUFBZ0IsRUFBRSxJQUFPO1FBQ3RDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUM7UUFFNUMsaURBQWlEO1FBQ2pELE1BQU0sY0FBYyxHQUFHLEtBQUssSUFBSSxFQUFFO1lBQ2hDLElBQUksQ0FBQztnQkFDSCxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFDLENBQUM7Z0JBQy9DLE1BQU0sYUFBRSxDQUFDLFNBQVMsQ0FBQyxRQUFRLEVBQUUsUUFBUSxFQUFFLE1BQU0sQ0FBQyxDQUFDO1lBQ2pELENBQUM7WUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO2dCQUNwQixNQUFNLElBQUksS0FBSyxDQUFDLHdCQUF3QixRQUFRLEtBQUssS0FBSyxDQUFDLE9BQU8sRUFBRSxDQUFDLENBQUM7WUFDeEUsQ0FBQztRQUNILENBQUMsQ0FBQztRQUVGLHVDQUF1QztRQUN2QyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDeEUsTUFBTSxTQUFTLEdBQUcsWUFBWSxDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztRQUNwRCxJQUFJLENBQUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUUsU0FBUyxDQUFDLENBQUM7UUFDekMsTUFBTSxTQUFTLENBQUM7SUFDbEIsQ0FBQztDQUNGO0FBbERELDhCQWtEQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IHByb21pc2VzIGFzIGZzIH0gZnJvbSBcImZzXCI7XG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcblxuLy8gRmlsZS1iYXNlZCBzdG9yYWdlIG1hbmFnZXJcbmV4cG9ydCBjbGFzcyBGaWxlU3RvcmUge1xuICBwcml2YXRlIGRhdGFEaXI6IHN0cmluZztcbiAgcHJpdmF0ZSB3cml0ZVF1ZXVlOiBNYXA8c3RyaW5nLCBQcm9taXNlPHZvaWQ+PiA9IG5ldyBNYXAoKTtcblxuICBjb25zdHJ1Y3RvcihkYXRhRGlyOiBzdHJpbmcpIHtcbiAgICB0aGlzLmRhdGFEaXIgPSBkYXRhRGlyO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgZnMubWtkaXIodGhpcy5kYXRhRGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byBjcmVhdGUgZGF0YSBkaXJlY3Rvcnk6ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGdldEZpbGVQYXRoKGZpbGVuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIHJldHVybiBqb2luKHRoaXMuZGF0YURpciwgYCR7ZmlsZW5hbWV9Lmpzb25gKTtcbiAgfVxuXG4gIGFzeW5jIHJlYWQ8VD4oZmlsZW5hbWU6IHN0cmluZyk6IFByb21pc2U8VCB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLmdldEZpbGVQYXRoKGZpbGVuYW1lKTtcbiAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCwgXCJ1dGY4XCIpO1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UoZGF0YSkgYXMgVDtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICBpZiAoZXJyb3IuY29kZSA9PT0gXCJFTk9FTlRcIikgcmV0dXJuIG51bGw7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYEZhaWxlZCB0byByZWFkIGZpbGUgJHtmaWxlbmFtZX06ICR7ZXJyb3IubWVzc2FnZX1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyB3cml0ZTxUPihmaWxlbmFtZTogc3RyaW5nLCBkYXRhOiBUKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZmlsZVBhdGggPSB0aGlzLmdldEZpbGVQYXRoKGZpbGVuYW1lKTtcblxuICAgIC8vIFF1ZXVlIHdyaXRlcyB0byBwcmV2ZW50IGNvbmN1cnJlbnQgZmlsZSBhY2Nlc3NcbiAgICBjb25zdCB3cml0ZU9wZXJhdGlvbiA9IGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGpzb25EYXRhID0gSlNPTi5zdHJpbmdpZnkoZGF0YSwgbnVsbCwgMik7XG4gICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlUGF0aCwganNvbkRhdGEsIFwidXRmOFwiKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWlsZWQgdG8gd3JpdGUgZmlsZSAke2ZpbGVuYW1lfTogJHtlcnJvci5tZXNzYWdlfWApO1xuICAgICAgfVxuICAgIH07XG5cbiAgICAvLyBBZGQgdG8gcXVldWUgYW5kIHdhaXQgZm9yIGNvbXBsZXRpb25cbiAgICBjb25zdCBjdXJyZW50V3JpdGUgPSB0aGlzLndyaXRlUXVldWUuZ2V0KGZpbGVuYW1lKSB8fCBQcm9taXNlLnJlc29sdmUoKTtcbiAgICBjb25zdCBuZXh0V3JpdGUgPSBjdXJyZW50V3JpdGUudGhlbih3cml0ZU9wZXJhdGlvbik7XG4gICAgdGhpcy53cml0ZVF1ZXVlLnNldChmaWxlbmFtZSwgbmV4dFdyaXRlKTtcbiAgICBhd2FpdCBuZXh0V3JpdGU7XG4gIH1cbn1cbiJdfQ==