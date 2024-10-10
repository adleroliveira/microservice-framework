import { IServiceRegistry, IRequest, IResponse } from "./";
import { PubSubConsumer } from "../PubSubConsumer";
export interface IBackEnd {
    serviceRegistry: IServiceRegistry;
    pubSubConsumer: PubSubConsumer<IRequest<any> | IResponse<any>>;
}
