import http from "http";
import url from "url";
import zlib from "zlib";
import path from "path";
import fs from "fs/promises";
import { MicroserviceFramework, IServerConfig } from "../MicroserviceFramework";
import {
  IBackEnd,
  IRequest,
  ISessionStore,
  IAuthenticationProvider,
} from "../interfaces";

export type HttpRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: any;
};

export type HttpResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
};

export interface WebServerConfig extends IServerConfig {
  port: number;
  maxBodySize?: number;
  timeout?: number;
  corsOrigin?: string;
  staticDir?: string;
  authProvider?: IAuthenticationProvider;
  sessionStore?: ISessionStore;
}

export class WebServer extends MicroserviceFramework<
  HttpRequest,
  HttpResponse
> {
  private server: http.Server;
  private port: number;
  private maxBodySize: number;
  private timeout: number;
  private corsOrigin: string;
  private staticDir: string | null;

  constructor(backend: IBackEnd, config: WebServerConfig) {
    super(backend, config);
    this.port = config.port || 8080;
    this.maxBodySize = config.maxBodySize || 1e6;
    this.timeout = config.timeout || 30000;
    this.corsOrigin = config.corsOrigin || "*";
    this.staticDir = config.staticDir || null;
    this.server = http.createServer(this.handleRequest.bind(this));
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    const parsedUrl = url.parse(req.url || "", true);

    if (this.staticDir && req.method === "GET") {
      let staticFilePath = path.join(this.staticDir, parsedUrl.pathname || "");

      // Check if the path is a directory
      try {
        const stats = await fs.stat(staticFilePath);
        if (stats.isDirectory()) {
          // If it's a directory, look for index.html
          staticFilePath = path.join(staticFilePath, "index.html");
        }
      } catch (error) {
        // If stat fails, just continue with the original path
      }

      try {
        this.info(`Trying to serve static file: ${staticFilePath}`);
        const content = await this.serveStaticFile(staticFilePath);
        if (content) {
          this.sendStaticResponse(
            res,
            200,
            content,
            this.getContentType(staticFilePath)
          );
          return;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.error(`Error serving static file: ${error}`);
          this.sendResponse(res, 500, { error: "Internal Server Error" });
          return;
        }
      }
    }

    let body = "";
    let bodySize = 0;

    req.setTimeout(this.timeout, () => {
      this.sendResponse(res, 408, { error: "Request Timeout" });
    });

    req.on("data", (chunk) => {
      bodySize += chunk.length;
      if (bodySize > this.maxBodySize) {
        this.sendResponse(res, 413, { error: "Payload Too Large" });
        req.destroy();
      } else {
        body += chunk.toString();
      }
    });

    req.on("end", async () => {
      if (req.destroyed) return;

      const httpRequest: HttpRequest = {
        method: req.method || "GET",
        path: parsedUrl.pathname || "/",
        query: parsedUrl.query as Record<string, string>,
        headers: req.headers as Record<string, string>,
        body: this.parseBody(body, req.headers["content-type"]),
      };

      try {
        const response = await this.processHttpRequest(httpRequest);
        this.sendResponse(
          res,
          response.statusCode,
          response.body,
          response.headers
        );
      } catch (error) {
        this.error(`Error processing request: ${error}`);
        this.sendResponse(res, 500, { error: "Internal Server Error" });
      }
    });

    req.on("error", (error) => {
      this.error(`Request error: ${error}`);
      this.sendResponse(res, 400, { error: "Bad Request" });
    });
  }

  private async serveStaticFile(filePath: string): Promise<Buffer | null> {
    try {
      const content = await fs.readFile(filePath);
      return content;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null; // File not found
      }
      throw error; // Other errors
    }
  }

  private sendStaticResponse(
    res: http.ServerResponse,
    statusCode: number,
    body: Buffer,
    contentType: string
  ) {
    const contentEncoding = this.negotiateContentEncoding(res);

    res.writeHead(statusCode, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": this.corsOrigin,
      "X-XSS-Protection": "1; mode=block",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      ...(contentEncoding ? { "Content-Encoding": contentEncoding } : {}),
    });

    if (contentEncoding === "gzip") {
      zlib.gzip(body, (_, result) => res.end(result));
    } else if (contentEncoding === "deflate") {
      zlib.deflate(body, (_, result) => res.end(result));
    } else {
      res.end(body);
    }
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".wav": "audio/wav",
      ".mp4": "video/mp4",
      ".woff": "application/font-woff",
      ".ttf": "application/font-ttf",
      ".eot": "application/vnd.ms-fontobject",
      ".otf": "application/font-otf",
      ".wasm": "application/wasm",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  private parseBody(body: string, contentType?: string): any {
    if (contentType?.includes("application/json")) {
      try {
        return JSON.parse(body);
      } catch (error) {
        this.warn(`Failed to parse JSON body: ${error}`);
      }
    }
    return body;
  }

  private sendResponse(
    res: http.ServerResponse,
    statusCode: number,
    body: any,
    headers: Record<string, string> = {}
  ) {
    const responseBody = JSON.stringify(body);
    const contentEncoding = this.negotiateContentEncoding(res);

    res.writeHead(statusCode, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": this.corsOrigin,
      "X-XSS-Protection": "1; mode=block",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
      ...headers,
      ...(contentEncoding ? { "Content-Encoding": contentEncoding } : {}),
    });

    if (contentEncoding === "gzip") {
      zlib.gzip(responseBody, (_, result) => res.end(result));
    } else if (contentEncoding === "deflate") {
      zlib.deflate(responseBody, (_, result) => res.end(result));
    } else {
      res.end(responseBody);
    }
  }

  private negotiateContentEncoding(res: http.ServerResponse): string | null {
    const acceptEncoding = (res.getHeader("accept-encoding") as string) || "";
    if (acceptEncoding.includes("gzip")) return "gzip";
    if (acceptEncoding.includes("deflate")) return "deflate";
    return null;
  }

  private async processHttpRequest(
    httpRequest: HttpRequest
  ): Promise<HttpResponse> {
    const requestType = `${httpRequest.method}:${httpRequest.path}`;
    this.info(`Received request: ${requestType}`);
    const response = await this.makeRequest<HttpResponse>({
      to: this.serviceId,
      requestType,
      body: httpRequest,
    });
    return response.body.data;
  }

  protected async startDependencies(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        this.info(`Web server listening on port ${this.port}`);
        resolve();
      });
    });
  }

  protected async stopDependencies(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.info("Web server stopped");
        resolve();
      });
    });
  }

  protected async defaultMessageHandler(
    request: IRequest<HttpRequest>
  ): Promise<HttpResponse> {
    this.warn(`Path not found: ${request.header.requestType}`);
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json" },
      body: { message: "Path not found" },
    };
  }

  // @RequestHandler<HttpRequest>("GET:/")
  // protected async handleRoot(request: HttpRequest): Promise<HttpResponse> {
  //   return {
  //     statusCode: 200,
  //     headers: { "Content-Type": "application/json" },
  //     body: { message: "Welcome to the Web Server!" },
  //   };
  // }
}
