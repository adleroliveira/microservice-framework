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
        const apiPath = parsedUrl.pathname?.substring(this.apiPrefix.length) || "/";
        const contentType = req.headers["content-type"] || "";
        if (contentType.includes("multipart/form-data")) {
            const httpRequest = {
                method: req.method || "GET",
                path: apiPath,
                query: parsedUrl.query,
                headers: req.headers,
                // Pass the raw request stream instead of body
                rawRequest: req,
            };
            try {
                const response = await this.processHttpRequest(httpRequest);
                this.sendResponse(res, response.statusCode, response.body, response.headers);
            }
            catch (error) {
                this.error(`Error processing request: ${error}`);
                this.sendResponse(res, 500, { error: "Internal Server Error" });
            }
            return;
        }
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxnREFBd0I7QUFDeEIsOENBQXNCO0FBQ3RCLGdEQUF3QjtBQUN4QixnREFBd0I7QUFDeEIsMkRBQTZCO0FBRTdCLG9FQUFnRjtBQWtDaEYsTUFBYSxTQUFVLFNBQVEsNkNBRzlCO0lBU0MsWUFBWSxPQUFpQixFQUFFLE1BQXVCO1FBQ3BELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDdkIsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQztRQUNoQyxJQUFJLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLElBQUksR0FBRyxDQUFDO1FBQzdDLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUM7UUFDdkMsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQztRQUMzQyxJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDO1FBQzFDLElBQUksQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFNBQVMsSUFBSSxNQUFNLENBQUM7UUFDNUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxjQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFFL0QsSUFBSSxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsR0FBRyxJQUFJLENBQUMsQ0FBQyxXQUFXO1FBQ2hELElBQUksQ0FBQyxNQUFNLENBQUMsY0FBYyxHQUFHLElBQUksQ0FBQyxDQUFDLFlBQVk7UUFDL0MsSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDLE9BQU8s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Q0FBQyxPQUFPLEVBQUUsQ0FBQztRQUN2QixDQUFDO0lBQ0gsQ0FBQztJQUVTLEtBQUssQ0FBQyxnQkFBZ0I7UUFDOUIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLEVBQUU7WUFDbkMsTUFBTSxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDdEIsSUFBSSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsR0FBRyxFQUFFO2dCQUNyQixJQUFJLENBQUMsSUFBSSxDQUFDLG9CQUFvQixDQUFDLENBQUM7Z0JBQ2hDLE9BQU8sRUFBRSxDQUFDO1lBQ1osQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFUyxLQUFLLENBQUMscUJBQXFCLENBQ25DLE9BQThCO1FBRTlCLElBQUksQ0FBQyxJQUFJLENBQUMsbUJBQW1CLE9BQU8sQ0FBQyxNQUFNLENBQUMsV0FBVyxFQUFFLENBQUMsQ0FBQztRQUMzRCxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUU7WUFDL0MsSUFBSSxFQUFFLEVBQUUsT0FBTyxFQUFFLGdCQUFnQixFQUFFO1NBQ3BDLENBQUM7SUFDSixDQUFDO0NBQ0Y7QUFsaUJELDhCQWtpQkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgaHR0cCBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHVybCBmcm9tIFwidXJsXCI7XG5pbXBvcnQgemxpYiBmcm9tIFwiemxpYlwiO1xuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCBuZXQgZnJvbSBcIm5ldFwiO1xuaW1wb3J0IHsgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLCBJU2VydmVyQ29uZmlnIH0gZnJvbSBcIi4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHtcbiAgSUJhY2tFbmQsXG4gIElSZXF1ZXN0LFxuICBJU2Vzc2lvblN0b3JlLFxuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuZXhwb3J0IHR5cGUgSHR0cFJlcXVlc3QgPSB7XG4gIG1ldGhvZDogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHF1ZXJ5OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBib2R5PzogYW55O1xuICByYXdSZXF1ZXN0PzogaHR0cC5JbmNvbWluZ01lc3NhZ2U7XG59O1xuXG5leHBvcnQgdHlwZSBIdHRwUmVzcG9uc2UgPSB7XG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgYm9keTogYW55O1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBtYXhCb2R5U2l6ZT86IG51bWJlcjtcbiAgdGltZW91dD86IG51bWJlcjtcbiAgY29yc09yaWdpbj86IHN0cmluZztcbiAgc3RhdGljRGlyPzogc3RyaW5nO1xuICBhcGlQcmVmaXg/OiBzdHJpbmc7XG4gIGF1dGhQcm92aWRlcj86IElBdXRoZW50aWNhdGlvblByb3ZpZGVyO1xuICBzZXNzaW9uU3RvcmU/OiBJU2Vzc2lvblN0b3JlO1xufVxuXG5leHBvcnQgY2xhc3MgV2ViU2VydmVyIGV4dGVuZHMgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBIdHRwUmVxdWVzdCxcbiAgSHR0cFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IGh0dHAuU2VydmVyO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBtYXhCb2R5U2l6ZTogbnVtYmVyO1xuICBwcml2YXRlIHRpbWVvdXQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBjb3JzT3JpZ2luOiBzdHJpbmc7XG4gIHByaXZhdGUgc3RhdGljRGlyOiBzdHJpbmcgfCBudWxsO1xuICBwcml2YXRlIGFwaVByZWZpeDogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQ6IElCYWNrRW5kLCBjb25maWc6IFdlYlNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKGJhY2tlbmQsIGNvbmZpZyk7XG4gICAgdGhpcy5wb3J0ID0gY29uZmlnLnBvcnQgfHwgODA4MDtcbiAgICB0aGlzLm1heEJvZHlTaXplID0gY29uZmlnLm1heEJvZHlTaXplIHx8IDFlNjtcbiAgICB0aGlzLnRpbWVvdXQgPSBjb25maWcudGltZW91dCB8fCAzMDAwMDtcbiAgICB0aGlzLmNvcnNPcmlnaW4gPSBjb25maWcuY29yc09yaWdpbiB8fCBcIipcIjtcbiAgICB0aGlzLnN0YXRpY0RpciA9IGNvbmZpZy5zdGF0aWNEaXIgfHwgbnVsbDtcbiAgICB0aGlzLmFwaVByZWZpeCA9IGNvbmZpZy5hcGlQcmVmaXggfHwgXCIvYXBpXCI7XG4gICAgdGhpcy5zZXJ2ZXIgPSBodHRwLmNyZWF0ZVNlcnZlcih0aGlzLmhhbmRsZVJlcXVlc3QuYmluZCh0aGlzKSk7XG5cbiAgICB0aGlzLnNlcnZlci5rZWVwQWxpdmVUaW1lb3V0ID0gMTAwMDsgLy8gMSBzZWNvbmRcbiAgICB0aGlzLnNlcnZlci5oZWFkZXJzVGltZW91dCA9IDIwMDA7IC8vIDIgc2Vjb25kc1xuICAgIHRoaXMuc2VydmVyLnRpbWVvdXQgPSB0aGlzLnRpbWVvdXQ7XG5cbiAgICB0aGlzLnNlcnZlci5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5lcnJvcihgU2VydmVyIGVycm9yOiAke2Vycm9yfWApO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zZXJ2ZXIub24oXG4gICAgICBcImNsaWVudEVycm9yXCIsXG4gICAgICAoZXJyb3I6IEVycm9yICYgeyBjb2RlPzogc3RyaW5nIH0sIHNvY2tldDogbmV0LlNvY2tldCkgPT4ge1xuICAgICAgICB0aGlzLmVycm9yKGBDbGllbnQgZXJyb3I6ICR7ZXJyb3J9YCk7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSBcIkVDT05OUkVTRVRcIiB8fCAhc29ja2V0LndyaXRhYmxlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHNvY2tldC5lbmQoXCJIVFRQLzEuMSA0MDAgQmFkIFJlcXVlc3RcXHJcXG5cXHJcXG5cIik7XG4gICAgICB9XG4gICAgKTtcblxuICAgIHRoaXMuc2VydmVyLm9uKFwiY2xvc2VcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5kZWJ1ZyhcIlNlcnZlciBpcyBzaHV0dGluZyBkb3duXCIpO1xuICAgIH0pO1xuXG4gICAgLy8gSGFuZGxlIGNvbm5lY3Rpb24gZXZlbnRzXG4gICAgdGhpcy5zZXJ2ZXIub24oXCJjb25uZWN0aW9uXCIsIChzb2NrZXQpID0+IHtcbiAgICAgIC8vIENvbmZpZ3VyZSBzb2NrZXQgc2V0dGluZ3NcbiAgICAgIHNvY2tldC5zZXRLZWVwQWxpdmUoZmFsc2UpO1xuICAgICAgc29ja2V0LnNldE5vRGVsYXkodHJ1ZSk7XG4gICAgICBzb2NrZXQuc2V0VGltZW91dCh0aGlzLnRpbWVvdXQpO1xuXG4gICAgICBzb2NrZXQub24oXCJ0aW1lb3V0XCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5kZWJ1ZyhcIlNvY2tldCB0aW1lb3V0LCBkZXN0cm95aW5nIGNvbm5lY3Rpb25cIik7XG4gICAgICAgIGlmICghc29ja2V0LmRlc3Ryb3llZCkge1xuICAgICAgICAgIHNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBzb2NrZXQub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgICAgdGhpcy5lcnJvcihgU29ja2V0IGVycm9yOiAke2Vycm9yfWApO1xuICAgICAgICBpZiAoIXNvY2tldC5kZXN0cm95ZWQpIHtcbiAgICAgICAgICBzb2NrZXQuZGVzdHJveSgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUmVxdWVzdChcbiAgICByZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLFxuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZVxuICApIHtcbiAgICBpZiAocmVxLm1ldGhvZCA9PT0gXCJPUFRJT05TXCIpIHtcbiAgICAgIHJlcy53cml0ZUhlYWQoMjAwLCB7XG4gICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IHRoaXMuY29yc09yaWdpbixcbiAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzXCI6IFwiR0VULCBQT1NULCBQVVQsIERFTEVURSwgT1BUSU9OU1wiLFxuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnNcIjogXCJDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb25cIixcbiAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1NYXgtQWdlXCI6IFwiODY0MDBcIixcbiAgICAgIH0pO1xuICAgICAgcmVzLmVuZCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHBhcnNlZFVybCA9IHVybC5wYXJzZShyZXEudXJsIHx8IFwiXCIsIHRydWUpO1xuICAgIGNvbnN0IHBhdGhuYW1lID0gcGFyc2VkVXJsLnBhdGhuYW1lIHx8IFwiL1wiO1xuXG4gICAgaWYgKHBhdGhuYW1lLnN0YXJ0c1dpdGgodGhpcy5hcGlQcmVmaXgpKSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUFwaVJlcXVlc3QocmVxLCByZXMsIHBhcnNlZFVybCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuc3RhdGljRGlyICYmIHJlcS5tZXRob2QgPT09IFwiR0VUXCIpIHtcbiAgICAgIGNvbnN0IGhhbmRsZWQgPSBhd2FpdCB0aGlzLmhhbmRsZVN0YXRpY1JlcXVlc3QocmVxLCByZXMsIHBhdGhuYW1lKTtcbiAgICAgIGlmIChoYW5kbGVkKSByZXR1cm47XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVBcGlSZXF1ZXN0KFxuICAgIHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHBhcnNlZFVybDogdXJsLlVybFdpdGhQYXJzZWRRdWVyeVxuICApIHtcbiAgICBjb25zdCBhcGlQYXRoID0gcGFyc2VkVXJsLnBhdGhuYW1lPy5zdWJzdHJpbmcodGhpcy5hcGlQcmVmaXgubGVuZ3RoKSB8fCBcIi9cIjtcblxuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVxLmhlYWRlcnNbXCJjb250ZW50LXR5cGVcIl0gfHwgXCJcIjtcbiAgICBpZiAoY29udGVudFR5cGUuaW5jbHVkZXMoXCJtdWx0aXBhcnQvZm9ybS1kYXRhXCIpKSB7XG4gICAgICBjb25zdCBodHRwUmVxdWVzdDogSHR0cFJlcXVlc3QgPSB7XG4gICAgICAgIG1ldGhvZDogcmVxLm1ldGhvZCB8fCBcIkdFVFwiLFxuICAgICAgICBwYXRoOiBhcGlQYXRoLFxuICAgICAgICBxdWVyeTogcGFyc2VkVXJsLnF1ZXJ5IGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIGhlYWRlcnM6IHJlcS5oZWFkZXJzIGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4sXG4gICAgICAgIC8vIFBhc3MgdGhlIHJhdyByZXF1ZXN0IHN0cmVhbSBpbnN0ZWFkIG9mIGJvZHlcbiAgICAgICAgcmF3UmVxdWVzdDogcmVxLFxuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnByb2Nlc3NIdHRwUmVxdWVzdChodHRwUmVxdWVzdCk7XG4gICAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKFxuICAgICAgICAgIHJlcyxcbiAgICAgICAgICByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgICAgIHJlc3BvbnNlLmJvZHksXG4gICAgICAgICAgcmVzcG9uc2UuaGVhZGVyc1xuICAgICAgICApO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyByZXF1ZXN0OiAke2Vycm9yfWApO1xuICAgICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDUwMCwgeyBlcnJvcjogXCJJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcIiB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBjaHVua3M6IEJ1ZmZlcltdID0gW107XG4gICAgbGV0IGJvZHlTaXplID0gMDtcblxuICAgIHJlcy5zZXRUaW1lb3V0KHRoaXMudGltZW91dCwgKCkgPT4ge1xuICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCB0aW1lb3V0IGZvciAke3JlcS51cmx9YCk7XG4gICAgICBpZiAodGhpcy5pc0Nvbm5lY3Rpb25BbGl2ZShyZXEpKSB7XG4gICAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDA4LCB7IGVycm9yOiBcIlJlcXVlc3QgVGltZW91dFwiIH0pO1xuICAgICAgICB0aGlzLmRlc3Ryb3lDb25uZWN0aW9uKHJlcSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXEub24oXCJkYXRhXCIsIChjaHVuaykgPT4ge1xuICAgICAgYm9keVNpemUgKz0gY2h1bmsubGVuZ3RoO1xuICAgICAgaWYgKGJvZHlTaXplID4gdGhpcy5tYXhCb2R5U2l6ZSkge1xuICAgICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDQxMywgeyBlcnJvcjogXCJQYXlsb2FkIFRvbyBMYXJnZVwiIH0pO1xuICAgICAgICByZXEuZGVzdHJveSgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2h1bmtzLnB1c2goQnVmZmVyLmZyb20oY2h1bmspKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcS5vbihcImVuZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocmVxLmRlc3Ryb3llZCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCByYXdCb2R5ID0gQnVmZmVyLmNvbmNhdChjaHVua3MpO1xuICAgICAgY29uc3QgY29udGVudFR5cGUgPSByZXEuaGVhZGVyc1tcImNvbnRlbnQtdHlwZVwiXSB8fCBcIlwiO1xuXG4gICAgICBsZXQgcGFyc2VkQm9keTtcbiAgICAgIGlmIChjb250ZW50VHlwZS5pbmNsdWRlcyhcIm11bHRpcGFydC9mb3JtLWRhdGFcIikpIHtcbiAgICAgICAgcGFyc2VkQm9keSA9IHJhd0JvZHk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXJzZWRCb2R5ID0gdGhpcy5wYXJzZUJvZHkocmF3Qm9keS50b1N0cmluZygpLCBjb250ZW50VHlwZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIFJlbW92ZSBBUEkgcHJlZml4IGZyb20gcGF0aCBmb3Igcm91dGluZ1xuICAgICAgY29uc3QgYXBpUGF0aCA9XG4gICAgICAgIHBhcnNlZFVybC5wYXRobmFtZT8uc3Vic3RyaW5nKHRoaXMuYXBpUHJlZml4Lmxlbmd0aCkgfHwgXCIvXCI7XG5cbiAgICAgIGNvbnN0IGh0dHBSZXF1ZXN0OiBIdHRwUmVxdWVzdCA9IHtcbiAgICAgICAgbWV0aG9kOiByZXEubWV0aG9kIHx8IFwiR0VUXCIsXG4gICAgICAgIHBhdGg6IGFwaVBhdGgsXG4gICAgICAgIHF1ZXJ5OiBwYXJzZWRVcmwucXVlcnkgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgICAgICAgaGVhZGVyczogcmVxLmhlYWRlcnMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgICAgICAgYm9keTogcGFyc2VkQm9keSxcbiAgICAgIH07XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5wcm9jZXNzSHR0cFJlcXVlc3QoaHR0cFJlcXVlc3QpO1xuICAgICAgICB0aGlzLnNlbmRSZXNwb25zZShcbiAgICAgICAgICByZXMsXG4gICAgICAgICAgcmVzcG9uc2Uuc3RhdHVzQ29kZSxcbiAgICAgICAgICByZXNwb25zZS5ib2R5LFxuICAgICAgICAgIHJlc3BvbnNlLmhlYWRlcnNcbiAgICAgICAgKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVxdWVzdDogJHtlcnJvcn1gKTtcbiAgICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA1MDAsIHsgZXJyb3I6IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCIgfSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXEub24oXCJlcnJvclwiLCAoZXJyb3IpID0+IHtcbiAgICAgIHRoaXMuZXJyb3IoYFJlcXVlc3QgZXJyb3I6ICR7ZXJyb3J9YCk7XG4gICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDQwMCwgeyBlcnJvcjogXCJCYWQgUmVxdWVzdFwiIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTdGF0aWNSZXF1ZXN0KFxuICAgIHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHBhdGhuYW1lOiBzdHJpbmdcbiAgKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCF0aGlzLnN0YXRpY0RpcikgcmV0dXJuIGZhbHNlO1xuXG4gICAgbGV0IHN0YXRpY0ZpbGVQYXRoID0gcGF0aC5qb2luKHRoaXMuc3RhdGljRGlyLCBwYXRobmFtZSk7XG5cbiAgICAvLyBOb3JtYWxpemUgdGhlIHBhdGggdG8gcHJldmVudCBkaXJlY3RvcnkgdHJhdmVyc2FsXG4gICAgc3RhdGljRmlsZVBhdGggPSBwYXRoLm5vcm1hbGl6ZShzdGF0aWNGaWxlUGF0aCk7XG4gICAgaWYgKCFzdGF0aWNGaWxlUGF0aC5zdGFydHNXaXRoKHRoaXMuc3RhdGljRGlyKSkge1xuICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA0MDMsIHsgZXJyb3I6IFwiRm9yYmlkZGVuXCIgfSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBmcy5zdGF0KHN0YXRpY0ZpbGVQYXRoKTtcbiAgICAgIGlmIChzdGF0cy5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgIHN0YXRpY0ZpbGVQYXRoID0gcGF0aC5qb2luKHN0YXRpY0ZpbGVQYXRoLCBcImluZGV4Lmh0bWxcIik7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLnNlcnZlU3RhdGljRmlsZShzdGF0aWNGaWxlUGF0aCk7XG4gICAgICBpZiAoY29udGVudCkge1xuICAgICAgICBhd2FpdCB0aGlzLnNlbmRTdGF0aWNSZXNwb25zZShcbiAgICAgICAgICByZXEsXG4gICAgICAgICAgcmVzLFxuICAgICAgICAgIDIwMCxcbiAgICAgICAgICBjb250ZW50LFxuICAgICAgICAgIHRoaXMuZ2V0Q29udGVudFR5cGUoc3RhdGljRmlsZVBhdGgpXG4gICAgICAgICk7XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gXCJFTk9FTlRcIikge1xuICAgICAgICAvLyBUcnkgZmFsbGJhY2sgdG8gaW5kZXguaHRtbCBmb3IgU1BBIHJvdXRpbmdcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBjb25zdCBpbmRleFBhdGggPSBwYXRoLmpvaW4odGhpcy5zdGF0aWNEaXIsIFwiaW5kZXguaHRtbFwiKTtcbiAgICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5zZXJ2ZVN0YXRpY0ZpbGUoaW5kZXhQYXRoKTtcbiAgICAgICAgICBpZiAoY29udGVudCkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5zZW5kU3RhdGljUmVzcG9uc2UoXG4gICAgICAgICAgICAgIHJlcSxcbiAgICAgICAgICAgICAgcmVzLFxuICAgICAgICAgICAgICAyMDAsXG4gICAgICAgICAgICAgIGNvbnRlbnQsXG4gICAgICAgICAgICAgIFwidGV4dC9odG1sOyBjaGFyc2V0PXV0Zi04XCJcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGluZGV4RXJyb3IpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlcnZlU3RhdGljRmlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxCdWZmZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XG4gICAgICByZXR1cm4gY29udGVudDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7IC8vIEZpbGUgbm90IGZvdW5kXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvcjsgLy8gT3RoZXIgZXJyb3JzXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kU3RhdGljUmVzcG9uc2UoXG4gICAgcmVxOiBodHRwLkluY29taW5nTWVzc2FnZSxcbiAgICByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UsXG4gICAgc3RhdHVzQ29kZTogbnVtYmVyLFxuICAgIGNvbnRlbnQ6IEJ1ZmZlcixcbiAgICBjb250ZW50VHlwZTogc3RyaW5nXG4gICkge1xuICAgIHRyeSB7XG4gICAgICAvLyBTZXQgQ29ubmVjdGlvbiBoZWFkZXIgdG8gY2xvc2UgZXhwbGljaXRseVxuICAgICAgcmVzLnNldEhlYWRlcihcIkNvbm5lY3Rpb25cIiwgXCJjbG9zZVwiKTtcblxuICAgICAgY29uc3QgY29udGVudEVuY29kaW5nID0gdGhpcy5uZWdvdGlhdGVDb250ZW50RW5jb2RpbmcocmVxKTtcbiAgICAgIGNvbnN0IGNvbXByZXNzZWRDb250ZW50ID0gY29udGVudEVuY29kaW5nXG4gICAgICAgID8gYXdhaXQgdGhpcy5jb21wcmVzc0NvbnRlbnQoY29udGVudCwgY29udGVudEVuY29kaW5nKVxuICAgICAgICA6IGNvbnRlbnQ7XG5cbiAgICAgIGNvbnN0IGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IGNvbnRlbnRUeXBlLFxuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiOiB0aGlzLmNvcnNPcmlnaW4sXG4gICAgICAgIFwiWC1YU1MtUHJvdGVjdGlvblwiOiBcIjE7IG1vZGU9YmxvY2tcIixcbiAgICAgICAgXCJYLUZyYW1lLU9wdGlvbnNcIjogXCJERU5ZXCIsXG4gICAgICAgIFwiWC1Db250ZW50LVR5cGUtT3B0aW9uc1wiOiBcIm5vc25pZmZcIixcbiAgICAgICAgXCJDb250ZW50LUxlbmd0aFwiOiBjb21wcmVzc2VkQ29udGVudC5sZW5ndGgudG9TdHJpbmcoKSxcbiAgICAgICAgXCJDYWNoZS1Db250cm9sXCI6IFwibm8tY2FjaGVcIixcbiAgICAgICAgQ29ubmVjdGlvbjogXCJjbG9zZVwiLCAvLyBBZGQgZXhwbGljaXRseSBpbiBoZWFkZXJzIHRvb1xuICAgICAgICBcIktlZXAtQWxpdmVcIjogXCJ0aW1lb3V0PTEsIG1heD0xXCIsIC8vIExpbWl0IGtlZXAtYWxpdmVcbiAgICAgIH07XG5cbiAgICAgIGlmIChjb250ZW50RW5jb2RpbmcpIHtcbiAgICAgICAgaGVhZGVyc1tcIkNvbnRlbnQtRW5jb2RpbmdcIl0gPSBjb250ZW50RW5jb2Rpbmc7XG4gICAgICAgIGhlYWRlcnNbXCJWYXJ5XCJdID0gXCJBY2NlcHQtRW5jb2RpbmdcIjsgLy8gR29vZCBwcmFjdGljZSB3aXRoIGNvbXByZXNzaW9uXG4gICAgICB9XG5cbiAgICAgIGlmIChcbiAgICAgICAgY29udGVudFR5cGUuaW5jbHVkZXMoXCJqYXZhc2NyaXB0XCIpICYmXG4gICAgICAgIGNvbnRlbnQuaW5jbHVkZXMoJ3R5cGU9XCJtb2R1bGVcIicpXG4gICAgICApIHtcbiAgICAgICAgaGVhZGVyc1tcIkNvbnRlbnQtVHlwZVwiXSA9IFwiYXBwbGljYXRpb24vamF2YXNjcmlwdDsgY2hhcnNldD11dGYtOFwiO1xuICAgICAgfVxuXG4gICAgICAvLyBTZXQgYSB0aW1lb3V0IGZvciB0aGUgcmVzcG9uc2VcbiAgICAgIGNvbnN0IFRJTUVPVVQgPSAzMDAwMDsgLy8gMzAgc2Vjb25kc1xuICAgICAgcmVzLnNldFRpbWVvdXQoVElNRU9VVCwgKCkgPT4ge1xuICAgICAgICBpZiAoIXJlcy5oZWFkZXJzU2VudCkge1xuICAgICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDb25uZWN0aW9uXCIsIFwiY2xvc2VcIik7XG4gICAgICAgICAgcmVzLndyaXRlSGVhZCg1MDQsIHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSk7XG4gICAgICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIlJlc3BvbnNlIHRpbWVvdXRcIiB9KSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHJlcS5zb2NrZXQgJiYgIXJlcS5zb2NrZXQuZGVzdHJveWVkKSB7XG4gICAgICAgICAgcmVxLnNvY2tldC5kZXN0cm95KCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICByZXMud3JpdGVIZWFkKHN0YXR1c0NvZGUsIGhlYWRlcnMpO1xuICAgICAgcmVzLmVuZChjb21wcmVzc2VkQ29udGVudCk7XG5cbiAgICAgIC8vIENsZWFuIHVwIGFmdGVyIHNlbmRpbmdcbiAgICAgIGlmIChyZXEuc29ja2V0ICYmICFyZXEuc29ja2V0LmRlc3Ryb3llZCkge1xuICAgICAgICByZXEuc29ja2V0LnNldFRpbWVvdXQoMTAwMCk7IC8vIDEgc2Vjb25kIHRpbWVvdXQgYWZ0ZXIgcmVzcG9uc2VcbiAgICAgICAgcmVxLnNvY2tldC51bnJlZigpOyAvLyBBbGxvdyB0aGUgcHJvY2VzcyB0byBleGl0IGlmIHRoaXMgaXMgdGhlIG9ubHkgY29ubmVjdGlvblxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBzZW5kaW5nIHN0YXRpYyByZXNwb25zZTogJHtlcnJvcn1gKTtcbiAgICAgIGlmICghcmVzLmhlYWRlcnNTZW50KSB7XG4gICAgICAgIHJlcy5zZXRIZWFkZXIoXCJDb25uZWN0aW9uXCIsIFwiY2xvc2VcIik7XG4gICAgICAgIHJlcy53cml0ZUhlYWQoNTAwLCB7XG4gICAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIjogdGhpcy5jb3JzT3JpZ2luLFxuICAgICAgICAgIENvbm5lY3Rpb246IFwiY2xvc2VcIixcbiAgICAgICAgfSk7XG4gICAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcIiB9KSk7XG4gICAgICB9XG5cbiAgICAgIC8vIEVuc3VyZSBjb25uZWN0aW9uIGlzIGNsZWFuZWQgdXAgb24gZXJyb3JcbiAgICAgIGlmIChyZXEuc29ja2V0ICYmICFyZXEuc29ja2V0LmRlc3Ryb3llZCkge1xuICAgICAgICByZXEuc29ja2V0LmRlc3Ryb3koKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGdldENvbnRlbnRUeXBlKGZpbGVQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IGV4dCA9IHBhdGguZXh0bmFtZShmaWxlUGF0aCkudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBjb250ZW50VHlwZXM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICBcIi5odG1sXCI6IFwidGV4dC9odG1sOyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICBcIi5qc1wiOiBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRmLThcIixcbiAgICAgIFwiLm1qc1wiOiBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRmLThcIixcbiAgICAgIFwiLmNzc1wiOiBcInRleHQvY3NzOyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICBcIi5qc29uXCI6IFwiYXBwbGljYXRpb24vanNvbjsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCIucG5nXCI6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICBcIi5qcGdcIjogXCJpbWFnZS9qcGVnXCIsXG4gICAgICBcIi5qcGVnXCI6IFwiaW1hZ2UvanBlZ1wiLFxuICAgICAgXCIuZ2lmXCI6IFwiaW1hZ2UvZ2lmXCIsXG4gICAgICBcIi5zdmdcIjogXCJpbWFnZS9zdmcreG1sXCIsXG4gICAgICBcIi5pY29cIjogXCJpbWFnZS94LWljb25cIixcbiAgICAgIFwiLndvZmZcIjogXCJmb250L3dvZmZcIixcbiAgICAgIFwiLndvZmYyXCI6IFwiZm9udC93b2ZmMlwiLFxuICAgICAgXCIudHRmXCI6IFwiZm9udC90dGZcIixcbiAgICAgIFwiLmVvdFwiOiBcImFwcGxpY2F0aW9uL3ZuZC5tcy1mb250b2JqZWN0XCIsXG4gICAgfTtcblxuICAgIHJldHVybiBjb250ZW50VHlwZXNbZXh0XSB8fCBcImFwcGxpY2F0aW9uL29jdGV0LXN0cmVhbVwiO1xuICB9XG5cbiAgcHJpdmF0ZSBwYXJzZUJvZHkoYm9keTogc3RyaW5nLCBjb250ZW50VHlwZT86IHN0cmluZyk6IGFueSB7XG4gICAgaWYgKCFjb250ZW50VHlwZSkgcmV0dXJuIGJvZHk7XG5cbiAgICBpZiAoY29udGVudFR5cGUuaW5jbHVkZXMoXCJhcHBsaWNhdGlvbi9qc29uXCIpKSB7XG4gICAgICB0cnkge1xuICAgICAgICByZXR1cm4gSlNPTi5wYXJzZShib2R5KTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMud2FybihgRmFpbGVkIHRvIHBhcnNlIEpTT04gYm9keTogJHtlcnJvcn1gKTtcbiAgICAgICAgcmV0dXJuIGJvZHk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSGFuZGxlIG11bHRpcGFydC9mb3JtLWRhdGFcbiAgICBpZiAoY29udGVudFR5cGUuaW5jbHVkZXMoXCJtdWx0aXBhcnQvZm9ybS1kYXRhXCIpKSB7XG4gICAgICB0cnkge1xuICAgICAgICAvLyBGb3IgbXVsdGlwYXJ0L2Zvcm0tZGF0YSwgd2UgbmVlZCB0byBwYXJzZSB0aGUgcmF3IGJvZHlcbiAgICAgICAgLy8gVGhlIGJvZHkgd2lsbCBiZSBhdmFpbGFibGUgYXMgQnVmZmVyIG9yIHN0cmluZ1xuICAgICAgICByZXR1cm4gYm9keTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMud2FybihgRmFpbGVkIHRvIHBhcnNlIG11bHRpcGFydC9mb3JtLWRhdGE6ICR7ZXJyb3J9YCk7XG4gICAgICAgIHJldHVybiBib2R5O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBib2R5O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kUmVzcG9uc2UoXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHN0YXR1c0NvZGU6IG51bWJlcixcbiAgICBib2R5OiBhbnksXG4gICAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICkge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnN0cmluZ2lmeShib2R5KTtcbiAgICAgIGNvbnN0IGNvbnRlbnRFbmNvZGluZyA9IHRoaXMubmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcyk7XG4gICAgICBjb25zdCBjb21wcmVzc2VkQ29udGVudCA9IGNvbnRlbnRFbmNvZGluZ1xuICAgICAgICA/IGF3YWl0IHRoaXMuY29tcHJlc3NDb250ZW50KEJ1ZmZlci5mcm9tKHJlc3BvbnNlQm9keSksIGNvbnRlbnRFbmNvZGluZylcbiAgICAgICAgOiByZXNwb25zZUJvZHk7XG5cbiAgICAgIGNvbnN0IGZpbmFsSGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IHRoaXMuY29yc09yaWdpbixcbiAgICAgICAgXCJYLVhTUy1Qcm90ZWN0aW9uXCI6IFwiMTsgbW9kZT1ibG9ja1wiLFxuICAgICAgICBcIlgtRnJhbWUtT3B0aW9uc1wiOiBcIkRFTllcIixcbiAgICAgICAgXCJYLUNvbnRlbnQtVHlwZS1PcHRpb25zXCI6IFwibm9zbmlmZlwiLFxuICAgICAgICBcIkNvbnRlbnQtTGVuZ3RoXCI6IEJ1ZmZlci5ieXRlTGVuZ3RoKGNvbXByZXNzZWRDb250ZW50KS50b1N0cmluZygpLFxuICAgICAgICAuLi5oZWFkZXJzLFxuICAgICAgfTtcblxuICAgICAgaWYgKGNvbnRlbnRFbmNvZGluZykge1xuICAgICAgICBmaW5hbEhlYWRlcnNbXCJDb250ZW50LUVuY29kaW5nXCJdID0gY29udGVudEVuY29kaW5nO1xuICAgICAgfVxuXG4gICAgICByZXMud3JpdGVIZWFkKHN0YXR1c0NvZGUsIGZpbmFsSGVhZGVycyk7XG4gICAgICByZXMuZW5kKGNvbXByZXNzZWRDb250ZW50KTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5lcnJvcihgRXJyb3Igc2VuZGluZyByZXNwb25zZTogJHtlcnJvcn1gKTtcbiAgICAgIC8vIFNlbmQgYSBiYXNpYyBlcnJvciByZXNwb25zZSB3aXRob3V0IGNvbXByZXNzaW9uIGlmIHNvbWV0aGluZyBnb2VzIHdyb25nXG4gICAgICByZXMud3JpdGVIZWFkKDUwMCwge1xuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIixcbiAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIjogdGhpcy5jb3JzT3JpZ2luLFxuICAgICAgfSk7XG4gICAgICByZXMuZW5kKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCIgfSkpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgbmVnb3RpYXRlQ29udGVudEVuY29kaW5nKFxuICAgIHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UgfCBodHRwLlNlcnZlclJlc3BvbnNlXG4gICk6IHN0cmluZyB8IG51bGwge1xuICAgIGNvbnN0IGFjY2VwdEVuY29kaW5nID1cbiAgICAgIFwiaGVhZGVyc1wiIGluIHJlcVxuICAgICAgICA/IHJlcS5oZWFkZXJzW1wiYWNjZXB0LWVuY29kaW5nXCJdXG4gICAgICAgIDogKHJlcSBhcyBhbnkpLl9yZXE/LmhlYWRlcnNbXCJhY2NlcHQtZW5jb2RpbmdcIl07IC8vIEZhbGxiYWNrIGZvciBTZXJ2ZXJSZXNwb25zZVxuXG4gICAgaWYgKCFhY2NlcHRFbmNvZGluZykgcmV0dXJuIG51bGw7XG5cbiAgICBpZiAodHlwZW9mIGFjY2VwdEVuY29kaW5nID09PSBcInN0cmluZ1wiKSB7XG4gICAgICBpZiAoYWNjZXB0RW5jb2RpbmcuaW5jbHVkZXMoXCJnemlwXCIpKSByZXR1cm4gXCJnemlwXCI7XG4gICAgICBpZiAoYWNjZXB0RW5jb2RpbmcuaW5jbHVkZXMoXCJkZWZsYXRlXCIpKSByZXR1cm4gXCJkZWZsYXRlXCI7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGNvbXByZXNzQ29udGVudChcbiAgICBjb250ZW50OiBCdWZmZXIgfCBzdHJpbmcsXG4gICAgZW5jb2Rpbmc6IHN0cmluZ1xuICApOiBQcm9taXNlPEJ1ZmZlciB8IHN0cmluZz4ge1xuICAgIGlmICh0eXBlb2YgY29udGVudCA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgY29udGVudCA9IEJ1ZmZlci5mcm9tKGNvbnRlbnQpO1xuICAgIH1cblxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBpZiAoZW5jb2RpbmcgPT09IFwiZ3ppcFwiKSB7XG4gICAgICAgIHpsaWIuZ3ppcChjb250ZW50LCAoZXJyLCByZXN1bHQpID0+IHtcbiAgICAgICAgICBpZiAoZXJyKSByZWplY3QoZXJyKTtcbiAgICAgICAgICBlbHNlIHJlc29sdmUocmVzdWx0KTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKGVuY29kaW5nID09PSBcImRlZmxhdGVcIikge1xuICAgICAgICB6bGliLmRlZmxhdGUoY29udGVudCwgKGVyciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKGVycikgcmVqZWN0KGVycik7XG4gICAgICAgICAgZWxzZSByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmVzb2x2ZShjb250ZW50KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0h0dHBSZXF1ZXN0KFxuICAgIGh0dHBSZXF1ZXN0OiBIdHRwUmVxdWVzdFxuICApOiBQcm9taXNlPEh0dHBSZXNwb25zZT4ge1xuICAgIGNvbnN0IHJlcXVlc3RUeXBlID0gYCR7aHR0cFJlcXVlc3QubWV0aG9kfToke2h0dHBSZXF1ZXN0LnBhdGh9YDtcbiAgICB0aGlzLmluZm8oYFJlY2VpdmVkIHJlcXVlc3Q6ICR7cmVxdWVzdFR5cGV9YCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PEh0dHBSZXNwb25zZT4oe1xuICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICBib2R5OiBodHRwUmVxdWVzdCxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcG9uc2UuYm9keS5kYXRhO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oYFdlYiBzZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgJHt0aGlzLnBvcnR9YCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGFzeW5jIHNodXRkb3duKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4ge1xuICAgICAgICB0aGlzLmRlYnVnKFwiU2VydmVyIGhhcyBiZWVuIHNodXQgZG93blwiKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG5cbiAgICAgIC8vIEZvcmNlIGNsb3NlIGFmdGVyIHRpbWVvdXRcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICB0aGlzLmVycm9yKFwiRm9yY2UgY2xvc2luZyByZW1haW5pbmcgY29ubmVjdGlvbnNcIik7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0sIDEwMDAwKTsgLy8gMTAgc2Vjb25kIGZvcmNlIHNodXRkb3duIHRpbWVvdXRcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgaXNDb25uZWN0aW9uQWxpdmUocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAhIShyZXEuc29ja2V0ICYmICFyZXEuc29ja2V0LmRlc3Ryb3llZCAmJiByZXEuc29ja2V0LndyaXRhYmxlKTtcbiAgfVxuXG4gIHByaXZhdGUgZGVzdHJveUNvbm5lY3Rpb24ocmVxOiBodHRwLkluY29taW5nTWVzc2FnZSk6IHZvaWQge1xuICAgIGlmIChyZXEuc29ja2V0ICYmICFyZXEuc29ja2V0LmRlc3Ryb3llZCkge1xuICAgICAgcmVxLnNvY2tldC5kZXN0cm95KCk7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlKSA9PiB7XG4gICAgICBhd2FpdCB0aGlzLnNodXRkb3duKCk7XG4gICAgICB0aGlzLnNlcnZlci5jbG9zZSgoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhcIldlYiBzZXJ2ZXIgc3RvcHBlZFwiKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PEh0dHBSZXF1ZXN0PlxuICApOiBQcm9taXNlPEh0dHBSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihgUGF0aCBub3QgZm91bmQ6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgIGJvZHk6IHsgbWVzc2FnZTogXCJQYXRoIG5vdCBmb3VuZFwiIH0sXG4gICAgfTtcbiAgfVxufVxuIl19