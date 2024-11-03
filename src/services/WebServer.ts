import http from "http";
import url from "url";
import zlib from "zlib";
import path from "path";
import fs from "fs/promises";
import net from "net";
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
  body?: any;
  rawRequest?: http.IncomingMessage;
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
  apiPrefix?: string;
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
  private apiPrefix: string;

  constructor(backend: IBackEnd, config: WebServerConfig) {
    super(backend, config);
    this.port = config.port || 8080;
    this.maxBodySize = config.maxBodySize || 1e6;
    this.timeout = config.timeout || 30000;
    this.corsOrigin = config.corsOrigin || "*";
    this.staticDir = config.staticDir || null;
    this.apiPrefix = config.apiPrefix || "/api";
    this.server = http.createServer(this.handleRequest.bind(this));

    this.server.keepAliveTimeout = 1000; // 1 second
    this.server.headersTimeout = 2000; // 2 seconds
    this.server.timeout = this.timeout;

    this.server.on("error", (error) => {
      this.error(`Server error: ${error}`);
    });

    this.server.on(
      "clientError",
      (error: Error & { code?: string }, socket: net.Socket) => {
        this.error(`Client error: ${error}`);
        if (error.code === "ECONNRESET" || !socket.writable) {
          return;
        }
        socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      }
    );

    this.server.on("close", () => {
      this.debug("Server is shutting down");
    });

    // Handle connection events
    this.server.on("connection", (socket) => {
      // Configure socket settings
      socket.setKeepAlive(false);
      socket.setNoDelay(true);
      socket.setTimeout(this.timeout);

      socket.on("timeout", () => {
        this.debug("Socket timeout, destroying connection");
        if (!socket.destroyed) {
          socket.destroy();
        }
      });

      socket.on("error", (error) => {
        this.error(`Socket error: ${error}`);
        if (!socket.destroyed) {
          socket.destroy();
        }
      });
    });
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
    const pathname = parsedUrl.pathname || "/";

    if (pathname.startsWith(this.apiPrefix)) {
      await this.handleApiRequest(req, res, parsedUrl);
      return;
    }

    if (this.staticDir && req.method === "GET") {
      const handled = await this.handleStaticRequest(req, res, pathname);
      if (handled) return;
    }
  }

  private async handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    parsedUrl: url.UrlWithParsedQuery
  ) {
    const apiPath = parsedUrl.pathname?.substring(this.apiPrefix.length) || "/";

    const contentType = req.headers["content-type"] || "";
    if (contentType.includes("multipart/form-data")) {
      const httpRequest: HttpRequest = {
        method: req.method || "GET",
        path: apiPath,
        query: parsedUrl.query as Record<string, string>,
        headers: req.headers as Record<string, string>,
        // Pass the raw request stream instead of body
        rawRequest: req,
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
      return;
    }

    const chunks: Buffer[] = [];
    let bodySize = 0;

    res.setTimeout(this.timeout, () => {
      this.error(`Request timeout for ${req.url}`);
      if (this.isConnectionAlive(req)) {
        this.sendResponse(res, 408, { error: "Request Timeout" });
        this.destroyConnection(req);
      }
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
        parsedBody = rawBody;
      } else {
        parsedBody = this.parseBody(rawBody.toString(), contentType);
      }

      // Remove API prefix from path for routing
      const apiPath =
        parsedUrl.pathname?.substring(this.apiPrefix.length) || "/";

      const httpRequest: HttpRequest = {
        method: req.method || "GET",
        path: apiPath,
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

  private async handleStaticRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string
  ): Promise<boolean> {
    if (!this.staticDir) return false;

    let staticFilePath = path.join(this.staticDir, pathname);

    // Normalize the path to prevent directory traversal
    staticFilePath = path.normalize(staticFilePath);
    if (!staticFilePath.startsWith(this.staticDir)) {
      this.sendResponse(res, 403, { error: "Forbidden" });
      return true;
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
        return true;
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
            return true;
          }
        } catch (indexError) {
          return false;
        }
      }
    }

    return false;
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
      // Set Connection header to close explicitly
      res.setHeader("Connection", "close");

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
        Connection: "close", // Add explicitly in headers too
        "Keep-Alive": "timeout=1, max=1", // Limit keep-alive
      };

      if (contentEncoding) {
        headers["Content-Encoding"] = contentEncoding;
        headers["Vary"] = "Accept-Encoding"; // Good practice with compression
      }

      if (
        contentType.includes("javascript") &&
        content.includes('type="module"')
      ) {
        headers["Content-Type"] = "application/javascript; charset=utf-8";
      }

      // Set a timeout for the response
      const TIMEOUT = 30000; // 30 seconds
      res.setTimeout(TIMEOUT, () => {
        if (!res.headersSent) {
          res.setHeader("Connection", "close");
          res.writeHead(504, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Response timeout" }));
        }
        if (req.socket && !req.socket.destroyed) {
          req.socket.destroy();
        }
      });

      res.writeHead(statusCode, headers);
      res.end(compressedContent);

      // Clean up after sending
      if (req.socket && !req.socket.destroyed) {
        req.socket.setTimeout(1000); // 1 second timeout after response
        req.socket.unref(); // Allow the process to exit if this is the only connection
      }
    } catch (error) {
      this.error(`Error sending static response: ${error}`);
      if (!res.headersSent) {
        res.setHeader("Connection", "close");
        res.writeHead(500, {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": this.corsOrigin,
          Connection: "close",
        });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      }

      // Ensure connection is cleaned up on error
      if (req.socket && !req.socket.destroyed) {
        req.socket.destroy();
      }
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

  public async shutdown(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.debug("Server has been shut down");
        resolve();
      });

      // Force close after timeout
      setTimeout(() => {
        this.error("Force closing remaining connections");
        resolve();
      }, 10000); // 10 second force shutdown timeout
    });
  }

  private isConnectionAlive(req: http.IncomingMessage): boolean {
    return !!(req.socket && !req.socket.destroyed && req.socket.writable);
  }

  private destroyConnection(req: http.IncomingMessage): void {
    if (req.socket && !req.socket.destroyed) {
      req.socket.destroy();
    }
  }

  protected async stopDependencies(): Promise<void> {
    return new Promise(async (resolve) => {
      await this.shutdown();
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
