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
exports.ExampleWebSocketServer = void 0;
const services_1 = require("../../services");
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
class ExampleWebSocketServer extends services_1.WebSocketServer {
    constructor(backend, config) {
        super(backend, config);
    }
    async exampleHandler(request) {
        this.info("Request", request);
        return request.body;
    }
}
exports.ExampleWebSocketServer = ExampleWebSocketServer;
__decorate([
    (0, MicroserviceFramework_1.RequestHandler)("/echo"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ExampleWebSocketServer.prototype, "exampleHandler", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRXhhbXBsZVdlYlNvY2tldFNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9leGFtcGxlcy9taWNyb3NlcnZpY2VzL0V4YW1wbGVXZWJTb2NrZXRTZXJ2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEsNkNBQXdFO0FBRXhFLHVFQUE2RDtBQUs3RCxNQUFhLHNCQUF1QixTQUFRLDBCQUFlO0lBQ3pELFlBQVksT0FBaUIsRUFBRSxNQUE2QjtRQUMxRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFHWSxBQUFOLEtBQUssQ0FBQyxjQUFjLENBQUMsT0FBeUI7UUFDbkQsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsT0FBTyxDQUFDLENBQUM7UUFDOUIsT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDO0lBQ3RCLENBQUM7Q0FDRjtBQVZELHdEQVVDO0FBSmM7SUFEWixJQUFBLHNDQUFjLEVBQW1CLE9BQU8sQ0FBQzs7Ozs0REFJekMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBXZWJTb2NrZXRTZXJ2ZXIsIFdlYlNvY2tldFNlcnZlckNvbmZpZyB9IGZyb20gXCIuLi8uLi9zZXJ2aWNlc1wiO1xuXG5pbXBvcnQgeyBSZXF1ZXN0SGFuZGxlciB9IGZyb20gXCIuLi8uLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcbmltcG9ydCB7IElCYWNrRW5kLCBJUmVxdWVzdCB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5cbmludGVyZmFjZSBDb25maWcgZXh0ZW5kcyBXZWJTb2NrZXRTZXJ2ZXJDb25maWcge31cblxuZXhwb3J0IGNsYXNzIEV4YW1wbGVXZWJTb2NrZXRTZXJ2ZXIgZXh0ZW5kcyBXZWJTb2NrZXRTZXJ2ZXIge1xuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBXZWJTb2NrZXRTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICB9XG5cbiAgQFJlcXVlc3RIYW5kbGVyPElSZXF1ZXN0PHN0cmluZz4+KFwiL2VjaG9cIilcbiAgcHVibGljIGFzeW5jIGV4YW1wbGVIYW5kbGVyKHJlcXVlc3Q6IElSZXF1ZXN0PHN0cmluZz4pOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIHRoaXMuaW5mbyhcIlJlcXVlc3RcIiwgcmVxdWVzdCk7XG4gICAgcmV0dXJuIHJlcXVlc3QuYm9keTtcbiAgfVxufVxuIl19