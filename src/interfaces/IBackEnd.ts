import { IServiceRegistry } from "./";
import { PubSubConsumer } from "../PubSubConsumer";

export interface IBackEnd {
  serviceRegistry: IServiceRegistry;
  pubSubConsumer: PubSubConsumer;
}
