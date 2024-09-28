export interface IMessage<T = any> {
    id: string;
    payload: T;
    timestamp?: number;
}
