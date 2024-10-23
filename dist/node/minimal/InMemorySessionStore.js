"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemorySessionStore = void 0;
const utils_1 = require("../utils");
class InMemorySessionStore {
    constructor(cleanupIntervalMs = 60000) {
        this.sessions = new Map();
        // Default 1 minute cleanup
        // Periodically clean expired sessions
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, cleanupIntervalMs);
    }
    async create(sessionData) {
        const sessionId = sessionData.sessionId || utils_1.CryptoUtil.generateToken();
        this.sessions.set(sessionId, {
            ...sessionData,
            sessionId,
        });
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
        return true;
    }
    async delete(sessionId) {
        return this.sessions.delete(sessionId);
    }
    async cleanup() {
        const now = new Date();
        for (const [sessionId, session] of this.sessions.entries()) {
            if (session.expiresAt < now) {
                this.sessions.delete(sessionId);
            }
        }
    }
    // Clean up interval when no longer needed
    destroy() {
        clearInterval(this.cleanupInterval);
    }
}
exports.InMemorySessionStore = InMemorySessionStore;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSW5NZW1vcnlTZXNzaW9uU3RvcmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbWluaW1hbC9Jbk1lbW9yeVNlc3Npb25TdG9yZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxvQ0FBc0M7QUFHdEMsTUFBYSxvQkFBb0I7SUFJL0IsWUFBWSxvQkFBNEIsS0FBSztRQUhyQyxhQUFRLEdBQThCLElBQUksR0FBRyxFQUFFLENBQUM7UUFJdEQsMkJBQTJCO1FBQzNCLHNDQUFzQztRQUN0QyxJQUFJLENBQUMsZUFBZSxHQUFHLFdBQVcsQ0FBQyxHQUFHLEVBQUU7WUFDdEMsSUFBSSxDQUFDLE9BQU8sRUFBRSxDQUFDO1FBQ2pCLENBQUMsRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3hCLENBQUM7SUFFRCxLQUFLLENBQUMsTUFBTSxDQUFDLFdBQXlCO1FBQ3BDLE1BQU0sU0FBUyxHQUFHLFdBQVcsQ0FBQyxTQUFTLElBQUksa0JBQVUsQ0FBQyxhQUFhLEVBQUUsQ0FBQztRQUN0RSxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUU7WUFDM0IsR0FBRyxXQUFXO1lBQ2QsU0FBUztTQUNWLENBQUMsQ0FBQztRQUNILE9BQU8sU0FBUyxDQUFDO0lBQ25CLENBQUM7SUFFRCxLQUFLLENBQUMsR0FBRyxDQUFDLFNBQWlCO1FBQ3pCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQzdDLElBQUksQ0FBQyxPQUFPO1lBQUUsT0FBTyxJQUFJLENBQUM7UUFFMUIsSUFBSSxJQUFJLElBQUksRUFBRSxHQUFHLE9BQU8sQ0FBQyxTQUFTLEVBQUUsQ0FBQztZQUNuQyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDN0IsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBRUQsT0FBTyxPQUFPLENBQUM7SUFDakIsQ0FBQztJQUVELEtBQUssQ0FBQyxNQUFNLENBQ1YsU0FBaUIsRUFDakIsV0FBa0M7UUFFbEMsTUFBTSxlQUFlLEdBQUcsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ2xELElBQUksQ0FBQyxlQUFlO1lBQUUsT0FBTyxLQUFLLENBQUM7UUFFbkMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFO1lBQzNCLEdBQUcsZUFBZTtZQUNsQixHQUFHLFdBQVc7WUFDZCxjQUFjLEVBQUUsSUFBSSxJQUFJLEVBQUU7U0FDM0IsQ0FBQyxDQUFDO1FBRUgsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRUQsS0FBSyxDQUFDLE1BQU0sQ0FBQyxTQUFpQjtRQUM1QixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7SUFFRCxLQUFLLENBQUMsT0FBTztRQUNYLE1BQU0sR0FBRyxHQUFHLElBQUksSUFBSSxFQUFFLENBQUM7UUFDdkIsS0FBSyxNQUFNLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsT0FBTyxFQUFFLEVBQUUsQ0FBQztZQUMzRCxJQUFJLE9BQU8sQ0FBQyxTQUFTLEdBQUcsR0FBRyxFQUFFLENBQUM7Z0JBQzVCLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQ2xDLENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELDBDQUEwQztJQUMxQyxPQUFPO1FBQ0wsYUFBYSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUN0QyxDQUFDO0NBQ0Y7QUFsRUQsb0RBa0VDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ3J5cHRvVXRpbCB9IGZyb20gXCIuLi91dGlsc1wiO1xuaW1wb3J0IHsgSVNlc3Npb25TdG9yZSwgSVNlc3Npb25EYXRhIH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuZXhwb3J0IGNsYXNzIEluTWVtb3J5U2Vzc2lvblN0b3JlIGltcGxlbWVudHMgSVNlc3Npb25TdG9yZSB7XG4gIHByaXZhdGUgc2Vzc2lvbnM6IE1hcDxzdHJpbmcsIElTZXNzaW9uRGF0YT4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgY2xlYW51cEludGVydmFsOiBOb2RlSlMuVGltZW91dDtcblxuICBjb25zdHJ1Y3RvcihjbGVhbnVwSW50ZXJ2YWxNczogbnVtYmVyID0gNjAwMDApIHtcbiAgICAvLyBEZWZhdWx0IDEgbWludXRlIGNsZWFudXBcbiAgICAvLyBQZXJpb2RpY2FsbHkgY2xlYW4gZXhwaXJlZCBzZXNzaW9uc1xuICAgIHRoaXMuY2xlYW51cEludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xuICAgICAgdGhpcy5jbGVhbnVwKCk7XG4gICAgfSwgY2xlYW51cEludGVydmFsTXMpO1xuICB9XG5cbiAgYXN5bmMgY3JlYXRlKHNlc3Npb25EYXRhOiBJU2Vzc2lvbkRhdGEpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHNlc3Npb25JZCA9IHNlc3Npb25EYXRhLnNlc3Npb25JZCB8fCBDcnlwdG9VdGlsLmdlbmVyYXRlVG9rZW4oKTtcbiAgICB0aGlzLnNlc3Npb25zLnNldChzZXNzaW9uSWQsIHtcbiAgICAgIC4uLnNlc3Npb25EYXRhLFxuICAgICAgc2Vzc2lvbklkLFxuICAgIH0pO1xuICAgIHJldHVybiBzZXNzaW9uSWQ7XG4gIH1cblxuICBhc3luYyBnZXQoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPElTZXNzaW9uRGF0YSB8IG51bGw+IHtcbiAgICBjb25zdCBzZXNzaW9uID0gdGhpcy5zZXNzaW9ucy5nZXQoc2Vzc2lvbklkKTtcbiAgICBpZiAoIXNlc3Npb24pIHJldHVybiBudWxsO1xuXG4gICAgaWYgKG5ldyBEYXRlKCkgPiBzZXNzaW9uLmV4cGlyZXNBdCkge1xuICAgICAgYXdhaXQgdGhpcy5kZWxldGUoc2Vzc2lvbklkKTtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiBzZXNzaW9uO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlKFxuICAgIHNlc3Npb25JZDogc3RyaW5nLFxuICAgIHNlc3Npb25EYXRhOiBQYXJ0aWFsPElTZXNzaW9uRGF0YT5cbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgZXhpc3RpbmdTZXNzaW9uID0gYXdhaXQgdGhpcy5nZXQoc2Vzc2lvbklkKTtcbiAgICBpZiAoIWV4aXN0aW5nU2Vzc2lvbikgcmV0dXJuIGZhbHNlO1xuXG4gICAgdGhpcy5zZXNzaW9ucy5zZXQoc2Vzc2lvbklkLCB7XG4gICAgICAuLi5leGlzdGluZ1Nlc3Npb24sXG4gICAgICAuLi5zZXNzaW9uRGF0YSxcbiAgICAgIGxhc3RBY2Nlc3NlZEF0OiBuZXcgRGF0ZSgpLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBhc3luYyBkZWxldGUoc2Vzc2lvbklkOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKTtcbiAgfVxuXG4gIGFzeW5jIGNsZWFudXAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcbiAgICBmb3IgKGNvbnN0IFtzZXNzaW9uSWQsIHNlc3Npb25dIG9mIHRoaXMuc2Vzc2lvbnMuZW50cmllcygpKSB7XG4gICAgICBpZiAoc2Vzc2lvbi5leHBpcmVzQXQgPCBub3cpIHtcbiAgICAgICAgdGhpcy5zZXNzaW9ucy5kZWxldGUoc2Vzc2lvbklkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvLyBDbGVhbiB1cCBpbnRlcnZhbCB3aGVuIG5vIGxvbmdlciBuZWVkZWRcbiAgZGVzdHJveSgpOiB2b2lkIHtcbiAgICBjbGVhckludGVydmFsKHRoaXMuY2xlYW51cEludGVydmFsKTtcbiAgfVxufVxuIl19