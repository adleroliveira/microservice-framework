export interface IPubSubClient {
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  publish(channel: string, message: any): Promise<void>;
}
