"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryAuthProvider = void 0;
const utils_1 = require("../utils");
class InMemoryAuthProvider {
    constructor() {
        this.users = new Map();
        this.tokens = new Map();
    }
    // Method to add users (for setup/testing)
    async addUser(username, password) {
        const userId = utils_1.CryptoUtil.generateToken().slice(0, 8);
        const passwordHash = await utils_1.CryptoUtil.hashPassword(password);
        this.users.set(username, {
            userId,
            username,
            passwordHash,
        });
        return userId;
    }
    async authenticate(credentials) {
        const user = this.users.get(credentials.username);
        if (!user) {
            return { success: false, error: "User not found" };
        }
        const passwordHash = await utils_1.CryptoUtil.hashPassword(credentials.password);
        if (passwordHash !== user.passwordHash) {
            return { success: false, error: "Invalid password" };
        }
        // Generate tokens
        const token = utils_1.CryptoUtil.generateToken();
        const refreshToken = utils_1.CryptoUtil.generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
        this.tokens.set(token, {
            userId: user.userId,
            expiresAt,
            refreshToken,
        });
        return {
            success: true,
            userId: user.userId,
            token,
            refreshToken,
            expiresAt,
            metadata: user.metadata,
        };
    }
    async validateToken(token) {
        const tokenData = this.tokens.get(token);
        if (!tokenData) {
            return { success: false, error: "Invalid token" };
        }
        if (tokenData.expiresAt < new Date()) {
            this.tokens.delete(token);
            return { success: false, error: "Token expired" };
        }
        return {
            success: true,
            userId: tokenData.userId,
            token,
            expiresAt: tokenData.expiresAt,
        };
    }
    async refreshToken(refreshToken) {
        // Find token entry by refresh token
        const tokenEntry = Array.from(this.tokens.entries()).find(([_, data]) => data.refreshToken === refreshToken);
        if (!tokenEntry) {
            return { success: false, error: "Invalid refresh token" };
        }
        // Generate new tokens
        const newToken = utils_1.CryptoUtil.generateToken();
        const newRefreshToken = utils_1.CryptoUtil.generateToken();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
        // Remove old token
        this.tokens.delete(tokenEntry[0]);
        // Store new tokens
        this.tokens.set(newToken, {
            userId: tokenEntry[1].userId,
            expiresAt,
            refreshToken: newRefreshToken,
        });
        return {
            success: true,
            userId: tokenEntry[1].userId,
            token: newToken,
            refreshToken: newRefreshToken,
            expiresAt,
        };
    }
}
exports.InMemoryAuthProvider = InMemoryAuthProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiSW5NZW1vcnlBdXRoUHJvdmlkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbWluaW1hbC9Jbk1lbW9yeUF1dGhQcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxvQ0FBc0M7QUFPdEMsTUFBYSxvQkFBb0I7SUFBakM7UUFDVSxVQUFLLEdBQThCLElBQUksR0FBRyxFQUFFLENBQUM7UUFDN0MsV0FBTSxHQU9WLElBQUksR0FBRyxFQUFFLENBQUM7SUF3R2hCLENBQUM7SUF0R0MsMENBQTBDO0lBQzFDLEtBQUssQ0FBQyxPQUFPLENBQUMsUUFBZ0IsRUFBRSxRQUFnQjtRQUM5QyxNQUFNLE1BQU0sR0FBRyxrQkFBVSxDQUFDLGFBQWEsRUFBRSxDQUFDLEtBQUssQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7UUFDdEQsTUFBTSxZQUFZLEdBQUcsTUFBTSxrQkFBVSxDQUFDLFlBQVksQ0FBQyxRQUFRLENBQUMsQ0FBQztRQUU3RCxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxRQUFRLEVBQUU7WUFDdkIsTUFBTTtZQUNOLFFBQVE7WUFDUixZQUFZO1NBQ2IsQ0FBQyxDQUFDO1FBRUgsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVELEtBQUssQ0FBQyxZQUFZLENBQUMsV0FHbEI7UUFDQyxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxXQUFXLENBQUMsUUFBUSxDQUFDLENBQUM7UUFDbEQsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ1YsT0FBTyxFQUFFLE9BQU8sRUFBRSxLQUFLLEVBQUUsS0FBSyxFQUFFLGdCQUFnQixFQUFFLENBQUM7UUFDckQsQ0FBQztRQUVELE1BQU0sWUFBWSxHQUFHLE1BQU0sa0JBQVUsQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRXpFLElBQUksWUFBWSxLQUFLLElBQUksQ0FB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QUFZLEVBQUUsZUFBZTtTQUM5QixDQUFDLENBQUM7UUFFSCxPQUFPO1lBQ0wsT0FBTyxFQUFFLElBQUk7WUFDYixNQUFNLEVBQUUsVUFBVSxDQUFDLENBQUMsQ0FBQyxDQUFDLE1BQU07WUFDNUIsS0FBSyxFQUFFLFFBQVE7WUFDZixZQUFZLEVBQUUsZUFBZTtZQUM3QixTQUFTO1NBQ1YsQ0FBQztJQUNKLENBQUM7Q0FDRjtBQWpIRCxvREFpSEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBDcnlwdG9VdGlsIH0gZnJvbSBcIi4uL3V0aWxzXCI7XG5pbXBvcnQge1xuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbiAgSUF1dGhlbnRpY2F0aW9uUmVzdWx0LFxuICBJbk1lbW9yeVVzZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cbmV4cG9ydCBjbGFzcyBJbk1lbW9yeUF1dGhQcm92aWRlciBpbXBsZW1lbnRzIElBdXRoZW50aWNhdGlvblByb3ZpZGVyIHtcbiAgcHJpdmF0ZSB1c2VyczogTWFwPHN0cmluZywgSW5NZW1vcnlVc2VyPiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSB0b2tlbnM6IE1hcDxcbiAgICBzdHJpbmcsXG4gICAge1xuICAgICAgdXNlcklkOiBzdHJpbmc7XG4gICAgICBleHBpcmVzQXQ6IERhdGU7XG4gICAgICByZWZyZXNoVG9rZW4/OiBzdHJpbmc7XG4gICAgfVxuICA+ID0gbmV3IE1hcCgpO1xuXG4gIC8vIE1ldGhvZCB0byBhZGQgdXNlcnMgKGZvciBzZXR1cC90ZXN0aW5nKVxuICBhc3luYyBhZGRVc2VyKHVzZXJuYW1lOiBzdHJpbmcsIHBhc3N3b3JkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IENyeXB0b1V0aWwuZ2VuZXJhdGVUb2tlbigpLnNsaWNlKDAsIDgpO1xuICAgIGNvbnN0IHBhc3N3b3JkSGFzaCA9IGF3YWl0IENyeXB0b1V0aWwuaGFzaFBhc3N3b3JkKHBhc3N3b3JkKTtcblxuICAgIHRoaXMudXNlcnMuc2V0KHVzZXJuYW1lLCB7XG4gICAgICB1c2VySWQsXG4gICAgICB1c2VybmFtZSxcbiAgICAgIHBhc3N3b3JkSGFzaCxcbiAgICB9KTtcblxuICAgIHJldHVybiB1c2VySWQ7XG4gIH1cblxuICBhc3luYyBhdXRoZW50aWNhdGUoY3JlZGVudGlhbHM6IHtcbiAgICB1c2VybmFtZTogc3RyaW5nO1xuICAgIHBhc3N3b3JkOiBzdHJpbmc7XG4gIH0pOiBQcm9taXNlPElBdXRoZW50aWNhdGlvblJlc3VsdD4ge1xuICAgIGNvbnN0IHVzZXIgPSB0aGlzLnVzZXJzLmdldChjcmVkZW50aWFscy51c2VybmFtZSk7XG4gICAgaWYgKCF1c2VyKSB7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IFwiVXNlciBub3QgZm91bmRcIiB9O1xuICAgIH1cblxuICAgIGNvbnN0IHBhc3N3b3JkSGFzaCA9IGF3YWl0IENyeXB0b1V0aWwuaGFzaFBhc3N3b3JkKGNyZWRlbnRpYWxzLnBhc3N3b3JkKTtcbiAgXG4gICAgaWYgKHBhc3N3b3JkSGFzaCAhPT0gdXNlci5wYXNzd29yZEhhc2gpIHtcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogXCJJbnZhbGlkIHBhc3N3b3JkXCIgfTtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSB0b2tlbnNcbiAgICBjb25zdCB0b2tlbiA9IENyeXB0b1V0aWwuZ2VuZXJhdGVUb2tlbigpO1xuICAgIGNvbnN0IHJlZnJlc2hUb2tlbiA9IENyeXB0b1V0aWwuZ2VuZXJhdGVUb2tlbigpO1xuICAgIGNvbnN0IGV4cGlyZXNBdCA9IG5ldyBEYXRlKERhdGUubm93KCkgKyAyNCAqIDYwICogNjAgKiAxMDAwKTsgLy8gMjQgaG91cnNcblxuICAgIHRoaXMudG9rZW5zLnNldCh0b2tlbiwge1xuICAgICAgdXNlcklkOiB1c2VyLnVzZXJJZCxcbiAgICAgIGV4cGlyZXNBdCxcbiAgICAgIHJlZnJlc2hUb2tlbixcbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdWNjZXNzOiB0cnVlLFxuICAgICAgdXNlcklkOiB1c2VyLnVzZXJJZCxcbiAgICAgIHRva2VuLFxuICAgICAgcmVmcmVzaFRva2VuLFxuICAgICAgZXhwaXJlc0F0LFxuICAgICAgbWV0YWRhdGE6IHVzZXIubWV0YWRhdGEsXG4gICAgfTtcbiAgfVxuXG4gIGFzeW5jIHZhbGlkYXRlVG9rZW4odG9rZW46IHN0cmluZyk6IFByb21pc2U8SUF1dGhlbnRpY2F0aW9uUmVzdWx0PiB7XG4gICAgY29uc3QgdG9rZW5EYXRhID0gdGhpcy50b2tlbnMuZ2V0KHRva2VuKTtcbiAgICBpZiAoIXRva2VuRGF0YSkge1xuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGVycm9yOiBcIkludmFsaWQgdG9rZW5cIiB9O1xuICAgIH1cblxuICAgIGlmICh0b2tlbkRhdGEuZXhwaXJlc0F0IDwgbmV3IERhdGUoKSkge1xuICAgICAgdGhpcy50b2tlbnMuZGVsZXRlKHRva2VuKTtcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBlcnJvcjogXCJUb2tlbiBleHBpcmVkXCIgfTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgc3VjY2VzczogdHJ1ZSxcbiAgICAgIHVzZXJJZDogdG9rZW5EYXRhLnVzZXJJZCxcbiAgICAgIHRva2VuLFxuICAgICAgZXhwaXJlc0F0OiB0b2tlbkRhdGEuZXhwaXJlc0F0LFxuICAgIH07XG4gIH1cblxuICBhc3luYyByZWZyZXNoVG9rZW4ocmVmcmVzaFRva2VuOiBzdHJpbmcpOiBQcm9taXNlPElBdXRoZW50aWNhdGlvblJlc3VsdD4ge1xuICAgIC8vIEZpbmQgdG9rZW4gZW50cnkgYnkgcmVmcmVzaCB0b2tlblxuICAgIGNvbnN0IHRva2VuRW50cnkgPSBBcnJheS5mcm9tKHRoaXMudG9rZW5zLmVudHJpZXMoKSkuZmluZChcbiAgICAgIChbXywgZGF0YV0pID0+IGRhdGEucmVmcmVzaFRva2VuID09PSByZWZyZXNoVG9rZW5cbiAgICApO1xuXG4gICAgaWYgKCF0b2tlbkVudHJ5KSB7XG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6IFwiSW52YWxpZCByZWZyZXNoIHRva2VuXCIgfTtcbiAgICB9XG5cbiAgICAvLyBHZW5lcmF0ZSBuZXcgdG9rZW5zXG4gICAgY29uc3QgbmV3VG9rZW4gPSBDcnlwdG9VdGlsLmdlbmVyYXRlVG9rZW4oKTtcbiAgICBjb25zdCBuZXdSZWZyZXNoVG9rZW4gPSBDcnlwdG9VdGlsLmdlbmVyYXRlVG9rZW4oKTtcbiAgICBjb25zdCBleHBpcmVzQXQgPSBuZXcgRGF0ZShEYXRlLm5vdygpICsgMjQgKiA2MCAqIDYwICogMTAwMCk7XG5cbiAgICAvLyBSZW1vdmUgb2xkIHRva2VuXG4gICAgdGhpcy50b2tlbnMuZGVsZXRlKHRva2VuRW50cnlbMF0pO1xuXG4gICAgLy8gU3RvcmUgbmV3IHRva2Vuc1xuICAgIHRoaXMudG9rZW5zLnNldChuZXdUb2tlbiwge1xuICAgICAgdXNlcklkOiB0b2tlbkVudHJ5WzFdLnVzZXJJZCxcbiAgICAgIGV4cGlyZXNBdCxcbiAgICAgIHJlZnJlc2hUb2tlbjogbmV3UmVmcmVzaFRva2VuLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIHN1Y2Nlc3M6IHRydWUsXG4gICAgICB1c2VySWQ6IHRva2VuRW50cnlbMV0udXNlcklkLFxuICAgICAgdG9rZW46IG5ld1Rva2VuLFxuICAgICAgcmVmcmVzaFRva2VuOiBuZXdSZWZyZXNoVG9rZW4sXG4gICAgICBleHBpcmVzQXQsXG4gICAgfTtcbiAgfVxufVxuIl19