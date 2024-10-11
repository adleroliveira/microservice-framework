import { Loggable, LogLevel } from "./logging";
import { MicroserviceFramework } from "./MicroserviceFramework";

Loggable.setLogLevel(Loggable.LogLevel.INFO);

export class ServerRunner extends Loggable {
  private services: MicroserviceFramework<any, any>[] = [];
  private logLevel: LogLevel = Loggable.LogLevel.DEBUG;
  private isStarted: boolean = false;

  constructor(
    serviceInstanceOrLogLevel?: MicroserviceFramework<any, any> | LogLevel,
    logLevel?: LogLevel
  ) {
    super();
    if (serviceInstanceOrLogLevel instanceof MicroserviceFramework) {
      this.registerService(serviceInstanceOrLogLevel);
      this.logLevel = logLevel || this.logLevel;
    } else {
      this.logLevel = serviceInstanceOrLogLevel || this.logLevel;
    }
    this.initialize();
  }

  private initialize() {
    this.info(`Initializing ServerRunner...`);
    process.on("SIGINT", this.handleSigint.bind(this));
    process.on("SIGTERM", this.handleShutdown.bind(this));
    process.on("unhandledRejection", this.handleUnhandledRejection.bind(this));
    this.setLogStrategy();
  }

  private setLogStrategy() {
    Loggable.setLogLevel(this.logLevel);
  }

  public registerService(serviceInstance: MicroserviceFramework<any, any>) {
    this.services.push(serviceInstance);
    this.info(`Registered service: ${serviceInstance.getserviceId()}`);
  }

  private async handleSigint() {
    this.info(`[SIGINT] Shutting down all services...`);
    await this.stop();
  }

  private async handleShutdown(signal: string) {
    this.info(`Received [${signal}]. Shutting down all services...`);
    await this.stop();
  }

  private handleUnhandledRejection(reason: any, promise: Promise<any>) {
    this.error(`Unhandled Rejection`, reason);
  }

  public async stop() {
    this.info(`Stopping all services...`);
    for (const service of this.services) {
      try {
        await service.stop();
        this.info(`Stopped service: ${service.getserviceId()}`);
      } catch (error: any) {
        this.error(`Error stopping service ${service.getserviceId()}:`, error);
      }
    }
    this.isStarted = false;
    this.info(`All services stopped.`);
    process.exit(0);
  }

  public async start() {
    if (this.isStarted) return;
    this.info(`Starting all services...`);
    try {
      for (const service of this.services) {
        await service.initialize();
        await service.start();
        this.info(`Started service: ${service.getserviceId()}`);
      }
      this.isStarted = true;
      this.info(`All services are running...`);
    } catch (error: any) {
      this.error(`Error starting services:`, error);
      await this.stop();
      process.exit(1);
    }
  }
}
