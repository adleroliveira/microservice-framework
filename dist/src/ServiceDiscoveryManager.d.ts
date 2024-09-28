import { IServiceRegistry } from "./interfaces";
export declare class ServiceDiscoveryManager {
    private registry;
    constructor(registry: IServiceRegistry);
    registerNode(serviceId: string, nodeId: string, load: number): Promise<void>;
    unregisterNode(serviceId: string, nodeId: string): Promise<void>;
    updateNodeLoad(serviceId: string, nodeId: string, load: number): Promise<void>;
    getLeastLoadedNode(serviceId: string): Promise<string | null>;
    getAllNodes(serviceId: string): Promise<Array<{
        nodeId: string;
        load: number;
    }>>;
    getOnlineServices(): Promise<string[]>;
    isServiceOnline(serviceId: string): Promise<boolean>;
}
