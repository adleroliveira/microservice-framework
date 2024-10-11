import { ServerRunner } from "../ServerRunner";
import { PingService } from "./microservices/PingService";
import { PongService } from "./microservices/PongService";
import { ExampleWebServer } from "./microservices/ExampleWebServer";
import { ExampleWebSocketServer } from "./microservices/ExampleWebSocketServer";
import { Backend } from "./backend/Backend";
import { ConsoleStrategy } from "../logging";
import path from "path";

const namespace = "example";
const logStrategy = new ConsoleStrategy();
const backend = new Backend();

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
});

const server = new ServerRunner();
server.registerService(exampleWebServer);
server.registerService(exampleWebSocketServer);
server.start();
