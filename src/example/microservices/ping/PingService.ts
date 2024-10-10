import {
  MicroserviceFramework,
  IServerConfig,
  IBackEnd,
} from "../../../MicroserviceFramework";

export class PingService extends MicroserviceFramework<string, string> {
  constructor(backend: IBackEnd, config: IServerConfig) {
    super(backend, config);
    this.ping();
  }

  private ping() {
    setTimeout(async () => {
      this.info(`Sending ping`);
      this.makeRequest({
        to: "pong",
        requestType: "ping",
        body: "ping",
      })
        .then((response) => {
          this.info(
            `Received ${response.body.data} from ${response.responseHeader.responderAddress}`
          );
        })
        .catch((error) => {
          this.error(error);
        });
      this.ping();
    }, 4000);
  }
}
