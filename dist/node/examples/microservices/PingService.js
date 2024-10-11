"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PingService = void 0;
const MicroserviceFramework_1 = require("../../MicroserviceFramework");
class PingService extends MicroserviceFramework_1.MicroserviceFramework {
    constructor(backend, config) {
        super(backend, config);
    }
    async startDependencies() {
        this.ping();
    }
    ping() {
        setTimeout(async () => {
            this.info(`Sending ping`);
            this.makeRequest({
                to: "pong",
                requestType: "ping",
                body: "ping",
            })
                .then((response) => {
                this.info(`Received ${response.body.data} from ${response.responseHeader.responderAddress}`);
            })
                .catch((error) => {
                this.error(error);
            });
            this.ping();
        }, 10000);
    }
}
exports.PingService = PingService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGluZ1NlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZXhhbXBsZXMvbWljcm9zZXJ2aWNlcy9QaW5nU2VydmljZS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx1RUFHcUM7QUFHckMsTUFBYSxXQUFZLFNBQVEsNkNBQXFDO0lBQ3BFLFlBQVksT0FBaUIsRUFBRSxNQUFxQjtRQUNsRCxLQUFLLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO0lBQ3pCLENBQUM7SUFFUyxLQUFLLENBQUMsaUJBQWlCO1FBQy9CLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztJQUNkLENBQUM7SUFFTyxJQUFJO1FBQ1YsVUFBVSxDQUFDLEtBQUssSUFBSSxFQUFFO1lBQ3BCLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUM7WUFDMUIsSUFBSSxDQUFDLFdBQVcsQ0FBQztnQkFDZixFQUFFLEVBQUUsTUFBTTtnQkFDVixXQUFXLEVBQUUsTUFBTTtnQkFDbkIsSUFBSSxFQUFFLE1BQU07YUFDYixDQUFDO2lCQUNDLElBQUksQ0FBQyxDQUFDLFFBQVEsRUFBRSxFQUFFO2dCQUNqQixJQUFJLENBQUMsSUFBSSxDQUNQLFlBQVksUUFBUSxDQUFDLElBQUksQ0FBQyxJQUFJLFNBQVMsUUFBUSxDQUFDLGNBQWMsQ0FBQyxnQkFBZ0IsRUFBRSxDQUNsRixDQUFDO1lBQ0osQ0FBQyxDQUFDO2lCQUNELEtBQUssQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFO2dCQUNmLElBQUksQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDcEIsQ0FBQyxDQUFDLENBQUM7WUFDTCxJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDZCxDQUFDLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDWixDQUFDO0NBQ0Y7QUE1QkQsa0NBNEJDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHtcbiAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLFxuICBJU2VydmVyQ29uZmlnLFxufSBmcm9tIFwiLi4vLi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5pbXBvcnQgeyBJQmFja0VuZCB9IGZyb20gXCIuLi8uLi9pbnRlcmZhY2VzXCI7XG5cbmV4cG9ydCBjbGFzcyBQaW5nU2VydmljZSBleHRlbmRzIE1pY3Jvc2VydmljZUZyYW1ld29yazxzdHJpbmcsIHN0cmluZz4ge1xuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBJU2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoYmFja2VuZCwgY29uZmlnKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnBpbmcoKTtcbiAgfVxuXG4gIHByaXZhdGUgcGluZygpIHtcbiAgICBzZXRUaW1lb3V0KGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMuaW5mbyhgU2VuZGluZyBwaW5nYCk7XG4gICAgICB0aGlzLm1ha2VSZXF1ZXN0KHtcbiAgICAgICAgdG86IFwicG9uZ1wiLFxuICAgICAgICByZXF1ZXN0VHlwZTogXCJwaW5nXCIsXG4gICAgICAgIGJvZHk6IFwicGluZ1wiLFxuICAgICAgfSlcbiAgICAgICAgLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgdGhpcy5pbmZvKFxuICAgICAgICAgICAgYFJlY2VpdmVkICR7cmVzcG9uc2UuYm9keS5kYXRhfSBmcm9tICR7cmVzcG9uc2UucmVzcG9uc2VIZWFkZXIucmVzcG9uZGVyQWRkcmVzc31gXG4gICAgICAgICAgKTtcbiAgICAgICAgfSlcbiAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIHRoaXMuZXJyb3IoZXJyb3IpO1xuICAgICAgICB9KTtcbiAgICAgIHRoaXMucGluZygpO1xuICAgIH0sIDEwMDAwKTtcbiAgfVxufVxuIl19