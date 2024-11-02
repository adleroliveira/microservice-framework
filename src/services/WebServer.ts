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
    if (req.method === "OPTIONS") {
      res.writeHead(200, {
        "Access-Control-Allow-Origin": this.corsOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    const parsedUrl = url.parse(req.url || "", true);

    if (this.staticDir && req.method === "GET") {
      let staticFilePath = path.join(this.staticDir, parsedUrl.pathname || "");

      // Normalize the path to prevent directory traversal
      staticFilePath = path.normalize(staticFilePath);
      if (!staticFilePath.startsWith(this.staticDir)) {
        this.sendResponse(res, 403, { error: "Forbidden" });
        return;
      }

      try {
        const stats = await fs.stat(staticFilePath);
        if (stats.isDirectory()) {
          staticFilePath = path.join(staticFilePath, "index.html");
        }

        const content = await this.serveStaticFile(staticFilePath);
        if (content) {
          await this.sendStaticResponse(
            req,
            res,
            200,
            content,
            this.getContentType(staticFilePath)
          );
          return;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          // Try fallback to index.html for SPA routing
          try {
            const indexPath = path.join(this.staticDir, "index.html");
            const content = await this.serveStaticFile(indexPath);
            if (content) {
              await this.sendStaticResponse(
                req,
                res,
                200,
                content,
                "text/html; charset=utf-8"
              );
              return;
            }
          } catch (indexError) {
            this.sendResponse(res, 404, { error: "Not Found" });
            return;
          }
        } else {
          this.error(`Error serving static file: ${error}`);
          this.sendResponse(res, 500, { error: "Internal Server Error" });
          return;
        }
      }
    }

    const chunks: Buffer[] = [];
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
        chunks.push(Buffer.from(chunk));
      }
    });

    req.on("end", async () => {
      if (req.destroyed) return;

      const rawBody = Buffer.concat(chunks);
      const contentType = req.headers["content-type"] || "";

      let parsedBody;
      if (contentType.includes("multipart/form-data")) {
        parsedBody = rawBody; // Keep as Buffer for multipart/form-data
      } else {
        parsedBody = this.parseBody(rawBody.toString(), contentType);
      }

      const httpRequest: HttpRequest = {
        method: req.method || "GET",
        path: parsedUrl.pathname || "/",
        query: parsedUrl.query as Record<string, string>,
        headers: req.headers as Record<string, string>,
        body: parsedBody,
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

  private async sendStaticResponse(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    statusCode: number,
    content: Buffer,
    contentType: string
  ) {
    try {
      const contentEncoding = this.negotiateContentEncoding(req);
      const compressedContent = contentEncoding
        ? await this.compressContent(content, contentEncoding)
        : content;

      const headers: Record<string, string> = {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": this.corsOrigin,
        "X-XSS-Protection": "1; mode=block",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": compressedContent.length.toString(),
        "Cache-Control": "no-cache",
      };

      if (contentEncoding) {
        headers["Content-Encoding"] = contentEncoding;
      }

      if (
        contentType.includes("javascript") &&
        content.includes('type="module"')
      ) {
        headers["Content-Type"] = "application/javascript; charset=utf-8";
      }

      res.writeHead(statusCode, headers);
      res.end(compressedContent);
    } catch (error) {
      this.error(`Error sending static response: ${error}`);
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": this.corsOrigin,
      });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  }

  private getContentType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".mjs": "application/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".eot": "application/vnd.ms-fontobject",
    };

    return contentTypes[ext] || "application/octet-stream";
  }

  private parseBody(body: string, contentType?: string): any {
    if (!contentType) return body;

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(body);
      } catch (error) {
        this.warn(`Failed to parse JSON body: ${error}`);
        return body;
      }
    }

    // Handle multipart/form-data
    if (contentType.includes("multipart/form-data")) {
      try {
        // For multipart/form-data, we need to parse the raw body
        // The body will be available as Buffer or string
        return body;
      } catch (error) {
        this.warn(`Failed to parse multipart/form-data: ${error}`);
        return body;
      }
    }

    return body;
  }

  private async sendResponse(
    res: http.ServerResponse,
    statusCode: number,
    body: any,
    headers: Record<string, string> = {}
  ) {
    try {
      const responseBody = JSON.stringify(body);
      const contentEncoding = this.negotiateContentEncoding(res);
      const compressedContent = contentEncoding
        ? await this.compressContent(Buffer.from(responseBody), contentEncoding)
        : responseBody;

      const finalHeaders: Record<string, string> = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": this.corsOrigin,
        "X-XSS-Protection": "1; mode=block",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": Buffer.byteLength(compressedContent).toString(),
        ...headers,
      };

      if (contentEncoding) {
        finalHeaders["Content-Encoding"] = contentEncoding;
      }

      res.writeHead(statusCode, finalHeaders);
      res.end(compressedContent);
    } catch (error) {
      this.error(`Error sending response: ${error}`);
      // Send a basic error response without compression if something goes wrong
      res.writeHead(500, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": this.corsOrigin,
      });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  }

  private negotiateContentEncoding(
    req: http.IncomingMessage | http.ServerResponse
  ): string | null {
    const acceptEncoding =
      "headers" in req
        ? req.headers["accept-encoding"]
        : (req as any)._req?.headers["accept-encoding"]; // Fallback for ServerResponse

    if (!acceptEncoding) return null;

    if (typeof acceptEncoding === "string") {
      if (acceptEncoding.includes("gzip")) return "gzip";
      if (acceptEncoding.includes("deflate")) return "deflate";
    }

    return null;
  }

  private async compressContent(
    content: Buffer | string,
    encoding: string
  ): Promise<Buffer | string> {
    if (typeof content === "string") {
      content = Buffer.from(content);
    }

    return new Promise((resolve, reject) => {
      if (encoding === "gzip") {
        zlib.gzip(content, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      } else if (encoding === "deflate") {
        zlib.deflate(content, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      } else {
        resolve(content);
      }
    });
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
}
