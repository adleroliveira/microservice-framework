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
        this.server = http_1.default.createServer(this.handleRequest.bind(this));
    }
    async handleRequest(req, res) {
        const parsedUrl = url_1.default.parse(req.url || "", true);
        if (this.staticDir && req.method === "GET") {
            let staticFilePath = path_1.default.join(this.staticDir, parsedUrl.pathname || "");
            // Check if the path is a directory
            try {
                const stats = await promises_1.default.stat(staticFilePath);
                if (stats.isDirectory()) {
                    // If it's a directory, look for index.html
                    staticFilePath = path_1.default.join(staticFilePath, "index.html");
                }
            }
            catch (error) {
                // If stat fails, just continue with the original path
            }
            try {
                const content = await this.serveStaticFile(staticFilePath);
                if (content) {
                    this.sendStaticResponse(res, 200, content, this.getContentType(staticFilePath));
                    return;
                }
            }
            catch (error) {
                if (error.code !== "ENOENT") {
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
            }
            else {
                body += chunk.toString();
            }
        });
        req.on("end", async () => {
            if (req.destroyed)
                return;
            const httpRequest = {
                method: req.method || "GET",
                path: parsedUrl.pathname || "/",
                query: parsedUrl.query,
                headers: req.headers,
                body: this.parseBody(body, req.headers["content-type"]),
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
    sendStaticResponse(res, statusCode, body, contentType) {
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
            zlib_1.default.gzip(body, (_, result) => res.end(result));
        }
        else if (contentEncoding === "deflate") {
            zlib_1.default.deflate(body, (_, result) => res.end(result));
        }
        else {
            res.end(body);
        }
    }
    getContentType(filePath) {
        const ext = path_1.default.extname(filePath).toLowerCase();
        const mimeTypes = {
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
    parseBody(body, contentType) {
        if (contentType?.includes("application/json")) {
            try {
                return JSON.parse(body);
            }
            catch (error) {
                this.warn(`Failed to parse JSON body: ${error}`);
            }
        }
        return body;
    }
    sendResponse(res, statusCode, body, headers = {}) {
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
            zlib_1.default.gzip(responseBody, (_, result) => res.end(result));
        }
        else if (contentEncoding === "deflate") {
            zlib_1.default.deflate(responseBody, (_, result) => res.end(result));
        }
        else {
            res.end(responseBody);
        }
    }
    negotiateContentEncoding(res) {
        const acceptEncoding = res.getHeader("accept-encoding") || "";
        if (acceptEncoding.includes("gzip"))
            return "gzip";
        if (acceptEncoding.includes("deflate"))
            return "deflate";
        return null;
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3NlcnZpY2VzL1dlYlNlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7QUFBQSxnREFBd0I7QUFDeEIsOENBQXNCO0FBQ3RCLGdEQUF3QjtBQUN4QixnREFBd0I7QUFDeEIsMkRBQTZCO0FBQzdCLG9FQUFnRjtBQWdDaEYsTUFBYSxTQUFVLFNBQVEsNkNBRzlCO0lBUUMsWUFBWSxPQUFpQixFQUFFLE1BQXVCO1FBQ3BELEtBQUssQ0FBQyxPQUFPLEVBQUUsTUFBTSxDQUFDLENBQUM7UUFDdkIsSUFBSSxDQUFDLElBQUksR0FBRyxNQUFNLENBQUMsSUFBSSxJQUFJLElBQUksQ0FBQztRQUNoQyxJQUFJLENBQUMsV0FBVyxHQUFHLE1BQU0sQ0FBQyxXQUFXLElBQUksR0FBRyxDQUFDO1FBQzdDLElBQUksQ0FBQyxPQUFPLEdBQUcsTUFBTSxDQUFDLE9BQU8sSUFBSSxLQUFLLENBQUM7UUFDdkMsSUFBSSxDQUFDLFVBQVUsR0FBRyxNQUFNLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQztRQUMzQyxJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDO1FBQzFDLElBQUksQ0FBQyxNQUFNLEdBQUcsY0FBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO0lBQ2pFLENBQUM7SUFFTyxLQUFLLENBQUMsYUFBYSxDQUN6QixHQUF5QixFQUN6QixHQUF3QjtRQUV4QixNQUFNLFNBQVMsR0FBRyxhQUFHLENBQUMsS0FBSyxDQUFDLEdBQUcsQ0FBQyxHQUFHLElBQUksRUFBRSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRWpELElBQUksSUFBSSxDQUFDLFNBQVMsSUFBSSxHQUFHLENBQUMsTUFBTSxLQUFLLEtBQUssRUFBRSxDQUFDO1lBQzNDLElBQUksY0FB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Q2YsT0FBTyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFO1lBQy9DLElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBRTtTQUNwQyxDQUFDO0lBQ0osQ0FBQztDQVVGO0FBelFELDhCQXlRQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBodHRwIGZyb20gXCJodHRwXCI7XG5pbXBvcnQgdXJsIGZyb20gXCJ1cmxcIjtcbmltcG9ydCB6bGliIGZyb20gXCJ6bGliXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiO1xuaW1wb3J0IHsgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLCBJU2VydmVyQ29uZmlnIH0gZnJvbSBcIi4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHtcbiAgSUJhY2tFbmQsXG4gIElSZXF1ZXN0LFxuICBJU2Vzc2lvblN0b3JlLFxuICBJQXV0aGVudGljYXRpb25Qcm92aWRlcixcbn0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcblxuZXhwb3J0IHR5cGUgSHR0cFJlcXVlc3QgPSB7XG4gIG1ldGhvZDogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHF1ZXJ5OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBib2R5OiBhbnk7XG59O1xuXG5leHBvcnQgdHlwZSBIdHRwUmVzcG9uc2UgPSB7XG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgYm9keTogYW55O1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBtYXhCb2R5U2l6ZT86IG51bWJlcjtcbiAgdGltZW91dD86IG51bWJlcjtcbiAgY29yc09yaWdpbj86IHN0cmluZztcbiAgc3RhdGljRGlyPzogc3RyaW5nO1xuICBhdXRoUHJvdmlkZXI/OiBJQXV0aGVudGljYXRpb25Qcm92aWRlcjtcbiAgc2Vzc2lvblN0b3JlPzogSVNlc3Npb25TdG9yZTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNlcnZlciBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgSHR0cFJlcXVlc3QsXG4gIEh0dHBSZXNwb25zZVxuPiB7XG4gIHByaXZhdGUgc2VydmVyOiBodHRwLlNlcnZlcjtcbiAgcHJpdmF0ZSBwb3J0OiBudW1iZXI7XG4gIHByaXZhdGUgbWF4Qm9keVNpemU6IG51bWJlcjtcbiAgcHJpdmF0ZSB0aW1lb3V0OiBudW1iZXI7XG4gIHByaXZhdGUgY29yc09yaWdpbjogc3RyaW5nO1xuICBwcml2YXRlIHN0YXRpY0Rpcjogc3RyaW5nIHwgbnVsbDtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucG9ydCA9IGNvbmZpZy5wb3J0IHx8IDgwODA7XG4gICAgdGhpcy5tYXhCb2R5U2l6ZSA9IGNvbmZpZy5tYXhCb2R5U2l6ZSB8fCAxZTY7XG4gICAgdGhpcy50aW1lb3V0ID0gY29uZmlnLnRpbWVvdXQgfHwgMzAwMDA7XG4gICAgdGhpcy5jb3JzT3JpZ2luID0gY29uZmlnLmNvcnNPcmlnaW4gfHwgXCIqXCI7XG4gICAgdGhpcy5zdGF0aWNEaXIgPSBjb25maWcuc3RhdGljRGlyIHx8IG51bGw7XG4gICAgdGhpcy5zZXJ2ZXIgPSBodHRwLmNyZWF0ZVNlcnZlcih0aGlzLmhhbmRsZVJlcXVlc3QuYmluZCh0aGlzKSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZVJlcXVlc3QoXG4gICAgcmVxOiBodHRwLkluY29taW5nTWVzc2FnZSxcbiAgICByZXM6IGh0dHAuU2VydmVyUmVzcG9uc2VcbiAgKSB7XG4gICAgY29uc3QgcGFyc2VkVXJsID0gdXJsLnBhcnNlKHJlcS51cmwgfHwgXCJcIiwgdHJ1ZSk7XG5cbiAgICBpZiAodGhpcy5zdGF0aWNEaXIgJiYgcmVxLm1ldGhvZCA9PT0gXCJHRVRcIikge1xuICAgICAgbGV0IHN0YXRpY0ZpbGVQYXRoID0gcGF0aC5qb2luKHRoaXMuc3RhdGljRGlyLCBwYXJzZWRVcmwucGF0aG5hbWUgfHwgXCJcIik7XG5cbiAgICAgIC8vIENoZWNrIGlmIHRoZSBwYXRoIGlzIGEgZGlyZWN0b3J5XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IGZzLnN0YXQoc3RhdGljRmlsZVBhdGgpO1xuICAgICAgICBpZiAoc3RhdHMuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICAgIC8vIElmIGl0J3MgYSBkaXJlY3RvcnksIGxvb2sgZm9yIGluZGV4Lmh0bWxcbiAgICAgICAgICBzdGF0aWNGaWxlUGF0aCA9IHBhdGguam9pbihzdGF0aWNGaWxlUGF0aCwgXCJpbmRleC5odG1sXCIpO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAvLyBJZiBzdGF0IGZhaWxzLCBqdXN0IGNvbnRpbnVlIHdpdGggdGhlIG9yaWdpbmFsIHBhdGhcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuc2VydmVTdGF0aWNGaWxlKHN0YXRpY0ZpbGVQYXRoKTtcbiAgICAgICAgaWYgKGNvbnRlbnQpIHtcbiAgICAgICAgICB0aGlzLnNlbmRTdGF0aWNSZXNwb25zZShcbiAgICAgICAgICAgIHJlcyxcbiAgICAgICAgICAgIDIwMCxcbiAgICAgICAgICAgIGNvbnRlbnQsXG4gICAgICAgICAgICB0aGlzLmdldENvbnRlbnRUeXBlKHN0YXRpY0ZpbGVQYXRoKVxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSAhPT0gXCJFTk9FTlRcIikge1xuICAgICAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHNlcnZpbmcgc3RhdGljIGZpbGU6ICR7ZXJyb3J9YCk7XG4gICAgICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA1MDAsIHsgZXJyb3I6IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCIgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGJvZHkgPSBcIlwiO1xuICAgIGxldCBib2R5U2l6ZSA9IDA7XG5cbiAgICByZXEuc2V0VGltZW91dCh0aGlzLnRpbWVvdXQsICgpID0+IHtcbiAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDA4LCB7IGVycm9yOiBcIlJlcXVlc3QgVGltZW91dFwiIH0pO1xuICAgIH0pO1xuXG4gICAgcmVxLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgIGJvZHlTaXplICs9IGNodW5rLmxlbmd0aDtcbiAgICAgIGlmIChib2R5U2l6ZSA+IHRoaXMubWF4Qm9keVNpemUpIHtcbiAgICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA0MTMsIHsgZXJyb3I6IFwiUGF5bG9hZCBUb28gTGFyZ2VcIiB9KTtcbiAgICAgICAgcmVxLmRlc3Ryb3koKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJvZHkgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcS5vbihcImVuZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocmVxLmRlc3Ryb3llZCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBodHRwUmVxdWVzdDogSHR0cFJlcXVlc3QgPSB7XG4gICAgICAgIG1ldGhvZDogcmVxLm1ldGhvZCB8fCBcIkdFVFwiLFxuICAgICAgICBwYXRoOiBwYXJzZWRVcmwucGF0aG5hbWUgfHwgXCIvXCIsXG4gICAgICAgIHF1ZXJ5OiBwYXJzZWRVcmwucXVlcnkgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgICAgICAgaGVhZGVyczogcmVxLmhlYWRlcnMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgICAgICAgYm9keTogdGhpcy5wYXJzZUJvZHkoYm9keSwgcmVxLmhlYWRlcnNbXCJjb250ZW50LXR5cGVcIl0pLFxuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnByb2Nlc3NIdHRwUmVxdWVzdChodHRwUmVxdWVzdCk7XG4gICAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKFxuICAgICAgICAgIHJlcyxcbiAgICAgICAgICByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgICAgIHJlc3BvbnNlLmJvZHksXG4gICAgICAgICAgcmVzcG9uc2UuaGVhZGVyc1xuICAgICAgICApO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyByZXF1ZXN0OiAke2Vycm9yfWApO1xuICAgICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDUwMCwgeyBlcnJvcjogXCJJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcIiB9KTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcS5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDAwLCB7IGVycm9yOiBcIkJhZCBSZXF1ZXN0XCIgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlcnZlU3RhdGljRmlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxCdWZmZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XG4gICAgICByZXR1cm4gY29udGVudDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7IC8vIEZpbGUgbm90IGZvdW5kXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvcjsgLy8gT3RoZXIgZXJyb3JzXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzZW5kU3RhdGljUmVzcG9uc2UoXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHN0YXR1c0NvZGU6IG51bWJlcixcbiAgICBib2R5OiBCdWZmZXIsXG4gICAgY29udGVudFR5cGU6IHN0cmluZ1xuICApIHtcbiAgICBjb25zdCBjb250ZW50RW5jb2RpbmcgPSB0aGlzLm5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhyZXMpO1xuXG4gICAgcmVzLndyaXRlSGVhZChzdGF0dXNDb2RlLCB7XG4gICAgICBcIkNvbnRlbnQtVHlwZVwiOiBjb250ZW50VHlwZSxcbiAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IHRoaXMuY29yc09yaWdpbixcbiAgICAgIFwiWC1YU1MtUHJvdGVjdGlvblwiOiBcIjE7IG1vZGU9YmxvY2tcIixcbiAgICAgIFwiWC1GcmFtZS1PcHRpb25zXCI6IFwiREVOWVwiLFxuICAgICAgXCJYLUNvbnRlbnQtVHlwZS1PcHRpb25zXCI6IFwibm9zbmlmZlwiLFxuICAgICAgLi4uKGNvbnRlbnRFbmNvZGluZyA/IHsgXCJDb250ZW50LUVuY29kaW5nXCI6IGNvbnRlbnRFbmNvZGluZyB9IDoge30pLFxuICAgIH0pO1xuXG4gICAgaWYgKGNvbnRlbnRFbmNvZGluZyA9PT0gXCJnemlwXCIpIHtcbiAgICAgIHpsaWIuZ3ppcChib2R5LCAoXywgcmVzdWx0KSA9PiByZXMuZW5kKHJlc3VsdCkpO1xuICAgIH0gZWxzZSBpZiAoY29udGVudEVuY29kaW5nID09PSBcImRlZmxhdGVcIikge1xuICAgICAgemxpYi5kZWZsYXRlKGJvZHksIChfLCByZXN1bHQpID0+IHJlcy5lbmQocmVzdWx0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlcy5lbmQoYm9keSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRDb250ZW50VHlwZShmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBleHQgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbWltZVR5cGVzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9ID0ge1xuICAgICAgXCIuaHRtbFwiOiBcInRleHQvaHRtbFwiLFxuICAgICAgXCIuanNcIjogXCJ0ZXh0L2phdmFzY3JpcHRcIixcbiAgICAgIFwiLmNzc1wiOiBcInRleHQvY3NzXCIsXG4gICAgICBcIi5qc29uXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgXCIucG5nXCI6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICBcIi5qcGdcIjogXCJpbWFnZS9qcGVnXCIsXG4gICAgICBcIi5naWZcIjogXCJpbWFnZS9naWZcIixcbiAgICAgIFwiLnN2Z1wiOiBcImltYWdlL3N2Zyt4bWxcIixcbiAgICAgIFwiLndhdlwiOiBcImF1ZGlvL3dhdlwiLFxuICAgICAgXCIubXA0XCI6IFwidmlkZW8vbXA0XCIsXG4gICAgICBcIi53b2ZmXCI6IFwiYXBwbGljYXRpb24vZm9udC13b2ZmXCIsXG4gICAgICBcIi50dGZcIjogXCJhcHBsaWNhdGlvbi9mb250LXR0ZlwiLFxuICAgICAgXCIuZW90XCI6IFwiYXBwbGljYXRpb24vdm5kLm1zLWZvbnRvYmplY3RcIixcbiAgICAgIFwiLm90ZlwiOiBcImFwcGxpY2F0aW9uL2ZvbnQtb3RmXCIsXG4gICAgICBcIi53YXNtXCI6IFwiYXBwbGljYXRpb24vd2FzbVwiLFxuICAgIH07XG4gICAgcmV0dXJuIG1pbWVUeXBlc1tleHRdIHx8IFwiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtXCI7XG4gIH1cblxuICBwcml2YXRlIHBhcnNlQm9keShib2R5OiBzdHJpbmcsIGNvbnRlbnRUeXBlPzogc3RyaW5nKTogYW55IHtcbiAgICBpZiAoY29udGVudFR5cGU/LmluY2x1ZGVzKFwiYXBwbGljYXRpb24vanNvblwiKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYm9keSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLndhcm4oYEZhaWxlZCB0byBwYXJzZSBKU09OIGJvZHk6ICR7ZXJyb3J9YCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBib2R5O1xuICB9XG5cbiAgcHJpdmF0ZSBzZW5kUmVzcG9uc2UoXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHN0YXR1c0NvZGU6IG51bWJlcixcbiAgICBib2R5OiBhbnksXG4gICAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICkge1xuICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04uc3RyaW5naWZ5KGJvZHkpO1xuICAgIGNvbnN0IGNvbnRlbnRFbmNvZGluZyA9IHRoaXMubmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcyk7XG5cbiAgICByZXMud3JpdGVIZWFkKHN0YXR1c0NvZGUsIHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIjogdGhpcy5jb3JzT3JpZ2luLFxuICAgICAgXCJYLVhTUy1Qcm90ZWN0aW9uXCI6IFwiMTsgbW9kZT1ibG9ja1wiLFxuICAgICAgXCJYLUZyYW1lLU9wdGlvbnNcIjogXCJERU5ZXCIsXG4gICAgICBcIlgtQ29udGVudC1UeXBlLU9wdGlvbnNcIjogXCJub3NuaWZmXCIsXG4gICAgICAuLi5oZWFkZXJzLFxuICAgICAgLi4uKGNvbnRlbnRFbmNvZGluZyA/IHsgXCJDb250ZW50LUVuY29kaW5nXCI6IGNvbnRlbnRFbmNvZGluZyB9IDoge30pLFxuICAgIH0pO1xuXG4gICAgaWYgKGNvbnRlbnRFbmNvZGluZyA9PT0gXCJnemlwXCIpIHtcbiAgICAgIHpsaWIuZ3ppcChyZXNwb25zZUJvZHksIChfLCByZXN1bHQpID0+IHJlcy5lbmQocmVzdWx0KSk7XG4gICAgfSBlbHNlIGlmIChjb250ZW50RW5jb2RpbmcgPT09IFwiZGVmbGF0ZVwiKSB7XG4gICAgICB6bGliLmRlZmxhdGUocmVzcG9uc2VCb2R5LCAoXywgcmVzdWx0KSA9PiByZXMuZW5kKHJlc3VsdCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXMuZW5kKHJlc3BvbnNlQm9keSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBuZWdvdGlhdGVDb250ZW50RW5jb2RpbmcocmVzOiBodHRwLlNlcnZlclJlc3BvbnNlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgYWNjZXB0RW5jb2RpbmcgPSAocmVzLmdldEhlYWRlcihcImFjY2VwdC1lbmNvZGluZ1wiKSBhcyBzdHJpbmcpIHx8IFwiXCI7XG4gICAgaWYgKGFjY2VwdEVuY29kaW5nLmluY2x1ZGVzKFwiZ3ppcFwiKSkgcmV0dXJuIFwiZ3ppcFwiO1xuICAgIGlmIChhY2NlcHRFbmNvZGluZy5pbmNsdWRlcyhcImRlZmxhdGVcIikpIHJldHVybiBcImRlZmxhdGVcIjtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0h0dHBSZXF1ZXN0KFxuICAgIGh0dHBSZXF1ZXN0OiBIdHRwUmVxdWVzdFxuICApOiBQcm9taXNlPEh0dHBSZXNwb25zZT4ge1xuICAgIGNvbnN0IHJlcXVlc3RUeXBlID0gYCR7aHR0cFJlcXVlc3QubWV0aG9kfToke2h0dHBSZXF1ZXN0LnBhdGh9YDtcbiAgICB0aGlzLmluZm8oYFJlY2VpdmVkIHJlcXVlc3Q6ICR7cmVxdWVzdFR5cGV9YCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PEh0dHBSZXNwb25zZT4oe1xuICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICBib2R5OiBodHRwUmVxdWVzdCxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcG9uc2UuYm9keS5kYXRhO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oYFdlYiBzZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgJHt0aGlzLnBvcnR9YCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5jbG9zZSgoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhcIldlYiBzZXJ2ZXIgc3RvcHBlZFwiKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PEh0dHBSZXF1ZXN0PlxuICApOiBQcm9taXNlPEh0dHBSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihgUGF0aCBub3QgZm91bmQ6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgIGJvZHk6IHsgbWVzc2FnZTogXCJQYXRoIG5vdCBmb3VuZFwiIH0sXG4gICAgfTtcbiAgfVxuXG4gIC8vIEBSZXF1ZXN0SGFuZGxlcjxIdHRwUmVxdWVzdD4oXCJHRVQ6L1wiKVxuICAvLyBwcm90ZWN0ZWQgYXN5bmMgaGFuZGxlUm9vdChyZXF1ZXN0OiBIdHRwUmVxdWVzdCk6IFByb21pc2U8SHR0cFJlc3BvbnNlPiB7XG4gIC8vICAgcmV0dXJuIHtcbiAgLy8gICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgLy8gICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgLy8gICAgIGJvZHk6IHsgbWVzc2FnZTogXCJXZWxjb21lIHRvIHRoZSBXZWIgU2VydmVyIVwiIH0sXG4gIC8vICAgfTtcbiAgLy8gfVxufVxuIl19