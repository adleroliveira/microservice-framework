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
        req.setTimeout(this.timeout, () => {
            this.sendResponse(res, 408, { error: "Request Timeout" });
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
            };
            if (contentEncoding) {
                headers["Content-Encoding"] = contentEncoding;
            }
            if (contentType.includes("javascript") &&
                content.includes('type="module"')) {
                headers["Content-Type"] = "application/javascript; charset=utf-8";
            }
            res.writeHead(statusCode, headers);
            res.end(compressedContent);
        }
        catch (error) {
            this.error(`Error sending static response: ${error}`);
            res.writeHead(500, {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": this.corsOrigin,
            });
            res.end(JSON.stringify({ error: "Internal Server Error" }));
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
    async stopDependencies() {
        return new Promise((resolve) => {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxnREFBd0I7QUFDeEIsOENBQXNCO0FBQ3RCLGdEQUF3QjtBQUN4QixnREFBd0I7QUFDeEIsMkRBQTZCO0FBQzdCLG9FQUFnRjtBQWlDaEYsTUFBYSxTQUFVLFNBQVEsNkNBRzlCO0lBU0MsWUFBWSxPQUFpQixFQUFFLE1BQXVCO1FBQ3BELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDdkIsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQztRQUNoQyxJQUFJLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLElBQUksR0FBRyxDQUFDO1FBQzdDLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUM7UUFDdkMsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQztRQUMzQyxJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDO1FBQzFDLElBQUksQ0FBQyxTQUFTLEdBQUcsTUFBTSxDQUFDLFNBQVMsSUFBSSxNQUFNLENBQUM7UUFDNUMsSUFBSSxDQUFDLE1BQU0sR0FBRyxjQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7SUFDakUsQ0FBQztJQUVPLEtBQUssQ0FBQyxhQUFhLENBQ3pCLEdBQXlCLEVBQ3pCLEdBQXdCO1FBRXhCLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxTQUFTLEVBQUUsQ0FBQztZQUM3QixHQUFHLENBQUMsU0FBUyxDQUFDLEdBQUcsRUFBRTtnQkFDakIsNkJBQTZCLEVBQUUsSUFBSSxDQUFD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IFwidXJsXCI7XG5pbXBvcnQgemxpYiBmcm9tIFwiemxpYlwiO1xuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7IE1pY3Jvc2VydmljZUZyYW1ld29yaywgSVNlcnZlckNvbmZpZyB9IGZyb20gXCIuLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7XG4gIElCYWNrRW5kLFxuICBJUmVxdWVzdCxcbiAgSVNlc3Npb25TdG9yZSxcbiAgSUF1dGhlbnRpY2F0aW9uUHJvdmlkZXIsXG59IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5cbmV4cG9ydCB0eXBlIEh0dHBSZXF1ZXN0ID0ge1xuICBtZXRob2Q6IHN0cmluZztcbiAgcGF0aDogc3RyaW5nO1xuICBxdWVyeTogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgYm9keTogYW55O1xufTtcblxuZXhwb3J0IHR5cGUgSHR0cFJlc3BvbnNlID0ge1xuICBzdGF0dXNDb2RlOiBudW1iZXI7XG4gIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz47XG4gIGJvZHk6IGFueTtcbn07XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU2VydmVyQ29uZmlnIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIHBvcnQ6IG51bWJlcjtcbiAgbWF4Qm9keVNpemU/OiBudW1iZXI7XG4gIHRpbWVvdXQ/OiBudW1iZXI7XG4gIGNvcnNPcmlnaW4/OiBzdHJpbmc7XG4gIHN0YXRpY0Rpcj86IHN0cmluZztcbiAgYXBpUHJlZml4Pzogc3RyaW5nO1xuICBhdXRoUHJvdmlkZXI/OiBJQXV0aGVudGljYXRpb25Qcm92aWRlcjtcbiAgc2Vzc2lvblN0b3JlPzogSVNlc3Npb25TdG9yZTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgSHR0cFJlcXVlc3QsXG4gIEh0dHBSZXNwb25zZVxuPiB7XG4gIHByaXZhdGUgc2VydmVyOiBodHRwLlNlcnZlcjtcbiAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gIHByaXZhdGUgbWF4Qm9keVNpemU6IG51bWJlcjtcbiAgcHJpdmF0ZSB0aW1lb3V0OiBudW1iZXI7XG4gIHByaXZhdGUgY29yc09yaWdpbjogc3RyaW5nO1xuICBwcml2YXRlIHN0YXRpY0Rpcjogc3RyaW5nIHwgbnVsbDtcbiAgcHJpdmF0ZSBhcGlQcmVmaXg6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0IHx8IDgwODA7XG4gICAgdGhpcy5tYXhCb2R5U2l6ZSA9IGNvbmZpZy5tYXhCb2R5U2l6ZSB8fCAxZTY7XG4gICAgdGhpcy50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQgfHwgMzAwMDA7XG4gICAgdGhpcy5jb3JzT3JpZ2luID0gY29uZmlnLmNvcnNPcmlnaW4gfHwgXCIqXCI7XG4gICAgdGhpcy5zdGF0aWNEaXIgPSBjb25maWcuc3RhdGljRGlyIHx8IG51bGw7XG4gICAgdGhpcy5hcGlQcmVmaXggPSBjb25maWcuYXBpUHJlZml4IHx8IFwiL2FwaVwiO1xuICAgIHRoaXMuc2VydmVyID0gaHR0cC5jcmVhdGVTZXJ2ZXIodGhpcy5oYW5kbGVSZXF1ZXN0LmJpbmQodGhpcykpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVSZXF1ZXN0KFxuICAgIHJlcTogaHR0cC5JbmNvbWluZ01lc3NhZ2UsXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlXG4gICkge1xuICAgIGlmIChyZXEubWV0aG9kID09PSBcIk9QVElPTlNcIikge1xuICAgICAgcmVzLndyaXRlSGVhZCgyMDAsIHtcbiAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIjogdGhpcy5jb3JzT3JpZ2luLFxuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHNcIjogXCJHRVQsIFBPU1QsIFBVVCwgREVMRVRFLCBPUFRJT05TXCIsXG4gICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVyc1wiOiBcIkNvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvblwiLFxuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLU1heC1BZ2VcIjogXCI4NjQwMFwiLFxuICAgICAgfSk7XG4gICAgICByZXMuZW5kKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGFyc2VkVXJsID0gdXJsLnBhcnNlKHJlcS51cmwgfHwgXCJcIiwgdHJ1ZSk7XG4gICAgY29uc3QgcGF0aG5hbWUgPSBwYXJzZWRVcmwucGF0aG5hbWUgfHwgXCIvXCI7XG5cbiAgICBpZiAocGF0aG5hbWUuc3RhcnRzV2l0aCh0aGlzLmFwaVByZWZpeCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQXBpUmVxdWVzdChyZXEsIHJlcywgcGFyc2VkVXJsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5zdGF0aWNEaXIgJiYgcmVxLm1ldGhvZCA9PT0gXCJHRVRcIikge1xuICAgICAgY29uc3QgaGFuZGxlZCA9IGF3YWl0IHRoaXMuaGFuZGxlU3RhdGljUmVxdWVzdChyZXEsIHJlcywgcGF0aG5hbWUpO1xuICAgICAgaWYgKGhhbmRsZWQpIHJldHVybjtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUFwaVJlcXVlc3QoXG4gICAgcmVxOiBodHRwLkluY29taW5nTWVzc2FnZSxcbiAgICByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UsXG4gICAgcGFyc2VkVXJsOiB1cmwuVXJsV2l0aFBhcnNlZFF1ZXJ5XG4gICkge1xuICAgIGNvbnN0IGNodW5rczogQnVmZmVyW10gPSBbXTtcbiAgICBsZXQgYm9keVNpemUgPSAwO1xuXG4gICAgcmVxLnNldFRpbWVvdXQodGhpcy50aW1lb3V0LCAoKSA9PiB7XG4gICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDQwOCwgeyBlcnJvcjogXCJSZXF1ZXN0IFRpbWVvdXRcIiB9KTtcbiAgICB9KTtcblxuICAgIHJlcS5vbihcImRhdGFcIiwgKGNodW5rKSA9PiB7XG4gICAgICBib2R5U2l6ZSArPSBjaHVuay5sZW5ndGg7XG4gICAgICBpZiAoYm9keVNpemUgPiB0aGlzLm1heEJvZHlTaXplKSB7XG4gICAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDEzLCB7IGVycm9yOiBcIlBheWxvYWQgVG9vIExhcmdlXCIgfSk7XG4gICAgICAgIHJlcS5kZXN0cm95KCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjaHVua3MucHVzaChCdWZmZXIuZnJvbShjaHVuaykpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgcmVxLm9uKFwiZW5kXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChyZXEuZGVzdHJveWVkKSByZXR1cm47XG5cbiAgICAgIGNvbnN0IHJhd0JvZHkgPSBCdWZmZXIuY29uY2F0KGNodW5rcyk7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9IHJlcS5oZWFkZXJzW1wiY29udGVudC10eXBlXCJdIHx8IFwiXCI7XG5cbiAgICAgIGxldCBwYXJzZWRCb2R5O1xuICAgICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwibXVsdGlwYXJ0L2Zvcm0tZGF0YVwiKSkge1xuICAgICAgICBwYXJzZWRCb2R5ID0gcmF3Qm9keTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhcnNlZEJvZHkgPSB0aGlzLnBhcnNlQm9keShyYXdCb2R5LnRvU3RyaW5nKCksIGNvbnRlbnRUeXBlKTtcbiAgICAgIH1cblxuICAgICAgLy8gUmVtb3ZlIEFQSSBwcmVmaXggZnJvbSBwYXRoIGZvciByb3V0aW5nXG4gICAgICBjb25zdCBhcGlQYXRoID1cbiAgICAgICAgcGFyc2VkVXJsLnBhdGhuYW1lPy5zdWJzdHJpbmcodGhpcy5hcGlQcmVmaXgubGVuZ3RoKSB8fCBcIi9cIjtcblxuICAgICAgY29uc3QgaHR0cFJlcXVlc3Q6IEh0dHBSZXF1ZXN0ID0ge1xuICAgICAgICBtZXRob2Q6IHJlcS5tZXRob2QgfHwgXCJHRVRcIixcbiAgICAgICAgcGF0aDogYXBpUGF0aCxcbiAgICAgICAgcXVlcnk6IHBhcnNlZFVybC5xdWVyeSBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICAgICAgICBoZWFkZXJzOiByZXEuaGVhZGVycyBhcyBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+LFxuICAgICAgICBib2R5OiBwYXJzZWRCb2R5LFxuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnByb2Nlc3NIdHRwUmVxdWVzdChodHRwUmVxdWVzdCk7XG4gICAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKFxuICAgICAgICAgIHJlcyxcbiAgICAgICAgICByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgICAgIHJlc3BvbnNlLmJvZHksXG4gICAgICAgICAgcmVzcG9uc2UuaGVhZGVyc1xuICAgICAgICApO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyByZXF1ZXN0OiAke2Vycm9yfWApO1xuICAgICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDUwMCwgeyBlcnJvcjogXCJJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcIiB9KTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcS5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDAwLCB7IGVycm9yOiBcIkJhZCBSZXF1ZXN0XCIgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZVN0YXRpY1JlcXVlc3QoXG4gICAgcmVxOiBodHRwLkluY29taW5nTWVzc2FnZSxcbiAgICByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2UsXG4gICAgcGF0aG5hbWU6IHN0cmluZ1xuICApOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIXRoaXMuc3RhdGljRGlyKSByZXR1cm4gZmFsc2U7XG5cbiAgICBsZXQgc3RhdGljRmlsZVBhdGggPSBwYXRoLmpvaW4odGhpcy5zdGF0aWNEaXIsIHBhdGhuYW1lKTtcblxuICAgIC8vIE5vcm1hbGl6ZSB0aGUgcGF0aCB0byBwcmV2ZW50IGRpcmVjdG9yeSB0cmF2ZXJzYWxcbiAgICBzdGF0aWNGaWxlUGF0aCA9IHBhdGgubm9ybWFsaXplKHN0YXRpY0ZpbGVQYXRoKTtcbiAgICBpZiAoIXN0YXRpY0ZpbGVQYXRoLnN0YXJ0c1dpdGgodGhpcy5zdGF0aWNEaXIpKSB7XG4gICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDQwMywgeyBlcnJvcjogXCJGb3JiaWRkZW5cIiB9KTtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoc3RhdGljRmlsZVBhdGgpO1xuICAgICAgaWYgKHN0YXRzLmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgc3RhdGljRmlsZVBhdGggPSBwYXRoLmpvaW4oc3RhdGljRmlsZVBhdGgsIFwiaW5kZXguaHRtbFwiKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuc2VydmVTdGF0aWNGaWxlKHN0YXRpY0ZpbGVQYXRoKTtcbiAgICAgIGlmIChjb250ZW50KSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZFN0YXRpY1Jlc3BvbnNlKFxuICAgICAgICAgIHJlcSxcbiAgICAgICAgICByZXMsXG4gICAgICAgICAgMjAwLFxuICAgICAgICAgIGNvbnRlbnQsXG4gICAgICAgICAgdGhpcy5nZXRDb250ZW50VHlwZShzdGF0aWNGaWxlUGF0aClcbiAgICAgICAgKTtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGlmICgoZXJyb3IgYXMgTm9kZUpTLkVycm5vRXhjZXB0aW9uKS5jb2RlID09PSBcIkVOT0VOVFwiKSB7XG4gICAgICAgIC8vIFRyeSBmYWxsYmFjayB0byBpbmRleC5odG1sIGZvciBTUEEgcm91dGluZ1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGNvbnN0IGluZGV4UGF0aCA9IHBhdGguam9pbih0aGlzLnN0YXRpY0RpciwgXCJpbmRleC5odG1sXCIpO1xuICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLnNlcnZlU3RhdGljRmlsZShpbmRleFBhdGgpO1xuICAgICAgICAgIGlmIChjb250ZW50KSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnNlbmRTdGF0aWNSZXNwb25zZShcbiAgICAgICAgICAgICAgcmVxLFxuICAgICAgICAgICAgICByZXMsXG4gICAgICAgICAgICAgIDIwMCxcbiAgICAgICAgICAgICAgY29udGVudCxcbiAgICAgICAgICAgICAgXCJ0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLThcIlxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoaW5kZXhFcnJvcikge1xuICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VydmVTdGF0aWNGaWxlKGZpbGVQYXRoOiBzdHJpbmcpOiBQcm9taXNlPEJ1ZmZlciB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IGZzLnJlYWRGaWxlKGZpbGVQYXRoKTtcbiAgICAgIHJldHVybiBjb250ZW50O1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSA9PT0gXCJFTk9FTlRcIikge1xuICAgICAgICByZXR1cm4gbnVsbDsgLy8gRmlsZSBub3QgZm91bmRcbiAgICAgIH1cbiAgICAgIHRocm93IGVycm9yOyAvLyBPdGhlciBlcnJvcnNcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmRTdGF0aWNSZXNwb25zZShcbiAgICByZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLFxuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSxcbiAgICBzdGF0dXNDb2RlOiBudW1iZXIsXG4gICAgY29udGVudDogQnVmZmVyLFxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmdcbiAgKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnRFbmNvZGluZyA9IHRoaXMubmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcSk7XG4gICAgICBjb25zdCBjb21wcmVzc2VkQ29udGVudCA9IGNvbnRlbnRFbmNvZGluZ1xuICAgICAgICA/IGF3YWl0IHRoaXMuY29tcHJlc3NDb250ZW50KGNvbnRlbnQsIGNvbnRlbnRFbmNvZGluZylcbiAgICAgICAgOiBjb250ZW50O1xuXG4gICAgICBjb25zdCBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgICBcIkNvbnRlbnQtVHlwZVwiOiBjb250ZW50VHlwZSxcbiAgICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIjogdGhpcy5jb3JzT3JpZ2luLFxuICAgICAgICBcIlgtWFNTLVByb3RlY3Rpb25cIjogXCIxOyBtb2RlPWJsb2NrXCIsXG4gICAgICAgIFwiWC1GcmFtZS1PcHRpb25zXCI6IFwiREVOWVwiLFxuICAgICAgICBcIlgtQ29udGVudC1UeXBlLU9wdGlvbnNcIjogXCJub3NuaWZmXCIsXG4gICAgICAgIFwiQ29udGVudC1MZW5ndGhcIjogY29tcHJlc3NlZENvbnRlbnQubGVuZ3RoLnRvU3RyaW5nKCksXG4gICAgICAgIFwiQ2FjaGUtQ29udHJvbFwiOiBcIm5vLWNhY2hlXCIsXG4gICAgICB9O1xuXG4gICAgICBpZiAoY29udGVudEVuY29kaW5nKSB7XG4gICAgICAgIGhlYWRlcnNbXCJDb250ZW50LUVuY29kaW5nXCJdID0gY29udGVudEVuY29kaW5nO1xuICAgICAgfVxuXG4gICAgICBpZiAoXG4gICAgICAgIGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwiamF2YXNjcmlwdFwiKSAmJlxuICAgICAgICBjb250ZW50LmluY2x1ZGVzKCd0eXBlPVwibW9kdWxlXCInKVxuICAgICAgKSB7XG4gICAgICAgIGhlYWRlcnNbXCJDb250ZW50LVR5cGVcIl0gPSBcImFwcGxpY2F0aW9uL2phdmFzY3JpcHQ7IGNoYXJzZXQ9dXRmLThcIjtcbiAgICAgIH1cblxuICAgICAgcmVzLndyaXRlSGVhZChzdGF0dXNDb2RlLCBoZWFkZXJzKTtcbiAgICAgIHJlcy5lbmQoY29tcHJlc3NlZENvbnRlbnQpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBzZW5kaW5nIHN0YXRpYyByZXNwb25zZTogJHtlcnJvcn1gKTtcbiAgICAgIHJlcy53cml0ZUhlYWQoNTAwLCB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiOiB0aGlzLmNvcnNPcmlnaW4sXG4gICAgICB9KTtcbiAgICAgIHJlcy5lbmQoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogXCJJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcIiB9KSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRDb250ZW50VHlwZShmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBleHQgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgY29udGVudFR5cGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICAgXCIuaHRtbFwiOiBcInRleHQvaHRtbDsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCIuanNcIjogXCJhcHBsaWNhdGlvbi9qYXZhc2NyaXB0OyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICBcIi5tanNcIjogXCJhcHBsaWNhdGlvbi9qYXZhc2NyaXB0OyBjaGFyc2V0PXV0Zi04XCIsXG4gICAgICBcIi5jc3NcIjogXCJ0ZXh0L2NzczsgY2hhcnNldD11dGYtOFwiLFxuICAgICAgXCIuanNvblwiOiBcImFwcGxpY2F0aW9uL2pzb247IGNoYXJzZXQ9dXRmLThcIixcbiAgICAgIFwiLnBuZ1wiOiBcImltYWdlL3BuZ1wiLFxuICAgICAgXCIuanBnXCI6IFwiaW1hZ2UvanBlZ1wiLFxuICAgICAgXCIuanBlZ1wiOiBcImltYWdlL2pwZWdcIixcbiAgICAgIFwiLmdpZlwiOiBcImltYWdlL2dpZlwiLFxuICAgICAgXCIuc3ZnXCI6IFwiaW1hZ2Uvc3ZnK3htbFwiLFxuICAgICAgXCIuaWNvXCI6IFwiaW1hZ2UveC1pY29uXCIsXG4gICAgICBcIi53b2ZmXCI6IFwiZm9udC93b2ZmXCIsXG4gICAgICBcIi53b2ZmMlwiOiBcImZvbnQvd29mZjJcIixcbiAgICAgIFwiLnR0ZlwiOiBcImZvbnQvdHRmXCIsXG4gICAgICBcIi5lb3RcIjogXCJhcHBsaWNhdGlvbi92bmQubXMtZm9udG9iamVjdFwiLFxuICAgIH07XG5cbiAgICByZXR1cm4gY29udGVudFR5cGVzW2V4dF0gfHwgXCJhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW1cIjtcbiAgfVxuXG4gIHByaXZhdGUgcGFyc2VCb2R5KGJvZHk6IHN0cmluZywgY29udGVudFR5cGU/OiBzdHJpbmcpOiBhbnkge1xuICAgIGlmICghY29udGVudFR5cGUpIHJldHVybiBib2R5O1xuXG4gICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwiYXBwbGljYXRpb24vanNvblwiKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYm9keSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLndhcm4oYEZhaWxlZCB0byBwYXJzZSBKU09OIGJvZHk6ICR7ZXJyb3J9YCk7XG4gICAgICAgIHJldHVybiBib2R5O1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEhhbmRsZSBtdWx0aXBhcnQvZm9ybS1kYXRhXG4gICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKFwibXVsdGlwYXJ0L2Zvcm0tZGF0YVwiKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgLy8gRm9yIG11bHRpcGFydC9mb3JtLWRhdGEsIHdlIG5lZWQgdG8gcGFyc2UgdGhlIHJhdyBib2R5XG4gICAgICAgIC8vIFRoZSBib2R5IHdpbGwgYmUgYXZhaWxhYmxlIGFzIEJ1ZmZlciBvciBzdHJpbmdcbiAgICAgICAgcmV0dXJuIGJvZHk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLndhcm4oYEZhaWxlZCB0byBwYXJzZSBtdWx0aXBhcnQvZm9ybS1kYXRhOiAke2Vycm9yfWApO1xuICAgICAgICByZXR1cm4gYm9keTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gYm9keTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VuZFJlc3BvbnNlKFxuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZSxcbiAgICBzdGF0dXNDb2RlOiBudW1iZXIsXG4gICAgYm9keTogYW55LFxuICAgIGhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7fVxuICApIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5zdHJpbmdpZnkoYm9keSk7XG4gICAgICBjb25zdCBjb250ZW50RW5jb2RpbmcgPSB0aGlzLm5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhyZXMpO1xuICAgICAgY29uc3QgY29tcHJlc3NlZENvbnRlbnQgPSBjb250ZW50RW5jb2RpbmdcbiAgICAgICAgPyBhd2FpdCB0aGlzLmNvbXByZXNzQ29udGVudChCdWZmZXIuZnJvbShyZXNwb25zZUJvZHkpLCBjb250ZW50RW5jb2RpbmcpXG4gICAgICAgIDogcmVzcG9uc2VCb2R5O1xuXG4gICAgICBjb25zdCBmaW5hbEhlYWRlcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgICBcIkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpblwiOiB0aGlzLmNvcnNPcmlnaW4sXG4gICAgICAgIFwiWC1YU1MtUHJvdGVjdGlvblwiOiBcIjE7IG1vZGU9YmxvY2tcIixcbiAgICAgICAgXCJYLUZyYW1lLU9wdGlvbnNcIjogXCJERU5ZXCIsXG4gICAgICAgIFwiWC1Db250ZW50LVR5cGUtT3B0aW9uc1wiOiBcIm5vc25pZmZcIixcbiAgICAgICAgXCJDb250ZW50LUxlbmd0aFwiOiBCdWZmZXIuYnl0ZUxlbmd0aChjb21wcmVzc2VkQ29udGVudCkudG9TdHJpbmcoKSxcbiAgICAgICAgLi4uaGVhZGVycyxcbiAgICAgIH07XG5cbiAgICAgIGlmIChjb250ZW50RW5jb2RpbmcpIHtcbiAgICAgICAgZmluYWxIZWFkZXJzW1wiQ29udGVudC1FbmNvZGluZ1wiXSA9IGNvbnRlbnRFbmNvZGluZztcbiAgICAgIH1cblxuICAgICAgcmVzLndyaXRlSGVhZChzdGF0dXNDb2RlLCBmaW5hbEhlYWRlcnMpO1xuICAgICAgcmVzLmVuZChjb21wcmVzc2VkQ29udGVudCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHNlbmRpbmcgcmVzcG9uc2U6ICR7ZXJyb3J9YCk7XG4gICAgICAvLyBTZW5kIGEgYmFzaWMgZXJyb3IgcmVzcG9uc2Ugd2l0aG91dCBjb21wcmVzc2lvbiBpZiBzb21ldGhpbmcgZ29lcyB3cm9uZ1xuICAgICAgcmVzLndyaXRlSGVhZCg1MDAsIHtcbiAgICAgICAgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIsXG4gICAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IHRoaXMuY29yc09yaWdpbixcbiAgICAgIH0pO1xuICAgICAgcmVzLmVuZChKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBcIkludGVybmFsIFNlcnZlciBFcnJvclwiIH0pKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIG5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhcbiAgICByZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlIHwgaHR0cC5TZXJ2ZXJSZXNwb25zZVxuICApOiBzdHJpbmcgfCBudWxsIHtcbiAgICBjb25zdCBhY2NlcHRFbmNvZGluZyA9XG4gICAgICBcImhlYWRlcnNcIiBpbiByZXFcbiAgICAgICAgPyByZXEuaGVhZGVyc1tcImFjY2VwdC1lbmNvZGluZ1wiXVxuICAgICAgICA6IChyZXEgYXMgYW55KS5fcmVxPy5oZWFkZXJzW1wiYWNjZXB0LWVuY29kaW5nXCJdOyAvLyBGYWxsYmFjayBmb3IgU2VydmVyUmVzcG9uc2VcblxuICAgIGlmICghYWNjZXB0RW5jb2RpbmcpIHJldHVybiBudWxsO1xuXG4gICAgaWYgKHR5cGVvZiBhY2NlcHRFbmNvZGluZyA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgaWYgKGFjY2VwdEVuY29kaW5nLmluY2x1ZGVzKFwiZ3ppcFwiKSkgcmV0dXJuIFwiZ3ppcFwiO1xuICAgICAgaWYgKGFjY2VwdEVuY29kaW5nLmluY2x1ZGVzKFwiZGVmbGF0ZVwiKSkgcmV0dXJuIFwiZGVmbGF0ZVwiO1xuICAgIH1cblxuICAgIHJldHVybiBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBjb21wcmVzc0NvbnRlbnQoXG4gICAgY29udGVudDogQnVmZmVyIHwgc3RyaW5nLFxuICAgIGVuY29kaW5nOiBzdHJpbmdcbiAgKTogUHJvbWlzZTxCdWZmZXIgfCBzdHJpbmc+IHtcbiAgICBpZiAodHlwZW9mIGNvbnRlbnQgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgIGNvbnRlbnQgPSBCdWZmZXIuZnJvbShjb250ZW50KTtcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgaWYgKGVuY29kaW5nID09PSBcImd6aXBcIikge1xuICAgICAgICB6bGliLmd6aXAoY29udGVudCwgKGVyciwgcmVzdWx0KSA9PiB7XG4gICAgICAgICAgaWYgKGVycikgcmVqZWN0KGVycik7XG4gICAgICAgICAgZWxzZSByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIGlmIChlbmNvZGluZyA9PT0gXCJkZWZsYXRlXCIpIHtcbiAgICAgICAgemxpYi5kZWZsYXRlKGNvbnRlbnQsIChlcnIsIHJlc3VsdCkgPT4ge1xuICAgICAgICAgIGlmIChlcnIpIHJlamVjdChlcnIpO1xuICAgICAgICAgIGVsc2UgcmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJlc29sdmUoY29udGVudCk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NIdHRwUmVxdWVzdChcbiAgICBodHRwUmVxdWVzdDogSHR0cFJlcXVlc3RcbiAgKTogUHJvbWlzZTxIdHRwUmVzcG9uc2U+IHtcbiAgICBjb25zdCByZXF1ZXN0VHlwZSA9IGAke2h0dHBSZXF1ZXN0Lm1ldGhvZH06JHtodHRwUmVxdWVzdC5wYXRofWA7XG4gICAgdGhpcy5pbmZvKGBSZWNlaXZlZCByZXF1ZXN0OiAke3JlcXVlc3RUeXBlfWApO1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5tYWtlUmVxdWVzdDxIdHRwUmVzcG9uc2U+KHtcbiAgICAgIHRvOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgYm9keTogaHR0cFJlcXVlc3QsXG4gICAgfSk7XG4gICAgcmV0dXJuIHJlc3BvbnNlLmJvZHkuZGF0YTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcbiAgICAgIHRoaXMuc2VydmVyLmxpc3Rlbih0aGlzLnBvcnQsICgpID0+IHtcbiAgICAgICAgdGhpcy5pbmZvKGBXZWIgc2VydmVyIGxpc3RlbmluZyBvbiBwb3J0ICR7dGhpcy5wb3J0fWApO1xuICAgICAgICByZXNvbHZlKCk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdG9wRGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIuY2xvc2UoKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oXCJXZWIgc2VydmVyIHN0b3BwZWRcIik7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlZmF1bHRNZXNzYWdlSGFuZGxlcihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxIdHRwUmVxdWVzdD5cbiAgKTogUHJvbWlzZTxIdHRwUmVzcG9uc2U+IHtcbiAgICB0aGlzLndhcm4oYFBhdGggbm90IGZvdW5kOiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWApO1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA0MDQsXG4gICAgICBoZWFkZXJzOiB7IFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiIH0sXG4gICAgICBib2R5OiB7IG1lc3NhZ2U6IFwiUGF0aCBub3QgZm91bmRcIiB9LFxuICAgIH07XG4gIH1cbn1cbiJdfQ==