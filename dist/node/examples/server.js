"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const ServerRunner_1 = require("../ServerRunner");
const ExampleWebServer_1 = require("./microservices/ExampleWebServer");
const ExampleWebSocketServer_1 = require("./microservices/ExampleWebSocketServer");
const Backend_1 = require("../minimal/Backend");
const logging_1 = require("../logging");
const path_1 = __importDefault(require("path"));
const minimal_1 = require("../minimal");
const namespace = "example";
const logStrategy = new logging_1.ConsoleStrategy();
const backend = new Backend_1.Backend();
const authProvider = new minimal_1.InMemoryAuthProvider();
const sessionStore = new minimal_1.InMemorySessionStore();
const exampleWebServer = new ExampleWebServer_1.ExampleWebServer(backend, {
    namespace,
    logStrategy,
    serviceId: "webservice",
    port: 8082,
    staticDir: path_1.default.join(path_1.default.resolve(__dirname, "../.."), "/public"),
});
const exampleWebSocketServer = new ExampleWebSocketServer_1.ExampleWebSocketServer(backend, {
    namespace,
    logStrategy,
    serviceId: "websocket",
    path: "/ws",
    port: 8083,
    authentication: {
        required: false, // Authentication not mandatory
        allowAnonymous: true, // Allow anonymous connections
        anonymousConfig: {
            enabled: true,
            sessionDuration: 24 * 60 * 60 * 1000, // 24 hours
            persistentIdentityEnabled: true,
            metadata: {
                permissions: ["read"], // Default permissions for anonymous users
            },
        },
        sessionStore,
        authProvider,
    },
});
const server = new ServerRunner_1.ServerRunner();
server.registerService(exampleWebServer);
server.registerService(exampleWebSocketServer);
const main = async () => {
    await authProvider.addUser("root", "password");
    server.start();
};
main();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2V4YW1wbGVzL3NlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLGtEQUErQztBQUMvQyx1RUFBb0U7QUFDcEUsbUZBQWdGO0FBQ2hGLGdEQUE2QztBQUM3Qyx3Q0FBNkM7QUFDN0MsZ0RBQXdCO0FBQ3hCLHdDQUtvQjtBQUVwQixNQUFNLFNBQVMsR0FBRyxTQUFTLENBQUM7QUFDNUIsTUFBTSxXQUFXLEdBQUcsSUFBSSx5QkFBZSxFQUFFLENBQUM7QUFDMUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxpQkFBTyxFQUFFLENBQUM7QUFDOUIsTUFBTSxZQUFZLEdBQUcsSUFBSSw4QkFBb0IsRUFBRSxDQUFDO0FBQ2hELE1BQU0sWUFBWSxHQUFHLElBQUksOEJBQW9CLEVBQUUsQ0FBQztBQUVoRCxNQUFNLGdCQUFnQixHQUFHLElBQUksbUNBQWdCLENBQUMsT0FBTyxFQUFFO0lBQ3JELFNBQVM7SUFDVCxXQUFXO0lBQ1gsU0FBUyxFQUFFLFlBQVk7SUFDdkIsSUFBSSxFQUFFLElBQUk7SUFDVixTQUFTLEVBQUUsY0FBSSxDQUFDLElBQUksQ0FBQyxjQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsRUFBRSxTQUFTLENBQUM7Q0FDbEUsQ0FBQyxDQUFDO0FBRUgsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLCtDQUFzQixDQUFDLE9BQU8sRUFBRTtJQUNqRSxTQUFTO0lBQ1QsV0FBVztJQUNYLFNBQVMsRUFBRSxXQUFXO0lBQ3RCLElBQUksRUFBRSxLQUFLO0lBQ1gsSUFBSSxFQUFFLElBQUk7SUFDVixjQUFjLEVBQUU7UUFDZCxRQUFRLEVBQUUsS0FBSyxFQUFFLCtCQUErQjtRQUNoRCxjQUFjLEVBQUUsSUFBSSxFQUFFLDhCQUE4QjtRQUNwRCxlQUFlLEVBQUU7WUFDZixPQUFPLEVBQUUsSUFBSTtZQUNiLGVBQWUsRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLEVBQUUsV0FBVztZQUNqRCx5QkFBeUIsRUFBRSxJQUFJO1lBQy9CLFFBQVEsRUFBRTtnQkFDUixXQUFXLEVBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSwwQ0FBMEM7YUFDbEU7U0FDRjtRQUNELFlBQVk7UUFDWixZQUFZO0tBQ2I7Q0FDRixDQUFDLENBQUM7QUFFSCxNQUFNLE1BQU0sR0FBRyxJQUFJLDJCQUFZLEVBQUUsQ0FBQztBQUNsQyxNQUFNLENBQUMsZUFBZSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFDekMsTUFBTSxDQUFDLGVBQWUsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBRS9DLE1BQU0sSUFBSSxHQUFHLEtBQUssSUFBSSxFQUFFO0lBQ3RCLE1BQU0sWUFBWSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsVUFBVSxDQUFDLENBQUM7SUFDL0MsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO0FBQ2pCLENBQUMsQ0FBQztBQUVGLElBQUksRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmVyUnVubmVyIH0gZnJvbSBcIi4uL1NlcnZlclJ1bm5lclwiO1xuaW1wb3J0IHsgRXhhbXBsZVdlYlNlcnZlciB9IGZyb20gXCIuL21pY3Jvc2VydmljZXMvRXhhbXBsZVdlYlNlcnZlclwiO1xuaW1wb3J0IHsgRXhhbXBsZVdlYlNvY2tldFNlcnZlciB9IGZyb20gXCIuL21pY3Jvc2VydmljZXMvRXhhbXBsZVdlYlNvY2tldFNlcnZlclwiO1xuaW1wb3J0IHsgQmFja2VuZCB9IGZyb20gXCIuLi9taW5pbWFsL0JhY2tlbmRcIjtcbmltcG9ydCB7IENvbnNvbGVTdHJhdGVneSB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHtcbiAgRmlsZUF1dGhQcm92aWRlcixcbiAgRmlsZVNlc3Npb25TdG9yZSxcbiAgSW5NZW1vcnlBdXRoUHJvdmlkZXIsXG4gIEluTWVtb3J5U2Vzc2lvblN0b3JlLFxufSBmcm9tIFwiLi4vbWluaW1hbFwiO1xuXG5jb25zdCBuYW1lc3BhY2UgPSBcImV4YW1wbGVcIjtcbmNvbnN0IGxvZ1N0cmF0ZWd5ID0gbmV3IENvbnNvbGVTdHJhdGVneSgpO1xuY29uc3QgYmFja2VuZCA9IG5ldyBCYWNrZW5kKCk7XG5jb25zdCBhdXRoUHJvdmlkZXIgPSBuZXcgSW5NZW1vcnlBdXRoUHJvdmlkZXIoKTtcbmNvbnN0IHNlc3Npb25TdG9yZSA9IG5ldyBJbk1lbW9yeVNlc3Npb25TdG9yZSgpO1xuXG5jb25zdCBleGFtcGxlV2ViU2VydmVyID0gbmV3IEV4YW1wbGVXZWJTZXJ2ZXIoYmFja2VuZCwge1xuICBuYW1lc3BhY2UsXG4gIGxvZ1N0cmF0ZWd5LFxuICBzZXJ2aWNlSWQ6IFwid2Vic2VydmljZVwiLFxuICBwb3J0OiA4MDgyLFxuICBzdGF0aWNEaXI6IHBhdGguam9pbihwYXRoLnJlc29sdmUoX19kaXJuYW1lLCBcIi4uLy4uXCIpLCBcIi9wdWJsaWNcIiksXG59KTtcblxuY29uc3QgZXhhbXBsZVdlYlNvY2tldFNlcnZlciA9IG5ldyBFeGFtcGxlV2ViU29ja2V0U2VydmVyKGJhY2tlbmQsIHtcbiAgbmFtZXNwYWNlLFxuICBsb2dTdHJhdGVneSxcbiAgc2VydmljZUlkOiBcIndlYnNvY2tldFwiLFxuICBwYXRoOiBcIi93c1wiLFxuICBwb3J0OiA4MDgzLFxuICBhdXRoZW50aWNhdGlvbjoge1xuICAgIHJlcXVpcmVkOiBmYWxzZSwgLy8gQXV0aGVudGljYXRpb24gbm90IG1hbmRhdG9yeVxuICAgIGFsbG93QW5vbnltb3VzOiB0cnVlLCAvLyBBbGxvdyBhbm9ueW1vdXMgY29ubmVjdGlvbnNcbiAgICBhbm9ueW1vdXNDb25maWc6IHtcbiAgICAgIGVuYWJsZWQ6IHRydWUsXG4gICAgICBzZXNzaW9uRHVyYXRpb246IDI0ICogNjAgKiA2MCAqIDEwMDAsIC8vIDI0IGhvdXJzXG4gICAgICBwZXJzaXN0ZW50SWRlbnRpdHlFbmFibGVkOiB0cnVlLFxuICAgICAgbWV0YWRhdGE6IHtcbiAgICAgICAgcGVybWlzc2lvbnM6IFtcInJlYWRcIl0sIC8vIERlZmF1bHQgcGVybWlzc2lvbnMgZm9yIGFub255bW91cyB1c2Vyc1xuICAgICAgfSxcbiAgICB9LFxuICAgIHNlc3Npb25TdG9yZSxcbiAgICBhdXRoUHJvdmlkZXIsXG4gIH0sXG59KTtcblxuY29uc3Qgc2VydmVyID0gbmV3IFNlcnZlclJ1bm5lcigpO1xuc2VydmVyLnJlZ2lzdGVyU2VydmljZShleGFtcGxlV2ViU2VydmVyKTtcbnNlcnZlci5yZWdpc3RlclNlcnZpY2UoZXhhbXBsZVdlYlNvY2tldFNlcnZlcik7XG5cbmNvbnN0IG1haW4gPSBhc3luYyAoKSA9PiB7XG4gIGF3YWl0IGF1dGhQcm92aWRlci5hZGRVc2VyKFwicm9vdFwiLCBcInBhc3N3b3JkXCIpO1xuICBzZXJ2ZXIuc3RhcnQoKTtcbn07XG5cbm1haW4oKTtcbiJdfQ==