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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2V4YW1wbGVzL3NlcnZlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLGtEQUErQztBQUMvQyx1RUFBb0U7QUFDcEUsbUZBQWdGO0FBQ2hGLGdEQUE2QztBQUM3Qyx3Q0FBNkM7QUFDN0MsZ0RBQXdCO0FBQ3hCLHdDQUF3RTtBQUV4RSxNQUFNLFNBQVMsR0FBRyxTQUFTLENBQUM7QUFDNUIsTUFBTSxXQUFXLEdBQUcsSUFBSSx5QkFBZSxFQUFFLENBQUM7QUFDMUMsTUFBTSxPQUFPLEdBQUcsSUFBSSxpQkFBTyxFQUFFLENBQUM7QUFDOUIsTUFBTSxZQUFZLEdBQUcsSUFBSSw4QkFBb0IsRUFBRSxDQUFDO0FBQ2hELE1BQU0sWUFBWSxHQUFHLElBQUksOEJBQW9CLEVBQUUsQ0FBQztBQUVoRCxNQUFNLGdCQUFnQixHQUFHLElBQUksbUNBQWdCLENBQUMsT0FBTyxFQUFFO0lBQ3JELFNBQVM7SUFDVCxXQUFXO0lBQ1gsU0FBUyxFQUFFLFlBQVk7SUFDdkIsSUFBSSxFQUFFLElBQUk7SUFDVixTQUFTLEVBQUUsY0FBSSxDQUFDLElBQUksQ0FBQyxjQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxPQUFPLENBQUMsRUFBRSxTQUFTLENBQUM7Q0FDbEUsQ0FBQyxDQUFDO0FBRUgsTUFBTSxzQkFBc0IsR0FBRyxJQUFJLCtDQUFzQixDQUFDLE9BQU8sRUFBRTtJQUNqRSxTQUFTO0lBQ1QsV0FBVztJQUNYLFNBQVMsRUFBRSxXQUFXO0lBQ3RCLElBQUksRUFBRSxLQUFLO0lBQ1gsSUFBSSxFQUFFLElBQUk7SUFDVixjQUFjLEVBQUU7UUFDZCxRQUFRLEVBQUUsS0FBSyxFQUFFLCtCQUErQjtRQUNoRCxjQUFjLEVBQUUsSUFBSSxFQUFFLDhCQUE4QjtRQUNwRCxlQUFlLEVBQUU7WUFDZixPQUFPLEVBQUUsSUFBSTtZQUNiLGVBQWUsRUFBRSxFQUFFLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxJQUFJLEVBQUUsV0FBVztZQUNqRCx5QkFBeUIsRUFBRSxJQUFJO1lBQy9CLFFBQVEsRUFBRTtnQkFDUixXQUFXLEVBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSwwQ0FBMEM7YUFDbEU7U0FDRjtRQUNELFlBQVk7UUFDWixZQUFZO0tBQ2I7Q0FDRixDQUFDLENBQUM7QUFFSCxNQUFNLE1BQU0sR0FBRyxJQUFJLDJCQUFZLEVBQUUsQ0FBQztBQUNsQyxNQUFNLENBQUMsZUFBZSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFDekMsTUFBTSxDQUFDLGVBQWUsQ0FBQyxzQkFBc0IsQ0FBQyxDQUFDO0FBRS9DLE1BQU0sSUFBSSxHQUFHLEtBQUssSUFBSSxFQUFFO0lBQ3RCLE1BQU0sWUFBWSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsVUFBVSxDQUFDLENBQUM7SUFDL0MsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDO0FBQ2pCLENBQUMsQ0FBQztBQUVGLElBQUksRUFBRSxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgU2VydmVyUnVubmVyIH0gZnJvbSBcIi4uL1NlcnZlclJ1bm5lclwiO1xuaW1wb3J0IHsgRXhhbXBsZVdlYlNlcnZlciB9IGZyb20gXCIuL21pY3Jvc2VydmljZXMvRXhhbXBsZVdlYlNlcnZlclwiO1xuaW1wb3J0IHsgRXhhbXBsZVdlYlNvY2tldFNlcnZlciB9IGZyb20gXCIuL21pY3Jvc2VydmljZXMvRXhhbXBsZVdlYlNvY2tldFNlcnZlclwiO1xuaW1wb3J0IHsgQmFja2VuZCB9IGZyb20gXCIuLi9taW5pbWFsL0JhY2tlbmRcIjtcbmltcG9ydCB7IENvbnNvbGVTdHJhdGVneSB9IGZyb20gXCIuLi9sb2dnaW5nXCI7XG5pbXBvcnQgcGF0aCBmcm9tIFwicGF0aFwiO1xuaW1wb3J0IHsgSW5NZW1vcnlBdXRoUHJvdmlkZXIsIEluTWVtb3J5U2Vzc2lvblN0b3JlIH0gZnJvbSBcIi4uL21pbmltYWxcIjtcblxuY29uc3QgbmFtZXNwYWNlID0gXCJleGFtcGxlXCI7XG5jb25zdCBsb2dTdHJhdGVneSA9IG5ldyBDb25zb2xlU3RyYXRlZ3koKTtcbmNvbnN0IGJhY2tlbmQgPSBuZXcgQmFja2VuZCgpO1xuY29uc3QgYXV0aFByb3ZpZGVyID0gbmV3IEluTWVtb3J5QXV0aFByb3ZpZGVyKCk7XG5jb25zdCBzZXNzaW9uU3RvcmUgPSBuZXcgSW5NZW1vcnlTZXNzaW9uU3RvcmUoKTtcblxuY29uc3QgZXhhbXBsZVdlYlNlcnZlciA9IG5ldyBFeGFtcGxlV2ViU2VydmVyKGJhY2tlbmQsIHtcbiAgbmFtZXNwYWNlLFxuICBsb2dTdHJhdGVneSxcbiAgc2VydmljZUlkOiBcIndlYnNlcnZpY2VcIixcbiAgcG9ydDogODA4MixcbiAgc3RhdGljRGlyOiBwYXRoLmpvaW4ocGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgXCIuLi8uLlwiKSwgXCIvcHVibGljXCIpLFxufSk7XG5cbmNvbnN0IGV4YW1wbGVXZWJTb2NrZXRTZXJ2ZXIgPSBuZXcgRXhhbXBsZVdlYlNvY2tldFNlcnZlcihiYWNrZW5kLCB7XG4gIG5hbWVzcGFjZSxcbiAgbG9nU3RyYXRlZ3ksXG4gIHNlcnZpY2VJZDogXCJ3ZWJzb2NrZXRcIixcbiAgcGF0aDogXCIvd3NcIixcbiAgcG9ydDogODA4MyxcbiAgYXV0aGVudGljYXRpb246IHtcbiAgICByZXF1aXJlZDogZmFsc2UsIC8vIEF1dGhlbnRpY2F0aW9uIG5vdCBtYW5kYXRvcnlcbiAgICBhbGxvd0Fub255bW91czogdHJ1ZSwgLy8gQWxsb3cgYW5vbnltb3VzIGNvbm5lY3Rpb25zXG4gICAgYW5vbnltb3VzQ29uZmlnOiB7XG4gICAgICBlbmFibGVkOiB0cnVlLFxuICAgICAgc2Vzc2lvbkR1cmF0aW9uOiAyNCAqIDYwICogNjAgKiAxMDAwLCAvLyAyNCBob3Vyc1xuICAgICAgcGVyc2lzdGVudElkZW50aXR5RW5hYmxlZDogdHJ1ZSxcbiAgICAgIG1ldGFkYXRhOiB7XG4gICAgICAgIHBlcm1pc3Npb25zOiBbXCJyZWFkXCJdLCAvLyBEZWZhdWx0IHBlcm1pc3Npb25zIGZvciBhbm9ueW1vdXMgdXNlcnNcbiAgICAgIH0sXG4gICAgfSxcbiAgICBzZXNzaW9uU3RvcmUsXG4gICAgYXV0aFByb3ZpZGVyLFxuICB9LFxufSk7XG5cbmNvbnN0IHNlcnZlciA9IG5ldyBTZXJ2ZXJSdW5uZXIoKTtcbnNlcnZlci5yZWdpc3RlclNlcnZpY2UoZXhhbXBsZVdlYlNlcnZlcik7XG5zZXJ2ZXIucmVnaXN0ZXJTZXJ2aWNlKGV4YW1wbGVXZWJTb2NrZXRTZXJ2ZXIpO1xuXG5jb25zdCBtYWluID0gYXN5bmMgKCkgPT4ge1xuICBhd2FpdCBhdXRoUHJvdmlkZXIuYWRkVXNlcihcInJvb3RcIiwgXCJwYXNzd29yZFwiKTtcbiAgc2VydmVyLnN0YXJ0KCk7XG59O1xuXG5tYWluKCk7XG4iXX0=