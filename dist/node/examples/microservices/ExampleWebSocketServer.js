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
const web_1 = require("../../services/web");
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
class ExampleWebSocketServer extends web_1.WebSocketServer {
    constructor(backend, config) {
        super(backend, config);
    }
    async exampleHandler(request) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiRXhhbXBsZVdlYlNvY2tldFNlcnZlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9leGFtcGxlcy9taWNyb3NlcnZpY2VzL0V4YW1wbGVXZWJTb2NrZXRTZXJ2ZXIudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEsNENBQTRFO0FBRTVFLHVFQUE2RDtBQUs3RCxNQUFhLHNCQUF1QixTQUFRLHFCQUFlO0lBQ3pELFlBQVksT0FBaUIsRUFBRSxNQUE2QjtRQUMxRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFHWSxBQUFOLEtBQUssQ0FBQyxjQUFjLENBQUMsT0FBeUI7UUFDbkQsT0FBTyxPQUFPLENBQUMsSUFBSSxDQUFDO0lBQ3RCLENBQUM7Q0FDRjtBQVRELHdEQVNDO0FBSGM7SUFEWixJQUFBLHNDQUFjLEVBQW1CLE9BQU8sQ0FBQzs7Ozs0REFHekMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBXZWJTb2NrZXRTZXJ2ZXIsIFdlYlNvY2tldFNlcnZlckNvbmZpZyB9IGZyb20gXCIuLi8uLi9zZXJ2aWNlcy93ZWJcIjtcblxuaW1wb3J0IHsgUmVxdWVzdEhhbmRsZXIgfSBmcm9tIFwiLi4vLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5pbXBvcnQgeyBJQmFja0VuZCwgSVJlcXVlc3QgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuXG5pbnRlcmZhY2UgQ29uZmlnIGV4dGVuZHMgV2ViU29ja2V0U2VydmVyQ29uZmlnIHt9XG5cbmV4cG9ydCBjbGFzcyBFeGFtcGxlV2ViU29ja2V0U2VydmVyIGV4dGVuZHMgV2ViU29ja2V0U2VydmVyIHtcbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogV2ViU29ja2V0U2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcjxJUmVxdWVzdDxzdHJpbmc+PihcIi9lY2hvXCIpXG4gIHB1YmxpYyBhc3luYyBleGFtcGxlSGFuZGxlcihyZXF1ZXN0OiBJUmVxdWVzdDxzdHJpbmc+KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gcmVxdWVzdC5ib2R5O1xuICB9XG59XG4iXX0=