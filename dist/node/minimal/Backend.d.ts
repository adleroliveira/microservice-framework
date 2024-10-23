import { IBackEnd, IServiceRegistry } from "../interfaces";
import { MemoryPubSubConsumer } from "./PubSubConsumer";
export declare class Backend implements IBackEnd {
    serviceRegistry: IServiceRegistry;
    pubSubConsumer: MemoryPubSubConsumer;
    constructor();
}
