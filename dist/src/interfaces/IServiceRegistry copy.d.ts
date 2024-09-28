export interface IServiceRegistry {
    registerService(serviceId: string, nodeId: string, load: number): Promise<void>;
    deregisterService(serviceId: string, nodeId: string): Promise<void>;
    updateServiceLoad(serviceId: string, nodeId: string, load: number): Promise<void>;
    getLeastLoadedNode(serviceId: string): Promise<string | null>;
    getAllNodes(serviceId: string): Promise<Array<{
        nodeId: string;
        load: number;
    }>>;
    getOnlineServices(): Promise<string[]>;
    isServiceOnline(serviceId: string): Promise<boolean>;
}
