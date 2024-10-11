"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExampleWebServer = void 0;
const WebServer_1 = require("../../services/WebServer");
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
class ExampleWebServer extends WebServer_1.WebServer {
    constructor(backend, config) {
        super(backend, config);
    }
    async exampleHandler(request) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: { message: "This is a get example" },
        };
    }
    async serviceStatus(request) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: this.getServerStatus(),
        };
    }
    async echoHandler(request) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: { message: request.body.body },
        };
    }
}
exports.ExampleWebServer = ExampleWebServer;
__decorate([
    (0, MicroserviceFramework_1.RequestHandler)("GET:/example"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ExampleWebServer.prototype, "exampleHandler", null);
__decorate([
    (0, MicroserviceFramework_1.RequestHandler)("GET:/status"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ExampleWebServer.prototype, "serviceStatus", null);
__decorate([
    (0, MicroserviceFramework_1.RequestHandler)("POST:/echo"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ExampleWebServer.prototype, "echoHandler", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRXhhbXBsZVdlYlNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9leGFtcGxlcy9taWNyb3NlcnZpY2VzL0V4YW1wbGVXZWJTZXJ2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEsd0RBS2tDO0FBQ2xDLHVFQUE2RDtBQUc3RCxNQUFhLGdCQUFpQixTQUFRLHFCQUFTO0lBQzdDLFlBQVksT0FBaUIsRUFBRSxNQUF1QjtRQUNwRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFHWSxBQUFOLEtBQUssQ0FBQyxjQUFjLENBQUMsT0FBb0I7UUFDOUMsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFO1lBQy9DLElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSx1QkFBdUIsRUFBRTtTQUMzQyxDQUFDO0lBQ0osQ0FBQztJQUdZLEFBQU4sS0FBSyxDQUFDLGFBQWEsQ0FBQyxPQUFvQjtRQUM3QyxPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUU7WUFDL0MsSUFBSSxFQUFFLElBQUksQ0FBQyxlQUFlLEVBQUU7U0FDN0IsQ0FBQztJQUNKLENBQUM7SUFHWSxBQUFOLEtBQUssQ0FBQyxXQUFXLENBQUMsT0FBb0I7UUFDM0MsT0FBTztZQUNMLFVBQVUsRUFBRSxHQUFHO1lBQ2YsT0FBTyxFQUFFLEVBQUUsY0FBYyxFQUFFLGtCQUFrQixFQUFFO1lBQy9DLElBQUksRUFBRSxFQUFFLE9BQU8sRUFBRSxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRTtTQUNyQyxDQUFDO0lBQ0osQ0FBQztDQUNGO0FBL0JELDRDQStCQztBQXpCYztJQURaLElBQUEsc0NBQWMsRUFBYyxjQUFjLENBQUM7Ozs7c0RBTzNDO0FBR1k7SUFEWixJQUFBLHNDQUFjLEVBQWMsYUFBYSxDQUFDOzs7O3FEQU8xQztBQUdZO0lBRFosSUFBQSxzQ0FBYyxFQUFjLFlBQVksQ0FBQzs7OzttREFPekMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge1xuICBXZWJTZXJ2ZXIsXG4gIEh0dHBSZXF1ZXN0LFxuICBIdHRwUmVzcG9uc2UsXG4gIFdlYlNlcnZlckNvbmZpZyxcbn0gZnJvbSBcIi4uLy4uL3NlcnZpY2VzL1dlYlNlcnZlclwiO1xuaW1wb3J0IHsgUmVxdWVzdEhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5pbXBvcnQgeyBJQmFja0VuZCB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5cbmV4cG9ydCBjbGFzcyBFeGFtcGxlV2ViU2VydmVyIGV4dGVuZHMgV2ViU2VydmVyIHtcbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogV2ViU2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxIdHRwUmVxdWVzdD4oXCJHRVQ6L2V4YW1wbGVcIilcbiAgcHVibGljIGFzeW5jIGV4YW1wbGVIYW5kbGVyKHJlcXVlc3Q6IEh0dHBSZXF1ZXN0KTogUHJvbWlzZTxIdHRwUmVzcG9uc2U+IHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzQ29kZTogMjAwLFxuICAgICAgaGVhZGVyczogeyBcIkNvbnRlbnQtVHlwZVwiOiBcImFwcGxpY2F0aW9uL2pzb25cIiB9LFxuICAgICAgYm9keTogeyBtZXNzYWdlOiBcIlRoaXMgaXMgYSBnZXQgZXhhbXBsZVwiIH0sXG4gICAgfTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxIdHRwUmVxdWVzdD4oXCJHRVQ6L3N0YXR1c1wiKVxuICBwdWJsaWMgYXN5bmMgc2VydmljZVN0YXR1cyhyZXF1ZXN0OiBIdHRwUmVxdWVzdCk6IFByb21pc2U8SHR0cFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgIGJvZHk6IHRoaXMuZ2V0U2VydmVyU3RhdHVzKCksXG4gICAgfTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxIdHRwUmVxdWVzdD4oXCJQT1NUOi9lY2hvXCIpXG4gIHB1YmxpYyBhc3luYyBlY2hvSGFuZGxlcihyZXF1ZXN0OiBIdHRwUmVxdWVzdCk6IFByb21pc2U8SHR0cFJlc3BvbnNlPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1c0NvZGU6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHsgXCJDb250ZW50LVR5cGVcIjogXCJhcHBsaWNhdGlvbi9qc29uXCIgfSxcbiAgICAgIGJvZHk6IHsgbWVzc2FnZTogcmVxdWVzdC5ib2R5LmJvZHkgfSxcbiAgICB9O1xuICB9XG59XG4iXX0=