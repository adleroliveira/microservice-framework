import { ServerRunner } from "../ServerRunner";
import { ExampleWebServer } from "./microservices/ExampleWebServer";
import { ExampleWebSocketServer } from "./microservices/ExampleWebSocketServer";
import { Backend } from "../minimal/Backend";
import { ConsoleStrategy } from "../logging";
import path from "path";
import { FileAuthProvider, FileSessionStore } from "../minimal";

const namespace = "example";
const logStrategy = new ConsoleStrategy();
const backend = new Backend();
const authProvider = new FileAuthProvider();
const sessionStore = new FileSessionStore();

const exampleWebServer = new ExampleWebServer(backend, {
  namespace,
  logStrategy,
  serviceId: "webservice",
  port: 8082,
  staticDir: path.join(path.resolve(__dirname, "../.."), "/public"),
});

const exampleWebSocketServer = new ExampleWebSocketServer(backend, {
  namespace,
  logStrategy,
  serviceId: "websocket",
  path: "/ws",
  port: 8083,
  requiresAuthentication: true,
  authProvider,
  sessionStore,
});

const server = new ServerRunner();
server.registerService(exampleWebServer);
server.registerService(exampleWebSocketServer);

const main = async () => {
  await authProvider.initialize();
  await sessionStore.initialize();
  await authProvider.addUser("root", "password");
  server.start();
}

main();