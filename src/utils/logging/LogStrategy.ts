import { IRequest, IRequestHeader } from "../../interfaces";
import { v4 as uuidv4 } from "uuid";

export abstract class LogStrategy {
  protected MAX_STRING_LENGTH?: number;
  protected MAX_DEPTH?: number;
  protected abstract sendPackaged(
    packagedMessage: IRequest<any>,
    options?: Record<string, any>
  ): Promise<void>;

  constructor() {}

  async send(message: any, options?: Record<string, any>): Promise<void> {
    const truncatedMessage = LogStrategy.truncateAndStringify(
      message,
      0,
      this.MAX_STRING_LENGTH,
      this.MAX_DEPTH
    );

    const packagedMessage: IRequest<any> = {
      header: this.createRequestHeader(),
      body: truncatedMessage,
    };

    await this.sendPackaged(packagedMessage, options);
  }

  protected createRequestHeader(): IRequestHeader {
    return {
      timestamp: Date.now(),
      requestId: uuidv4(),
      requesterAddress: "log-strategy",
      requestType: "LOG::MESSAGE",
    };
  }

  static truncateAndStringify(
    value: any,
    depth: number = 0,
    maxStringLength = 5000,
    maxDepth = 10
  ): any {
    if (depth > maxDepth) {
      return "[Object depth limit exceeded]";
    }

    if (value === undefined || value === null) {
      return value;
    }

    if (typeof value === "string") {
      return value.length > maxStringLength
        ? value.substring(0, maxStringLength) + "..."
        : value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.truncateAndStringify(value.message),
        stack: this.truncateAndStringify(value.stack),
      };
    }

    if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
      return `[Binary data of length ${value.byteLength}]`;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.truncateAndStringify(item, depth + 1));
    }

    if (typeof value === "object") {
      const truncatedObject: { [key: string]: any } = {};
      for (const [key, prop] of Object.entries(value)) {
        truncatedObject[key] = this.truncateAndStringify(prop, depth + 1);
      }
      return truncatedObject;
    }

    return "[Unserializable data]";
  }
}
