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
const MicroserviceFramework_1 = require("../../../MicroserviceFramework");
class PongService extends MicroserviceFramework_1.MicroserviceFramework {
    constructor(backend, config) {
        super(backend, config);
    }
    async pong() {
        this.info(`[${this.instanceId}] Received ping`);
        await this.delay(10000);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUG9uZ1NlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZXhhbXBsZS9taWNyb3NlcnZpY2VzL3BvbmcvUG9uZ1NlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7O0FBQUEsMEVBS3dDO0FBRXhDLE1BQWEsV0FBWSxTQUFRLDZDQUFxQztJQUNwRSxZQUFZLE9BQWlCLEVBQUUsTUFBcUI7UUFDbEQsS0FBSyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztJQUN6QixDQUFDO0lBR2EsQUFBTixLQUFLLENBQUMsSUFBSTtRQUNoQixJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksSUFBSSxDQUFDLFVBQVUsaUJBQWlCLENBQUMsQ0FBQztRQUNoRCxNQUFNLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDeEIsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxVQUFVLHFCQUFxQixDQUFDLENBQUM7UUFDcEQsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVPLEtBQUssQ0FBQyxFQUFVO1FBQ3RCLE9BQU8sSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLFVBQVUsQ0FBQyxPQUFPLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztJQUMzRCxDQUFDO0NBQ0Y7QUFoQkQsa0NBZ0JDO0FBVmU7SUFEYixJQUFBLHNDQUFjLEVBQUMsTUFBTSxDQUFDOzs7O3VDQU10QiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbiAgSUJhY2tFbmQsXG4gIFJlcXVlc3RIYW5kbGVyLFxufSBmcm9tIFwiLi4vLi4vLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5cbmV4cG9ydCBjbGFzcyBQb25nU2VydmljZSBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBJU2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcbiAgfVxuXG4gIEBSZXF1ZXN0SGFuZGxlcihcInBpbmdcIilcbiAgcHJpdmF0ZSBhc3luYyBwb25nKCkge1xuICAgIHRoaXMuaW5mbyhgWyR7dGhpcy5pbnN0YW5jZUlkfV0gUmVjZWl2ZWQgcGluZ2ApO1xuICAgIGF3YWl0IHRoaXMuZGVsYXkoMTAwMDApO1xuICAgIHRoaXMuaW5mbyhgWyR7dGhpcy5pbnN0YW5jZUlkfV0gU2VuZGluZyBiYWNrIHBvbmdgKTtcbiAgICByZXR1cm4gXCJwb25nXCI7XG4gIH1cblxuICBwcml2YXRlIGRlbGF5KG1zOiBudW1iZXIpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgbXMpKTtcbiAgfVxufVxuIl19