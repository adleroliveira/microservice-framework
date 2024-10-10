"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServerRunner = void 0;
const Loggable_1 = require("./utils/logging/Loggable");
const MicroserviceFramework_1 = require("./MicroserviceFramework");
Loggable_1.Loggable.setLogLevel(Loggable_1.Loggable.LogLevel.INFO);
class ServerRunner extends Loggable_1.Loggable {
    constructor(serviceInstanceOrLogLevel, logLevel) {
        super();
        this.services = [];
        this.logLevel = Loggable_1.Loggable.LogLevel.DEBUG;
        this.isStarted = false;
        if (serviceInstanceOrLogLevel instanceof MicroserviceFramework_1.MicroserviceFramework) {
            this.registerService(serviceInstanceOrLogLevel);
            this.logLevel = logLevel || this.logLevel;
        }
        else {
            this.logLevel = serviceInstanceOrLogLevel || this.logLevel;
        }
        this.initialize();
    }
    initialize() {
        this.info(`Initializing ServerRunner...`);
        process.on("SIGINT", this.handleSigint.bind(this));
        process.on("SIGTERM", this.handleShutdown.bind(this));
        process.on("unhandledRejection", this.handleUnhandledRejection.bind(this));
        this.setLogStrategy();
    }
    setLogStrategy() {
        Loggable_1.Loggable.setLogLevel(this.logLevel);
    }
    registerService(serviceInstance) {
        this.services.push(serviceInstance);
        this.info(`Registered service: ${serviceInstance.getserviceId()}`);
    }
    async handleSigint() {
        this.info(`[SIGINT] Shutting down all services...`);
        await this.stop();
    }
    async handleShutdown(signal) {
        this.info(`Received [${signal}]. Shutting down all services...`);
        await this.stop();
    }
    handleUnhandledRejection(reason, promise) {
        this.error(`Unhandled Rejection`, reason);
    }
    async stop() {
        this.info(`Stopping all services...`);
        for (const service of this.services) {
            try {
                await service.stop();
                this.info(`Stopped service: ${service.getserviceId()}`);
            }
            catch (error) {
                this.error(`Error stopping service ${service.getserviceId()}:`, error);
            }
        }
        this.isStarted = false;
        this.info(`All services stopped.`);
        process.exit(0);
    }
    async start() {
        if (this.isStarted)
            return;
        this.info(`Starting all services...`);
        try {
            for (const service of this.services) {
                await service.initialize();
                await service.start();
                this.info(`Started service: ${service.getserviceId()}`);
            }
            this.isStarted = true;
            this.info(`All services are running...`);
        }
        catch (error) {
            this.error(`Error starting services:`, error);
            await this.stop();
            process.exit(1);
        }
    }
}
exports.ServerRunner = ServerRunner;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiU2VydmVyUnVubmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL1NlcnZlclJ1bm5lci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx1REFBOEQ7QUFDOUQsbUVBQWdFO0FBRWhFLG1CQUFRLENBQUMsV0FBVyxDQUFDLG1CQUFRLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxDQUFDO0FBRTdDLE1BQWEsWUFBYSxTQUFRLG1CQUFRO0lBS3hDLFlBQ0UseUJBQXNFLEVBQ3RFLFFBQW1CO1FBRW5CLEtBQUssRUFBRSxDQUFDO1FBUkYsYUFBUSxHQUFzQyxFQUFFLENBQUM7UUFDakQsYUFBUSxHQUFhLG1CQUFRLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQztRQUM3QyxjQUFTLEdBQVksS0FBSyxDQUFDO1FBT2pDLElBQUkseUJBQXlCLFlBQVksNkNBQXFCLEVBQUUsQ0FBQztZQUMvRCxJQUFJLENBQUMsZUFBZSxDQUFDLHlCQUF5QixDQUFDLENBQUM7WUFDaEQsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUM1QyxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQUksQ0FBQyxRQUFRLEdBQUcseUJBQXlCLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUM3RCxDQUFDO1FBQ0QsSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO0lBQ3BCLENBQUM7SUFFTyxVQUFVO1FBQ2hCLElBQUksQ0FBQyxJQUFJLENBQUMsOEJBQThCLENBQUMsQ0FBQztRQUMxQyxPQUFPLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDO1FBQ25ELE9BQU8sQ0FBQyxFQUFFLENBQUMsU0FBUyxFQUFFLElBQUksQ0FBQyxjQUFjLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLENBQUM7UUFDdEQsT0FBTyxDQUFDLEVBQUUs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IHsgTG9nZ2FibGUsIExvZ0xldmVsIH0gZnJvbSBcIi4vdXRpbHMvbG9nZ2luZy9Mb2dnYWJsZVwiO1xuaW1wb3J0IHsgTWljcm9zZXJ2aWNlRnJhbWV3b3JrIH0gZnJvbSBcIi4vTWljcm9zZXJ2aWNlRnJhbWV3b3JrXCI7XG5cbkxvZ2dhYmxlLnNldExvZ0xldmVsKExvZ2dhYmxlLkxvZ0xldmVsLklORk8pO1xuXG5leHBvcnQgY2xhc3MgU2VydmVyUnVubmVyIGV4dGVuZHMgTG9nZ2FibGUge1xuICBwcml2YXRlIHNlcnZpY2VzOiBNaWNyb3NlcnZpY2VGcmFtZXdvcms8YW55LCBhbnk+W10gPSBbXTtcbiAgcHJpdmF0ZSBsb2dMZXZlbDogTG9nTGV2ZWwgPSBMb2dnYWJsZS5Mb2dMZXZlbC5ERUJVRztcbiAgcHJpdmF0ZSBpc1N0YXJ0ZWQ6IGJvb2xlYW4gPSBmYWxzZTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBzZXJ2aWNlSW5zdGFuY2VPckxvZ0xldmVsPzogTWljcm9zZXJ2aWNlRnJhbWV3b3JrPGFueSwgYW55PiB8IExvZ0xldmVsLFxuICAgIGxvZ0xldmVsPzogTG9nTGV2ZWxcbiAgKSB7XG4gICAgc3VwZXIoKTtcbiAgICBpZiAoc2VydmljZUluc3RhbmNlT3JMb2dMZXZlbCBpbnN0YW5jZW9mIE1pY3Jvc2VydmljZUZyYW1ld29yaykge1xuICAgICAgdGhpcy5yZWdpc3RlclNlcnZpY2Uoc2VydmljZUluc3RhbmNlT3JMb2dMZXZlbCk7XG4gICAgICB0aGlzLmxvZ0xldmVsID0gbG9nTGV2ZWwgfHwgdGhpcy5sb2dMZXZlbDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5sb2dMZXZlbCA9IHNlcnZpY2VJbnN0YW5jZU9yTG9nTGV2ZWwgfHwgdGhpcy5sb2dMZXZlbDtcbiAgICB9XG4gICAgdGhpcy5pbml0aWFsaXplKCk7XG4gIH1cblxuICBwcml2YXRlIGluaXRpYWxpemUoKSB7XG4gICAgdGhpcy5pbmZvKGBJbml0aWFsaXppbmcgU2VydmVyUnVubmVyLi4uYCk7XG4gICAgcHJvY2Vzcy5vbihcIlNJR0lOVFwiLCB0aGlzLmhhbmRsZVNpZ2ludC5iaW5kKHRoaXMpKTtcbiAgICBwcm9jZXNzLm9uKFwiU0lHVEVSTVwiLCB0aGlzLmhhbmRsZVNodXRkb3duLmJpbmQodGhpcykpO1xuICAgIHByb2Nlc3Mub24oXCJ1bmhhbmRsZWRSZWplY3Rpb25cIiwgdGhpcy5oYW5kbGVVbmhhbmRsZWRSZWplY3Rpb24uYmluZCh0aGlzKSk7XG4gICAgdGhpcy5zZXRMb2dTdHJhdGVneSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXRMb2dTdHJhdGVneSgpIHtcbiAgICBMb2dnYWJsZS5zZXRMb2dMZXZlbCh0aGlzLmxvZ0xldmVsKTtcbiAgfVxuXG4gIHB1YmxpYyByZWdpc3RlclNlcnZpY2Uoc2VydmljZUluc3RhbmNlOiBNaWNyb3NlcnZpY2VGcmFtZXdvcms8YW55LCBhbnk+KSB7XG4gICAgdGhpcy5zZXJ2aWNlcy5wdXNoKHNlcnZpY2VJbnN0YW5jZSk7XG4gICAgdGhpcy5pbmZvKGBSZWdpc3RlcmVkIHNlcnZpY2U6ICR7c2VydmljZUluc3RhbmNlLmdldHNlcnZpY2VJZCgpfWApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTaWdpbnQoKSB7XG4gICAgdGhpcy5pbmZvKGBbU0lHSU5UXSBTaHV0dGluZyBkb3duIGFsbCBzZXJ2aWNlcy4uLmApO1xuICAgIGF3YWl0IHRoaXMuc3RvcCgpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVTaHV0ZG93bihzaWduYWw6IHN0cmluZykge1xuICAgIHRoaXMuaW5mbyhgUmVjZWl2ZWQgWyR7c2lnbmFsfV0uIFNodXR0aW5nIGRvd24gYWxsIHNlcnZpY2VzLi4uYCk7XG4gICAgYXdhaXQgdGhpcy5zdG9wKCk7XG4gIH1cblxuICBwcml2YXRlIGhhbmRsZVVuaGFuZGxlZFJlamVjdGlvbihyZWFzb246IGFueSwgcHJvbWlzZTogUHJvbWlzZTxhbnk+KSB7XG4gICAgdGhpcy5lcnJvcihgVW5oYW5kbGVkIFJlamVjdGlvbmAsIHJlYXNvbik7XG4gIH1cblxuICBwdWJsaWMgYXN5bmMgc3RvcCgpIHtcbiAgICB0aGlzLmluZm8oYFN0b3BwaW5nIGFsbCBzZXJ2aWNlcy4uLmApO1xuICAgIGZvciAoY29uc3Qgc2VydmljZSBvZiB0aGlzLnNlcnZpY2VzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBzZXJ2aWNlLnN0b3AoKTtcbiAgICAgICAgdGhpcy5pbmZvKGBTdG9wcGVkIHNlcnZpY2U6ICR7c2VydmljZS5nZXRzZXJ2aWNlSWQoKX1gKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3Igc3RvcHBpbmcgc2VydmljZSAke3NlcnZpY2UuZ2V0c2VydmljZUlkKCl9OmAsIGVycm9yKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5pc1N0YXJ0ZWQgPSBmYWxzZTtcbiAgICB0aGlzLmluZm8oYEFsbCBzZXJ2aWNlcyBzdG9wcGVkLmApO1xuICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgfVxuXG4gIHB1YmxpYyBhc3luYyBzdGFydCgpIHtcbiAgICBpZiAodGhpcy5pc1N0YXJ0ZWQpIHJldHVybjtcbiAgICB0aGlzLmluZm8oYFN0YXJ0aW5nIGFsbCBzZXJ2aWNlcy4uLmApO1xuICAgIHRyeSB7XG4gICAgICBmb3IgKGNvbnN0IHNlcnZpY2Ugb2YgdGhpcy5zZXJ2aWNlcykge1xuICAgICAgICBhd2FpdCBzZXJ2aWNlLmluaXRpYWxpemUoKTtcbiAgICAgICAgYXdhaXQgc2VydmljZS5zdGFydCgpO1xuICAgICAgICB0aGlzLmluZm8oYFN0YXJ0ZWQgc2VydmljZTogJHtzZXJ2aWNlLmdldHNlcnZpY2VJZCgpfWApO1xuICAgICAgfVxuICAgICAgdGhpcy5pc1N0YXJ0ZWQgPSB0cnVlO1xuICAgICAgdGhpcy5pbmZvKGBBbGwgc2VydmljZXMgYXJlIHJ1bm5pbmcuLi5gKTtcbiAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICB0aGlzLmVycm9yKGBFcnJvciBzdGFydGluZyBzZXJ2aWNlczpgLCBlcnJvcik7XG4gICAgICBhd2FpdCB0aGlzLnN0b3AoKTtcbiAgICAgIHByb2Nlc3MuZXhpdCgxKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==