import { IRequest } from "../interfaces";
import { LogLevel, LogMessage, LogStrategy } from "../logging/LogStrategy";

export class BrowserConsoleStrategy extends LogStrategy {
  private static readonly LOG_COLORS = {
    [LogLevel.INFO]: "color: blue",
    [LogLevel.WARN]: "color: orange",
    [LogLevel.ERROR]: "color: red",
    [LogLevel.DEBUG]: "color: green",
  };

  constructor(maxStringLength = 5000, maxDepth = 10) {
    super();
    this.MAX_STRING_LENGTH = maxStringLength;
    this.MAX_DEPTH = maxDepth;
  }

  private isLogMessage(body: any): body is LogMessage {
    return (
      typeof body === "object" &&
      body !== null &&
      "timestamp" in body &&
      "level" in body &&
      "message" in body
    );
  }

  protected async sendPackaged(
    packagedMessage: IRequest<any>,
    options?: Record<string, any>
  ): Promise<void> {
    const { header, body } = packagedMessage;
    const logLevel = (options?.logLevel as LogLevel) || LogLevel.INFO;

    if (this.isLogMessage(body)) {
      this.formatLogMessage(body, header.requestId);
    } else {
      this.formatGenericMessage(
        body,
        logLevel,
        header.timestamp,
        header.requestId
      );
    }
  }

  private formatLogMessage(logMessage: LogMessage, requestId: string): void {
    const { sender, timestamp, level, message, payload } = logMessage;
    const logLevel = (parseInt(level) as LogLevel) || LogLevel.INFO;
    const color = BrowserConsoleStrategy.LOG_COLORS[logLevel];

    console.groupCollapsed(
      `%c[${logLevel}] ${new Date(timestamp).toISOString()}`,
      color
    );

    if (sender) {
      console.log(`Sender: ${sender}`);
    }
    console.log(`Message: ${message}`);
    console.log(`RequestID: ${requestId}`);

    if (payload) {
      console.log("Payload:", payload);
    }

    console.groupEnd();
  }

  private formatGenericMessage(
    message: any,
    logLevel: LogLevel,
    timestamp: number,
    requestId: string
  ): void {
    const color = BrowserConsoleStrategy.LOG_COLORS[logLevel];

    console.groupCollapsed(
      `%c[${logLevel}] ${new Date(timestamp).toISOString()}`,
      color
    );

    console.log(`RequestID: ${requestId}`);

    if (typeof message === "object" && message !== null) {
      console.log("Message:", message);
    } else {
      console.log(`Message: ${message}`);
    }

    console.groupEnd();
  }

  async log(message: any, logLevel: LogLevel = LogLevel.INFO): Promise<void> {
    await this.send(message, { logLevel });
  }

  async info(message: any, data?: any): Promise<void> {
    await this.log({ message, data }, LogLevel.INFO);
  }

  async warn(message: any, data?: any): Promise<void> {
    await this.log({ message, data }, LogLevel.WARN);
  }

  async error(message: any, data?: any): Promise<void> {
    await this.log({ message, data }, LogLevel.ERROR);
  }

  async debug(message: any, data?: any): Promise<void> {
    await this.log({ message, data }, LogLevel.DEBUG);
  }
}
