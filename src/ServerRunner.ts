import { ConsoleStrategy, LogStrategy } from "./utils/logging/LogStrategy";
import { Loggable, LogLevel } from "./utils/logging/Loggable";
import { MicroserviceFramework } from "./MicroserviceFramework";

Loggable.setLogLevel(Loggable.LogLevel.INFO);
Loggable.setLogStrategy(new ConsoleStrategy());

export class ServerRunner extends Loggable {
  private serviceId: string;
  private serviceInstance: MicroserviceFramework<any, any>;
  private logLevel: LogLevel = Loggable.LogLevel.DEBUG;
  private logStrategy: LogStrategy = new ConsoleStrategy();

  constructor(
    serviceInstance: MicroserviceFramework<any, any>,
    logLevel?: LogLevel
  ) {
    super();
    this.serviceInstance = serviceInstance;
    this.serviceId = serviceInstance.getserviceId();
    this.logLevel = logLevel || this.logLevel;
    this.inititalize();
  }

  private inititalize() {
    console.log(`initializing ServerRunner...`);
    process.on("SIGINT", this.handleSigint.bind(this));
    process.on("SIGTERM", this.handleShutdown.bind(this));
    process.on("unhandledRejection", this.handleUnhandledRejection.bind(this));
    this.setLogStrategy();
  }

  private setLogStrategy() {
    Loggable.setLogLevel(this.logLevel);
  }

  private async handleSigint() {
    console.log(`Shutting down ${this.serviceId} server...`);
    await this.serviceInstance.stop();
    process.exit(0);
  }

  private async handleShutdown(signal: string) {
    console.log(
      `Received ${signal}. Shutting down ${this.serviceId} server...`
    );
    await this.serviceInstance.stop();
    process.exit(0);
  }

  private handleUnhandledRejection(reason: any, promise: Promise<any>) {
    console.error(`ServerRunner: Unhandled Rejection`, promise, reason);
    try {
      this.logStrategy.send(reason);
    } catch (error) {
      console.error(`ServerRunner: Failed to send error logs to log-stream`);
    }
  }

  public stop() {
    if (this.serviceInstance) {
      this.serviceInstance.stop();
      console.log(`Shutting down ${this.serviceId} server...`);
    }
  }

  public start() {
    console.log(`ServerRunner: Starting ${this.serviceId} server...`);
    try {
      this.serviceInstance.start();
    } catch (error) {
      console.error(
        `ServerRunner: Error starting ${this.serviceId} server:`,
        error
      );
      this.stop();
      process.exit(1);
    }
  }
}
