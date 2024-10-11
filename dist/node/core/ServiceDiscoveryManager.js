"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceDiscoveryManager = void 0;
const logging_1 = require("../logging");
class ServiceDiscoveryManager extends logging_1.Loggable {
    constructor(registry) {
        super();
        this.registry = registry;
    }
    async registerNode(serviceId, nodeId, load) {
        await this.registry.registerService(serviceId, nodeId, load);
    }
    async unregisterNode(serviceId, nodeId) {
        await this.registry.deregisterService(serviceId, nodeId);
    }
    async updateNodeLoad(serviceId, nodeId, load) {
        await this.registry.updateServiceLoad(serviceId, nodeId, load);
    }
    async getLeastLoadedNode(serviceId) {
        const leastLoadedNode = await this.registry.getLeastLoadedNode(serviceId);
        if (leastLoadedNode) {
            // Perform a health check on the node
            const isNodeHealthy = await this.performHealthCheck(serviceId, leastLoadedNode);
            if (isNodeHealthy) {
                return leastLoadedNode;
            }
            else {
                // If the node is not healthy, remove it from the registry
                await this.unregisterNode(serviceId, leastLoadedNode);
                // Recursively call getLeastLoadedNode to get the next least loaded node
                return this.getLeastLoadedNode(serviceId);
            }
        }
        return null;
    }
    async performHealthCheck(serviceId, nodeId) {
        try {
            // TODO: Implement a method to determine if service is not stale
            return true;
        }
        catch (error) {
            this.error(`Health check failed for node ${nodeId} of service ${serviceId}:`, error);
            return false;
        }
    }
    async getAllNodes(serviceId) {
        return this.registry.getAllNodes(serviceId);
    }
    async getOnlineServices() {
        return this.registry.getOnlineServices();
    }
    async isServiceOnline(serviceId) {
        return this.registry.isServiceOnline(serviceId);
    }
}
exports.ServiceDiscoveryManager = ServiceDiscoveryManager;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2VydmljZURpc2NvdmVyeU1hbmFnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvY29yZS9TZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFDQSx3Q0FBc0M7QUFFdEMsTUFBYSx1QkFBd0IsU0FBUSxrQkFBUTtJQUNuRCxZQUFvQixRQUEwQjtRQUM1QyxLQUFLLEVBQUUsQ0FBQztRQURVLGFBQVEsR0FBUixRQUFRLENBQWtCO0lBRTlDLENBQUM7SUFFRCxLQUFLLENBQUMsWUFBWSxDQUNoQixTQUFpQixFQUNqQixNQUFjLEVBQ2QsSUFBWTtRQUVaLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxlQUFlLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztJQUMvRCxDQUFDO0lBRUQsS0FBSyxDQUFDLGNBQWMsQ0FBQyxTQUFpQixFQUFFLE1BQWM7UUFDcEQsTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxNQUFNLENBQUMsQ0FBQztJQUMzRCxDQUFDO0lBRUQsS0FBSyxDQUFDLGNBQWMsQ0FDbEIsU0FBaUIsRUFDakIsTUFBYyxFQUNkLElBQVk7UUFFWixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCLENBQUMsU0FBUyxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsQ0FBQztJQUNqRSxDQUFDO0lBRUQsS0FBSyxDQUFDLGtCQUFrQixDQUFDLFNBQWlCO1FBQ3hDLE1BQU0sZUFBZSxHQUFHLE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxrQkFBa0IsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUUxRSxJQUFJLGVBQWUsRUFBRSxDQUFDO1lBQ3BCLHFDQUFxQztZQUNyQyxNQUFNLGFBQWEsR0FBRyxNQUFNLElBQUksQ0FBQyxrQkFBa0IsQ0FDakQsU0FBUyxFQUNULGVBQWUsQ0FDaEIsQ0FBQztZQUVGLElBQUksYUFBYSxFQUFFLENBQUM7Z0JBQ2xCLE9BQU8sZUFBZSxDQUFDO1lBQ3pCLENBQUM7aUJBQU0sQ0FBQztnQkFDTiwwREFBMEQ7Z0JBQzFELE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxTQUFTLEVBQUUsZUFBZSxDQUFDLENBQUM7Z0JBQ3RELHdFQUF3RTtnQkFDeEUsT0FBTyxJQUFJLENBQUMsa0JBQWtCLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDNUMsQ0FBQztRQUNILENBQUM7UUFFRCxPQUFPLElBQUksQ0FBQztJQUNkLENBQUM7SUFFTyxLQUFLLENBQUMsa0JBQWtCLENBQzlCLFNBQWlCLEVBQ2pCLE1BQWM7UUFFZCxJQUFJLENBQUM7WUFDSCxnRUFBZ0U7WUFDaEUsT0FBTyxJQUFJLENBQUM7UUFDZCxDQUFDO1FBQUMsT0FBTyxLQUFVLEVBQUUsQ0FBQztZQUNwQixJQUFJLENBQUMsS0FBSyxDQUNSLGdDQUFnQyxNQUFNLGVBQWUsU0FBUyxHQUFHLEVBQ2pFLEtBQUssQ0FDTixDQUFDO1lBQ0YsT0FBTyxLQUFLLENBQUM7UUFDZixDQUFDO0lBQ0gsQ0FBQztJQUVELEtBQUssQ0FBQyxXQUFXLENBQ2YsU0FBaUI7UUFFakIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLFdBQVcsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUM5QyxDQUFDO0lBRUQsS0FBSyxDQUFDLGlCQUFpQjtRQUNyQixPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztJQUMzQyxDQUFDO0lBRUQsS0FBSyxDQUFDLGVBQWUsQ0FBQyxTQUFpQjtRQUNyQyxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLFNBQVMsQ0FBQyxDQUFDO0lBQ2xELENBQUM7Q0FDRjtBQTdFRCwwREE2RUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBJU2VydmljZVJlZ2lzdHJ5IH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IExvZ2dhYmxlIH0gZnJvbSBcIi4uL2xvZ2dpbmdcIjtcblxuZXhwb3J0IGNsYXNzIFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyIGV4dGVuZHMgTG9nZ2FibGUge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlZ2lzdHJ5OiBJU2VydmljZVJlZ2lzdHJ5KSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIGFzeW5jIHJlZ2lzdGVyTm9kZShcbiAgICBzZXJ2aWNlSWQ6IHN0cmluZyxcbiAgICBub2RlSWQ6IHN0cmluZyxcbiAgICBsb2FkOiBudW1iZXJcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5yZWdpc3RyeS5yZWdpc3RlclNlcnZpY2Uoc2VydmljZUlkLCBub2RlSWQsIGxvYWQpO1xuICB9XG5cbiAgYXN5bmMgdW5yZWdpc3Rlck5vZGUoc2VydmljZUlkOiBzdHJpbmcsIG5vZGVJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5yZWdpc3RyeS5kZXJlZ2lzdGVyU2VydmljZShzZXJ2aWNlSWQsIG5vZGVJZCk7XG4gIH1cblxuICBhc3luYyB1cGRhdGVOb2RlTG9hZChcbiAgICBzZXJ2aWNlSWQ6IHN0cmluZyxcbiAgICBub2RlSWQ6IHN0cmluZyxcbiAgICBsb2FkOiBudW1iZXJcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5yZWdpc3RyeS51cGRhdGVTZXJ2aWNlTG9hZChzZXJ2aWNlSWQsIG5vZGVJZCwgbG9hZCk7XG4gIH1cblxuICBhc3luYyBnZXRMZWFzdExvYWRlZE5vZGUoc2VydmljZUlkOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZyB8IG51bGw+IHtcbiAgICBjb25zdCBsZWFzdExvYWRlZE5vZGUgPSBhd2FpdCB0aGlzLnJlZ2lzdHJ5LmdldExlYXN0TG9hZGVkTm9kZShzZXJ2aWNlSWQpO1xuXG4gICAgaWYgKGxlYXN0TG9hZGVkTm9kZSkge1xuICAgICAgLy8gUGVyZm9ybSBhIGhlYWx0aCBjaGVjayBvbiB0aGUgbm9kZVxuICAgICAgY29uc3QgaXNOb2RlSGVhbHRoeSA9IGF3YWl0IHRoaXMucGVyZm9ybUhlYWx0aENoZWNrKFxuICAgICAgICBzZXJ2aWNlSWQsXG4gICAgICAgIGxlYXN0TG9hZGVkTm9kZVxuICAgICAgKTtcblxuICAgICAgaWYgKGlzTm9kZUhlYWx0aHkpIHtcbiAgICAgICAgcmV0dXJuIGxlYXN0TG9hZGVkTm9kZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIElmIHRoZSBub2RlIGlzIG5vdCBoZWFsdGh5LCByZW1vdmUgaXQgZnJvbSB0aGUgcmVnaXN0cnlcbiAgICAgICAgYXdhaXQgdGhpcy51bnJlZ2lzdGVyTm9kZShzZXJ2aWNlSWQsIGxlYXN0TG9hZGVkTm9kZSk7XG4gICAgICAgIC8vIFJlY3Vyc2l2ZWx5IGNhbGwgZ2V0TGVhc3RMb2FkZWROb2RlIHRvIGdldCB0aGUgbmV4dCBsZWFzdCBsb2FkZWQgbm9kZVxuICAgICAgICByZXR1cm4gdGhpcy5nZXRMZWFzdExvYWRlZE5vZGUoc2VydmljZUlkKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcGVyZm9ybUhlYWx0aENoZWNrKFxuICAgIHNlcnZpY2VJZDogc3RyaW5nLFxuICAgIG5vZGVJZDogc3RyaW5nXG4gICk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICAvLyBUT0RPOiBJbXBsZW1lbnQgYSBtZXRob2QgdG8gZGV0ZXJtaW5lIGlmIHNlcnZpY2UgaXMgbm90IHN0YWxlXG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKFxuICAgICAgICBgSGVhbHRoIGNoZWNrIGZhaWxlZCBmb3Igbm9kZSAke25vZGVJZH0gb2Ygc2VydmljZSAke3NlcnZpY2VJZH06YCxcbiAgICAgICAgZXJyb3JcbiAgICAgICk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0QWxsTm9kZXMoXG4gICAgc2VydmljZUlkOiBzdHJpbmdcbiAgKTogUHJvbWlzZTxBcnJheTx7IG5vZGVJZDogc3RyaW5nOyBsb2FkOiBudW1iZXIgfT4+IHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5nZXRBbGxOb2RlcyhzZXJ2aWNlSWQpO1xuICB9XG5cbiAgYXN5bmMgZ2V0T25saW5lU2VydmljZXMoKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdHJ5LmdldE9ubGluZVNlcnZpY2VzKCk7XG4gIH1cblxuICBhc3luYyBpc1NlcnZpY2VPbmxpbmUoc2VydmljZUlkOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5pc1NlcnZpY2VPbmxpbmUoc2VydmljZUlkKTtcbiAgfVxufVxuIl19