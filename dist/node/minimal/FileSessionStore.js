"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileSessionStore = void 0;
const FileStore_1 = require("./FileStore");
const utils_1 = require("src/utils");
class FileSessionStore {
    constructor(dataDir = "./.session-data", cleanupIntervalMs = 60000) {
        this.sessions = new Map();
        this.store = new FileStore_1.FileStore(dataDir);
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, cleanupIntervalMs);
    }
    async initialize() {
        await this.store.initialize();
        // Load sessions from file
        const sessionData = await this.store.read("sessions");
        if (sessionData) {
            sessionData.sessions.forEach(([id, data]) => {
                this.sessions.set(id, {
                    ...data,
                    createdAt: new Date(data.createdAt),
                    expiresAt: new Date(data.expiresAt),
                    lastAccessedAt: new Date(data.lastAccessedAt),
                });
            });
        }
    }
    async persistSessions() {
        await this.store.write("sessions", {
            sessions: Array.from(this.sessions.entries()).map(([id, data]) => [
                id,
                {
                    ...data,
                    createdAt: data.createdAt.toISOString(),
                    expiresAt: data.expiresAt.toISOString(),
                    lastAccessedAt: data.lastAccessedAt.toISOString(),
                },
            ]),
        });
    }
    async create(sessionData) {
        const sessionId = sessionData.sessionId || utils_1.CryptoUtil.generateToken();
        this.sessions.set(sessionId, {
            ...sessionData,
            sessionId,
        });
        await this.persistSessions();
        return sessionId;
    }
    async get(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
        if (new Date() > session.expiresAt) {
            await this.delete(sessionId);
            return null;
        }
        return session;
    }
    async update(sessionId, sessionData) {
        const existingSession = await this.get(sessionId);
        if (!existingSession)
            return false;
        this.sessions.set(sessionId, {
            ...existingSession,
            ...sessionData,
            lastAccessedAt: new Date(),
        });
        await this.persistSessions();
        return true;
    }
    async delete(sessionId) {
        const deleted = this.sessions.delete(sessionId);
        if (deleted) {
            await this.persistSessions();
        }
        return deleted;
    }
    async cleanup() {
        const now = new Date();
        let changed = false;
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expiresAt < now) {
                this.sessions.delete(sessionId);
                changed = true;
            }
        }
        if (changed) {
            await this.persistSessions();
        }
    }
    destroy() {
        clearInterval(this.cleanupInterval);
    }
}
exports.FileSessionStore = FileSessionStore;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRmlsZVNlc3Npb25TdG9yZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9taW5pbWFsL0ZpbGVTZXNzaW9uU3RvcmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMkNBQXdDO0FBRXhDLHFDQUF1QztBQUV2QyxNQUFhLGdCQUFnQjtJQUszQixZQUNFLFVBQWtCLGlCQUFpQixFQUNuQyxvQkFBNEIsS0FBSztRQUwzQixhQUFRLEdBQThCLElBQUksR0FBRyxFQUFFLENBQUM7UUFPdEQsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLHFCQUFTLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDcEMsSUFBSSxDQUFDLGVBQWUsR0FBRyxXQUFXLENBQUMsR0FBRyxFQUFFO1lBQ3RDLElBQUksQ0FBQyxPQUFPLEVBQUUsQ0FBQztRQUNqQixDQUFDLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztJQUN4QixDQUFDO0lBRUQsS0FBSyxDQUFDLFVBQVU7UUFDZCxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsVUFBVSxFQUFFLENBQUM7UUFFOUIsMEJBQTBCO1FBQzFCLE1BQU0sV0FBVyxHQUFHLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBRXRDLFVBQVUsQ0FBQyxDQUFDO1FBRWYsSUFBSSxXQUFXLEVBQUUsQ0FBQztZQUNoQixXQUFXLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxFQUFFLElBQUksQ0FBQyxFQUFFLEVBQUU7Z0JBQzFDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEVBQUUsRUFBRTtvQkFDcEIsR0FBRyxJQUFJO29CQUNQLFNBQVMsRUFBRSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDO29CQUNuQyxTQUFTLEVBQUUsSUFBSSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQztvQkFDbkMsY0FBYyxFQUFFLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxj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NUIsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQ2hDLE9BQU8sR0FBRyxJQUFJLENBQUM7WUFDakIsQ0FBQztRQUNILENBQUM7UUFFRCxJQUFJLE9BQU8sRUFBRSxDQUFDO1lBQ1osTUFBTSxJQUFJLENBQUMsZUFBZSxFQUFFLENBQUM7UUFDL0IsQ0FBQztJQUNILENBQUM7SUFFRCxPQUFPO1FBQ0wsYUFBYSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUN0QyxDQUFDO0NBQ0Y7QUFwSEQsNENBb0hDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgRmlsZVN0b3JlIH0gZnJvbSBcIi4vRmlsZVN0b3JlXCI7XG5pbXBvcnQgeyBJU2Vzc2lvbkRhdGEsIElTZXNzaW9uU3RvcmUgfSBmcm9tIFwic3JjL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IENyeXB0b1V0aWwgfSBmcm9tIFwic3JjL3V0aWxzXCI7XG5cbmV4cG9ydCBjbGFzcyBGaWxlU2Vzc2lvblN0b3JlIGltcGxlbWVudHMgSVNlc3Npb25TdG9yZSB7XG4gIHByaXZhdGUgc3RvcmU6IEZpbGVTdG9yZTtcbiAgcHJpdmF0ZSBzZXNzaW9uczogTWFwPHN0cmluZywgSVNlc3Npb25EYXRhPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSBjbGVhbnVwSW50ZXJ2YWw6IE5vZGVKUy5UaW1lb3V0O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIGRhdGFEaXI6IHN0cmluZyA9IFwiLi8uc2Vzc2lvbi1kYXRhXCIsXG4gICAgY2xlYW51cEludGVydmFsTXM6IG51bWJlciA9IDYwMDAwXG4gICkge1xuICAgIHRoaXMuc3RvcmUgPSBuZXcgRmlsZVN0b3JlKGRhdGFEaXIpO1xuICAgIHRoaXMuY2xlYW51cEludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgdGhpcy5jbGVhbnVwKCk7XG4gICAgfSwgY2xlYW51cEludGVydmFsTXMpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLmluaXRpYWxpemUoKTtcblxuICAgIC8vIExvYWQgc2Vzc2lvbnMgZnJvbSBmaWxlXG4gICAgY29uc3Qgc2Vzc2lvbkRhdGEgPSBhd2FpdCB0aGlzLnN0b3JlLnJlYWQ8e1xuICAgICAgc2Vzc2lvbnM6IEFycmF5PFtzdHJpbmcsIElTZXNzaW9uRGF0YV0+O1xuICAgIH0+KFwic2Vzc2lvbnNcIik7XG5cbiAgICBpZiAoc2Vzc2lvbkRhdGEpIHtcbiAgICAgIHNlc3Npb25EYXRhLnNlc3Npb25zLmZvckVhY2goKFtpZCwgZGF0YV0pID0+IHtcbiAgICAgICAgdGhpcy5zZXNzaW9ucy5zZXQoaWQsIHtcbiAgICAgICAgICAuLi5kYXRhLFxuICAgICAgICAgIGNyZWF0ZWRBdDogbmV3IERhdGUoZGF0YS5jcmVhdGVkQXQpLFxuICAgICAgICAgIGV4cGlyZXNBdDogbmV3IERhdGUoZGF0YS5leHBpcmVzQXQpLFxuICAgICAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZShkYXRhLmxhc3RBY2Nlc3NlZEF0KSxcbiAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBlcnNpc3RTZXNzaW9ucygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnN0b3JlLndyaXRlKFwic2Vzc2lvbnNcIiwge1xuICAgICAgc2Vzc2lvbnM6IEFycmF5LmZyb20odGhpcy5zZXNzaW9ucy5lbnRyaWVzKCkpLm1hcCgoW2lkLCBkYXRhXSkgPT4gW1xuICAgICAgICBpZCxcbiAgICAgICAge1xuICAgICAgICAgIC4uLmRhdGEsXG4gICAgICAgICAgY3JlYXRlZEF0OiBkYXRhLmNyZWF0ZWRBdC50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGV4cGlyZXNBdDogZGF0YS5leHBpcmVzQXQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBsYXN0QWNjZXNzZWRBdDogZGF0YS5sYXN0QWNjZXNzZWRBdC50b0lTT1N0cmluZygpLFxuICAgICAgICB9LFxuICAgICAgXSksXG4gICAgfSk7XG4gIH1cblxuICBhc3luYyBjcmVhdGUoc2Vzc2lvbkRhdGE6IElTZXNzaW9uRGF0YSk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgY29uc3Qgc2Vzc2lvbklkID0gc2Vzc2lvbkRhdGEuc2Vzc2lvbklkIHx8IENyeXB0b1V0aWwuZ2VuZXJhdGVUb2tlbigpO1xuICAgIHRoaXMuc2Vzc2lvbnMuc2V0KHNlc3Npb25JZCwge1xuICAgICAgLi4uc2Vzc2lvbkRhdGEsXG4gICAgICBzZXNzaW9uSWQsXG4gICAgfSk7XG5cbiAgICBhd2FpdCB0aGlzLnBlcnNpc3RTZXNzaW9ucygpO1xuICAgIHJldHVybiBzZXNzaW9uSWQ7XG4gIH1cblxuICBhc3luYyBnZXQoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPElTZXNzaW9uRGF0YSB8IG51bGw+IHtcbiAgICBjb25zdCBzZXNzaW9uID0gdGhpcy5zZXNzaW9ucy5nZXQoc2Vzc2lvbklkKTtcbiAgICBpZiAoIXNlc3Npb24pIHJldHVybiBudWxsO1xuXG4gICAgaWYgKG5ldyBEYXRlKCkgPiBzZXNzaW9uLmV4cGlyZXNBdCkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGUoc2Vzc2lvbklkKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiBzZXNzaW9uO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlKFxuICAgIHNlc3Npb25JZDogc3RyaW5nLFxuICAgIHNlc3Npb25EYXRhOiBQYXJ0aWFsPElTZXNzaW9uRGF0YT5cbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgZXhpc3RpbmdTZXNzaW9uID0gYXdhaXQgdGhpcy5nZXQoc2Vzc2lvbklkKTtcbiAgICBpZiAoIWV4aXN0aW5nU2Vzc2lvbikgcmV0dXJuIGZhbHNlO1xuXG4gICAgdGhpcy5zZXNzaW9ucy5zZXQoc2Vzc2lvbklkLCB7XG4gICAgICAuLi5leGlzdGluZ1Nlc3Npb24sXG4gICAgICAuLi5zZXNzaW9uRGF0YSxcbiAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLFxuICAgIH0pO1xuXG4gICAgYXdhaXQgdGhpcy5wZXJzaXN0U2Vzc2lvbnMoKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZShzZXNzaW9uSWQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGRlbGV0ZWQgPSB0aGlzLnNlc3Npb25zLmRlbGV0ZShzZXNzaW9uSWQpO1xuICAgIGlmIChkZWxldGVkKSB7XG4gICAgICBhd2FpdCB0aGlzLnBlcnNpc3RTZXNzaW9ucygpO1xuICAgIH1cbiAgICByZXR1cm4gZGVsZXRlZDtcbiAgfVxuXG4gIGFzeW5jIGNsZWFudXAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBsZXQgY2hhbmdlZCA9IGZhbHNlO1xuXG4gICAgZm9yIChjb25zdCBbc2Vzc2lvbklkLCBzZXNzaW9uXSBvZiB0aGlzLnNlc3Npb25zLmVudHJpZXMoKSkge1xuICAgICAgaWYgKHNlc3Npb24uZXhwaXJlc0F0IDwgbm93KSB7XG4gICAgICAgIHRoaXMuc2Vzc2lvbnMuZGVsZXRlKHNlc3Npb25JZCk7XG4gICAgICAgIGNoYW5nZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjaGFuZ2VkKSB7XG4gICAgICBhd2FpdCB0aGlzLnBlcnNpc3RTZXNzaW9ucygpO1xuICAgIH1cbiAgfVxuXG4gIGRlc3Ryb3koKTogdm9pZCB7XG4gICAgY2xlYXJJbnRlcnZhbCh0aGlzLmNsZWFudXBJbnRlcnZhbCk7XG4gIH1cbn1cbiJdfQ==