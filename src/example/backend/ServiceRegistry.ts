import { IServiceRegistry } from "../../interfaces";
import { Loggable } from "../../MicroserviceFramework";

interface ServiceNode {
  nodeId: string;
  load: number;
}

interface ServiceInfo {
  nodes: Map<string, ServiceNode>;
}

export class MemoryServiceRegistry
  extends Loggable
  implements IServiceRegistry
{
  private services: Map<string, ServiceInfo>;

  constructor() {
    super();
    this.services = new Map();
  }

  async registerService(
    serviceId: string,
    nodeId: string,
    load: number
  ): Promise<void> {
    if (!this.services.has(serviceId)) {
      this.services.set(serviceId, { nodes: new Map() });
    }
    this.services.get(serviceId)!.nodes.set(nodeId, { nodeId, load });
  }

  async deregisterService(serviceId: string, nodeId: string): Promise<void> {
    const serviceInfo = this.services.get(serviceId);
    if (serviceInfo) {
      serviceInfo.nodes.delete(nodeId);
      this.warn(`Deregistered node ${nodeId} from service ${serviceId}`);
      if (serviceInfo.nodes.size === 0) {
        this.services.delete(serviceId);
      }
    }
  }

  async updateServiceLoad(
    serviceId: string,
    nodeId: string,
    load: number
  ): Promise<void> {
    const serviceInfo = this.services.get(serviceId);
    if (serviceInfo && serviceInfo.nodes.has(nodeId)) {
      serviceInfo.nodes.get(nodeId)!.load = load;
      this.debug(
        `Updated load for service ${serviceId} on node ${nodeId} to ${load}`
      );
    }
  }

  async getLeastLoadedNode(serviceId: string): Promise<string | null> {
    const serviceInfo = this.services.get(serviceId);
    if (!serviceInfo || serviceInfo.nodes.size === 0) {
      return null;
    }
    let leastLoadedNode: ServiceNode | null = null;
    for (const node of serviceInfo.nodes.values()) {
      if (!leastLoadedNode || node.load < leastLoadedNode.load) {
        leastLoadedNode = node;
      }
    }
    return leastLoadedNode!.nodeId;
  }

  async getAllNodes(
    serviceId: string
  ): Promise<Array<{ nodeId: string; load: number }>> {
    const serviceInfo = this.services.get(serviceId);
    if (!serviceInfo) {
      return [];
    }
    return Array.from(serviceInfo.nodes.values());
  }

  async getOnlineServices(): Promise<string[]> {
    return Array.from(this.services.keys());
  }

  async isServiceOnline(serviceId: string): Promise<boolean> {
    return this.services.has(serviceId);
  }
}
