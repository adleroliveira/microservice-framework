"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerRunner = void 0;
const LogStrategy_1 = require("./utils/logging/LogStrategy");
const Loggable_1 = require("./utils/logging/Loggable");
Loggable_1.Loggable.setLogLevel(Loggable_1.Loggable.LogLevel.INFO);
Loggable_1.Loggable.setLogStrategy(new LogStrategy_1.ConsoleStrategy());
class ServerRunner extends Loggable_1.Loggable {
    constructor(serviceInstance, logLevel) {
        super();
        this.logLevel = Loggable_1.Loggable.LogLevel.DEBUG;
        this.logStrategy = new LogStrategy_1.ConsoleStrategy();
        this.serviceInstance = serviceInstance;
        this.serviceId = serviceInstance.getserviceId();
        this.logLevel = logLevel || this.logLevel;
        this.inititalize();
    }
    inititalize() {
        console.log(`initializing ServerRunner...`);
        process.on("SIGINT", this.handleSigint.bind(this));
        process.on("SIGTERM", this.handleShutdown.bind(this));
        process.on("unhandledRejection", this.handleUnhandledRejection.bind(this));
        this.setLogStrategy();
    }
    setLogStrategy() {
        Loggable_1.Loggable.setLogLevel(this.logLevel);
    }
    async handleSigint() {
        console.log(`Shutting down ${this.serviceId} server...`);
        await this.serviceInstance.stop();
        process.exit(0);
    }
    async handleShutdown(signal) {
        console.log(`Received ${signal}. Shutting down ${this.serviceId} server...`);
        await this.serviceInstance.stop();
        process.exit(0);
    }
    handleUnhandledRejection(reason, promise) {
        console.error(`ServerRunner: Unhandled Rejection`, promise, reason);
        try {
            this.logStrategy.send(reason);
        }
        catch (error) {
            console.error(`ServerRunner: Failed to send error logs to log-stream`);
        }
    }
    stop() {
        if (this.serviceInstance) {
            this.serviceInstance.stop();
            console.log(`Shutting down ${this.serviceId} server...`);
        }
    }
    start() {
        console.log(`ServerRunner: Starting ${this.serviceId} server...`);
        try {
            this.serviceInstance.start();
        }
        catch (error) {
            console.error(`ServerRunner: Error starting ${this.serviceId} server:`, error);
            this.stop();
            process.exit(1);
        }
    }
}
exports.ServerRunner = ServerRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2VydmVyUnVubmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL1NlcnZlclJ1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSw2REFBMkU7QUFDM0UsdURBQThEO0FBRzlELG1CQUFRLENBQUMsV0FBVyxDQUFDLG1CQUFRLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBQzdDLG1CQUFRLENBQUMsY0FBYyxDQUFDLElBQUksNkJBQWUsRUFBRSxDQUFDLENBQUM7QUFFL0MsTUFBYSxZQUFhLFNBQVEsbUJBQVE7SUFNeEMsWUFDRSxlQUFnRCxFQUNoRCxRQUFtQjtRQUVuQixLQUFLLEVBQUUsQ0FBQztRQVBGLGFBQVEsR0FBYSxtQkFBUSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUM7UUFDN0MsZ0JBQVcsR0FBZ0IsSUFBSSw2QkFBZSxFQUFFLENBQUM7UUFPdkQsSUFBSSxDQUFDLGVBQWUsR0FBRyxlQUFlLENBQUM7UUFDdkMsSUFBSSxDQUFDLFNBQVMsR0FBRyxlQUFlLENBQUMsWUFBWSxFQUFFLENBQUM7UUFDaEQsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUMxQyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7SUFDckIsQ0FBQztJQUVPLFdBQVc7UUFDakIsT0FBTyxDQUFDLEdBQUcsQ0FBQyw4QkFBOEIsQ0FBQyxDQUFDO1FBQzVDLE9BQU8sQ0FBQyxFQUFFLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDbkQsT0FBTyxDQUFDLEVBQUUsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGNBQWMsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUN0RCxPQUFPLENBQUMsRUFBRSxDQUFDLG9CQUFvQixFQUFFLElBQUksQ0FBQyx3QkFBd0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUMzRSxJQUFJLENBQUMsY0FBYyxFQUFFLENBQUM7SUFDeEIsQ0FBQztJQUVPLGNBQWM7UUFDcEIsbUJBQVEsQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDO0lBQ3RDLENBQUM7SUFFTyxLQUFLLENBQUMsWUFBWTtRQUN4QixPQUFPLENBQUMsR0FBRyxDQUFDLGlCQUFpQixJQUFJLENBQUMsU0FBUyxZQUFZLENBQUMsQ0FBQztRQUN6RCxNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDbEMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNsQixDQUFDO0lBRU8sS0FBSyxDQUFDLGNBQWMsQ0FBQyxNQUFjO1FBQ3pDLE9BQU8sQ0FBQyxHQUFHLENBQ1QsWUFBWSxNQUFNLG1CQUFtQixJQUFJLENBQUMsU0FBUyxZQUFZLENBQ2hFLENBQUM7UUFDRixNQUFNLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7UUFDbEMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUNsQixDQUFDO0lBRU8sd0JBQXdCLENBQUMsTUFBVyxFQUFFLE9BQXFCO1FBQ2pFLE9BQU8sQ0FBQyxLQUFLLENBQUMsbUNBQW1DLEVBQUUsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO1FBQ3BFLElBQUksQ0FBQztZQUNILElBQUksQ0FBQyxXQUFXLENBQUMsSUFBSSxDQUFDLE1BQU0sQ0FBQyxDQUFDO1FBQ2hDLENBQUM7UUFBQyxPQUFPLEtBQUssRUFBRSxDQUFDO1lBQ2YsT0FBTyxDQUFDLEtBQUssQ0FBQyx1REFBdUQsQ0FBQyxDQUFDO1FBQ3pFLENBQUM7SUFDSCxDQUFDO0lBRU0sSUFBSTtRQUNULElBQUksSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3pCLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDNUIsT0FBTyxDQUFDLEdBQUcsQ0FBQyxpQkFBaUIsSUFBSSxDQUFDLFNBQVMsWUFBWSxDQUFDLENBQUM7UUFDM0QsQ0FBQztJQUNILENBQUM7SUFFTSxLQUFLO1FBQ1YsT0FBTyxDQUFDLEdBQUcsQ0FBQywwQkFBMEIsSUFBSSxDQUFDLFNBQVMsWUFBWSxDQUFDLENBQUM7UUFDbEUsSUFBSSxDQUFDO1lBQ0gsSUFBSSxDQUFDLGVBQWUsQ0FBQyxLQUFLLEVBQUUsQ0FBQztRQUMvQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE9BQU8sQ0FBQyxLQUFLLENBQ1gsZ0NBQWdDLElBQUksQ0FBQyxTQUFTLFVBQVUsRUFDeEQsS0FBSyxDQUNOLENBQUM7WUFDRixJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDWixPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQ2xCLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUF4RUQsb0NBd0VDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgQ29uc29sZVN0cmF0ZWd5LCBMb2dTdHJhdGVneSB9IGZyb20gXCIuL3V0aWxzL2xvZ2dpbmcvTG9nU3RyYXRlZ3lcIjtcbmltcG9ydCB7IExvZ2dhYmxlLCBMb2dMZXZlbCB9IGZyb20gXCIuL3V0aWxzL2xvZ2dpbmcvTG9nZ2FibGVcIjtcbmltcG9ydCB7IE1pY3Jvc2VydmljZUZyYW1ld29yayB9IGZyb20gXCIuL01pY3Jvc2VydmljZUZyYW1ld29ya1wiO1xuXG5Mb2dnYWJsZS5zZXRMb2dMZXZlbChMb2dnYWJsZS5Mb2dMZXZlbC5JTkZPKTtcbkxvZ2dhYmxlLnNldExvZ1N0cmF0ZWd5KG5ldyBDb25zb2xlU3RyYXRlZ3koKSk7XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXJSdW5uZXIgZXh0ZW5kcyBMb2dnYWJsZSB7XG4gIHByaXZhdGUgc2VydmljZUlkOiBzdHJpbmc7XG4gIHByaXZhdGUgc2VydmljZUluc3RhbmNlOiBNaWNyb3NlcnZpY2VGcmFtZXdvcms8YW55LCBhbnk+O1xuICBwcml2YXRlIGxvZ0xldmVsOiBMb2dMZXZlbCA9IExvZ2dhYmxlLkxvZ0xldmVsLkRFQlVHO1xuICBwcml2YXRlIGxvZ1N0cmF0ZWd5OiBMb2dTdHJhdGVneSA9IG5ldyBDb25zb2xlU3RyYXRlZ3koKTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBzZXJ2aWNlSW5zdGFuY2U6IE1pY3Jvc2VydmljZUZyYW1ld29yazxhbnksIGFueT4sXG4gICAgbG9nTGV2ZWw/OiBMb2dMZXZlbFxuICApIHtcbiAgICBzdXBlcigpO1xuICAgIHRoaXMuc2VydmljZUluc3RhbmNlID0gc2VydmljZUluc3RhbmNlO1xuICAgIHRoaXMuc2VydmljZUlkID0gc2VydmljZUluc3RhbmNlLmdldHNlcnZpY2VJZCgpO1xuICAgIHRoaXMubG9nTGV2ZWwgPSBsb2dMZXZlbCB8fCB0aGlzLmxvZ0xldmVsO1xuICAgIHRoaXMuaW5pdGl0YWxpemUoKTtcbiAgfVxuXG4gIHByaXZhdGUgaW5pdGl0YWxpemUoKSB7XG4gICAgY29uc29sZS5sb2coYGluaXRpYWxpemluZyBTZXJ2ZXJSdW5uZXIuLi5gKTtcbiAgICBwcm9jZXNzLm9uKFwiU0lHSU5UXCIsIHRoaXMuaGFuZGxlU2lnaW50LmJpbmQodGhpcykpO1xuICAgIHByb2Nlc3Mub24oXCJTSUdURVJNXCIsIHRoaXMuaGFuZGxlU2h1dGRvd24uYmluZCh0aGlzKSk7XG4gICAgcHJvY2Vzcy5vbihcInVuaGFuZGxlZFJlamVjdGlvblwiLCB0aGlzLmhhbmRsZVVuaGFuZGxlZFJlamVjdGlvbi5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLnNldExvZ1N0cmF0ZWd5KCk7XG4gIH1cblxuICBwcml2YXRlIHNldExvZ1N0cmF0ZWd5KCkge1xuICAgIExvZ2dhYmxlLnNldExvZ0xldmVsKHRoaXMubG9nTGV2ZWwpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTaWdpbnQoKSB7XG4gICAgY29uc29sZS5sb2coYFNodXR0aW5nIGRvd24gJHt0aGlzLnNlcnZpY2VJZH0gc2VydmVyLi4uYCk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlSW5zdGFuY2Uuc3RvcCgpO1xuICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlU2h1dGRvd24oc2lnbmFsOiBzdHJpbmcpIHtcbiAgICBjb25zb2xlLmxvZyhcbiAgICAgIGBSZWNlaXZlZCAke3NpZ25hbH0uIFNodXR0aW5nIGRvd24gJHt0aGlzLnNlcnZpY2VJZH0gc2VydmVyLi4uYFxuICAgICk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlSW5zdGFuY2Uuc3RvcCgpO1xuICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgfVxuXG4gIHByaXZhdGUgaGFuZGxlVW5oYW5kbGVkUmVqZWN0aW9uKHJlYXNvbjogYW55LCBwcm9taXNlOiBQcm9taXNlPGFueT4pIHtcbiAgICBjb25zb2xlLmVycm9yKGBTZXJ2ZXJSdW5uZXI6IFVuaGFuZGxlZCBSZWplY3Rpb25gLCBwcm9taXNlLCByZWFzb24pO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmxvZ1N0cmF0ZWd5LnNlbmQocmVhc29uKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihgU2VydmVyUnVubmVyOiBGYWlsZWQgdG8gc2VuZCBlcnJvciBsb2dzIHRvIGxvZy1zdHJlYW1gKTtcbiAgICB9XG4gIH1cblxuICBwdWJsaWMgc3RvcCgpIHtcbiAgICBpZiAodGhpcy5zZXJ2aWNlSW5zdGFuY2UpIHtcbiAgICAgIHRoaXMuc2VydmljZUluc3RhbmNlLnN0b3AoKTtcbiAgICAgIGNvbnNvbGUubG9nKGBTaHV0dGluZyBkb3duICR7dGhpcy5zZXJ2aWNlSWR9IHNlcnZlci4uLmApO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyBzdGFydCgpIHtcbiAgICBjb25zb2xlLmxvZyhgU2VydmVyUnVubmVyOiBTdGFydGluZyAke3RoaXMuc2VydmljZUlkfSBzZXJ2ZXIuLi5gKTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zZXJ2aWNlSW5zdGFuY2Uuc3RhcnQoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcihcbiAgICAgICAgYFNlcnZlclJ1bm5lcjogRXJyb3Igc3RhcnRpbmcgJHt0aGlzLnNlcnZpY2VJZH0gc2VydmVyOmAsXG4gICAgICAgIGVycm9yXG4gICAgICApO1xuICAgICAgdGhpcy5zdG9wKCk7XG4gICAgICBwcm9jZXNzLmV4aXQoMSk7XG4gICAgfVxuICB9XG59XG4iXX0=