"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebServer = void 0;
const http_1 = __importDefault(require("http"));
const url_1 = __importDefault(require("url"));
const zlib_1 = __importDefault(require("zlib"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const MicroserviceFramework_1 = require("../MicroserviceFramework");
class WebServer extends MicroserviceFramework_1.MicroserviceFramework {
    constructor(backend, config) {
        super(backend, config);
        this.port = config.port || 8080;
        this.maxBodySize = config.maxBodySize || 1e6;
        this.timeout = config.timeout || 30000;
        this.corsOrigin = config.corsOrigin || "*";
        this.staticDir = config.staticDir || null;
        this.apiPrefix = config.apiPrefix || "/api";
        this.server = http_1.default.createServer(this.handleRequest.bind(this));
        this.server.keepAliveTimeout = 1000; // 1 second
        this.server.headersTimeout = 2000; // 2 seconds
        this.server.timeout = this.timeout;
        this.server.on("error", (error) => {
            this.error(`Server error: ${error}`);
        });
        this.server.on("clientError", (error, socket) => {
            this.error(`Client error: ${error}`);
            if (error.code === "ECONNRESET" || !socket.writable) {
                return;
            }
            socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
        });
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
    async handleRequest(req, res) {
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
        const parsedUrl = url_1.default.parse(req.url || "", true);
        const pathname = parsedUrl.pathname || "/";
        if (pathname.startsWith(this.apiPrefix)) {
            await this.handleApiRequest(req, res, parsedUrl);
            return;
        }
        if (this.staticDir && req.method === "GET") {
            const handled = await this.handleStaticRequest(req, res, pathname);
            if (handled)
                return;
        }
    }
    async handleApiRequest(req, res, parsedUrl) {
        const chunks = [];
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
            }
            else {
                chunks.push(Buffer.from(chunk));
            }
        });
        req.on("end", async () => {
            if (req.destroyed)
                return;
            const rawBody = Buffer.concat(chunks);
            const contentType = req.headers["content-type"] || "";
            let parsedBody;
            if (contentType.includes("multipart/form-data")) {
                parsedBody = rawBody;
            }
            else {
                parsedBody = this.parseBody(rawBody.toString(), contentType);
            }
            // Remove API prefix from path for routing
            const apiPath = parsedUrl.pathname?.substring(this.apiPrefix.length) || "/";
            const httpRequest = {
                method: req.method || "GET",
                path: apiPath,
                query: parsedUrl.query,
                headers: req.headers,
                body: parsedBody,
            };
            try {
                const response = await this.processHttpRequest(httpRequest);
                this.sendResponse(res, response.statusCode, response.body, response.headers);
            }
            catch (error) {
                this.error(`Error processing request: ${error}`);
                this.sendResponse(res, 500, { error: "Internal Server Error" });
            }
        });
        req.on("error", (error) => {
            this.error(`Request error: ${error}`);
            this.sendResponse(res, 400, { error: "Bad Request" });
        });
    }
    async handleStaticRequest(req, res, pathname) {
        if (!this.staticDir)
            return false;
        let staticFilePath = path_1.default.join(this.staticDir, pathname);
        // Normalize the path to prevent directory traversal
        staticFilePath = path_1.default.normalize(staticFilePath);
        if (!staticFilePath.startsWith(this.staticDir)) {
            this.sendResponse(res, 403, { error: "Forbidden" });
            return true;
        }
        try {
            const stats = await promises_1.default.stat(staticFilePath);
            if (stats.isDirectory()) {
                staticFilePath = path_1.default.join(staticFilePath, "index.html");
            }
            const content = await this.serveStaticFile(staticFilePath);
            if (content) {
                await this.sendStaticResponse(req, res, 200, content, this.getContentType(staticFilePath));
                return true;
            }
        }
        catch (error) {
            if (error.code === "ENOENT") {
                // Try fallback to index.html for SPA routing
                try {
                    const indexPath = path_1.default.join(this.staticDir, "index.html");
                    const content = await this.serveStaticFile(indexPath);
                    if (content) {
                        await this.sendStaticResponse(req, res, 200, content, "text/html; charset=utf-8");
                        return true;
                    }
                }
                catch (indexError) {
                    return false;
                }
            }
        }
        return false;
    }
    async serveStaticFile(filePath) {
        try {
            const content = await promises_1.default.readFile(filePath);
            return content;
        }
        catch (error) {
            if (error.code === "ENOENT") {
                return null; // File not found
            }
            throw error; // Other errors
        }
    }
    async sendStaticResponse(req, res, statusCode, content, contentType) {
        try {
            // Set Connection header to close explicitly
            res.setHeader("Connection", "close");
            const contentEncoding = this.negotiateContentEncoding(req);
            const compressedContent = contentEncoding
                ? await this.compressContent(content, contentEncoding)
                : content;
            const headers = {
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
            if (contentType.includes("javascript") &&
                content.includes('type="module"')) {
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
        }
        catch (error) {
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
    getContentType(filePath) {
        const ext = path_1.default.extname(filePath).toLowerCase();
        const contentTypes = {
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
    parseBody(body, contentType) {
        if (!contentType)
            return body;
        if (contentType.includes("application/json")) {
            try {
                return JSON.parse(body);
            }
            catch (error) {
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
            }
            catch (error) {
                this.warn(`Failed to parse multipart/form-data: ${error}`);
                return body;
            }
        }
        return body;
    }
    async sendResponse(res, statusCode, body, headers = {}) {
        try {
            const responseBody = JSON.stringify(body);
            const contentEncoding = this.negotiateContentEncoding(res);
            const compressedContent = contentEncoding
                ? await this.compressContent(Buffer.from(responseBody), contentEncoding)
                : responseBody;
            const finalHeaders = {
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
        }
        catch (error) {
            this.error(`Error sending response: ${error}`);
            // Send a basic error response without compression if something goes wrong
            res.writeHead(500, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": this.corsOrigin,
            });
            res.end(JSON.stringify({ error: "Internal Server Error" }));
        }
    }
    negotiateContentEncoding(req) {
        const acceptEncoding = "headers" in req
            ? req.headers["accept-encoding"]
            : req._req?.headers["accept-encoding"]; // Fallback for ServerResponse
        if (!acceptEncoding)
            return null;
        if (typeof acceptEncoding === "string") {
            if (acceptEncoding.includes("gzip"))
                return "gzip";
            if (acceptEncoding.includes("deflate"))
                return "deflate";
        }
        return null;
    }
    async compressContent(content, encoding) {
        if (typeof content === "string") {
            content = Buffer.from(content);
        }
        return new Promise((resolve, reject) => {
            if (encoding === "gzip") {
                zlib_1.default.gzip(content, (err, result) => {
                    if (err)
                        reject(err);
                    else
                        resolve(result);
                });
            }
            else if (encoding === "deflate") {
                zlib_1.default.deflate(content, (err, result) => {
                    if (err)
                        reject(err);
                    else
                        resolve(result);
                });
            }
            else {
                resolve(content);
            }
        });
    }
    async processHttpRequest(httpRequest) {
        const requestType = `${httpRequest.method}:${httpRequest.path}`;
        this.info(`Received request: ${requestType}`);
        const response = await this.makeRequest({
            to: this.serviceId,
            requestType,
            body: httpRequest,
        });
        return response.body.data;
    }
    async startDependencies() {
        return new Promise((resolve) => {
            this.server.listen(this.port, () => {
                this.info(`Web server listening on port ${this.port}`);
                resolve();
            });
        });
    }
    async shutdown() {
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
    isConnectionAlive(req) {
        return !!(req.socket && !req.socket.destroyed && req.socket.writable);
    }
    destroyConnection(req) {
        if (req.socket && !req.socket.destroyed) {
            req.socket.destroy();
        }
    }
    async stopDependencies() {
        return new Promise(async (resolve) => {
            await this.shutdown();
            this.server.close(() => {
                this.info("Web server stopped");
                resolve();
            });
        });
    }
    async defaultMessageHandler(request) {
        this.warn(`Path not found: ${request.header.requestType}`);
        return {
            statusCode: 404,
            headers: { "Content-Type": "application/json" },
            body: { message: "Path not found" },
        };
    }
}
exports.WebServer = WebServer;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxnREFBd0I7QUFDeEIsOENBQXNCO0FBQ3RCLGdEQUF3QjtBQUN4QixnREFBd0I7QUFDeEIsMkRBQTZCO0FBRTdCLG9FQUFnRjtBQWlDaEYsTUFBYSxTQUFVLFNBQVEsNkNBRzlCO0lBU0MsWUFBWSxPQUFpQixFQUFFLE1BQXVCO1FBQ3BELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDdkIsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQztRQUNoQyxJQUFJLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLElBQUksR0FBRyxDQUFDO1FBQzdDLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUM7UUFDdkMsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQztRQUMzQyxJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDO1FBQzFDLElBQUksQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFNBQVMsSUFBSSxNQUFNLENBQUM7UUFDNUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxjQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFFL0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsQ0FBQyxXQUFXO1FBQ2hELElBQUksQ0FBQyxNQUFNLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxDQUFDLFlBQVk7UUFDL0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8s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Q0FBQyxHQUF5QjtRQUNqRCxJQUFJLEdBQUcsQ0FBQyxNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ3hDLEdBQUcsQ0FBQyxNQUFNLENBQUMsT0FBTyxFQUFFLENBQUM7UUFDdkIsQ0FBQztJQUNILENBQUM7SUFFUyxLQUFLLENBQUMsZ0JBQWdCO1FBQzlCLE9BQU8sSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFLE9BQU8sRUFBRSxFQUFFO1lBQ25DLE1BQU0sSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1lBQ3RCLElBQUksQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFDLEdBQUcsRUFBRTtnQkFDckIsSUFBSSxDQUFDLElBQUksQ0FBQyxvQkFBb0IsQ0FBQyxDQUFDO2dCQUNoQyxPQUFPLEVBQUUsQ0FBQztZQUNaLENBQUMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRVMsS0FBSyxDQUFDLHFCQUFxQixDQUNuQyxPQUE4QjtRQUU5QixJQUFJLENBQUMsSUFBSSxDQUFDLG1CQUFtQixPQUFPLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUFDLENBQUM7UUFDM0QsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFO1lBQy9DLElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRTtTQUNwQyxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBdGdCRCw4QkFzZ0JDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGh0dHAgZnJvbSBcImh0dHBcIjtcbmltcG9ydCB1cmwgZnJvbSBcInVybFwiO1xuaW1wb3J0IHpsaWIgZnJvbSBcInpsaWJcIjtcbmltcG9ydCBwYXRoIGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgZnMgZnJvbSBcImZzL3Byb21pc2VzXCI7XG5pbXBvcnQgbmV0IGZyb20gXCJuZXRcIjtcbmltcG9ydCB7IE1pY3Jvc2VydmljZUZyYW1ld29yaywgSVNlcnZlckNvbmZpZyB9IGZyb20gXCIuLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7XG4gIElCYWNrRW5kLFxuICBJUmVxdWVzdCxcbiAgSVNlc3Npb25TdG9yZSxcbiAgSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cbmV4cG9ydCB0eXBlIEh0dHBSZXF1ZXN0ID0ge1xuICBtZXRob2Q6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBxdWVyeTogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgYm9keTogYW55O1xufTtcblxuZXhwb3J0IHR5cGUgSHR0cFJlc3BvbnNlID0ge1xuICBzdGF0dXNDb2RlOiBudW1iZXI7XG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGJvZHk6IGFueTtcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU2VydmVyQ29uZmlnIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIHBvcnQ6IG51bWJlcjtcbiAgbWF4Qm9keVNpemU/OiBudW1iZXI7XG4gIHRpbWVvdXQ/OiBudW1iZXI7XG4gIGNvcnNPcmlnaW4/OiBzdHJpbmc7XG4gIHN0YXRpY0Rpcj86IHN0cmluZztcbiAgYXBpUHJlZml4Pzogc3RyaW5nO1xuICBhdXRoUHJvdmlkZXI/OiBJQXV0aGVudGljYXRpb25Qcm92aWRlcjtcbiAgc2Vzc2lvblN0b3JlPzogSVNlc3Npb25TdG9yZTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgSHR0cFJlcXVlc3QsXG4gIEh0dHBSZXNwb25zZVxuPiB7XG4gIHByaXZhdGUgc2VydmVyOiBodHRwLlNlcnZlcjtcbiAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gIHByaXZhdGUgbWF4Qm9keVNpemU6IG51bWJlcjtcbiAgcHJpdmF0ZSB0aW1lb3V0OiBudW1iZXI7XG4gIHByaXZhdGUgY29yc09yaWdpbjogc3RyaW5nO1xuICBwcml2YXRlIHN0YXRpY0Rpcjogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBhcGlQcmVmaXg6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0IHx8IDgwODA7XG4gICAgdGhpcy5tYXhCb2R5U2l6ZSA9IGNvbmZpZy5tYXhCb2R5U2l6ZSB8fCAxZTY7XG4gICAgdGhpcy50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQgfHwgMzAwMDA7XG4gICAgdGhpcy5jb3JzT3JpZ2luID0gY29uZmlnLmNvcnNPcmlnaW4gfHwgXCIqXCI7XG4gICAgdGhpcy5zdGF0aWNEaXIgPSBjb25maWcuc3RhdGljRGlyIHx8IG51bGw7XG4gICAgdGhpcy5hcGlQcmVmaXggPSBjb25maWcuYXBpUHJlZml4IHx8IFwiL2FwaVwiO1xuICAgIHRoaXMuc2VydmVyID0gaHR0cC5jcmVhdGVTZXJ2ZXIodGhpcy5oYW5kbGVSZXF1ZXN0LmJpbmQodGhpcykpO1xuXG4gICAgdGhpcy5zZXJ2ZXIua2VlcEFsaXZlVGltZW91dCA9IDEwMDA7IC8vIDEgc2Vjb25kXG4gICAgdGhpcy5zZXJ2ZXIuaGVhZGVyc1RpbWVvdXQgPSAyMDAwOyAvLyAyIHNlY29uZHNcbiAgICB0aGlzLnNlcnZlci50aW1lb3V0ID0gdGhpcy50aW1lb3V0O1xuXG4gICAgdGhpcy5zZXJ2ZXIub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIHRoaXMuZXJyb3IoYFNlcnZlciBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc2VydmVyLm9uKFxuICAgICAgXCJjbGllbnRFcnJvclwiLFxuICAgICAgKGVycm9yOiBFcnJvciAmIHsgY29kZT86IHN0cmluZyB9LCBzb2NrZXQ6IG5ldC5Tb2NrZXQpID0+IHtcbiAgICAgICAgdGhpcy5lcnJvcihgQ2xpZW50IGVycm9yOiAke2Vycm9yfWApO1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gXCJFQ09OTlJFU0VUXCIgfHwgIXNvY2tldC53cml0YWJsZSkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBzb2NrZXQuZW5kKFwiSFRUUC8xLjEgNDAwIEJhZCBSZXF1ZXN0XFxyXFxuXFxyXFxuXCIpO1xuICAgICAgfVxuICAgICk7XG5cbiAgICB0aGlzLnNlcnZlci5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIHRoaXMuZGVidWcoXCJTZXJ2ZXIgaXMgc2h1dHRpbmcgZG93blwiKTtcbiAgICB9KTtcblxuICAgIC8vIEhhbmRsZSBjb25uZWN0aW9uIGV2ZW50c1xuICAgIHRoaXMuc2VydmVyLm9uKFwiY29ubmVjdGlvblwiLCAoc29ja2V0KSA9PiB7XG4gICAgICAvLyBDb25maWd1cmUgc29ja2V0IHNldHRpbmdzXG4gICAgICBzb2NrZXQuc2V0S2VlcEFsaXZlKGZhbHNlKTtcbiAgICAgIHNvY2tldC5zZXROb0RlbGF5KHRydWUpO1xuICAgICAgc29ja2V0LnNldFRpbWVvdXQodGhpcy50aW1lb3V0KTtcblxuICAgICAgc29ja2V0Lm9uKFwidGltZW91dFwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMuZGVidWcoXCJTb2NrZXQgdGltZW91dCwgZGVzdHJveWluZyBjb25uZWN0aW9uXCIpO1xuICAgICAgICBpZiAoIXNvY2tldC5kZXN0cm95ZWQpIHtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgc29ja2V0Lm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICAgIHRoaXMuZXJyb3IoYFNvY2tldCBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICAgICAgaWYgKCFzb2NrZXQuZGVzdHJveWVkKSB7XG4gICAgICAgICAgc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZVJlcXVlc3QoXG4gICAgcmVxOiBodHRwLkluY29taW5nTWVzc2FnZSxcbiAgICByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2VcbiAgKSB7XG4gICAgaWYgKHJlcS5tZXRob2QgPT09IFwiT1BUSU9OU1wiKSB7XG4gICAgICByZXMud3JpdGVIZWFkKDIwMCwge1xuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiOiB0aGlzLmNvcnNPcmlnaW4sXG4gICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kc1wiOiBcIkdFVCwgUE9TVCwgUFVULCBERUxFVEUsIE9QVElPTlNcIixcbiAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzXCI6IFwiQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uXCIsXG4gICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtTWF4LUFnZVwiOiBcIjg2NDAwXCIsXG4gICAgICB9KTtcbiAgICAgIHJlcy5lbmQoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBwYXJzZWRVcmwgPSB1cmwucGFyc2UocmVxLnVybCB8fCBcIlwiLCB0cnVlKTtcbiAgICBjb25zdCBwYXRobmFtZSA9IHBhcnNlZFVybC5wYXRobmFtZSB8fCBcIi9cIjtcblxuICAgIGlmIChwYXRobmFtZS5zdGFydHNXaXRoKHRoaXMuYXBpUHJlZml4KSkge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVBcGlSZXF1ZXN0KHJlcSwgcmVzLCBwYXJzZWRVcmwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnN0YXRpY0RpciAmJiByZXEubWV0aG9kID09PSBcIkdFVFwiKSB7XG4gICAgICBjb25zdCBoYW5kbGVkID0gYXdhaXQgdGhpcy5oYW5kbGVTdGF0aWNSZXF1ZXN0KHJlcSwgcmVzLCBwYXRobmFtZSk7XG4gICAgICBpZiAoaGFuZGxlZCkgcmV0dXJuO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQXBpUmVxdWVzdChcbiAgICByZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLFxuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSxcbiAgICBwYXJzZWRVcmw6IHVybC5VcmxXaXRoUGFyc2VkUXVlcnlcbiAgKSB7XG4gICAgY29uc3QgY2h1bmtzOiBCdWZmZXJbXSA9IFtdO1xuICAgIGxldCBib2R5U2l6ZSA9IDA7XG5cbiAgICByZXMuc2V0VGltZW91dCh0aGlzLnRpbWVvdXQsICgpID0+IHtcbiAgICAgIHRoaXMuZXJyb3IoYFJlcXVlc3QgdGltZW91dCBmb3IgJHtyZXEudXJsfWApO1xuICAgICAgaWYgKHRoaXMuaXNDb25uZWN0aW9uQWxpdmUocmVxKSkge1xuICAgICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDQwOCwgeyBlcnJvcjogXCJSZXF1ZXN0IFRpbWVvdXRcIiB9KTtcbiAgICAgICAgdGhpcy5kZXN0cm95Q29ubmVjdGlvbihyZXEpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVxLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgIGJvZHlTaXplICs9IGNodW5rLmxlbmd0aDtcbiAgICAgIGlmIChib2R5U2l6ZSA+IHRoaXMubWF4Qm9keVNpemUpIHtcbiAgICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA0MTMsIHsgZXJyb3I6IFwiUGF5bG9hZCBUb28gTGFyZ2VcIiB9KTtcbiAgICAgICAgcmVxLmRlc3Ryb3koKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNodW5rcy5wdXNoKEJ1ZmZlci5mcm9tKGNodW5rKSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXEub24oXCJlbmRcIiwgYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHJlcS5kZXN0cm95ZWQpIHJldHVybjtcblxuICAgICAgY29uc3QgcmF3Qm9keSA9IEJ1ZmZlci5jb25jYXQoY2h1bmtzKTtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVxLmhlYWRlcnNbXCJjb250ZW50LXR5cGVcIl0gfHwgXCJcIjtcblxuICAgICAgbGV0IHBhcnNlZEJvZHk7XG4gICAgICBpZiAoY29udGVudFR5cGUuaW5jbHVkZXMoXCJtdWx0aXBhcnQvZm9ybS1kYXRhXCIpKSB7XG4gICAgICAgIHBhcnNlZEJvZHkgPSByYXdCb2R5O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcGFyc2VkQm9keSA9IHRoaXMucGFyc2VCb2R5KHJhd0JvZHkudG9TdHJpbmcoKSwgY29udGVudFR5cGUpO1xuICAgICAgfVxuXG4gICAgICAvLyBSZW1vdmUgQVBJIHByZWZpeCBmcm9tIHBhdGggZm9yIHJvdXRpbmdcbiAgICAgIGNvbnN0IGFwaVBhdGggPVxuICAgICAgICBwYXJzZWRVcmwucGF0aG5hbWU/LnN1YnN0cmluZyh0aGlzLmFwaVByZWZpeC5sZW5ndGgpIHx8IFwiL1wiO1xuXG4gICAgICBjb25zdCBodHRwUmVxdWVzdDogSHR0cFJlcXVlc3QgPSB7XG4gICAgICAgIG1ldGhvZDogcmVxLm1ldGhvZCB8fCBcIkdFVFwiLFxuICAgICAgICBwYXRoOiBhcGlQYXRoLFxuICAgICAgICBxdWVyeTogcGFyc2VkVXJsLnF1ZXJ5IGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIGhlYWRlcnM6IHJlcS5oZWFkZXJzIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIGJvZHk6IHBhcnNlZEJvZHksXG4gICAgICB9O1xuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMucHJvY2Vzc0h0dHBSZXF1ZXN0KGh0dHBSZXF1ZXN0KTtcbiAgICAgICAgdGhpcy5zZW5kUmVzcG9uc2UoXG4gICAgICAgICAgcmVzLFxuICAgICAgICAgIHJlc3BvbnNlLnN0YXR1c0NvZGUsXG4gICAgICAgICAgcmVzcG9uc2UuYm9keSxcbiAgICAgICAgICByZXNwb25zZS5oZWFkZXJzXG4gICAgICAgICk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmVycm9yKGBFcnJvciBwcm9jZXNzaW5nIHJlcXVlc3Q6ICR7ZXJyb3J9YCk7XG4gICAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNTAwLCB7IGVycm9yOiBcIkludGVybmFsIFNlcnZlciBFcnJvclwiIH0pO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVxLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XG4gICAgICB0aGlzLmVycm9yKGBSZXF1ZXN0IGVycm9yOiAke2Vycm9yfWApO1xuICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA0MDAsIHsgZXJyb3I6IFwiQmFkIFJlcXVlc3RcIiB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlU3RhdGljUmVxdWVzdChcbiAgICByZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLFxuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSxcbiAgICBwYXRobmFtZTogc3RyaW5nXG4gICk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghdGhpcy5zdGF0aWNEaXIpIHJldHVybiBmYWxzZTtcblxuICAgIGxldCBzdGF0aWNGaWxlUGF0aCA9IHBhdGguam9pbih0aGlzLnN0YXRpY0RpciwgcGF0aG5hbWUpO1xuXG4gICAgLy8gTm9ybWFsaXplIHRoZSBwYXRoIHRvIHByZXZlbnQgZGlyZWN0b3J5IHRyYXZlcnNhbFxuICAgIHN0YXRpY0ZpbGVQYXRoID0gcGF0aC5ub3JtYWxpemUoc3RhdGljRmlsZVBhdGgpO1xuICAgIGlmICghc3RhdGljRmlsZVBhdGguc3RhcnRzV2l0aCh0aGlzLnN0YXRpY0RpcikpIHtcbiAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDAzLCB7IGVycm9yOiBcIkZvcmJpZGRlblwiIH0pO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChzdGF0aWNGaWxlUGF0aCk7XG4gICAgICBpZiAoc3RhdHMuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICBzdGF0aWNGaWxlUGF0aCA9IHBhdGguam9pbihzdGF0aWNGaWxlUGF0aCwgXCJpbmRleC5odG1sXCIpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5zZXJ2ZVN0YXRpY0ZpbGUoc3RhdGljRmlsZVBhdGgpO1xuICAgICAgaWYgKGNvbnRlbnQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kU3RhdGljUmVzcG9uc2UoXG4gICAgICAgICAgcmVxLFxuICAgICAgICAgIHJlcyxcbiAgICAgICAgICAyMDAsXG4gICAgICAgICAgY29udGVudCxcbiAgICAgICAgICB0aGlzLmdldENvbnRlbnRUeXBlKHN0YXRpY0ZpbGVQYXRoKVxuICAgICAgICApO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgLy8gVHJ5IGZhbGxiYWNrIHRvIGluZGV4Lmh0bWwgZm9yIFNQQSByb3V0aW5nXG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgaW5kZXhQYXRoID0gcGF0aC5qb2luKHRoaXMuc3RhdGljRGlyLCBcImluZGV4Lmh0bWxcIik7XG4gICAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuc2VydmVTdGF0aWNGaWxlKGluZGV4UGF0aCk7XG4gICAgICAgICAgaWYgKGNvbnRlbnQpIHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuc2VuZFN0YXRpY1Jlc3BvbnNlKFxuICAgICAgICAgICAgICByZXEsXG4gICAgICAgICAgICAgIHJlcyxcbiAgICAgICAgICAgICAgMjAwLFxuICAgICAgICAgICAgICBjb250ZW50LFxuICAgICAgICAgICAgICBcInRleHQvaHRtbDsgY2hhcnNldD11dGYtOFwiXG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChpbmRleEVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZXJ2ZVN0YXRpY0ZpbGUoZmlsZVBhdGg6IHN0cmluZyk6IFByb21pc2U8QnVmZmVyIHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgZnMucmVhZEZpbGUoZmlsZVBhdGgpO1xuICAgICAgcmV0dXJuIGNvbnRlbnQ7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICgoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgICAgIHJldHVybiBudWxsOyAvLyBGaWxlIG5vdCBmb3VuZFxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyb3I7IC8vIE90aGVyIGVycm9yc1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VuZFN0YXRpY1Jlc3BvbnNlKFxuICAgIHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHN0YXR1c0NvZGU6IG51bWJlcixcbiAgICBjb250ZW50OiBCdWZmZXIsXG4gICAgY29udGVudFR5cGU6IHN0cmluZ1xuICApIHtcbiAgICB0cnkge1xuICAgICAgLy8gU2V0IENvbm5lY3Rpb24gaGVhZGVyIHRvIGNsb3NlIGV4cGxpY2l0bHlcbiAgICAgIHJlcy5zZXRIZWFkZXIoXCJDb25uZWN0aW9uXCIsIFwiY2xvc2VcIik7XG5cbiAgICAgIGNvbnN0IGNvbnRlbnRFbmNvZGluZyA9IHRoaXMubmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcSk7XG4gICAgICBjb25zdCBjb21wcmVzc2VkQ29udGVudCA9IGNvbnRlbnRFbmNvZGluZ1xuICAgICAgICA/IGF3YWl0IHRoaXMuY29tcHJlc3NDb250ZW50KGNvbnRlbnQsIGNvbnRlbnRFbmNvZGluZylcbiAgICAgICAgOiBjb250ZW50O1xuXG4gICAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBjb250ZW50VHlwZSxcbiAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIjogdGhpcy5jb3JzT3JpZ2luLFxuICAgICAgICBcIlgtWFNTLVByb3RlY3Rpb25cIjogXCIxOyBtb2RlPWJsb2NrXCIsXG4gICAgICAgIFwiWC1GcmFtZS1PcHRpb25zXCI6IFwiREVOWVwiLFxuICAgICAgICBcIlgtQ29udGVudC1UeXBlLU9wdGlvbnNcIjogXCJub3NuaWZmXCIsXG4gICAgICAgIFwiQ29udGVudC1MZW5ndGhcIjogY29tcHJlc3NlZENvbnRlbnQubGVuZ3RoLnRvU3RyaW5nKCksXG4gICAgICAgIFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIsXG4gICAgICAgIENvbm5lY3Rpb246IFwiY2xvc2VcIiwgLy8gQWRkIGV4cGxpY2l0bHkgaW4gaGVhZGVycyB0b29cbiAgICAgICAgXCJLZWVwLUFsaXZlXCI6IFwidGltZW91dD0xLCBtYXg9MVwiLCAvLyBMaW1pdCBrZWVwLWFsaXZlXG4gICAgICB9O1xuXG4gICAgICBpZiAoY29udGVudEVuY29kaW5nKSB7XG4gICAgICAgIGhlYWRlcnNbXCJDb250ZW50LUVuY29kaW5nXCJdID0gY29udGVudEVuY29kaW5nO1xuICAgICAgICBoZWFkZXJzW1wiVmFyeVwiXSA9IFwiQWNjZXB0LUVuY29kaW5nXCI7IC8vIEdvb2QgcHJhY3RpY2Ugd2l0aCBjb21wcmVzc2lvblxuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwiamF2YXNjcmlwdFwiKSAmJlxuICAgICAgICBjb250ZW50LmluY2x1ZGVzKCd0eXBlPVwibW9kdWxlXCInKVxuICAgICAgKSB7XG4gICAgICAgIGhlYWRlcnNbXCJDb250ZW50LVR5cGVcIl0gPSBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRmLThcIjtcbiAgICAgIH1cblxuICAgICAgLy8gU2V0IGEgdGltZW91dCBmb3IgdGhlIHJlc3BvbnNlXG4gICAgICBjb25zdCBUSU1FT1VUID0gMzAwMDA7IC8vIDMwIHNlY29uZHNcbiAgICAgIHJlcy5zZXRUaW1lb3V0KFRJTUVPVVQsICgpID0+IHtcbiAgICAgICAgaWYgKCFyZXMuaGVhZGVyc1NlbnQpIHtcbiAgICAgICAgICByZXMuc2V0SGVhZGVyKFwiQ29ubmVjdGlvblwiLCBcImNsb3NlXCIpO1xuICAgICAgICAgIHJlcy53cml0ZUhlYWQoNTA0LCB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0pO1xuICAgICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJSZXNwb25zZSB0aW1lb3V0XCIgfSkpO1xuICAgICAgICB9XG4gICAgICAgIGlmIChyZXEuc29ja2V0ICYmICFyZXEuc29ja2V0LmRlc3Ryb3llZCkge1xuICAgICAgICAgIHJlcS5zb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgcmVzLndyaXRlSGVhZChzdGF0dXNDb2RlLCBoZWFkZXJzKTtcbiAgICAgIHJlcy5lbmQoY29tcHJlc3NlZENvbnRlbnQpO1xuXG4gICAgICAvLyBDbGVhbiB1cCBhZnRlciBzZW5kaW5nXG4gICAgICBpZiAocmVxLnNvY2tldCAmJiAhcmVxLnNvY2tldC5kZXN0cm95ZWQpIHtcbiAgICAgICAgcmVxLnNvY2tldC5zZXRUaW1lb3V0KDEwMDApOyAvLyAxIHNlY29uZCB0aW1lb3V0IGFmdGVyIHJlc3BvbnNlXG4gICAgICAgIHJlcS5zb2NrZXQudW5yZWYoKTsgLy8gQWxsb3cgdGhlIHByb2Nlc3MgdG8gZXhpdCBpZiB0aGlzIGlzIHRoZSBvbmx5IGNvbm5lY3Rpb25cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5lcnJvcihgRXJyb3Igc2VuZGluZyBzdGF0aWMgcmVzcG9uc2U6ICR7ZXJyb3J9YCk7XG4gICAgICBpZiAoIXJlcy5oZWFkZXJzU2VudCkge1xuICAgICAgICByZXMuc2V0SGVhZGVyKFwiQ29ubmVjdGlvblwiLCBcImNsb3NlXCIpO1xuICAgICAgICByZXMud3JpdGVIZWFkKDUwMCwge1xuICAgICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IHRoaXMuY29yc09yaWdpbixcbiAgICAgICAgICBDb25uZWN0aW9uOiBcImNsb3NlXCIsXG4gICAgICAgIH0pO1xuICAgICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCIgfSkpO1xuICAgICAgfVxuXG4gICAgICAvLyBFbnN1cmUgY29ubmVjdGlvbiBpcyBjbGVhbmVkIHVwIG9uIGVycm9yXG4gICAgICBpZiAocmVxLnNvY2tldCAmJiAhcmVxLnNvY2tldC5kZXN0cm95ZWQpIHtcbiAgICAgICAgcmVxLnNvY2tldC5kZXN0cm95KCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRDb250ZW50VHlwZShmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBleHQgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgY29udGVudFR5cGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgXCIuaHRtbFwiOiBcInRleHQvaHRtbDsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCIuanNcIjogXCJhcHBsaWNhdGlvbi9qYXZhc2NyaXB0OyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICBcIi5tanNcIjogXCJhcHBsaWNhdGlvbi9qYXZhc2NyaXB0OyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICBcIi5jc3NcIjogXCJ0ZXh0L2NzczsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCIuanNvblwiOiBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLThcIixcbiAgICAgIFwiLnBuZ1wiOiBcImltYWdlL3BuZ1wiLFxuICAgICAgXCIuanBnXCI6IFwiaW1hZ2UvanBlZ1wiLFxuICAgICAgXCIuanBlZ1wiOiBcImltYWdlL2pwZWdcIixcbiAgICAgIFwiLmdpZlwiOiBcImltYWdlL2dpZlwiLFxuICAgICAgXCIuc3ZnXCI6IFwiaW1hZ2Uvc3ZnK3htbFwiLFxuICAgICAgXCIuaWNvXCI6IFwiaW1hZ2UveC1pY29uXCIsXG4gICAgICBcIi53b2ZmXCI6IFwiZm9udC93b2ZmXCIsXG4gICAgICBcIi53b2ZmMlwiOiBcImZvbnQvd29mZjJcIixcbiAgICAgIFwiLnR0ZlwiOiBcImZvbnQvdHRmXCIsXG4gICAgICBcIi5lb3RcIjogXCJhcHBsaWNhdGlvbi92bmQubXMtZm9udG9iamVjdFwiLFxuICAgIH07XG5cbiAgICByZXR1cm4gY29udGVudFR5cGVzW2V4dF0gfHwgXCJhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW1cIjtcbiAgfVxuXG4gIHByaXZhdGUgcGFyc2VCb2R5KGJvZHk6IHN0cmluZywgY29udGVudFR5cGU/OiBzdHJpbmcpOiBhbnkge1xuICAgIGlmICghY29udGVudFR5cGUpIHJldHVybiBib2R5O1xuXG4gICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwiYXBwbGljYXRpb24vanNvblwiKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYm9keSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLndhcm4oYEZhaWxlZCB0byBwYXJzZSBKU09OIGJvZHk6ICR7ZXJyb3J9YCk7XG4gICAgICAgIHJldHVybiBib2R5O1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBtdWx0aXBhcnQvZm9ybS1kYXRhXG4gICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwibXVsdGlwYXJ0L2Zvcm0tZGF0YVwiKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gRm9yIG11bHRpcGFydC9mb3JtLWRhdGEsIHdlIG5lZWQgdG8gcGFyc2UgdGhlIHJhdyBib2R5XG4gICAgICAgIC8vIFRoZSBib2R5IHdpbGwgYmUgYXZhaWxhYmxlIGFzIEJ1ZmZlciBvciBzdHJpbmdcbiAgICAgICAgcmV0dXJuIGJvZHk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLndhcm4oYEZhaWxlZCB0byBwYXJzZSBtdWx0aXBhcnQvZm9ybS1kYXRhOiAke2Vycm9yfWApO1xuICAgICAgICByZXR1cm4gYm9keTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYm9keTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VuZFJlc3BvbnNlKFxuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSxcbiAgICBzdGF0dXNDb2RlOiBudW1iZXIsXG4gICAgYm9keTogYW55LFxuICAgIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICApIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5zdHJpbmdpZnkoYm9keSk7XG4gICAgICBjb25zdCBjb250ZW50RW5jb2RpbmcgPSB0aGlzLm5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhyZXMpO1xuICAgICAgY29uc3QgY29tcHJlc3NlZENvbnRlbnQgPSBjb250ZW50RW5jb2RpbmdcbiAgICAgICAgPyBhd2FpdCB0aGlzLmNvbXByZXNzQ29udGVudChCdWZmZXIuZnJvbShyZXNwb25zZUJvZHkpLCBjb250ZW50RW5jb2RpbmcpXG4gICAgICAgIDogcmVzcG9uc2VCb2R5O1xuXG4gICAgICBjb25zdCBmaW5hbEhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiOiB0aGlzLmNvcnNPcmlnaW4sXG4gICAgICAgIFwiWC1YU1MtUHJvdGVjdGlvblwiOiBcIjE7IG1vZGU9YmxvY2tcIixcbiAgICAgICAgXCJYLUZyYW1lLU9wdGlvbnNcIjogXCJERU5ZXCIsXG4gICAgICAgIFwiWC1Db250ZW50LVR5cGUtT3B0aW9uc1wiOiBcIm5vc25pZmZcIixcbiAgICAgICAgXCJDb250ZW50LUxlbmd0aFwiOiBCdWZmZXIuYnl0ZUxlbmd0aChjb21wcmVzc2VkQ29udGVudCkudG9TdHJpbmcoKSxcbiAgICAgICAgLi4uaGVhZGVycyxcbiAgICAgIH07XG5cbiAgICAgIGlmIChjb250ZW50RW5jb2RpbmcpIHtcbiAgICAgICAgZmluYWxIZWFkZXJzW1wiQ29udGVudC1FbmNvZGluZ1wiXSA9IGNvbnRlbnRFbmNvZGluZztcbiAgICAgIH1cblxuICAgICAgcmVzLndyaXRlSGVhZChzdGF0dXNDb2RlLCBmaW5hbEhlYWRlcnMpO1xuICAgICAgcmVzLmVuZChjb21wcmVzc2VkQ29udGVudCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHNlbmRpbmcgcmVzcG9uc2U6ICR7ZXJyb3J9YCk7XG4gICAgICAvLyBTZW5kIGEgYmFzaWMgZXJyb3IgcmVzcG9uc2Ugd2l0aG91dCBjb21wcmVzc2lvbiBpZiBzb21ldGhpbmcgZ29lcyB3cm9uZ1xuICAgICAgcmVzLndyaXRlSGVhZCg1MDAsIHtcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IHRoaXMuY29yc09yaWdpbixcbiAgICAgIH0pO1xuICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIkludGVybmFsIFNlcnZlciBFcnJvclwiIH0pKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIG5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhcbiAgICByZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlIHwgaHR0cC5TZXJ2ZXJSZXNwb25zZVxuICApOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBhY2NlcHRFbmNvZGluZyA9XG4gICAgICBcImhlYWRlcnNcIiBpbiByZXFcbiAgICAgICAgPyByZXEuaGVhZGVyc1tcImFjY2VwdC1lbmNvZGluZ1wiXVxuICAgICAgICA6IChyZXEgYXMgYW55KS5fcmVxPy5oZWFkZXJzW1wiYWNjZXB0LWVuY29kaW5nXCJdOyAvLyBGYWxsYmFjayBmb3IgU2VydmVyUmVzcG9uc2VcblxuICAgIGlmICghYWNjZXB0RW5jb2RpbmcpIHJldHVybiBudWxsO1xuXG4gICAgaWYgKHR5cGVvZiBhY2NlcHRFbmNvZGluZyA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgaWYgKGFjY2VwdEVuY29kaW5nLmluY2x1ZGVzKFwiZ3ppcFwiKSkgcmV0dXJuIFwiZ3ppcFwiO1xuICAgICAgaWYgKGFjY2VwdEVuY29kaW5nLmluY2x1ZGVzKFwiZGVmbGF0ZVwiKSkgcmV0dXJuIFwiZGVmbGF0ZVwiO1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjb21wcmVzc0NvbnRlbnQoXG4gICAgY29udGVudDogQnVmZmVyIHwgc3RyaW5nLFxuICAgIGVuY29kaW5nOiBzdHJpbmdcbiAgKTogUHJvbWlzZTxCdWZmZXIgfCBzdHJpbmc+IHtcbiAgICBpZiAodHlwZW9mIGNvbnRlbnQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShjb250ZW50KTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgaWYgKGVuY29kaW5nID09PSBcImd6aXBcIikge1xuICAgICAgICB6bGliLmd6aXAoY29udGVudCwgKGVyciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKGVycikgcmVqZWN0KGVycik7XG4gICAgICAgICAgZWxzZSByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmIChlbmNvZGluZyA9PT0gXCJkZWZsYXRlXCIpIHtcbiAgICAgICAgemxpYi5kZWZsYXRlKGNvbnRlbnQsIChlcnIsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChlcnIpIHJlamVjdChlcnIpO1xuICAgICAgICAgIGVsc2UgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc29sdmUoY29udGVudCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NIdHRwUmVxdWVzdChcbiAgICBodHRwUmVxdWVzdDogSHR0cFJlcXVlc3RcbiAgKTogUHJvbWlzZTxIdHRwUmVzcG9uc2U+IHtcbiAgICBjb25zdCByZXF1ZXN0VHlwZSA9IGAke2h0dHBSZXF1ZXN0Lm1ldGhvZH06JHtodHRwUmVxdWVzdC5wYXRofWA7XG4gICAgdGhpcy5pbmZvKGBSZWNlaXZlZCByZXF1ZXN0OiAke3JlcXVlc3RUeXBlfWApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxIdHRwUmVzcG9uc2U+KHtcbiAgICAgIHRvOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgYm9keTogaHR0cFJlcXVlc3QsXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3BvbnNlLmJvZHkuZGF0YTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMuc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZvKGBXZWIgc2VydmVyIGxpc3RlbmluZyBvbiBwb3J0ICR7dGhpcy5wb3J0fWApO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzaHV0ZG93bigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMuc2VydmVyLmNsb3NlKCgpID0+IHtcbiAgICAgICAgdGhpcy5kZWJ1ZyhcIlNlcnZlciBoYXMgYmVlbiBzaHV0IGRvd25cIik7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuXG4gICAgICAvLyBGb3JjZSBjbG9zZSBhZnRlciB0aW1lb3V0XG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5lcnJvcihcIkZvcmNlIGNsb3NpbmcgcmVtYWluaW5nIGNvbm5lY3Rpb25zXCIpO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9LCAxMDAwMCk7IC8vIDEwIHNlY29uZCBmb3JjZSBzaHV0ZG93biB0aW1lb3V0XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGlzQ29ubmVjdGlvbkFsaXZlKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiBib29sZWFuIHtcbiAgICByZXR1cm4gISEocmVxLnNvY2tldCAmJiAhcmVxLnNvY2tldC5kZXN0cm95ZWQgJiYgcmVxLnNvY2tldC53cml0YWJsZSk7XG4gIH1cblxuICBwcml2YXRlIGRlc3Ryb3lDb25uZWN0aW9uKHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UpOiB2b2lkIHtcbiAgICBpZiAocmVxLnNvY2tldCAmJiAhcmVxLnNvY2tldC5kZXN0cm95ZWQpIHtcbiAgICAgIHJlcS5zb2NrZXQuZGVzdHJveSgpO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdG9wRGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5zaHV0ZG93bigpO1xuICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oXCJXZWIgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlZmF1bHRNZXNzYWdlSGFuZGxlcihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxIdHRwUmVxdWVzdD5cbiAgKTogUHJvbWlzZTxIdHRwUmVzcG9uc2U+IHtcbiAgICB0aGlzLndhcm4oYFBhdGggbm90IGZvdW5kOiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWApO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICBib2R5OiB7IG1lc3NhZ2U6IFwiUGF0aCBub3QgZm91bmRcIiB9LFxuICAgIH07XG4gIH1cbn1cbiJdfQ==