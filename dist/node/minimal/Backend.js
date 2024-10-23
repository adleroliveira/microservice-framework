"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Backend = void 0;
const PubSubConsumer_1 = require("./PubSubConsumer");
const ServiceRegistry_1 = require("./ServiceRegistry");
class Backend {
    constructor() {
        this.serviceRegistry = new ServiceRegistry_1.MemoryServiceRegistry();
        const client = new PubSubConsumer_1.PubSubConsumerClient();
        this.pubSubConsumer = new PubSubConsumer_1.MemoryPubSubConsumer(client, {});
    }
}
exports.Backend = Backend;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQmFja2VuZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9taW5pbWFsL0JhY2tlbmQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQ0EscURBQThFO0FBQzlFLHVEQUEwRDtBQUUxRCxNQUFhLE9BQU87SUFHbEI7UUFDRSxJQUFJLENBQUMsZUFBZSxHQUFHLElBQUksdUNBQXFCLEVBQUUsQ0FBQztRQUNuRCxNQUFNLE1BQU0sR0FBRyxJQUFJLHFDQUFvQixFQUFFLENBQUM7UUFDMUMsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLHFDQUFvQixDQUFDLE1BQU0sRUFBRSxFQUFFLENBQUMsQ0FBQztJQUM3RCxDQUFDO0NBQ0Y7QUFSRCwwQkFRQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElCYWNrRW5kLCBJU2VydmljZVJlZ2lzdHJ5IH0gZnJvbSBcIi4uL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7IE1lbW9yeVB1YlN1YkNvbnN1bWVyLCBQdWJTdWJDb25zdW1lckNsaWVudCB9IGZyb20gXCIuL1B1YlN1YkNvbnN1bWVyXCI7XG5pbXBvcnQgeyBNZW1vcnlTZXJ2aWNlUmVnaXN0cnkgfSBmcm9tIFwiLi9TZXJ2aWNlUmVnaXN0cnlcIjtcblxuZXhwb3J0IGNsYXNzIEJhY2tlbmQgaW1wbGVtZW50cyBJQmFja0VuZCB7XG4gIHNlcnZpY2VSZWdpc3RyeTogSVNlcnZpY2VSZWdpc3RyeTtcbiAgcHViU3ViQ29uc3VtZXI6IE1lbW9yeVB1YlN1YkNvbnN1bWVyO1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICB0aGlzLnNlcnZpY2VSZWdpc3RyeSA9IG5ldyBNZW1vcnlTZXJ2aWNlUmVnaXN0cnkoKTtcbiAgICBjb25zdCBjbGllbnQgPSBuZXcgUHViU3ViQ29uc3VtZXJDbGllbnQoKTtcbiAgICB0aGlzLnB1YlN1YkNvbnN1bWVyID0gbmV3IE1lbW9yeVB1YlN1YkNvbnN1bWVyKGNsaWVudCwge30pO1xuICB9XG59XG4iXX0=