# MicroserviceFramework Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Getting Started](#getting-started)
3. [Core Concepts](#core-concepts)
4. [Configuration](#configuration)
5. [Request Handling](#request-handling)
6. [Sending Messages and Requests](#sending-messages-and-requests)
7. [Service Discovery](#service-discovery)
8. [Logging](#logging)
9. [Error Handling](#error-handling)
10. [Best Practices](#best-practices)

## Introduction

The MicroserviceFramework is a TypeScript-based framework designed to simplify the creation and management of microservices. It provides a robust foundation for building scalable, distributed systems with features such as request handling, service discovery, rate limiting, and more.

## Getting Started

To use the MicroserviceFramework, you need to create a class that extends the `MicroserviceFramework` base class. Here's a basic example:

```typescript
import {
  MicroserviceFramework,
  IServerConfig,
  RequestHandler,
} from "./path-to-microservice-framework";

class MyService extends MicroserviceFramework<MyRequestBody, MyResponseData> {
  constructor(backend: IBackEnd, config: IServerConfig) {
    super(backend, config);
  }

  @RequestHandler<MyRequestBody>("MY_REQUEST_TYPE")
  async handleMyRequest(body: MyRequestBody): Promise<MyResponseData> {
    // Handle the request
    return {
      /* your response data */
    };
  }
}
```

## Core Concepts

The MicroserviceFramework is built around several core concepts:

1. **Service**: A single instance of your microservice, extending the `MicroserviceFramework` class.
2. **Requests**: Incoming messages that your service can handle.
3. **Responses**: Outgoing messages sent in reply to requests.
4. **Channels**: Communication pathways for sending and receiving messages.
5. **Service Discovery**: A mechanism for locating and load balancing between service instances.

## Configuration

When initializing your service, you need to provide a configuration object (`IServerConfig`):

```typescript
const config: IServerConfig = {
  namespace: "myapp",
  concurrencyLimit: 10,
  requestsPerInterval: 100,
  tpsInterval: 1000,
  serviceId: "my-service",
  requestCallbackTimeout: 30000, // optional, defaults to 30000ms
};

const myService = new MyService(backend, config);
```

## Request Handling

Use the `@RequestHandler` decorator to define methods that handle specific request types:

```typescript
@RequestHandler<MyRequestBody>("MY_REQUEST_TYPE")
async handleMyRequest(body: MyRequestBody): Promise<MyResponseData> {
  // Handle the request
  return { /* your response data */ };
}
```

The framework will automatically route incoming requests to the appropriate handler based on the `requestType` in the request header.

## Sending Messages and Requests

### One-way Messages

To send a one-way message (fire-and-forget):

```typescript
await this.sendOneWayMessage("MESSAGE_TYPE", "recipient-service", messageBody);
```

### Request-Response

To send a request and wait for a response:

```typescript
const response = await this.makeRequest<ResponseType>(
  "REQUEST_TYPE",
  "recipient-service",
  requestBody
);
```

## Service Discovery

The framework includes a `ServiceDiscoveryManager` that helps with registering your service and finding other services. It's automatically initialized and used internally.

To get the least loaded node for a service:

```typescript
const nodeId = await this.serviceDiscoveryManager.getLeastLoadedNode(
  "service-id"
);
```

## Logging

The framework integrates with a logging system. Use the following methods for logging:

```typescript
this.info("Informational message");
this.warn("Warning message");
this.error("Error message", errorObject);
```

## Error Handling

Use the `@Loggable.handleErrors` decorator on methods to automatically log and handle errors:

```typescript
@Loggable.handleErrors
async myMethod() {
  // Your code here
}
```

## Best Practices

1. **Request Handlers**: Keep request handlers focused and small. Move complex logic to separate methods.
2. **Error Handling**: Use try-catch blocks in your request handlers to ensure you always return a valid response.
3. **Timeouts**: Be aware of the `requestCallbackTimeout` and ensure your handlers respond within this time.
4. **Scaling**: Use the service discovery mechanism to distribute load across multiple instances of your service.
5. **Logging**: Use appropriate log levels (info, warn, error) to make troubleshooting easier.
6. **Testing**: Create unit tests for your request handlers and integration tests for the full service.

Remember to handle edge cases, validate input, and provide meaningful error messages to make your microservice robust and maintainable.

## ServerRunner

The ServerRunner class is a complementary utility designed to help run and manage microservices created with the MicroserviceFramework. It provides a structured way to start and stop your service, handle process signals, and manage logging.

### Features

- Graceful shutdown handling (SIGINT and SIGTERM)
- Unhandled rejection handling
- Logging configuration
- Easy start and stop methods

### Usage

To use the ServerRunner, you first need to import it along with the necessary logging utilities:

```typescript
import {
  Loggable,
  LogLevel,
  ConsoleStrategy,
  LogStrategy,
} from "@/utils/logging";
import { MicroserviceFramework } from "@/core";
import { ServerRunner } from "./path-to-server-runner";
```

Then, you can create an instance of ServerRunner with your microservice:

```typescript
const myService = new MyService(backend, config);
const runner = new ServerRunner(myService, LogLevel.DEBUG);
```

### Starting the Service

To start your service:

```typescript
runner.start();
```

This method will call the `start()` method of your MicroserviceFramework instance and handle any errors that occur during startup.

### Stopping the Service

To stop your service programmatically:

```typescript
runner.stop();
```

This method will call the `stop()` method of your MicroserviceFramework instance.

### Automatic Shutdown Handling

The ServerRunner automatically sets up handlers for SIGINT and SIGTERM signals. When these signals are received, it will gracefully shut down your service.

### Logging

The ServerRunner uses the Loggable class for logging. You can set the log level when creating the ServerRunner instance:

```typescript
const runner = new ServerRunner(myService, LogLevel.INFO);
```

### Error Handling

The ServerRunner sets up a handler for unhandled rejections. These are logged using the configured log strategy.

### Best Practices

1. **Always use ServerRunner**: It's recommended to always use the ServerRunner when deploying your microservices in production. It provides important features like graceful shutdown and error handling.

2. **Configure Logging**: Set an appropriate log level for your environment. Use DEBUG for development and INFO or WARN for production.

3. **Error Handling**: While ServerRunner handles unhandled rejections, it's still best practice to handle errors within your service where possible.

4. **Graceful Shutdown**: The ServerRunner provides graceful shutdown handling, but ensure your service's `stop()` method properly closes all resources (database connections, file handles, etc.).

By using the ServerRunner, you can ensure that your microservices are run consistently and handle common scenarios like shutdowns and unhandled errors gracefully.
