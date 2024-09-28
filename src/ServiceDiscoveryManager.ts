import { IServiceRegistry } from "./interfaces";

export class ServiceDiscoveryManager {
  constructor(private registry: IServiceRegistry) {}

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
    return this.registry.getLeastLoadedNode(serviceId);
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
