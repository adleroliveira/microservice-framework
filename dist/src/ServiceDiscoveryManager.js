"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceDiscoveryManager = void 0;
const MicroserviceFramework_1 = require("./MicroserviceFramework");
class ServiceDiscoveryManager extends MicroserviceFramework_1.Loggable {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2VydmljZURpc2NvdmVyeU1hbmFnZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi9zcmMvU2VydmljZURpc2NvdmVyeU1hbmFnZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EsbUVBQW1EO0FBRW5ELE1BQWEsdUJBQXdCLFNBQVEsZ0NBQVE7SUFDbkQsWUFBb0IsUUFBMEI7UUFDNUMsS0FBSyxFQUFFLENBQUM7UUFEVSxhQUFRLEdBQVIsUUFBUSxDQUFrQjtJQUU5QyxDQUFDO0lBRUQsS0FBSyxDQUFDLFlBQVksQ0FDaEIsU0FBaUIsRUFDakIsTUFBYyxFQUNkLElBQVk7UUFFWixNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsZUFBZSxDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDL0QsQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQUMsU0FBaUIsRUFBRSxNQUFjO1FBQ3BELE1BQU0sSUFBSSxDQUFDLFFBQVEsQ0FBQyxpQkFBaUIsQ0FBQyxTQUFTLEVBQUUsTUFBTSxDQUFDLENBQUM7SUFDM0QsQ0FBQztJQUVELEtBQUssQ0FBQyxjQUFjLENBQ2xCLFNBQWlCLEVBQ2pCLE1BQWMsRUFDZCxJQUFZO1FBRVosTUFBTSxJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixDQUFDLFNBQVMsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDakUsQ0FBQztJQUVELEtBQUssQ0FBQyxrQkFBa0IsQ0FBQyxTQUFpQjtRQUN4QyxNQUFNLGVBQWUsR0FBRyxNQUFNLElBQUksQ0FBQyxRQUFRLENBQUMsa0JBQWtCLENBQUMsU0FBUyxDQUFDLENBQUM7UUFFMUUsSUFBSSxlQUFlLEVBQUUsQ0FBQztZQUNwQixxQ0FBcUM7WUFDckMsTUFBTSxhQUFhLEdBQUcsTUFBTSxJQUFJLENBQUMsa0JBQWtCLENBQ2pELFNBQVMsRUFDVCxlQUFlLENBQ2hCLENBQUM7WUFFRixJQUFJLGFBQWEsRUFBRSxDQUFDO2dCQUNsQixPQUFPLGVBQWUsQ0FBQztZQUN6QixDQUFDO2lCQUFNLENBQUM7Z0JBQ04sMERBQTBEO2dCQUMxRCxNQUFNLElBQUksQ0FBQyxjQUFjLENBQUMsU0FBUyxFQUFFLGVBQWUsQ0FBQyxDQUFDO2dCQUN0RCx3RUFBd0U7Z0JBQ3hFLE9BQU8sSUFBSSxDQUFDLGtCQUFrQixDQUFDLFNBQVMsQ0FBQyxDQUFDO1lBQzVDLENBQUM7UUFDSCxDQUFDO1FBRUQsT0FBTyxJQUFJLENBQUM7SUFDZCxDQUFDO0lBRU8sS0FBSyxDQUFDLGtCQUFrQixDQUM5QixTQUFpQixFQUNqQixNQUFjO1FBRWQsSUFBSSxDQUFDO1lBQ0gsZ0VBQWdFO1lBQ2hFLE9BQU8sSUFBSSxDQUFDO1FBQ2QsQ0FBQztRQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7WUFDcEIsSUFBSSxDQUFDLEtBQUssQ0FDUixnQ0FBZ0MsTUFBTSxlQUFlLFNBQVMsR0FBRyxFQUNqRSxLQUFLLENBQ04sQ0FBQztZQUNGLE9BQU8sS0FBSyxDQUFDO1FBQ2YsQ0FBQztJQUNILENBQUM7SUFFRCxLQUFLLENBQUMsV0FBVyxDQUNmLFNBQWlCO1FBRWpCLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxXQUFXLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDOUMsQ0FBQztJQUVELEtBQUssQ0FBQyxpQkFBaUI7UUFDckIsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLGlCQUFpQixFQUFFLENBQUM7SUFDM0MsQ0FBQztJQUVELEtBQUssQ0FBQyxlQUFlLENBQUMsU0FBaUI7UUFDckMsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLGVBQWUsQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNsRCxDQUFDO0NBQ0Y7QUE3RUQsMERBNkVDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSVNlcnZpY2VSZWdpc3RyeSB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IExvZ2dhYmxlIH0gZnJvbSBcIi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5cbmV4cG9ydCBjbGFzcyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciBleHRlbmRzIExvZ2dhYmxlIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWdpc3RyeTogSVNlcnZpY2VSZWdpc3RyeSkge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBhc3luYyByZWdpc3Rlck5vZGUoXG4gICAgc2VydmljZUlkOiBzdHJpbmcsXG4gICAgbm9kZUlkOiBzdHJpbmcsXG4gICAgbG9hZDogbnVtYmVyXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMucmVnaXN0cnkucmVnaXN0ZXJTZXJ2aWNlKHNlcnZpY2VJZCwgbm9kZUlkLCBsb2FkKTtcbiAgfVxuXG4gIGFzeW5jIHVucmVnaXN0ZXJOb2RlKHNlcnZpY2VJZDogc3RyaW5nLCBub2RlSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMucmVnaXN0cnkuZGVyZWdpc3RlclNlcnZpY2Uoc2VydmljZUlkLCBub2RlSWQpO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlTm9kZUxvYWQoXG4gICAgc2VydmljZUlkOiBzdHJpbmcsXG4gICAgbm9kZUlkOiBzdHJpbmcsXG4gICAgbG9hZDogbnVtYmVyXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMucmVnaXN0cnkudXBkYXRlU2VydmljZUxvYWQoc2VydmljZUlkLCBub2RlSWQsIGxvYWQpO1xuICB9XG5cbiAgYXN5bmMgZ2V0TGVhc3RMb2FkZWROb2RlKHNlcnZpY2VJZDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmcgfCBudWxsPiB7XG4gICAgY29uc3QgbGVhc3RMb2FkZWROb2RlID0gYXdhaXQgdGhpcy5yZWdpc3RyeS5nZXRMZWFzdExvYWRlZE5vZGUoc2VydmljZUlkKTtcblxuICAgIGlmIChsZWFzdExvYWRlZE5vZGUpIHtcbiAgICAgIC8vIFBlcmZvcm0gYSBoZWFsdGggY2hlY2sgb24gdGhlIG5vZGVcbiAgICAgIGNvbnN0IGlzTm9kZUhlYWx0aHkgPSBhd2FpdCB0aGlzLnBlcmZvcm1IZWFsdGhDaGVjayhcbiAgICAgICAgc2VydmljZUlkLFxuICAgICAgICBsZWFzdExvYWRlZE5vZGVcbiAgICAgICk7XG5cbiAgICAgIGlmIChpc05vZGVIZWFsdGh5KSB7XG4gICAgICAgIHJldHVybiBsZWFzdExvYWRlZE5vZGU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBJZiB0aGUgbm9kZSBpcyBub3QgaGVhbHRoeSwgcmVtb3ZlIGl0IGZyb20gdGhlIHJlZ2lzdHJ5XG4gICAgICAgIGF3YWl0IHRoaXMudW5yZWdpc3Rlck5vZGUoc2VydmljZUlkLCBsZWFzdExvYWRlZE5vZGUpO1xuICAgICAgICAvLyBSZWN1cnNpdmVseSBjYWxsIGdldExlYXN0TG9hZGVkTm9kZSB0byBnZXQgdGhlIG5leHQgbGVhc3QgbG9hZGVkIG5vZGVcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0TGVhc3RMb2FkZWROb2RlKHNlcnZpY2VJZCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBlcmZvcm1IZWFsdGhDaGVjayhcbiAgICBzZXJ2aWNlSWQ6IHN0cmluZyxcbiAgICBub2RlSWQ6IHN0cmluZ1xuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0cnkge1xuICAgICAgLy8gVE9ETzogSW1wbGVtZW50IGEgbWV0aG9kIHRvIGRldGVybWluZSBpZiBzZXJ2aWNlIGlzIG5vdCBzdGFsZVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgdGhpcy5lcnJvcihcbiAgICAgICAgYEhlYWx0aCBjaGVjayBmYWlsZWQgZm9yIG5vZGUgJHtub2RlSWR9IG9mIHNlcnZpY2UgJHtzZXJ2aWNlSWR9OmAsXG4gICAgICAgIGVycm9yXG4gICAgICApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldEFsbE5vZGVzKFxuICAgIHNlcnZpY2VJZDogc3RyaW5nXG4gICk6IFByb21pc2U8QXJyYXk8eyBub2RlSWQ6IHN0cmluZzsgbG9hZDogbnVtYmVyIH0+PiB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0cnkuZ2V0QWxsTm9kZXMoc2VydmljZUlkKTtcbiAgfVxuXG4gIGFzeW5jIGdldE9ubGluZVNlcnZpY2VzKCk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RyeS5nZXRPbmxpbmVTZXJ2aWNlcygpO1xuICB9XG5cbiAgYXN5bmMgaXNTZXJ2aWNlT25saW5lKHNlcnZpY2VJZDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0cnkuaXNTZXJ2aWNlT25saW5lKHNlcnZpY2VJZCk7XG4gIH1cbn1cbiJdfQ==