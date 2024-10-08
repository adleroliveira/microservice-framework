"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryServiceRegistry = void 0;
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
class MemoryServiceRegistry extends MicroserviceFramework_1.Loggable {
    constructor() {
        super();
        this.services = new Map();
    }
    async registerService(serviceId, nodeId, load) {
        if (!this.services.has(serviceId)) {
            this.services.set(serviceId, { nodes: new Map() });
        }
        this.services.get(serviceId).nodes.set(nodeId, { nodeId, load });
    }
    async deregisterService(serviceId, nodeId) {
        const serviceInfo = this.services.get(serviceId);
        if (serviceInfo) {
            serviceInfo.nodes.delete(nodeId);
            this.warn(`Deregistered node ${nodeId} from service ${serviceId}`);
            if (serviceInfo.nodes.size === 0) {
                this.services.delete(serviceId);
            }
        }
    }
    async updateServiceLoad(serviceId, nodeId, load) {
        const serviceInfo = this.services.get(serviceId);
        if (serviceInfo && serviceInfo.nodes.has(nodeId)) {
            serviceInfo.nodes.get(nodeId).load = load;
            this.debug(`Updated load for service ${serviceId} on node ${nodeId} to ${load}`);
        }
    }
    async getLeastLoadedNode(serviceId) {
        const serviceInfo = this.services.get(serviceId);
        if (!serviceInfo || serviceInfo.nodes.size === 0) {
            return null;
        }
        let leastLoadedNode = null;
        for (const node of serviceInfo.nodes.values()) {
            if (!leastLoadedNode || node.load < leastLoadedNode.load) {
                leastLoadedNode = node;
            }
        }
        return leastLoadedNode.nodeId;
    }
    async getAllNodes(serviceId) {
        const serviceInfo = this.services.get(serviceId);
        if (!serviceInfo) {
            return [];
        }
        return Array.from(serviceInfo.nodes.values());
    }
    async getOnlineServices() {
        return Array.from(this.services.keys());
    }
    async isServiceOnline(serviceId) {
        return this.services.has(serviceId);
    }
}
exports.MemoryServiceRegistry = MemoryServiceRegistry;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2VydmljZVJlZ2lzdHJ5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL2V4YW1wbGUvYmFja2VuZC9TZXJ2aWNlUmVnaXN0cnkudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsdUVBQXVEO0FBV3ZELE1BQWEscUJBQ1gsU0FBUSxnQ0FBUTtJQUtoQjtRQUNFLEtBQUssRUFBRSxDQUFDO1FBQ1IsSUFBSSxDQUFDLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBRSxDQUFDO0lBQzVCLENBQUM7SUFFRCxLQUFLLENBQUMsZUFBZSxDQUNuQixTQUFpQixFQUNqQixNQUFjLEVBQ2QsSUFBWTtRQUVaLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsRUFBRSxDQUFDO1lBQ2xDLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSxFQUFFLEtBQUssRUFBRSxJQUFJLEdBQUcsRUFBRSxFQUFFLENBQUMsQ0FBQztRQUNyRCxDQUFDO1FBQ0QsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFFLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxNQUFNLEVBQUUsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQztJQUNwRSxDQUFDO0lBRUQsS0FBSyxDQUFDLGlCQUFpQixDQUFDLFNBQWlCLEVBQUUsTUFBYztRQUN2RCxNQUFNLFdBQVcsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztRQUNqRCxJQUFJLFdBQVcsRUFBRSxDQUFDO1lBQ2hCLFdBQVcsQ0FBQyxLQUFLLENBQUMsTUFBTSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1lBQ2pDLElBQUksQ0FBQyxJQUFJLENBQUMscUJBQXFCLE1BQU0saUJBQWlCLFNBQVMsRUFBRSxDQUFDLENBQUM7WUFDbkUsSUFBSSxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQztnQkFDakMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDbEMsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRUQsS0FBSyxDQUFDLGlCQUFpQixDQUNyQixTQUFpQixFQUNqQixNQUFjLEVBQ2QsSUFBWTtRQUVaLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ2pELElBQUksV0FBVyxJQUFJLFdBQVcsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxFQUFFLENBQUM7WUFDakQsV0FBVyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFFLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztZQUMzQyxJQUFJLENBQUMsS0FBSyxDQUNSLDRCQUE0QixTQUFTLFlBQVksTUFBTSxPQUFPLElBQUksRUFBRSxDQUNyRSxDQUFDO1FBQ0osQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsa0JBQWtCLENBQUMsU0FBaUI7UUFDeEMsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDakQsSUFBSSxDQUFDLFdBQVcsSUFBSSxXQUFXLENBQUMsS0FBSyxDQUFDLElBQUksS0FBSyxDQUFDLEVBQUUsQ0FBQztZQUNqRCxPQUFPLElBQUksQ0FBQztRQUNkLENBQUM7UUFDRCxJQUFJLGVBQWUsR0FBdUIsSUFBSSxDQUFDO1FBQy9DLEtBQUssTUFBTSxJQUFJLElBQUksV0FBVyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQzlDLElBQUksQ0FBQyxlQUFlLElBQUksSUFBSSxDQUFDLElBQUksR0FBRyxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7Z0JBQ3pELGVBQWUsR0FBRyxJQUFJLENBQUM7WUFDekIsQ0FBQztRQUNILENBQUM7UUFDRCxPQUFPLGVBQWdCLENBQUMsTUFBTSxDQUFDO0lBQ2pDLENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVyxDQUNmLFNBQWlCO1FBRWpCLE1BQU0sV0FBVyxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDO1FBQ2pELElBQUksQ0FBQyxXQUFXLEVBQUUsQ0FBQztZQUNqQixPQUFPLEVBQUUsQ0FBQztRQUNaLENBQUM7UUFDRCxPQUFPLEtBQUssQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO0lBQ2hELENBQUM7SUFFRCxLQUFLLENBQUMsaUJBQWlCO1FBQ3JCLE9BQU8sS0FBSyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxDQUFDLENBQUM7SUFDMUMsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsU0FBaUI7UUFDckMsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN0QyxDQUFDO0NBQ0Y7QUE5RUQsc0RBOEVDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSVNlcnZpY2VSZWdpc3RyeSB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgeyBMb2dnYWJsZSB9IGZyb20gXCIuLi8uLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcblxuaW50ZXJmYWNlIFNlcnZpY2VOb2RlIHtcbiAgbm9kZUlkOiBzdHJpbmc7XG4gIGxvYWQ6IG51bWJlcjtcbn1cblxuaW50ZXJmYWNlIFNlcnZpY2VJbmZvIHtcbiAgbm9kZXM6IE1hcDxzdHJpbmcsIFNlcnZpY2VOb2RlPjtcbn1cblxuZXhwb3J0IGNsYXNzIE1lbW9yeVNlcnZpY2VSZWdpc3RyeVxuICBleHRlbmRzIExvZ2dhYmxlXG4gIGltcGxlbWVudHMgSVNlcnZpY2VSZWdpc3RyeVxue1xuICBwcml2YXRlIHNlcnZpY2VzOiBNYXA8c3RyaW5nLCBTZXJ2aWNlSW5mbz47XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLnNlcnZpY2VzID0gbmV3IE1hcCgpO1xuICB9XG5cbiAgYXN5bmMgcmVnaXN0ZXJTZXJ2aWNlKFxuICAgIHNlcnZpY2VJZDogc3RyaW5nLFxuICAgIG5vZGVJZDogc3RyaW5nLFxuICAgIGxvYWQ6IG51bWJlclxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuc2VydmljZXMuaGFzKHNlcnZpY2VJZCkpIHtcbiAgICAgIHRoaXMuc2VydmljZXMuc2V0KHNlcnZpY2VJZCwgeyBub2RlczogbmV3IE1hcCgpIH0pO1xuICAgIH1cbiAgICB0aGlzLnNlcnZpY2VzLmdldChzZXJ2aWNlSWQpIS5ub2Rlcy5zZXQobm9kZUlkLCB7IG5vZGVJZCwgbG9hZCB9KTtcbiAgfVxuXG4gIGFzeW5jIGRlcmVnaXN0ZXJTZXJ2aWNlKHNlcnZpY2VJZDogc3RyaW5nLCBub2RlSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNlcnZpY2VJbmZvID0gdGhpcy5zZXJ2aWNlcy5nZXQoc2VydmljZUlkKTtcbiAgICBpZiAoc2VydmljZUluZm8pIHtcbiAgICAgIHNlcnZpY2VJbmZvLm5vZGVzLmRlbGV0ZShub2RlSWQpO1xuICAgICAgdGhpcy53YXJuKGBEZXJlZ2lzdGVyZWQgbm9kZSAke25vZGVJZH0gZnJvbSBzZXJ2aWNlICR7c2VydmljZUlkfWApO1xuICAgICAgaWYgKHNlcnZpY2VJbmZvLm5vZGVzLnNpemUgPT09IDApIHtcbiAgICAgICAgdGhpcy5zZXJ2aWNlcy5kZWxldGUoc2VydmljZUlkKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBhc3luYyB1cGRhdGVTZXJ2aWNlTG9hZChcbiAgICBzZXJ2aWNlSWQ6IHN0cmluZyxcbiAgICBub2RlSWQ6IHN0cmluZyxcbiAgICBsb2FkOiBudW1iZXJcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc2VydmljZUluZm8gPSB0aGlzLnNlcnZpY2VzLmdldChzZXJ2aWNlSWQpO1xuICAgIGlmIChzZXJ2aWNlSW5mbyAmJiBzZXJ2aWNlSW5mby5ub2Rlcy5oYXMobm9kZUlkKSkge1xuICAgICAgc2VydmljZUluZm8ubm9kZXMuZ2V0KG5vZGVJZCkhLmxvYWQgPSBsb2FkO1xuICAgICAgdGhpcy5kZWJ1ZyhcbiAgICAgICAgYFVwZGF0ZWQgbG9hZCBmb3Igc2VydmljZSAke3NlcnZpY2VJZH0gb24gbm9kZSAke25vZGVJZH0gdG8gJHtsb2FkfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZ2V0TGVhc3RMb2FkZWROb2RlKHNlcnZpY2VJZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgY29uc3Qgc2VydmljZUluZm8gPSB0aGlzLnNlcnZpY2VzLmdldChzZXJ2aWNlSWQpO1xuICAgIGlmICghc2VydmljZUluZm8gfHwgc2VydmljZUluZm8ubm9kZXMuc2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICAgIGxldCBsZWFzdExvYWRlZE5vZGU6IFNlcnZpY2VOb2RlIHwgbnVsbCA9IG51bGw7XG4gICAgZm9yIChjb25zdCBub2RlIG9mIHNlcnZpY2VJbmZvLm5vZGVzLnZhbHVlcygpKSB7XG4gICAgICBpZiAoIWxlYXN0TG9hZGVkTm9kZSB8fCBub2RlLmxvYWQgPCBsZWFzdExvYWRlZE5vZGUubG9hZCkge1xuICAgICAgICBsZWFzdExvYWRlZE5vZGUgPSBub2RlO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbGVhc3RMb2FkZWROb2RlIS5ub2RlSWQ7XG4gIH1cblxuICBhc3luYyBnZXRBbGxOb2RlcyhcbiAgICBzZXJ2aWNlSWQ6IHN0cmluZ1xuICApOiBQcm9taXNlPEFycmF5PHsgbm9kZUlkOiBzdHJpbmc7IGxvYWQ6IG51bWJlciB9Pj4ge1xuICAgIGNvbnN0IHNlcnZpY2VJbmZvID0gdGhpcy5zZXJ2aWNlcy5nZXQoc2VydmljZUlkKTtcbiAgICBpZiAoIXNlcnZpY2VJbmZvKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuICAgIHJldHVybiBBcnJheS5mcm9tKHNlcnZpY2VJbmZvLm5vZGVzLnZhbHVlcygpKTtcbiAgfVxuXG4gIGFzeW5jIGdldE9ubGluZVNlcnZpY2VzKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICByZXR1cm4gQXJyYXkuZnJvbSh0aGlzLnNlcnZpY2VzLmtleXMoKSk7XG4gIH1cblxuICBhc3luYyBpc1NlcnZpY2VPbmxpbmUoc2VydmljZUlkOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2aWNlcy5oYXMoc2VydmljZUlkKTtcbiAgfVxufVxuIl19