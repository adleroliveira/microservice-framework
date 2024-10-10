import { IBackEnd, IServiceRegistry } from "../../interfaces";
import { MemoryPubSubConsumer, PubSubConsumerClient } from "./PubSubConsumer";
import { MemoryServiceRegistry } from "./ServiceRegistry";

export class Backend implements IBackEnd {
  serviceRegistry: IServiceRegistry;
  pubSubConsumer: MemoryPubSubConsumer;
  constructor() {
    this.serviceRegistry = new MemoryServiceRegistry();
    const client = new PubSubConsumerClient();
    this.pubSubConsumer = new MemoryPubSubConsumer(client, {});
  }
}
