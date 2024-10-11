import { IServiceRegistry } from "../interfaces";
import { Loggable } from "../logging";

export class ServiceDiscoveryManager extends Loggable {
  constructor(private registry: IServiceRegistry) {
    super();
  }

  async registerNode(
    serviceId: string,
    nodeId: string,
    load: number
  ): Promise<void> {
    await this.registry.registerService(serviceId, nodeId, load);
  }

  async unregisterNode(serviceId: string, nodeId: string): Promise<void> {
    await this.registry.deregisterService(serviceId, nodeId);
  }

  async updateNodeLoad(
    serviceId: string,
    nodeId: string,
    load: number
  ): Promise<void> {
    await this.registry.updateServiceLoad(serviceId, nodeId, load);
  }

  async getLeastLoadedNode(serviceId: string): Promise<string | null> {
    const leastLoadedNode = await this.registry.getLeastLoadedNode(serviceId);

    if (leastLoadedNode) {
      // Perform a health check on the node
      const isNodeHealthy = await this.performHealthCheck(
        serviceId,
        leastLoadedNode
      );

      if (isNodeHealthy) {
        return leastLoadedNode;
      } else {
        // If the node is not healthy, remove it from the registry
        await this.unregisterNode(serviceId, leastLoadedNode);
        // Recursively call getLeastLoadedNode to get the next least loaded node
        return this.getLeastLoadedNode(serviceId);
      }
    }

    return null;
  }

  private async performHealthCheck(
    serviceId: string,
    nodeId: string
  ): Promise<boolean> {
    try {
      // TODO: Implement a method to determine if service is not stale
      return true;
    } catch (error: any) {
      this.error(
        `Health check failed for node ${nodeId} of service ${serviceId}:`,
        error
      );
      return false;
    }
  }

  async getAllNodes(
    serviceId: string
  ): Promise<Array<{ nodeId: string; load: number }>> {
    return this.registry.getAllNodes(serviceId);
  }

  async getOnlineServices(): Promise<string[]> {
    return this.registry.getOnlineServices();
  }

  async isServiceOnline(serviceId: string): Promise<boolean> {
    return this.registry.isServiceOnline(serviceId);
  }
}
