import { ServerRunner } from "../ServerRunner";
import { PingService } from "./microservices/ping/PingService";
import { PongService } from "./microservices/pong/PongService";
import { Backend } from "./backend/Backend";
import { ConsoleStrategy } from "..//MicroserviceFramework";

const namespace = "example";
const logStrategy = new ConsoleStrategy();
const backend = new Backend();

const pongConfig = {
  namespace,
  logStrategy,
  serviceId: "pong",
  concurrencyLimit: 1,
  requestsPerInterval: 1,
  interval: 1000,
  statusUpdateInterval: 2000,
};

const ping = new PingService(backend, {
  namespace,
  logStrategy,
  serviceId: "ping",
});

const pong1 = new PongService(backend, pongConfig);
const pong2 = new PongService(backend, pongConfig);
const pong3 = new PongService(backend, pongConfig);

const server = new ServerRunner();
server.registerService(ping);
server.registerService(pong1);
server.registerService(pong2);
server.registerService(pong3);
server.start();
