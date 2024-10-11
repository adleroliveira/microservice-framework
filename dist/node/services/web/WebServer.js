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
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
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
                this.info(`Trying to serve static file: ${staticFilePath}`);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiV2ViU2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vc3JjL3NlcnZpY2VzL3dlYi9XZWJTZXJ2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7O0FBQUEsZ0RBQXdCO0FBQ3hCLDhDQUFzQjtBQUN0QixnREFBd0I7QUFDeEIsZ0RBQXdCO0FBQ3hCLDJEQUE2QjtBQUM3Qix1RUFHcUM7QUF5QnJDLE1BQWEsU0FBVSxTQUFRLDZDQUc5QjtJQVFDLFlBQVksT0FBaUIsRUFBRSxNQUF1QjtRQUNwRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3ZCLElBQUksQ0FBQyxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUksSUFBSSxJQUFJLENBQUM7UUFDaEMsSUFBSSxDQUFDLFdBQVcsR0FBRyxNQUFNLENBQUMsV0FBVyxJQUFJLEdBQUcsQ0FBQztRQUM3QyxJQUFJLENBQUMsT0FBTyxHQUFHLE1BQU0sQ0FBQyxPQUFPLElBQUksS0FBSyxDQUFDO1FBQ3ZDLElBQUksQ0FBQyxVQUFVLEdBQUcsTUFBTSxDQUFDLFVBQVUsSUFBSSxHQUFHLENBQUM7UUFDM0MsSUFBSSxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQztRQUMxQyxJQUFJLENBQUMsTUFBTSxHQUFHLGNBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztJQUNqRSxDQUFDO0lBRU8sS0FBSyxDQUFDLGFBQWEsQ0FDekIsR0FBeUIsRUFDekIsR0FBd0I7UUFFeEIsTUFBTSxTQUFTLEdBQUcsYUFBRyxDQUFDLEtBQUssQ0FBQyxHQUFHLENBQUMsR0FBRyxJQUFJLEVBQUUsRUFBRSxJQUFJLENBQUMsQ0FBQztRQUVqRCxJQUFJLElBQUksQ0FBQyxTQUFTLElBQUksR0FBRyxDQUFDLE1BQU0sS0FBSyxLQUFLLEVBQUUsQ0FBQztZQUMzQyxJ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QU0sQ0FBQyxXQUFXLEVBQUUsQ0FBQyxDQUFDO1FBQzNELE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtZQUMvQyxJQUFJLEVBQUUsRUFBRSxPQUFPLEVBQUUsZ0JBQWdCLEVBQUU7U0FDcEMsQ0FBQztJQUNKLENBQUM7Q0FVRjtBQTFRRCw4QkEwUUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgaHR0cCBmcm9tIFwiaHR0cFwiO1xuaW1wb3J0IHVybCBmcm9tIFwidXJsXCI7XG5pbXBvcnQgemxpYiBmcm9tIFwiemxpYlwiO1xuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIjtcbmltcG9ydCBmcyBmcm9tIFwiZnMvcHJvbWlzZXNcIjtcbmltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbn0gZnJvbSBcIi4uLy4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHsgSUJhY2tFbmQsIElSZXF1ZXN0IH0gZnJvbSBcIi4uLy4uL2ludGVyZmFjZXNcIjtcblxuZXhwb3J0IHR5cGUgSHR0cFJlcXVlc3QgPSB7XG4gIG1ldGhvZDogc3RyaW5nO1xuICBwYXRoOiBzdHJpbmc7XG4gIHF1ZXJ5OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBoZWFkZXJzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+O1xuICBib2R5OiBhbnk7XG59O1xuXG5leHBvcnQgdHlwZSBIdHRwUmVzcG9uc2UgPSB7XG4gIHN0YXR1c0NvZGU6IG51bWJlcjtcbiAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPjtcbiAgYm9keTogYW55O1xufTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTZXJ2ZXJDb25maWcgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgcG9ydDogbnVtYmVyO1xuICBtYXhCb2R5U2l6ZT86IG51bWJlcjtcbiAgdGltZW91dD86IG51bWJlcjtcbiAgY29yc09yaWdpbj86IHN0cmluZztcbiAgc3RhdGljRGlyPzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgV2ViU2VydmVyIGV4dGVuZHMgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBIdHRwUmVxdWVzdCxcbiAgSHR0cFJlc3BvbnNlXG4+IHtcbiAgcHJpdmF0ZSBzZXJ2ZXI6IGh0dHAuU2VydmVyO1xuICBwcml2YXRlIHBvcnQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBtYXhCb2R5U2l6ZTogbnVtYmVyO1xuICBwcml2YXRlIHRpbWVvdXQ6IG51bWJlcjtcbiAgcHJpdmF0ZSBjb3JzT3JpZ2luOiBzdHJpbmc7XG4gIHByaXZhdGUgc3RhdGljRGlyOiBzdHJpbmcgfCBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQ6IElCYWNrRW5kLCBjb25maWc6IFdlYlNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKGJhY2tlbmQsIGNvbmZpZyk7XG4gICAgdGhpcy5wb3J0ID0gY29uZmlnLnBvcnQgfHwgODA4MDtcbiAgICB0aGlzLm1heEJvZHlTaXplID0gY29uZmlnLm1heEJvZHlTaXplIHx8IDFlNjtcbiAgICB0aGlzLnRpbWVvdXQgPSBjb25maWcudGltZW91dCB8fCAzMDAwMDtcbiAgICB0aGlzLmNvcnNPcmlnaW4gPSBjb25maWcuY29yc09yaWdpbiB8fCBcIipcIjtcbiAgICB0aGlzLnN0YXRpY0RpciA9IGNvbmZpZy5zdGF0aWNEaXIgfHwgbnVsbDtcbiAgICB0aGlzLnNlcnZlciA9IGh0dHAuY3JlYXRlU2VydmVyKHRoaXMuaGFuZGxlUmVxdWVzdC5iaW5kKHRoaXMpKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUmVxdWVzdChcbiAgICByZXE6IGh0dHAuSW5jb21pbmdNZXNzYWdlLFxuICAgIHJlczogaHR0cC5TZXJ2ZXJSZXNwb25zZVxuICApIHtcbiAgICBjb25zdCBwYXJzZWRVcmwgPSB1cmwucGFyc2UocmVxLnVybCB8fCBcIlwiLCB0cnVlKTtcblxuICAgIGlmICh0aGlzLnN0YXRpY0RpciAmJiByZXEubWV0aG9kID09PSBcIkdFVFwiKSB7XG4gICAgICBsZXQgc3RhdGljRmlsZVBhdGggPSBwYXRoLmpvaW4odGhpcy5zdGF0aWNEaXIsIHBhcnNlZFVybC5wYXRobmFtZSB8fCBcIlwiKTtcblxuICAgICAgLy8gQ2hlY2sgaWYgdGhlIHBhdGggaXMgYSBkaXJlY3RvcnlcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChzdGF0aWNGaWxlUGF0aCk7XG4gICAgICAgIGlmIChzdGF0cy5pc0RpcmVjdG9yeSgpKSB7XG4gICAgICAgICAgLy8gSWYgaXQncyBhIGRpcmVjdG9yeSwgbG9vayBmb3IgaW5kZXguaHRtbFxuICAgICAgICAgIHN0YXRpY0ZpbGVQYXRoID0gcGF0aC5qb2luKHN0YXRpY0ZpbGVQYXRoLCBcImluZGV4Lmh0bWxcIik7XG4gICAgICAgIH1cbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIC8vIElmIHN0YXQgZmFpbHMsIGp1c3QgY29udGludWUgd2l0aCB0aGUgb3JpZ2luYWwgcGF0aFxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICB0aGlzLmluZm8oYFRyeWluZyB0byBzZXJ2ZSBzdGF0aWMgZmlsZTogJHtzdGF0aWNGaWxlUGF0aH1gKTtcbiAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuc2VydmVTdGF0aWNGaWxlKHN0YXRpY0ZpbGVQYXRoKTtcbiAgICAgICAgaWYgKGNvbnRlbnQpIHtcbiAgICAgICAgICB0aGlzLnNlbmRTdGF0aWNSZXNwb25zZShcbiAgICAgICAgICAgIHJlcyxcbiAgICAgICAgICAgIDIwMCxcbiAgICAgICAgICAgIGNvbnRlbnQsXG4gICAgICAgICAgICB0aGlzLmdldENvbnRlbnRUeXBlKHN0YXRpY0ZpbGVQYXRoKVxuICAgICAgICAgICk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoKGVycm9yIGFzIE5vZGVKUy5FcnJub0V4Y2VwdGlvbikuY29kZSAhPT0gXCJFTk9FTlRcIikge1xuICAgICAgICAgIHRoaXMuZXJyb3IoYEVycm9yIHNlcnZpbmcgc3RhdGljIGZpbGU6ICR7ZXJyb3J9YCk7XG4gICAgICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA1MDAsIHsgZXJyb3I6IFwiSW50ZXJuYWwgU2VydmVyIEVycm9yXCIgfSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgbGV0IGJvZHkgPSBcIlwiO1xuICAgIGxldCBib2R5U2l6ZSA9IDA7XG5cbiAgICByZXEuc2V0VGltZW91dCh0aGlzLnRpbWVvdXQsICgpID0+IHtcbiAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDA4LCB7IGVycm9yOiBcIlJlcXVlc3QgVGltZW91dFwiIH0pO1xuICAgIH0pO1xuXG4gICAgcmVxLm9uKFwiZGF0YVwiLCAoY2h1bmspID0+IHtcbiAgICAgIGJvZHlTaXplICs9IGNodW5rLmxlbmd0aDtcbiAgICAgIGlmIChib2R5U2l6ZSA+IHRoaXMubWF4Qm9keVNpemUpIHtcbiAgICAgICAgdGhpcy5zZW5kUmVzcG9uc2UocmVzLCA0MTMsIHsgZXJyb3I6IFwiUGF5bG9hZCBUb28gTGFyZ2VcIiB9KTtcbiAgICAgICAgcmVxLmRlc3Ryb3koKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGJvZHkgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcS5vbihcImVuZFwiLCBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocmVxLmRlc3Ryb3llZCkgcmV0dXJuO1xuXG4gICAgICBjb25zdCBodHRwUmVxdWVzdDogSHR0cFJlcXVlc3QgPSB7XG4gICAgICAgIG1ldGhvZDogcmVxLm1ldGhvZCB8fCBcIkdFVFwiLFxuICAgICAgICBwYXRoOiBwYXJzZWRVcmwucGF0aG5hbWUgfHwgXCIvXCIsXG4gICAgICAgIHF1ZXJ5OiBwYXJzZWRVcmwucXVlcnkgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgICAgICAgaGVhZGVyczogcmVxLmhlYWRlcnMgYXMgUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbiAgICAgICAgYm9keTogdGhpcy5wYXJzZUJvZHkoYm9keSwgcmVxLmhlYWRlcnNbXCJjb250ZW50LXR5cGVcIl0pLFxuICAgICAgfTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLnByb2Nlc3NIdHRwUmVxdWVzdChodHRwUmVxdWVzdCk7XG4gICAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKFxuICAgICAgICAgIHJlcyxcbiAgICAgICAgICByZXNwb25zZS5zdGF0dXNDb2RlLFxuICAgICAgICAgIHJlc3BvbnNlLmJvZHksXG4gICAgICAgICAgcmVzcG9uc2UuaGVhZGVyc1xuICAgICAgICApO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgcHJvY2Vzc2luZyByZXF1ZXN0OiAke2Vycm9yfWApO1xuICAgICAgICB0aGlzLnNlbmRSZXNwb25zZShyZXMsIDUwMCwgeyBlcnJvcjogXCJJbnRlcm5hbCBTZXJ2ZXIgRXJyb3JcIiB9KTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJlcS5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xuICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCBlcnJvcjogJHtlcnJvcn1gKTtcbiAgICAgIHRoaXMuc2VuZFJlc3BvbnNlKHJlcywgNDAwLCB7IGVycm9yOiBcIkJhZCBSZXF1ZXN0XCIgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlcnZlU3RhdGljRmlsZShmaWxlUGF0aDogc3RyaW5nKTogUHJvbWlzZTxCdWZmZXIgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmcy5yZWFkRmlsZShmaWxlUGF0aCk7XG4gICAgICByZXR1cm4gY29udGVudDtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKChlcnJvciBhcyBOb2RlSlMuRXJybm9FeGNlcHRpb24pLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgcmV0dXJuIG51bGw7IC8vIEZpbGUgbm90IGZvdW5kXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJvcjsgLy8gT3RoZXIgZXJyb3JzXG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzZW5kU3RhdGljUmVzcG9uc2UoXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHN0YXR1c0NvZGU6IG51bWJlcixcbiAgICBib2R5OiBCdWZmZXIsXG4gICAgY29udGVudFR5cGU6IHN0cmluZ1xuICApIHtcbiAgICBjb25zdCBjb250ZW50RW5jb2RpbmcgPSB0aGlzLm5lZ290aWF0ZUNvbnRlbnRFbmNvZGluZyhyZXMpO1xuXG4gICAgcmVzLndyaXRlSGVhZChzdGF0dXNDb2RlLCB7XG4gICAgICBcIkNvbnRlbnQtVHlwZVwiOiBjb250ZW50VHlwZSxcbiAgICAgIFwiQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luXCI6IHRoaXMuY29yc09yaWdpbixcbiAgICAgIFwiWC1YU1MtUHJvdGVjdGlvblwiOiBcIjE7IG1vZGU9YmxvY2tcIixcbiAgICAgIFwiWC1GcmFtZS1PcHRpb25zXCI6IFwiREVOWVwiLFxuICAgICAgXCJYLUNvbnRlbnQtVHlwZS1PcHRpb25zXCI6IFwibm9zbmlmZlwiLFxuICAgICAgLi4uKGNvbnRlbnRFbmNvZGluZyA/IHsgXCJDb250ZW50LUVuY29kaW5nXCI6IGNvbnRlbnRFbmNvZGluZyB9IDoge30pLFxuICAgIH0pO1xuXG4gICAgaWYgKGNvbnRlbnRFbmNvZGluZyA9PT0gXCJnemlwXCIpIHtcbiAgICAgIHpsaWIuZ3ppcChib2R5LCAoXywgcmVzdWx0KSA9PiByZXMuZW5kKHJlc3VsdCkpO1xuICAgIH0gZWxzZSBpZiAoY29udGVudEVuY29kaW5nID09PSBcImRlZmxhdGVcIikge1xuICAgICAgemxpYi5kZWZsYXRlKGJvZHksIChfLCByZXN1bHQpID0+IHJlcy5lbmQocmVzdWx0KSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlcy5lbmQoYm9keSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRDb250ZW50VHlwZShmaWxlUGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBleHQgPSBwYXRoLmV4dG5hbWUoZmlsZVBhdGgpLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgbWltZVR5cGVzOiB7IFtrZXk6IHN0cmluZ106IHN0cmluZyB9ID0ge1xuICAgICAgXCIuaHRtbFwiOiBcInRleHQvaHRtbFwiLFxuICAgICAgXCIuanNcIjogXCJ0ZXh0L2phdmFzY3JpcHRcIixcbiAgICAgIFwiLmNzc1wiOiBcInRleHQvY3NzXCIsXG4gICAgICBcIi5qc29uXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgXCIucG5nXCI6IFwiaW1hZ2UvcG5nXCIsXG4gICAgICBcIi5qcGdcIjogXCJpbWFnZS9qcGVnXCIsXG4gICAgICBcIi5naWZcIjogXCJpbWFnZS9naWZcIixcbiAgICAgIFwiLnN2Z1wiOiBcImltYWdlL3N2Zyt4bWxcIixcbiAgICAgIFwiLndhdlwiOiBcImF1ZGlvL3dhdlwiLFxuICAgICAgXCIubXA0XCI6IFwidmlkZW8vbXA0XCIsXG4gICAgICBcIi53b2ZmXCI6IFwiYXBwbGljYXRpb24vZm9udC13b2ZmXCIsXG4gICAgICBcIi50dGZcIjogXCJhcHBsaWNhdGlvbi9mb250LXR0ZlwiLFxuICAgICAgXCIuZW90XCI6IFwiYXBwbGljYXRpb24vdm5kLm1zLWZvbnRvYmplY3RcIixcbiAgICAgIFwiLm90ZlwiOiBcImFwcGxpY2F0aW9uL2ZvbnQtb3RmXCIsXG4gICAgICBcIi53YXNtXCI6IFwiYXBwbGljYXRpb24vd2FzbVwiLFxuICAgIH07XG4gICAgcmV0dXJuIG1pbWVUeXBlc1tleHRdIHx8IFwiYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtXCI7XG4gIH1cblxuICBwcml2YXRlIHBhcnNlQm9keShib2R5OiBzdHJpbmcsIGNvbnRlbnRUeXBlPzogc3RyaW5nKTogYW55IHtcbiAgICBpZiAoY29udGVudFR5cGU/LmluY2x1ZGVzKFwiYXBwbGljYXRpb24vanNvblwiKSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoYm9keSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLndhcm4oYEZhaWxlZCB0byBwYXJzZSBKU09OIGJvZHk6ICR7ZXJyb3J9YCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBib2R5O1xuICB9XG5cbiAgcHJpdmF0ZSBzZW5kUmVzcG9uc2UoXG4gICAgcmVzOiBodHRwLlNlcnZlclJlc3BvbnNlLFxuICAgIHN0YXR1c0NvZGU6IG51bWJlcixcbiAgICBib2R5OiBhbnksXG4gICAgaGVhZGVyczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHt9XG4gICkge1xuICAgIGNvbnN0IHJlc3BvbnNlQm9keSA9IEpTT04uc3RyaW5naWZ5KGJvZHkpO1xuICAgIGNvbnN0IGNvbnRlbnRFbmNvZGluZyA9IHRoaXMubmVnb3RpYXRlQ29udGVudEVuY29kaW5nKHJlcyk7XG5cbiAgICByZXMud3JpdGVIZWFkKHN0YXR1c0NvZGUsIHtcbiAgICAgIFwiQ29udGVudC1UeXBlXCI6IFwiYXBwbGljYXRpb24vanNvblwiLFxuICAgICAgXCJBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW5cIjogdGhpcy5jb3JzT3JpZ2luLFxuICAgICAgXCJYLVhTUy1Qcm90ZWN0aW9uXCI6IFwiMTsgbW9kZT1ibG9ja1wiLFxuICAgICAgXCJYLUZyYW1lLU9wdGlvbnNcIjogXCJERU5ZXCIsXG4gICAgICBcIlgtQ29udGVudC1UeXBlLU9wdGlvbnNcIjogXCJub3NuaWZmXCIsXG4gICAgICAuLi5oZWFkZXJzLFxuICAgICAgLi4uKGNvbnRlbnRFbmNvZGluZyA/IHsgXCJDb250ZW50LUVuY29kaW5nXCI6IGNvbnRlbnRFbmNvZGluZyB9IDoge30pLFxuICAgIH0pO1xuXG4gICAgaWYgKGNvbnRlbnRFbmNvZGluZyA9PT0gXCJnemlwXCIpIHtcbiAgICAgIHpsaWIuZ3ppcChyZXNwb25zZUJvZHksIChfLCByZXN1bHQpID0+IHJlcy5lbmQocmVzdWx0KSk7XG4gICAgfSBlbHNlIGlmIChjb250ZW50RW5jb2RpbmcgPT09IFwiZGVmbGF0ZVwiKSB7XG4gICAgICB6bGliLmRlZmxhdGUocmVzcG9uc2VCb2R5LCAoXywgcmVzdWx0KSA9PiByZXMuZW5kKHJlc3VsdCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXMuZW5kKHJlc3BvbnNlQm9keSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBuZWdvdGlhdGVDb250ZW50RW5jb2RpbmcocmVzOiBodHRwLlNlcnZlclJlc3BvbnNlKTogc3RyaW5nIHwgbnVsbCB7XG4gICAgY29uc3QgYWNjZXB0RW5jb2RpbmcgPSAocmVzLmdldEhlYWRlcihcImFjY2VwdC1lbmNvZGluZ1wiKSBhcyBzdHJpbmcpIHx8IFwiXCI7XG4gICAgaWYgKGFjY2VwdEVuY29kaW5nLmluY2x1ZGVzKFwiZ3ppcFwiKSkgcmV0dXJuIFwiZ3ppcFwiO1xuICAgIGlmIChhY2NlcHRFbmNvZGluZy5pbmNsdWRlcyhcImRlZmxhdGVcIikpIHJldHVybiBcImRlZmxhdGVcIjtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0h0dHBSZXF1ZXN0KFxuICAgIGh0dHBSZXF1ZXN0OiBIdHRwUmVxdWVzdFxuICApOiBQcm9taXNlPEh0dHBSZXNwb25zZT4ge1xuICAgIGNvbnN0IHJlcXVlc3RUeXBlID0gYCR7aHR0cFJlcXVlc3QubWV0aG9kfToke2h0dHBSZXF1ZXN0LnBhdGh9YDtcbiAgICB0aGlzLmluZm8oYFJlY2VpdmVkIHJlcXVlc3Q6ICR7cmVxdWVzdFR5cGV9YCk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLm1ha2VSZXF1ZXN0PEh0dHBSZXNwb25zZT4oe1xuICAgICAgdG86IHRoaXMuc2VydmljZUlkLFxuICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICBib2R5OiBodHRwUmVxdWVzdCxcbiAgICB9KTtcbiAgICByZXR1cm4gcmVzcG9uc2UuYm9keS5kYXRhO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xuICAgICAgdGhpcy5zZXJ2ZXIubGlzdGVuKHRoaXMucG9ydCwgKCkgPT4ge1xuICAgICAgICB0aGlzLmluZm8oYFdlYiBzZXJ2ZXIgbGlzdGVuaW5nIG9uIHBvcnQgJHt0aGlzLnBvcnR9YCk7XG4gICAgICAgIHJlc29sdmUoKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XG4gICAgICB0aGlzLnNlcnZlci5jbG9zZSgoKSA9PiB7XG4gICAgICAgIHRoaXMuaW5mbyhcIldlYiBzZXJ2ZXIgc3RvcHBlZFwiKTtcbiAgICAgICAgcmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PEh0dHBSZXF1ZXN0PlxuICApOiBQcm9taXNlPEh0dHBSZXNwb25zZT4ge1xuICAgIHRoaXMud2FybihgUGF0aCBub3QgZm91bmQ6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YCk7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDQwNCxcbiAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgIGJvZHk6IHsgbWVzc2FnZTogXCJQYXRoIG5vdCBmb3VuZFwiIH0sXG4gICAgfTtcbiAgfVxuXG4gIC8vIEBSZXF1ZXN0SGFuZGxlcjxIdHRwUmVxdWVzdD4oXCJHRVQ6L1wiKVxuICAvLyBwcm90ZWN0ZWQgYXN5bmMgaGFuZGxlUm9vdChyZXF1ZXN0OiBIdHRwUmVxdWVzdCk6IFByb21pc2U8SHR0cFJlc3BvbnNlPiB7XG4gIC8vICAgcmV0dXJuIHtcbiAgLy8gICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgLy8gICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgLy8gICAgIGJvZHk6IHsgbWVzc2FnZTogXCJXZWxjb21lIHRvIHRoZSBXZWIgU2VydmVyIVwiIH0sXG4gIC8vICAgfTtcbiAgLy8gfVxufVxuIl19