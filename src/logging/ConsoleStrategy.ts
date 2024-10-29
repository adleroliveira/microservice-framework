import { LogStrategy } from "./LogStrategy";
import { IRequest } from "../interfaces";
import chalk from "chalk";

enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

interface LogMessage {
  sender?: string;
  timestamp: string;
  level: string;
  message: string;
  payload?: any;
}

interface LogPayload {
  [key: string]: any;
}

export class ConsoleStrategy extends LogStrategy {
  private static readonly LOG_COLORS = {
    [LogLevel.INFO]: chalk.blue,
    [LogLevel.WARN]: chalk.yellow,
    [LogLevel.ERROR]: chalk.red,
    [LogLevel.DEBUG]: chalk.green,
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

    const formattedMessage = this.isLogMessage(body)
      ? this.formatLogMessage(body, header.requestId)
      : this.formatGenericMessage(
          body,
          logLevel,
          header.timestamp,
          header.requestId
        );

    console.log(formattedMessage);
  }

  private formatLogMessage(logMessage: LogMessage, requestId: string): string {
    const { sender, timestamp, level, message, payload } = logMessage;
    const logLevel = level.toUpperCase() as LogLevel;
    const color = ConsoleStrategy.LOG_COLORS[logLevel] || chalk.white;

    let formattedMessage = color(
      `[${logLevel}] ${new Date(timestamp).toISOString()}` // - RequestID: ${requestId}`
    );

    if (sender) {
      formattedMessage += color(` [${sender}]`);
    }

    formattedMessage += color(` - ${message}`);

    if (payload) {
      formattedMessage += "\n" + this.formatPayload(payload, "  ");
    }

    return formattedMessage;
  }

  private formatGenericMessage(
    message: any,
    logLevel: LogLevel,
    timestamp: number,
    requestId: string
  ): string {
    const color = ConsoleStrategy.LOG_COLORS[logLevel];
    let formattedMessage = color(
      `[${logLevel}] ${new Date(
        timestamp
      ).toISOString()} - RequestID: ${requestId} - `
    );

    if (typeof message === "object" && message !== null) {
      formattedMessage += "\n" + this.formatPayload(message, "  ");
    } else {
      formattedMessage += message;
    }

    return formattedMessage;
  }

  private formatPayload(payload: any, indent: string = ""): string {
    if (typeof payload !== "object" || payload === null) {
      return `${indent}${payload}`;
    }

    return Object.entries(payload)
      .map(([key, value]) => {
        if (typeof value === "object" && value !== null) {
          return `${indent}${key}:\n${this.formatPayload(
            value,
            indent + "  "
          )}`;
        }
        return `${indent}${key}: ${value}`;
      })
      .join("\n");
  }

  async log(message: any, logLevel: LogLevel = LogLevel.INFO): Promise<void> {
    await this.send(message, { logLevel });
  }

  async info(message: any): Promise<void> {
    await this.log(message, LogLevel.INFO);
  }

  async warn(message: any): Promise<void> {
    await this.log(message, LogLevel.WARN);
  }

  async error(message: any): Promise<void> {
    await this.log(message, LogLevel.ERROR);
  }

  async debug(message: any): Promise<void> {
    await this.log(message, LogLevel.DEBUG);
  }

  public logFromRequest(request: IRequest<LogMessage>): void {
    this.sendPackaged(request);
  }
}
