export interface IPublishingStrategy {
  publishTo(data: any, path: string, contentType: string): Promise<string>;
  readFrom(path: string): Promise<any>;
}
