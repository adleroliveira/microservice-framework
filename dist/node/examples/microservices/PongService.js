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
exports.PongService = void 0;
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
class PongService extends MicroserviceFramework_1.MicroserviceFramework {
    constructor(backend, config) {
        super(backend, config);
    }
    async pong() {
        this.info(`[${this.instanceId}] Received ping`);
        await this.delay(5000);
        this.info(`[${this.instanceId}] Sending back pong`);
        return "pong";
    }
    delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.PongService = PongService;
__decorate([
    (0, MicroserviceFramework_1.RequestHandler)("ping"),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PongService.prototype, "pong", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUG9uZ1NlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZXhhbXBsZXMvbWljcm9zZXJ2aWNlcy9Qb25nU2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7QUFBQSx1RUFJcUM7QUFHckMsTUFBYSxXQUFZLFNBQVEsNkNBQXFDO0lBQ3BFLFlBQVksT0FBaUIsRUFBRSxNQUFxQjtRQUNsRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFHYSxBQUFOLEtBQUssQ0FBQyxJQUFJO1FBQ2hCLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxJQUFJLENBQUMsVUFBVSxpQkFBaUIsQ0FBQyxDQUFDO1FBQ2hELE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN2QixJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLFVBQVUscUJBQXFCLENBQUMsQ0FBQztRQUNwRCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0lBRU8sS0FBSyxDQUFDLEVBQVU7UUFDdEIsT0FBTyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsVUFBVSxDQUFDLE9BQU8sRUFBRSxFQUFFLENBQUMsQ0FBQyxDQUFDO0lBQzNELENBQUM7Q0FDRjtBQWhCRCxrQ0FnQkM7QUFWZTtJQURiLElBQUEsc0NBQWMsRUFBQyxNQUFNLENBQUM7Ozs7dUNBTXRCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLFxuICBJU2VydmVyQ29uZmlnLFxuICBSZXF1ZXN0SGFuZGxlcixcbn0gZnJvbSBcIi4uLy4uL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuaW1wb3J0IHsgSUJhY2tFbmQgfSBmcm9tIFwiLi4vLi4vaW50ZXJmYWNlc1wiO1xuXG5leHBvcnQgY2xhc3MgUG9uZ1NlcnZpY2UgZXh0ZW5kcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8c3RyaW5nLCBzdHJpbmc+IHtcbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogSVNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKGJhY2tlbmQsIGNvbmZpZyk7XG4gIH1cblxuICBAUmVxdWVzdEhhbmRsZXIoXCJwaW5nXCIpXG4gIHByaXZhdGUgYXN5bmMgcG9uZygpIHtcbiAgICB0aGlzLmluZm8oYFske3RoaXMuaW5zdGFuY2VJZH1dIFJlY2VpdmVkIHBpbmdgKTtcbiAgICBhd2FpdCB0aGlzLmRlbGF5KDUwMDApO1xuICAgIHRoaXMuaW5mbyhgWyR7dGhpcy5pbnN0YW5jZUlkfV0gU2VuZGluZyBiYWNrIHBvbmdgKTtcbiAgICByZXR1cm4gXCJwb25nXCI7XG4gIH1cblxuICBwcml2YXRlIGRlbGF5KG1zOiBudW1iZXIpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbiAgfVxufVxuIl19