"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PingService = void 0;
const MicroserviceFramework_1 = require("../../../MicroserviceFramework");
class PingService extends MicroserviceFramework_1.MicroserviceFramework {
    constructor(backend, config) {
        super(backend, config);
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
        }, 4000);
    }
}
exports.PingService = PingService;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUGluZ1NlcnZpY2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvZXhhbXBsZS9taWNyb3NlcnZpY2VzL3BpbmcvUGluZ1NlcnZpY2UudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsMEVBSXdDO0FBRXhDLE1BQWEsV0FBWSxTQUFRLDZDQUFxQztJQUNwRSxZQUFZLE9BQWlCLEVBQUUsTUFBcUI7UUFDbEQsS0FBSyxDQUFDLE9BQU8sRUFBRSxNQUFNLENBQUMsQ0FBQztRQUN2QixJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7SUFDZCxDQUFDO0lBRU8sSUFBSTtRQUNWLFVBQVUsQ0FBQyxLQUFLLElBQUksRUFBRTtZQUNwQixJQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFDO1lBQzFCLElBQUksQ0FBQyxXQUFXLENBQUM7Z0JBQ2YsRUFBRSxFQUFFLE1BQU07Z0JBQ1YsV0FBVyxFQUFFLE1BQU07Z0JBQ25CLElBQUksRUFBRSxNQUFNO2FBQ2IsQ0FBQztpQkFDQyxJQUFJLENBQUMsQ0FBQyxRQUFRLEVBQUUsRUFBRTtnQkFDakIsSUFBSSxDQUFDLElBQUksQ0FDUCxZQUFZLFFBQVEsQ0FBQyxJQUFJLENBQUMsSUFBSSxTQUFTLFFBQVEsQ0FBQyxjQUFjLENBQUMsZ0JBQWdCLEVBQUUsQ0FDbEYsQ0FBQztZQUNKLENBQUMsQ0FBQztpQkFDRCxLQUFLLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtnQkFDZixJQUFJLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ3BCLENBQUMsQ0FBQyxDQUFDO1lBQ0wsSUFBSSxDQUFDLElBQUksRUFBRSxDQUFDO1FBQ2QsQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ1gsQ0FBQztDQUNGO0FBekJELGtDQXlCQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIE1pY3Jvc2VydmljZUZyYW1ld29yayxcbiAgSVNlcnZlckNvbmZpZyxcbiAgSUJhY2tFbmQsXG59IGZyb20gXCIuLi8uLi8uLi9NaWNyb3NlcnZpY2VGcmFtZXdvcmtcIjtcblxuZXhwb3J0IGNsYXNzIFBpbmdTZXJ2aWNlIGV4dGVuZHMgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPHN0cmluZywgc3RyaW5nPiB7XG4gIGNvbnN0cnVjdG9yKGJhY2tlbmQ6IElCYWNrRW5kLCBjb25maWc6IElTZXJ2ZXJDb25maWcpIHtcbiAgICBzdXBlcihiYWNrZW5kLCBjb25maWcpO1xuICAgIHRoaXMucGluZygpO1xuICB9XG5cbiAgcHJpdmF0ZSBwaW5nKCkge1xuICAgIHNldFRpbWVvdXQoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy5pbmZvKGBTZW5kaW5nIHBpbmdgKTtcbiAgICAgIHRoaXMubWFrZVJlcXVlc3Qoe1xuICAgICAgICB0bzogXCJwb25nXCIsXG4gICAgICAgIHJlcXVlc3RUeXBlOiBcInBpbmdcIixcbiAgICAgICAgYm9keTogXCJwaW5nXCIsXG4gICAgICB9KVxuICAgICAgICAudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICB0aGlzLmluZm8oXG4gICAgICAgICAgICBgUmVjZWl2ZWQgJHtyZXNwb25zZS5ib2R5LmRhdGF9IGZyb20gJHtyZXNwb25zZS5yZXNwb25zZUhlYWRlci5yZXNwb25kZXJBZGRyZXNzfWBcbiAgICAgICAgICApO1xuICAgICAgICB9KVxuICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgdGhpcy5lcnJvcihlcnJvcik7XG4gICAgICAgIH0pO1xuICAgICAgdGhpcy5waW5nKCk7XG4gICAgfSwgNDAwMCk7XG4gIH1cbn1cbiJdfQ==