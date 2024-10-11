import {
  MicroserviceFramework,
  IServerConfig,
  RequestHandler,
} from "../../MicroserviceFramework";
import { IBackEnd } from "../../interfaces";

export class PongService extends MicroserviceFramework<string, string> {
  constructor(backend: IBackEnd, config: IServerConfig) {
    super(backend, config);
  }

  @RequestHandler("ping")
  private async pong() {
    this.info(`[${this.instanceId}] Received ping`);
    await this.delay(5000);
    this.info(`[${this.instanceId}] Sending back pong`);
    return "pong";
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
