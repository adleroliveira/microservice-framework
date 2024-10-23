import { ServerRunner } from "../ServerRunner";
import { ExampleWebServer } from "./microservices/ExampleWebServer";
import { ExampleWebSocketServer } from "./microservices/ExampleWebSocketServer";
import { Backend } from "../minimal/Backend";
import { ConsoleStrategy } from "../logging";
import path from "path";
import { InMemoryAuthProvider, InMemorySessionStore } from "../minimal";

const namespace = "example";
const logStrategy = new ConsoleStrategy();
const backend = new Backend();
const authProvider = new InMemoryAuthProvider();
const sessionStore = new InMemorySessionStore();

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

authProvider.addUser("root", "password").then(() => {
  console.log("Root user created");
  server.start();
});
