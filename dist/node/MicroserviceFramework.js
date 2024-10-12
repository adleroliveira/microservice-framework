"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicroserviceFramework = exports.MicroserviceLogStrategy = void 0;
exports.RequestHandler = RequestHandler;
const RateLimitedTaskScheduler_1 = require("./core//RateLimitedTaskScheduler");
const logging_1 = require("./logging");
const ServiceDiscoveryManager_1 = require("./core//ServiceDiscoveryManager");
require("reflect-metadata");
const uuid_1 = require("uuid");
const LogStrategy_1 = require("./logging/LogStrategy");
const chalk_1 = __importDefault(require("chalk"));
const REQUEST_HANDLER_METADATA_KEY = Symbol("requestHandler");
// Helper function to determine if the handler accepts full request
function isFullRequestHandler() {
    return {};
}
// Decorator
function RequestHandler(requestType) {
    return function (target, propertyKey, descriptor) {
        const acceptsFullRequest = isFullRequestHandler();
        const isAsync = descriptor.value?.constructor.name === "AsyncFunction";
        Reflect.defineMetadata(REQUEST_HANDLER_METADATA_KEY, { requestType, method: propertyKey, acceptsFullRequest, isAsync }, target, propertyKey);
    };
}
// Helper function to get all methods with the RequestHandler decorator
function getRequestHandlers(target) {
    const handlers = new Map();
    let currentTarget = target.prototype;
    while (currentTarget) {
        for (const propertyName of Object.getOwnPropertyNames(currentTarget)) {
            const metadata = Reflect.getMetadata(REQUEST_HANDLER_METADATA_KEY, currentTarget, propertyName);
            if (metadata) {
                handlers.set(metadata.requestType, metadata);
            }
        }
        currentTarget = Object.getPrototypeOf(currentTarget);
    }
    return handlers;
}
class MicroserviceLogStrategy extends LogStrategy_1.LogStrategy {
    constructor(logChannel) {
        super();
        this.logChannel = logChannel;
    }
    async sendPackaged(packagedMessage, options) {
        this.logChannel.send(packagedMessage);
    }
}
exports.MicroserviceLogStrategy = MicroserviceLogStrategy;
class MicroserviceFramework extends RateLimitedTaskScheduler_1.RateLimitedTaskScheduler {
    constructor(backend, config) {
        super(config.concurrencyLimit || 100, config.requestsPerInterval || 100, config.interval || 1000);
        this.statusUpdateTimeoutId = null;
        this.pendingRequests = new Map();
        this.running = false;
        this.statusUpdateInterval = 120000;
        this.requestCallbackTimeout = 30000;
        this.namespace = config.namespace;
        this.serverConfig = config;
        this.backend = backend;
        this.serviceId = config.serviceId;
        this.statusUpdateInterval = config.statusUpdateInterval || 120000;
        this.address = `${this.namespace}:${this.serviceId}:${this.instanceId}`;
        this.requestCallbackTimeout =
            config.requestCallbackTimeout || this.requestCallbackTimeout;
        this.requestHandlers = getRequestHandlers(this.constructor);
        this.serviceDiscoveryManager = new ServiceDiscoveryManager_1.ServiceDiscoveryManager(this.backend.serviceRegistry);
    }
    // @Loggable.handleErrors
    async initialize() {
        this.serviceChannel = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:${this.serviceId}`, this.handleServiceMessages.bind(this));
        this.broadcastChannel = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:${this.serviceId}:broadcast`);
        this.lobby = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:lobby`, this.handleLobbyMessages.bind(this));
        const logChannel = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:${this.serviceId}:logs`);
        if (!this.serverConfig.logStrategy) {
            logging_1.Loggable.setLogStrategy(this.serverConfig.logStrategy || new MicroserviceLogStrategy(logChannel));
            console.warn(chalk_1.default.yellow(`
[WARNING]
Log Strategy is set to MicroserviceLogStrategy.
MicroserviceFramework will stream logs to ${this.namespace}:${this.serviceId}:logs channel
If you are not seeing any logs, try adding the following to MicroserviceFramework configuration object:

import { ConsoleStrategy } from "microservice-framework";
config = {
  ...,
  logStrategy: new ConsoleStrategy()
}
      `));
        }
        else {
            logging_1.Loggable.setLogStrategy(this.serverConfig.logStrategy);
        }
        this.backend.pubSubConsumer.bindChannel(this.address, this.handleIncomingMessage.bind(this));
        await this.serviceDiscoveryManager.registerNode(this.serviceId, this.instanceId, this.queue.size());
        await this.lobby.send(MicroserviceFramework.createRequest(this.address, "CHECKIN", this.getServerStatus()));
        this.onTaskComplete(this.processAndNotify.bind(this));
        this.scheduleNextLoadLevelUpdate();
        this.info(`Service ${this.serviceId} [${this.instanceId}] initialized.`);
    }
    async updateLoadLevel() {
        await this.serviceDiscoveryManager.updateNodeLoad(this.serviceId, this.instanceId, this.queue.size());
        this.scheduleNextLoadLevelUpdate();
    }
    async startDependencies() {
        this.info(`Service: ${this.serviceId} started successfully. InstanceID: ${this.instanceId}`);
    }
    async stopDependencies() { }
    static createRequest(requesterAddress, requestType, body, recipientAddress) {
        return {
            header: {
                timestamp: Date.now(),
                requestId: (0, uuid_1.v4)(),
                requesterAddress,
                recipientAddress,
                requestType,
            },
            body,
        };
    }
    static createResponse(request, responderAddress, data, success = true, error = null) {
        return {
            requestHeader: request.header,
            responseHeader: {
                responderAddress,
                timestamp: Date.now(),
            },
            body: {
                data,
                success,
                error,
            },
        };
    }
    getServerStatus() {
        const status = {
            ...this.serverConfig,
            instanceId: this.instanceId,
            pendingRequests: this.pendingRequests.size,
            queueSize: this.queue.size(),
            runningTasks: this.runningTasks,
            timestamp: Date.now(),
            address: this.address,
        };
        return status;
    }
    getserviceId() {
        return this.serviceId;
    }
    getBackend() {
        return this.backend;
    }
    handleServiceMessages(message) { }
    async handleLobbyMessages(message) {
        if (this.isServiceStatusRequest(message)) {
            if (message.header.requestType === "CHECKIN") {
                this.info(`Received CHECKIN from ${message.header.requesterAddress}`);
            }
        }
    }
    async defaultMessageHandler(request) {
        throw new Error(`No handler found for request type: ${request.header.requestType}`);
    }
    isServiceStatusRequest(message) {
        return "header" in message && "requestType" in message.header;
    }
    scheduleNextLoadLevelUpdate() {
        if (this.statusUpdateTimeoutId) {
            clearTimeout(this.statusUpdateTimeoutId);
        }
        this.statusUpdateTimeoutId = setTimeout(() => {
            this.updateLoadLevel();
            this.scheduleNextLoadLevelUpdate();
        }, this.statusUpdateInterval);
    }
    async processRequest(input) {
        const requestType = input.header.requestType;
        if (!requestType) {
            throw new Error("Request type not specified");
        }
        const handlerMetadata = this.requestHandlers.get(requestType);
        if (!handlerMetadata) {
            return await this.defaultMessageHandler(input);
        }
        // Call the handler method
        const handlerMethod = this[handlerMetadata.method].bind(this);
        const args = handlerMetadata.acceptsFullRequest ? input : input.body;
        const handlerResponse = handlerMetadata.isAsync
            ? await handlerMethod(args)
            : handlerMethod(args);
        return handlerResponse;
    }
    async wrapAndProcessRequest(input) {
        try {
            const result = await this.processRequest(input);
            let response = this.makeResponse(result, input, null);
            response = this.enrichResponse(response, input);
            return response;
        }
        catch (error) {
            let response = this.makeResponse({}, input, error);
            response = this.enrichResponse(response, input);
            return response;
        }
    }
    async handleStatusUpdate(request, status) { }
    enrichResponse(response, originalRequest) {
        // Default implementation does nothing
        // Concrete classes can override this method to add custom enrichment
        // FIXME: For now, logging within this method causes infinite loop.
        return response;
    }
    enrichRequest(header, body) {
        // Default implementation: return the header unchanged
        return header;
    }
    async handleIncomingMessage(payload) {
        // right now we don't wait to see if the acknowledgement succeeded.
        // we might want to do this in the future.
        await this.backend.pubSubConsumer.ack(payload);
        this.processIncomingMessage(payload);
    }
    async processIncomingMessage(payload) {
        if (this.isResponse(payload)) {
            await this.handleResponse(payload);
        }
        else {
            if (payload.header.requestType === "MicroserviceFramework::StatusUpdate") {
                const requestId = payload.header.requestId;
                const status = payload.body;
                const callbackObject = this.pendingRequests.get(requestId);
                if (callbackObject) {
                    const { callback, timeoutCallback, timeOutId, handleStatusUpdate } = callbackObject;
                    clearTimeout(timeOutId);
                    const newTimeOut = setTimeout(timeoutCallback, this.requestCallbackTimeout);
                    this.pendingRequests.set(requestId, {
                        callback,
                        timeoutCallback,
                        timeOutId: newTimeOut,
                        handleStatusUpdate,
                    });
                    await handleStatusUpdate(payload, status);
                    return;
                }
            }
            this.scheduleNewMessage(payload);
        }
    }
    isResponse(payload) {
        return "responseHeader" in payload;
    }
    async handleResponse(response) {
        const requestId = response.requestHeader.requestId;
        const callbackObject = this.pendingRequests.get(requestId);
        if (callbackObject) {
            try {
                await callbackObject.callback(response);
            }
            catch (error) {
                this.error(`Error executing callback for request ${requestId}`, error);
            }
            finally {
                this.pendingRequests.delete(requestId);
            }
        }
        else {
            this.warn(`Received response for unknown request: ${requestId}`);
        }
    }
    scheduleNewMessage(message) {
        this.scheduleTask(async (input) => await this.wrapAndProcessRequest(input), message);
    }
    async start() {
        await this.startDependencies();
        this.running = true;
    }
    async stop() {
        await this.lobby.send(MicroserviceFramework.createRequest(this.address, "CHECKOUT", this.getServerStatus()));
        this.info(`Service ${this.serviceId} [${this.instanceId}] checked out`);
        await this.stopDependencies();
        await this.serviceDiscoveryManager.unregisterNode(this.serviceId, this.instanceId);
        this.running = false;
    }
    async processAndNotify(output) {
        // FIXME: DO NOT LOG WITHIN THIS METHOD, it causes infinite loop!
        if (output.result) {
            const recipientAddress = output.result.requestHeader.recipientAddress;
            if (recipientAddress) {
                await this.sendNotification(output.result);
            }
        }
    }
    async sendNotification(response) {
        const recipientId = response.requestHeader.recipientAddress;
        if (recipientId) {
            const [_namespace, serviceId, _instanceId] = recipientId.split(":");
            if (serviceId && serviceId === this.serviceId) {
                this.processIncomingMessage(response);
                return;
            }
            const peer = this.backend.pubSubConsumer.bindChannel(recipientId);
            peer.send(response);
            // TODO: validate if peer exists before sending message
            // Throw if peer not found.
        }
    }
    async sendStatusUpdate(request, status) {
        await this.sendOneWayMessage("MicroserviceFramework::StatusUpdate", request.header.requesterAddress, status, request.header.requestId);
    }
    makeResponse(data, request, error) {
        const response = {
            requestHeader: request.header,
            responseHeader: {
                timestamp: Date.now(),
                responderAddress: this.address,
            },
            body: {
                data,
                success: error === null,
                error,
            },
        };
        if (request.header.recipientAddress &&
            (!data || (typeof data === "object" && Object.keys(data).length === 0)) &&
            !error) {
            this.error(`Attempting to send empty data for ${request.header.requestType}. Data: ${JSON.stringify(data)}`, { request, error });
            error = new Error("Empty response data");
        }
        return response;
    }
    async sendOneWayMessage(messageType, to, body, requestId) {
        requestId = requestId || this.generateRequestId();
        let peerAddress = "";
        if (to.startsWith(`${this.namespace}:`)) {
            peerAddress = to;
        }
        else {
            const nodeId = await this.serviceDiscoveryManager.getLeastLoadedNode(to);
            if (!nodeId) {
                throw new logging_1.LoggableError(`No nodes available for service ${to}.`);
            }
            peerAddress = `${this.namespace}:${to}:${nodeId}`;
        }
        const peer = this.backend.pubSubConsumer.bindChannel(peerAddress);
        let header = {
            timestamp: Date.now(),
            requestId,
            requesterAddress: this.serviceId,
            requestType: messageType,
            // Note: recipientAddress is intentionally omitted
        };
        header = this.enrichRequest(header, body);
        const message = {
            header,
            body,
        };
        try {
            await peer.send(message);
        }
        catch (error) {
            this.error(`Failed to send one-way message to ${to}`, {
                error,
                requestId,
                messageType,
            });
            throw new logging_1.LoggableError(`Failed to send one-way message to ${to}`, error);
        }
    }
    async makeRequest(props) {
        const { to, requestType, body, replyTo, handleStatusUpdate, headers, timeout, timeoutCallback, } = props;
        return new Promise(async (resolve, reject) => {
            const requestId = headers?.requestId || this.generateRequestId();
            let peerAddress = "";
            if (to.startsWith(`${this.namespace}:`)) {
                peerAddress = to;
            }
            else {
                const nodeId = await this.serviceDiscoveryManager.getLeastLoadedNode(to);
                if (!nodeId) {
                    reject(new logging_1.LoggableError(`No nodes available for service ${to}.`));
                    return;
                }
                peerAddress = `${this.namespace}:${to}:${nodeId}`;
            }
            let header = {
                timestamp: Date.now(),
                requestId,
                requesterAddress: headers?.requesterAddress || this.address,
                recipientAddress: replyTo || this.address,
                requestType,
            };
            header = this.enrichRequest(header, body);
            const request = {
                header,
                body,
            };
            const callback = async (response) => {
                try {
                    if (response.body.success) {
                        resolve(response);
                    }
                    else {
                        this.error(`Request to ${to} failed`, {
                            requestId,
                            error: response.body.error,
                            requestType,
                            to,
                            replyTo,
                        });
                        reject(new logging_1.LoggableError(`Request to ${to} failed`, {
                            request,
                            response,
                        }));
                    }
                }
                catch (error) {
                    this.error(`Error in callback for request ${requestId}`, error);
                    reject(new logging_1.LoggableError(`Error processing response from ${to}`, error));
                }
            };
            const timeoutMs = timeout || this.requestCallbackTimeout;
            const timeoutCb = timeoutCallback ||
                (() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.pendingRequests.delete(requestId);
                        this.warn(`Request to ${to} timed out`, {
                            requestId,
                            timeoutMs,
                            requestType,
                        });
                        reject(new logging_1.LoggableError(`Request to ${to} timed out after ${timeoutMs}ms`));
                    }
                });
            const timeOutId = setTimeout(timeoutCb, timeoutMs);
            this.pendingRequests.set(requestId, {
                callback,
                timeoutCallback: timeoutCb,
                timeOutId,
                handleStatusUpdate: handleStatusUpdate || this.handleStatusUpdate.bind(this),
            });
            const peer = this.backend.pubSubConsumer.bindChannel(peerAddress);
            const sendMethod = to == this.serviceId
                ? this.processIncomingMessage.bind(this)
                : peer.send;
            sendMethod(request).catch((error) => {
                this.pendingRequests.delete(requestId);
                this.error(`Failed to send request to ${to}`, {
                    error,
                    requestId,
                    requestType,
                });
                reject(new logging_1.LoggableError(`Failed to send request to ${to}`, error));
            });
        });
    }
    generateRequestId() {
        return `${this.serviceId}-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`;
    }
}
exports.MicroserviceFramework = MicroserviceFramework;
__decorate([
    logging_1.Loggable.handleErrors,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MicroserviceFramework.prototype, "start", null);
__decorate([
    logging_1.Loggable.handleErrors,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MicroserviceFramework.prototype, "stop", null);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7QUE2QkEsd0NBZUM7QUEzQ0QsK0VBRzBDO0FBQzFDLHVDQUFnRTtBQUNoRSw2RUFBMEU7QUFFMUUsNEJBQTBCO0FBQzFCLCtCQUFvQztBQUNwQyx1REFBb0Q7QUFDcEQsa0RBQTBCO0FBRTFCLE1BQU0sNEJBQTRCLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFXOUQsbUVBQW1FO0FBQ25FLFNBQVMsb0JBQW9CO0lBQzNCLE9BQU8sRUFBaUMsQ0FBQztBQUMzQyxDQUFDO0FBQ0QsWUFBWTtBQUNaLFNBQWdCLGNBQWMsQ0FBSSxXQUFtQjtJQUNuRCxPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQXNDO1FBRXRDLE1BQU0sa0JBQWtCLEdBQUcsb0JBQW9CLEVBQUssQ0FBQztRQUNyRCxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFDO1FBQ3ZFLE9BQU8sQ0FBQyxjQUFjLENBQ3BCLDRCQUE0QixFQUM1QixFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxFQUNqRSxNQUFNLEVBQ04sV0FBVyxDQUNaLENBQUM7SUFDSixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsdUVBQXVFO0FBQ3ZFLFNBQVMsa0JBQWtCLENBQUMsTUFBVztJQUNyQyxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBa0MsQ0FBQztJQUUzRCxJQUFJLGFBQWEsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDO0lBQ3JDLE9BQU8sYUFBYSxFQUFFLENBQUM7UUFDckIsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsbUJB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WUFBWTs7OztrREFJckI7QUFHSztJQURMLGtCQUFRLENBQUMsWUFBWTs7OztpREFpQnJCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSUJhY2tFbmQsIENoYW5uZWxCaW5kaW5nIH0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHtcbiAgUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyLFxuICBUYXNrT3V0cHV0LFxufSBmcm9tIFwiLi9jb3JlLy9SYXRlTGltaXRlZFRhc2tTY2hlZHVsZXJcIjtcbmltcG9ydCB7IExvZ2dhYmxlLCBMb2dnYWJsZUVycm9yLCBMb2dNZXNzYWdlIH0gZnJvbSBcIi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgU2VydmljZURpc2NvdmVyeU1hbmFnZXIgfSBmcm9tIFwiLi9jb3JlLy9TZXJ2aWNlRGlzY292ZXJ5TWFuYWdlclwiO1xuaW1wb3J0IHsgSVJlcXVlc3QsIElSZXNwb25zZSwgSVJlcXVlc3RIZWFkZXIgfSBmcm9tIFwiLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgXCJyZWZsZWN0LW1ldGFkYXRhXCI7XG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuaW1wb3J0IHsgTG9nU3RyYXRlZ3kgfSBmcm9tIFwiLi9sb2dnaW5nL0xvZ1N0cmF0ZWd5XCI7XG5pbXBvcnQgY2hhbGsgZnJvbSBcImNoYWxrXCI7XG5cbmNvbnN0IFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVkgPSBTeW1ib2woXCJyZXF1ZXN0SGFuZGxlclwiKTtcblxuaW50ZXJmYWNlIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGEge1xuICByZXF1ZXN0VHlwZTogc3RyaW5nO1xuICBtZXRob2Q6IHN0cmluZztcbiAgYWNjZXB0c0Z1bGxSZXF1ZXN0OiBib29sZWFuO1xuICBpc0FzeW5jOiBib29sZWFuO1xufVxuXG50eXBlIElzRnVsbFJlcXVlc3Q8VD4gPSBUIGV4dGVuZHMgSVJlcXVlc3Q8YW55PiA/IHRydWUgOiBmYWxzZTtcblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGRldGVybWluZSBpZiB0aGUgaGFuZGxlciBhY2NlcHRzIGZ1bGwgcmVxdWVzdFxuZnVuY3Rpb24gaXNGdWxsUmVxdWVzdEhhbmRsZXI8VD4oKTogYm9vbGVhbiB7XG4gIHJldHVybiB7fSBhcyBJc0Z1bGxSZXF1ZXN0PFQ+IGFzIGJvb2xlYW47XG59XG4vLyBEZWNvcmF0b3JcbmV4cG9ydCBmdW5jdGlvbiBSZXF1ZXN0SGFuZGxlcjxUPihyZXF1ZXN0VHlwZTogc3RyaW5nKSB7XG4gIHJldHVybiBmdW5jdGlvbiA8TSBleHRlbmRzIChhcmc6IFQpID0+IFByb21pc2U8YW55PiB8IGFueT4oXG4gICAgdGFyZ2V0OiBhbnksXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxNPlxuICApIHtcbiAgICBjb25zdCBhY2NlcHRzRnVsbFJlcXVlc3QgPSBpc0Z1bGxSZXF1ZXN0SGFuZGxlcjxUPigpO1xuICAgIGNvbnN0IGlzQXN5bmMgPSBkZXNjcmlwdG9yLnZhbHVlPy5jb25zdHJ1Y3Rvci5uYW1lID09PSBcIkFzeW5jRnVuY3Rpb25cIjtcbiAgICBSZWZsZWN0LmRlZmluZU1ldGFkYXRhKFxuICAgICAgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSxcbiAgICAgIHsgcmVxdWVzdFR5cGUsIG1ldGhvZDogcHJvcGVydHlLZXksIGFjY2VwdHNGdWxsUmVxdWVzdCwgaXNBc3luYyB9LFxuICAgICAgdGFyZ2V0LFxuICAgICAgcHJvcGVydHlLZXlcbiAgICApO1xuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFsbCBtZXRob2RzIHdpdGggdGhlIFJlcXVlc3RIYW5kbGVyIGRlY29yYXRvclxuZnVuY3Rpb24gZ2V0UmVxdWVzdEhhbmRsZXJzKHRhcmdldDogYW55KTogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT4ge1xuICBjb25zdCBoYW5kbGVycyA9IG5ldyBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhPigpO1xuXG4gIGxldCBjdXJyZW50VGFyZ2V0ID0gdGFyZ2V0LnByb3RvdHlwZTtcbiAgd2hpbGUgKGN1cnJlbnRUYXJnZXQpIHtcbiAgICBmb3IgKGNvbnN0IHByb3BlcnR5TmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhjdXJyZW50VGFyZ2V0KSkge1xuICAgICAgY29uc3QgbWV0YWRhdGE6IFJlcXVlc3RIYW5kbGVyTWV0YWRhdGEgfCB1bmRlZmluZWQgPSBSZWZsZWN0LmdldE1ldGFkYXRhKFxuICAgICAgICBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZLFxuICAgICAgICBjdXJyZW50VGFyZ2V0LFxuICAgICAgICBwcm9wZXJ0eU5hbWVcbiAgICAgICk7XG4gICAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgICAgaGFuZGxlcnMuc2V0KG1ldGFkYXRhLnJlcXVlc3RUeXBlLCBtZXRhZGF0YSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY3VycmVudFRhcmdldCA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50VGFyZ2V0KTtcbiAgfVxuXG4gIHJldHVybiBoYW5kbGVycztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJU2VydmVyQ29uZmlnIHtcbiAgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIGNvbmN1cnJlbmN5TGltaXQ/OiBudW1iZXI7XG4gIHJlcXVlc3RzUGVySW50ZXJ2YWw/OiBudW1iZXI7XG4gIGludGVydmFsPzogbnVtYmVyO1xuICB0cHNJbnRlcnZhbD86IG51bWJlcjtcbiAgc2VydmljZUlkOiBzdHJpbmc7XG4gIHJlcXVlc3RDYWxsYmFja1RpbWVvdXQ/OiBudW1iZXI7XG4gIGxvZ1N0cmF0ZWd5PzogTG9nU3RyYXRlZ3k7XG4gIHN0YXR1c1VwZGF0ZUludGVydmFsPzogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZpY2VTdGF0dXMgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgaW5zdGFuY2VJZDogc3RyaW5nO1xuICBwZW5kaW5nUmVxdWVzdHM6IG51bWJlcjtcbiAgcXVldWVTaXplOiBudW1iZXI7XG4gIHJ1bm5pbmdUYXNrczogbnVtYmVyO1xuICB0aW1lc3RhbXA6IG51bWJlcjtcbiAgYWRkcmVzczogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YXR1c1VwZGF0ZSB7XG4gIHN0YXR1czogc3RyaW5nO1xuICBwcm9ncmVzcz86IG51bWJlcjtcbiAgbWV0YWRhdGE/OiBhbnk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVxdWVzdFByb3BzIHtcbiAgcmVxdWVzdFR5cGU6IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgYm9keTogYW55O1xuICByZXBseVRvPzogc3RyaW5nO1xuICBoYW5kbGVTdGF0dXNVcGRhdGU/OiAoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICApID0+IFByb21pc2U8dm9pZD47XG4gIHRpbWVvdXRDYWxsYmFjaz86ICgpID0+IHZvaWQ7XG4gIHRpbWVvdXQ/OiBudW1iZXI7XG4gIGhlYWRlcnM/OiBJUmVxdWVzdEhlYWRlcjtcbiAgaXNCcm9hZGNhc3Q/OiBib29sZWFuO1xufVxuXG5leHBvcnQgdHlwZSBDYWxsYmFja0Z1bmN0aW9uPFQ+ID0gKHJlc3BvbnNlOiBJUmVzcG9uc2U8VD4pID0+IFByb21pc2U8dm9pZD47XG5leHBvcnQgdHlwZSBDYWxsYmFja09iamVjdDxUPiA9IHtcbiAgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD47XG4gIHRpbWVvdXRDYWxsYmFjazogKCkgPT4gdm9pZDtcbiAgaGFuZGxlU3RhdHVzVXBkYXRlOiAoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VD4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB0aW1lT3V0SWQ6IE5vZGVKUy5UaW1lb3V0O1xufTtcblxuZXhwb3J0IGNsYXNzIE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5IGV4dGVuZHMgTG9nU3RyYXRlZ3kge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGxvZ0NoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PExvZ01lc3NhZ2U+Pikge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFBhY2thZ2VkKFxuICAgIHBhY2thZ2VkTWVzc2FnZTogSVJlcXVlc3Q8YW55PixcbiAgICBvcHRpb25zPzogUmVjb3JkPHN0cmluZywgYW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxvZ0NoYW5uZWwuc2VuZChwYWNrYWdlZE1lc3NhZ2UpO1xuICB9XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFRSZXF1ZXN0Qm9keSxcbiAgVFJlc3BvbnNlRGF0YVxuPiBleHRlbmRzIFJhdGVMaW1pdGVkVGFza1NjaGVkdWxlcjxcbiAgSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PixcbiAgSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+XG4+IHtcbiAgcHJpdmF0ZSBsb2JieTogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8YW55Pj47XG4gIHByaXZhdGUgc2VydmljZUNoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcml2YXRlIHN0YXR1c1VwZGF0ZVRpbWVvdXRJZDogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwZW5kaW5nUmVxdWVzdHM6IE1hcDxzdHJpbmcsIENhbGxiYWNrT2JqZWN0PGFueT4+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlcXVlc3RIYW5kbGVyczogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT47XG4gIHByb3RlY3RlZCBicm9hZGNhc3RDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxhbnk+PjtcbiAgcHJvdGVjdGVkIGJhY2tlbmQ6IElCYWNrRW5kO1xuICBwcm90ZWN0ZWQgc2VydmVyQ29uZmlnOiBJU2VydmVyQ29uZmlnO1xuICBwcm90ZWN0ZWQgc2VydmljZUlkOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBydW5uaW5nOiBib29sZWFuID0gZmFsc2U7XG4gIHByb3RlY3RlZCBzdGF0dXNVcGRhdGVJbnRlcnZhbDogbnVtYmVyID0gMTIwMDAwO1xuICBwcm90ZWN0ZWQgcmVxdWVzdENhbGxiYWNrVGltZW91dDogbnVtYmVyID0gMzAwMDA7XG4gIHJlYWRvbmx5IGFkZHJlc3M6IHN0cmluZztcbiAgcmVhZG9ubHkgc2VydmljZURpc2NvdmVyeU1hbmFnZXI6IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyO1xuICByZWFkb25seSBuYW1lc3BhY2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBJU2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoXG4gICAgICBjb25maWcuY29uY3VycmVuY3lMaW1pdCB8fCAxMDAsXG4gICAgICBjb25maWcucmVxdWVzdHNQZXJJbnRlcnZhbCB8fCAxMDAsXG4gICAgICBjb25maWcuaW50ZXJ2YWwgfHwgMTAwMFxuICAgICk7XG4gICAgdGhpcy5uYW1lc3BhY2UgPSBjb25maWcubmFtZXNwYWNlO1xuICAgIHRoaXMuc2VydmVyQ29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuYmFja2VuZCA9IGJhY2tlbmQ7XG4gICAgdGhpcy5zZXJ2aWNlSWQgPSBjb25maWcuc2VydmljZUlkO1xuICAgIHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwgPSBjb25maWcuc3RhdHVzVXBkYXRlSW50ZXJ2YWwgfHwgMTIwMDAwO1xuICAgIHRoaXMuYWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfToke3RoaXMuaW5zdGFuY2VJZH1gO1xuICAgIHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dCA9XG4gICAgICBjb25maWcucmVxdWVzdENhbGxiYWNrVGltZW91dCB8fCB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQ7XG4gICAgdGhpcy5yZXF1ZXN0SGFuZGxlcnMgPSBnZXRSZXF1ZXN0SGFuZGxlcnModGhpcy5jb25zdHJ1Y3Rvcik7XG4gICAgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciA9IG5ldyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcihcbiAgICAgIHRoaXMuYmFja2VuZC5zZXJ2aWNlUmVnaXN0cnlcbiAgICApO1xuICB9XG5cbiAgLy8gQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgIHRoaXMuc2VydmljZUNoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH1gLFxuICAgICAgdGhpcy5oYW5kbGVTZXJ2aWNlTWVzc2FnZXMuYmluZCh0aGlzKVxuICAgICk7XG4gICAgdGhpcy5icm9hZGNhc3RDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmJyb2FkY2FzdGBcbiAgICApO1xuICAgIHRoaXMubG9iYnkgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06bG9iYnlgLFxuICAgICAgdGhpcy5oYW5kbGVMb2JieU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIGNvbnN0IGxvZ0NoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06bG9nc2BcbiAgICApO1xuICAgIGlmICghdGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kpIHtcbiAgICAgIExvZ2dhYmxlLnNldExvZ1N0cmF0ZWd5KFxuICAgICAgICB0aGlzLnNlcnZlckNvbmZpZy5sb2dTdHJhdGVneSB8fCBuZXcgTWljcm9zZXJ2aWNlTG9nU3RyYXRlZ3kobG9nQ2hhbm5lbClcbiAgICAgICk7XG4gICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgIGNoYWxrLnllbGxvdyhgXG5bV0FSTklOR11cbkxvZyBTdHJhdGVneSBpcyBzZXQgdG8gTWljcm9zZXJ2aWNlTG9nU3RyYXRlZ3kuXG5NaWNyb3NlcnZpY2VGcmFtZXdvcmsgd2lsbCBzdHJlYW0gbG9ncyB0byAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfTpsb2dzIGNoYW5uZWxcbklmIHlvdSBhcmUgbm90IHNlZWluZyBhbnkgbG9ncywgdHJ5IGFkZGluZyB0aGUgZm9sbG93aW5nIHRvIE1pY3Jvc2VydmljZUZyYW1ld29yayBjb25maWd1cmF0aW9uIG9iamVjdDpcblxuaW1wb3J0IHsgQ29uc29sZVN0cmF0ZWd5IH0gZnJvbSBcIm1pY3Jvc2VydmljZS1mcmFtZXdvcmtcIjtcbmNvbmZpZyA9IHtcbiAgLi4uLFxuICBsb2dTdHJhdGVneTogbmV3IENvbnNvbGVTdHJhdGVneSgpXG59XG4gICAgICBgKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgTG9nZ2FibGUuc2V0TG9nU3RyYXRlZ3kodGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kpO1xuICAgIH1cbiAgICB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICB0aGlzLmhhbmRsZUluY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgdGhpcy5xdWV1ZS5zaXplKClcbiAgICApO1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tJTlwiLFxuICAgICAgICB0aGlzLmdldFNlcnZlclN0YXR1cygpXG4gICAgICApXG4gICAgKTtcbiAgICB0aGlzLm9uVGFza0NvbXBsZXRlKHRoaXMucHJvY2Vzc0FuZE5vdGlmeS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIHRoaXMuaW5mbyhgU2VydmljZSAke3RoaXMuc2VydmljZUlkfSBbJHt0aGlzLmluc3RhbmNlSWR9XSBpbml0aWFsaXplZC5gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlTG9hZExldmVsKCkge1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIudXBkYXRlTm9kZUxvYWQoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHRoaXMucXVldWUuc2l6ZSgpXG4gICAgKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCkge1xuICAgIHRoaXMuaW5mbyhcbiAgICAgIGBTZXJ2aWNlOiAke3RoaXMuc2VydmljZUlkfSBzdGFydGVkIHN1Y2Nlc3NmdWxseS4gSW5zdGFuY2VJRDogJHt0aGlzLmluc3RhbmNlSWR9YFxuICAgICk7XG4gIH1cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKSB7fVxuXG4gIHN0YXRpYyBjcmVhdGVSZXF1ZXN0PFQ+KFxuICAgIHJlcXVlc3RlckFkZHJlc3M6IHN0cmluZyxcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IFQsXG4gICAgcmVjaXBpZW50QWRkcmVzcz86IHN0cmluZ1xuICApOiBJUmVxdWVzdDxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZDogdXVpZHY0KCksXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgfSxcbiAgICAgIGJvZHksXG4gICAgfTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVSZXNwb25zZTxUPihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgIHJlc3BvbmRlckFkZHJlc3M6IHN0cmluZyxcbiAgICBkYXRhOiBULFxuICAgIHN1Y2Nlc3M6IGJvb2xlYW4gPSB0cnVlLFxuICAgIGVycm9yOiBFcnJvciB8IG51bGwgPSBudWxsXG4gICk6IElSZXNwb25zZTxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgcmVzcG9uZGVyQWRkcmVzcyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0U2VydmVyU3RhdHVzKCk6IFNlcnZpY2VTdGF0dXMge1xuICAgIGNvbnN0IHN0YXR1cyA9IHtcbiAgICAgIC4uLnRoaXMuc2VydmVyQ29uZmlnLFxuICAgICAgaW5zdGFuY2VJZDogdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgcGVuZGluZ1JlcXVlc3RzOiB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5zaXplLFxuICAgICAgcXVldWVTaXplOiB0aGlzLnF1ZXVlLnNpemUoKSxcbiAgICAgIHJ1bm5pbmdUYXNrczogdGhpcy5ydW5uaW5nVGFza3MsXG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICBhZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgfTtcblxuICAgIHJldHVybiBzdGF0dXM7XG4gIH1cblxuICBwdWJsaWMgZ2V0c2VydmljZUlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmljZUlkO1xuICB9XG5cbiAgcHVibGljIGdldEJhY2tlbmQoKTogSUJhY2tFbmQge1xuICAgIHJldHVybiB0aGlzLmJhY2tlbmQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlU2VydmljZU1lc3NhZ2VzPFQ+KG1lc3NhZ2U6IFQpIHt9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGhhbmRsZUxvYmJ5TWVzc2FnZXMoXG4gICAgbWVzc2FnZTogSVJlcXVlc3Q8YW55PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmlzU2VydmljZVN0YXR1c1JlcXVlc3QobWVzc2FnZSkpIHtcbiAgICAgIGlmIChtZXNzYWdlLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJDSEVDS0lOXCIpIHtcbiAgICAgICAgdGhpcy5pbmZvKGBSZWNlaXZlZCBDSEVDS0lOIGZyb20gJHttZXNzYWdlLmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzfWApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPFRSZXNwb25zZURhdGE+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTm8gaGFuZGxlciBmb3VuZCBmb3IgcmVxdWVzdCB0eXBlOiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWBcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBpc1NlcnZpY2VTdGF0dXNSZXF1ZXN0KFxuICAgIG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBtZXNzYWdlIGlzIElSZXF1ZXN0PFNlcnZpY2VTdGF0dXM+IHtcbiAgICByZXR1cm4gXCJoZWFkZXJcIiBpbiBtZXNzYWdlICYmIFwicmVxdWVzdFR5cGVcIiBpbiBtZXNzYWdlLmhlYWRlcjtcbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkKTtcbiAgICB9XG4gICAgdGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMudXBkYXRlTG9hZExldmVsKCk7XG4gICAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIH0sIHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXF1ZXN0VHlwZSA9IGlucHV0LmhlYWRlci5yZXF1ZXN0VHlwZTtcbiAgICBpZiAoIXJlcXVlc3RUeXBlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1ZXN0IHR5cGUgbm90IHNwZWNpZmllZFwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYW5kbGVyTWV0YWRhdGEgPSB0aGlzLnJlcXVlc3RIYW5kbGVycy5nZXQocmVxdWVzdFR5cGUpO1xuICAgIGlmICghaGFuZGxlck1ldGFkYXRhKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5kZWZhdWx0TWVzc2FnZUhhbmRsZXIoaW5wdXQpO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIGhhbmRsZXIgbWV0aG9kXG4gICAgY29uc3QgaGFuZGxlck1ldGhvZCA9ICh0aGlzIGFzIGFueSlbaGFuZGxlck1ldGFkYXRhLm1ldGhvZF0uYmluZCh0aGlzKTtcbiAgICBjb25zdCBhcmdzID0gaGFuZGxlck1ldGFkYXRhLmFjY2VwdHNGdWxsUmVxdWVzdCA/IGlucHV0IDogaW5wdXQuYm9keTtcblxuICAgIGNvbnN0IGhhbmRsZXJSZXNwb25zZSA9IGhhbmRsZXJNZXRhZGF0YS5pc0FzeW5jXG4gICAgICA/IGF3YWl0IGhhbmRsZXJNZXRob2QoYXJncylcbiAgICAgIDogaGFuZGxlck1ldGhvZChhcmdzKTtcblxuICAgIHJldHVybiBoYW5kbGVyUmVzcG9uc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyYXBBbmRQcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPj4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NSZXF1ZXN0KGlucHV0KTtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKHJlc3VsdCwgaW5wdXQsIG51bGwpO1xuICAgICAgcmVzcG9uc2UgPSB0aGlzLmVucmljaFJlc3BvbnNlKHJlc3BvbnNlLCBpbnB1dCk7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKFxuICAgICAgICB7fSBhcyBUUmVzcG9uc2VEYXRhLFxuICAgICAgICBpbnB1dCxcbiAgICAgICAgZXJyb3IgYXMgRXJyb3JcbiAgICAgICk7XG4gICAgICByZXNwb25zZSA9IHRoaXMuZW5yaWNoUmVzcG9uc2UocmVzcG9uc2UsIGlucHV0KTtcbiAgICAgIHJldHVybiByZXNwb25zZTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaGFuZGxlU3RhdHVzVXBkYXRlKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKTogUHJvbWlzZTx2b2lkPiB7fVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXNwb25zZShcbiAgICByZXNwb25zZTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+LFxuICAgIG9yaWdpbmFsUmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb24gZG9lcyBub3RoaW5nXG4gICAgLy8gQ29uY3JldGUgY2xhc3NlcyBjYW4gb3ZlcnJpZGUgdGhpcyBtZXRob2QgdG8gYWRkIGN1c3RvbSBlbnJpY2htZW50XG4gICAgLy8gRklYTUU6IEZvciBub3csIGxvZ2dpbmcgd2l0aGluIHRoaXMgbWV0aG9kIGNhdXNlcyBpbmZpbml0ZSBsb29wLlxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXF1ZXN0KGhlYWRlcjogSVJlcXVlc3RIZWFkZXIsIGJvZHk6IGFueSk6IElSZXF1ZXN0SGVhZGVyIHtcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9uOiByZXR1cm4gdGhlIGhlYWRlciB1bmNoYW5nZWRcbiAgICByZXR1cm4gaGVhZGVyO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVJbmNvbWluZ01lc3NhZ2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIHJpZ2h0IG5vdyB3ZSBkb24ndCB3YWl0IHRvIHNlZSBpZiB0aGUgYWNrbm93bGVkZ2VtZW50IHN1Y2NlZWRlZC5cbiAgICAvLyB3ZSBtaWdodCB3YW50IHRvIGRvIHRoaXMgaW4gdGhlIGZ1dHVyZS5cbiAgICBhd2FpdCB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYWNrKHBheWxvYWQpO1xuICAgIHRoaXMucHJvY2Vzc0luY29taW5nTWVzc2FnZShwYXlsb2FkKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0luY29taW5nTWVzc2FnZShcbiAgICBwYXlsb2FkOiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+IHwgSVJlc3BvbnNlPGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuaXNSZXNwb25zZShwYXlsb2FkKSkge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVSZXNwb25zZShwYXlsb2FkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKFxuICAgICAgICBwYXlsb2FkLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJNaWNyb3NlcnZpY2VGcmFtZXdvcms6OlN0YXR1c1VwZGF0ZVwiXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdElkID0gcGF5bG9hZC5oZWFkZXIucmVxdWVzdElkO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBwYXlsb2FkLmJvZHkgYXMgU3RhdHVzVXBkYXRlO1xuICAgICAgICBjb25zdCBjYWxsYmFja09iamVjdCA9IHRoaXMucGVuZGluZ1JlcXVlc3RzLmdldChyZXF1ZXN0SWQpO1xuICAgICAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgICAgICBjb25zdCB7IGNhbGxiYWNrLCB0aW1lb3V0Q2FsbGJhY2ssIHRpbWVPdXRJZCwgaGFuZGxlU3RhdHVzVXBkYXRlIH0gPVxuICAgICAgICAgICAgY2FsbGJhY2tPYmplY3Q7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVPdXRJZCk7XG4gICAgICAgICAgY29uc3QgbmV3VGltZU91dCA9IHNldFRpbWVvdXQoXG4gICAgICAgICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXRcbiAgICAgICAgICApO1xuICAgICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgICAgIGNhbGxiYWNrLFxuICAgICAgICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgICAgICAgICAgdGltZU91dElkOiBuZXdUaW1lT3V0LFxuICAgICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IGhhbmRsZVN0YXR1c1VwZGF0ZShwYXlsb2FkLCBzdGF0dXMpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5zY2hlZHVsZU5ld01lc3NhZ2UocGF5bG9hZCBhcyBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUmVzcG9uc2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IHBheWxvYWQgaXMgSVJlc3BvbnNlPGFueT4ge1xuICAgIHJldHVybiBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGF5bG9hZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUmVzcG9uc2UocmVzcG9uc2U6IElSZXNwb25zZTxhbnk+KSB7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0SWQ7XG4gICAgY29uc3QgY2FsbGJhY2tPYmplY3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQocmVxdWVzdElkKTtcbiAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrT2JqZWN0LmNhbGxiYWNrKHJlc3BvbnNlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgZXhlY3V0aW5nIGNhbGxiYWNrIGZvciByZXF1ZXN0ICR7cmVxdWVzdElkfWAsIGVycm9yKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJlc3BvbnNlIGZvciB1bmtub3duIHJlcXVlc3Q6ICR7cmVxdWVzdElkfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXdNZXNzYWdlKG1lc3NhZ2U6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4pIHtcbiAgICB0aGlzLnNjaGVkdWxlVGFzayhcbiAgICAgIGFzeW5jIChpbnB1dCkgPT4gYXdhaXQgdGhpcy53cmFwQW5kUHJvY2Vzc1JlcXVlc3QoaW5wdXQpLFxuICAgICAgbWVzc2FnZVxuICAgICk7XG4gIH1cblxuICBATG9nZ2FibGUuaGFuZGxlRXJyb3JzXG4gIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc3RhcnREZXBlbmRlbmNpZXMoKTtcbiAgICB0aGlzLnJ1bm5pbmcgPSB0cnVlO1xuICB9XG5cbiAgQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBzdG9wKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tPVVRcIixcbiAgICAgICAgdGhpcy5nZXRTZXJ2ZXJTdGF0dXMoKVxuICAgICAgKVxuICAgICk7XG4gICAgdGhpcy5pbmZvKGBTZXJ2aWNlICR7dGhpcy5zZXJ2aWNlSWR9IFske3RoaXMuaW5zdGFuY2VJZH1dIGNoZWNrZWQgb3V0YCk7XG4gICAgYXdhaXQgdGhpcy5zdG9wRGVwZW5kZW5jaWVzKCk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci51bnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkXG4gICAgKTtcblxuICAgIHRoaXMucnVubmluZyA9IGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzQW5kTm90aWZ5KFxuICAgIG91dHB1dDogVGFza091dHB1dDxJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEZJWE1FOiBETyBOT1QgTE9HIFdJVEhJTiBUSElTIE1FVEhPRCwgaXQgY2F1c2VzIGluZmluaXRlIGxvb3AhXG4gICAgaWYgKG91dHB1dC5yZXN1bHQpIHtcbiAgICAgIGNvbnN0IHJlY2lwaWVudEFkZHJlc3MgPSBvdXRwdXQucmVzdWx0LnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcztcbiAgICAgIGlmIChyZWNpcGllbnRBZGRyZXNzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE5vdGlmaWNhdGlvbihvdXRwdXQucmVzdWx0KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmROb3RpZmljYXRpb24oXG4gICAgcmVzcG9uc2U6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZWNpcGllbnRJZCA9IHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcztcbiAgICBpZiAocmVjaXBpZW50SWQpIHtcbiAgICAgIGNvbnN0IFtfbmFtZXNwYWNlLCBzZXJ2aWNlSWQsIF9pbnN0YW5jZUlkXSA9IHJlY2lwaWVudElkLnNwbGl0KFwiOlwiKTtcbiAgICAgIGlmIChzZXJ2aWNlSWQgJiYgc2VydmljZUlkID09PSB0aGlzLnNlcnZpY2VJZCkge1xuICAgICAgICB0aGlzLnByb2Nlc3NJbmNvbWluZ01lc3NhZ2UocmVzcG9uc2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHJlY2lwaWVudElkKTtcbiAgICAgIHBlZXIuc2VuZChyZXNwb25zZSk7XG4gICAgICAvLyBUT0RPOiB2YWxpZGF0ZSBpZiBwZWVyIGV4aXN0cyBiZWZvcmUgc2VuZGluZyBtZXNzYWdlXG4gICAgICAvLyBUaHJvdyBpZiBwZWVyIG5vdCBmb3VuZC5cbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFN0YXR1c1VwZGF0ZShcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICBcIk1pY3Jvc2VydmljZUZyYW1ld29yazo6U3RhdHVzVXBkYXRlXCIsXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgc3RhdHVzLFxuICAgICAgcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBtYWtlUmVzcG9uc2UoXG4gICAgZGF0YTogVFJlc3BvbnNlRGF0YSxcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIGVycm9yOiBFcnJvciB8IG51bGxcbiAgKTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXNwb25kZXJBZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgICB9LFxuICAgICAgYm9keToge1xuICAgICAgICBkYXRhLFxuICAgICAgICBzdWNjZXNzOiBlcnJvciA9PT0gbnVsbCxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBpZiAoXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZWNpcGllbnRBZGRyZXNzICYmXG4gICAgICAoIWRhdGEgfHwgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIE9iamVjdC5rZXlzKGRhdGEpLmxlbmd0aCA9PT0gMCkpICYmXG4gICAgICAhZXJyb3JcbiAgICApIHtcbiAgICAgIHRoaXMuZXJyb3IoXG4gICAgICAgIGBBdHRlbXB0aW5nIHRvIHNlbmQgZW1wdHkgZGF0YSBmb3IgJHtcbiAgICAgICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZVxuICAgICAgICB9LiBEYXRhOiAke0pTT04uc3RyaW5naWZ5KGRhdGEpfWAsXG4gICAgICAgIHsgcmVxdWVzdCwgZXJyb3IgfVxuICAgICAgKTtcbiAgICAgIGVycm9yID0gbmV3IEVycm9yKFwiRW1wdHkgcmVzcG9uc2UgZGF0YVwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgbWVzc2FnZVR5cGU6IHN0cmluZyxcbiAgICB0bzogc3RyaW5nLFxuICAgIGJvZHk6IGFueSxcbiAgICByZXF1ZXN0SWQ/OiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmVxdWVzdElkID0gcmVxdWVzdElkIHx8IHRoaXMuZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcblxuICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgaWYgKHRvLnN0YXJ0c1dpdGgoYCR7dGhpcy5uYW1lc3BhY2V9OmApKSB7XG4gICAgICBwZWVyQWRkcmVzcyA9IHRvO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBub2RlSWQgPSBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLmdldExlYXN0TG9hZGVkTm9kZSh0byk7XG4gICAgICBpZiAoIW5vZGVJZCkge1xuICAgICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgTm8gbm9kZXMgYXZhaWxhYmxlIGZvciBzZXJ2aWNlICR7dG99LmApO1xuICAgICAgfVxuICAgICAgcGVlckFkZHJlc3MgPSBgJHt0aGlzLm5hbWVzcGFjZX06JHt0b306JHtub2RlSWR9YDtcbiAgICB9XG5cbiAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHBlZXJBZGRyZXNzKTtcblxuICAgIGxldCBoZWFkZXI6IElSZXF1ZXN0SGVhZGVyID0ge1xuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgcmVxdWVzdElkLFxuICAgICAgcmVxdWVzdGVyQWRkcmVzczogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICByZXF1ZXN0VHlwZTogbWVzc2FnZVR5cGUsXG4gICAgICAvLyBOb3RlOiByZWNpcGllbnRBZGRyZXNzIGlzIGludGVudGlvbmFsbHkgb21pdHRlZFxuICAgIH07XG5cbiAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgIGNvbnN0IG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gPSB7XG4gICAgICBoZWFkZXIsXG4gICAgICBib2R5LFxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVlci5zZW5kKG1lc3NhZ2UpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCBvbmUtd2F5IG1lc3NhZ2UgdG8gJHt0b31gLCB7XG4gICAgICAgIGVycm9yLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIG1lc3NhZ2VUeXBlLFxuICAgICAgfSk7XG4gICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgb25lLXdheSBtZXNzYWdlIHRvICR7dG99YCwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBtYWtlUmVxdWVzdDxUPihwcm9wczogUmVxdWVzdFByb3BzKTogUHJvbWlzZTxJUmVzcG9uc2U8VD4+IHtcbiAgICBjb25zdCB7XG4gICAgICB0byxcbiAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgYm9keSxcbiAgICAgIHJlcGx5VG8sXG4gICAgICBoYW5kbGVTdGF0dXNVcGRhdGUsXG4gICAgICBoZWFkZXJzLFxuICAgICAgdGltZW91dCxcbiAgICAgIHRpbWVvdXRDYWxsYmFjayxcbiAgICB9ID0gcHJvcHM7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IGhlYWRlcnM/LnJlcXVlc3RJZCB8fCB0aGlzLmdlbmVyYXRlUmVxdWVzdElkKCk7XG5cbiAgICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgICBpZiAodG8uc3RhcnRzV2l0aChgJHt0aGlzLm5hbWVzcGFjZX06YCkpIHtcbiAgICAgICAgcGVlckFkZHJlc3MgPSB0bztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIuZ2V0TGVhc3RMb2FkZWROb2RlKFxuICAgICAgICAgIHRvXG4gICAgICAgICk7XG4gICAgICAgIGlmICghbm9kZUlkKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBMb2dnYWJsZUVycm9yKGBObyBub2RlcyBhdmFpbGFibGUgZm9yIHNlcnZpY2UgJHt0b30uYCkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBwZWVyQWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RvfToke25vZGVJZH1gO1xuICAgICAgfVxuXG4gICAgICBsZXQgaGVhZGVyOiBJUmVxdWVzdEhlYWRlciA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3M6IGhlYWRlcnM/LnJlcXVlc3RlckFkZHJlc3MgfHwgdGhpcy5hZGRyZXNzLFxuICAgICAgICByZWNpcGllbnRBZGRyZXNzOiByZXBseVRvIHx8IHRoaXMuYWRkcmVzcyxcbiAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICB9O1xuXG4gICAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgICAgY29uc3QgcmVxdWVzdDogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgICAgaGVhZGVyLFxuICAgICAgICBib2R5LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD4gPSBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAocmVzcG9uc2UuYm9keS5zdWNjZXNzKSB7XG4gICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgZXJyb3I6IHJlc3BvbnNlLmJvZHkuZXJyb3IsXG4gICAgICAgICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICAgICAgICB0byxcbiAgICAgICAgICAgICAgcmVwbHlUbyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgaW4gY2FsbGJhY2sgZm9yIHJlcXVlc3QgJHtyZXF1ZXN0SWR9YCwgZXJyb3IpO1xuICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKGBFcnJvciBwcm9jZXNzaW5nIHJlc3BvbnNlIGZyb20gJHt0b31gLCBlcnJvcilcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0IHx8IHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dDtcbiAgICAgIGNvbnN0IHRpbWVvdXRDYiA9XG4gICAgICAgIHRpbWVvdXRDYWxsYmFjayB8fFxuICAgICAgICAoKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLnBlbmRpbmdSZXF1ZXN0cy5oYXMocmVxdWVzdElkKSkge1xuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgICAgICAgICB0aGlzLndhcm4oYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0YCwge1xuICAgICAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoXG4gICAgICAgICAgICAgICAgYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICBjb25zdCB0aW1lT3V0SWQgPSBzZXRUaW1lb3V0KHRpbWVvdXRDYiwgdGltZW91dE1zKTtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgIHRpbWVvdXRDYWxsYmFjazogdGltZW91dENiLFxuICAgICAgICB0aW1lT3V0SWQsXG4gICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTpcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGUgfHwgdGhpcy5oYW5kbGVTdGF0dXNVcGRhdGUuYmluZCh0aGlzKSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcGVlciA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChwZWVyQWRkcmVzcyk7XG4gICAgICBjb25zdCBzZW5kTWV0aG9kID1cbiAgICAgICAgdG8gPT0gdGhpcy5zZXJ2aWNlSWRcbiAgICAgICAgICA/IHRoaXMucHJvY2Vzc0luY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgICAgICAgOiBwZWVyLnNlbmQ7XG4gICAgICBzZW5kTWV0aG9kKHJlcXVlc3QpLmNhdGNoKChlcnJvcjogYW55KSA9PiB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCByZXF1ZXN0IHRvICR7dG99YCwge1xuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlamVjdChuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIGVycm9yKSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVSZXF1ZXN0SWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXJ2aWNlSWR9LSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpXG4gICAgICAudG9TdHJpbmcoMzYpXG4gICAgICAuc3Vic3RyKDIsIDkpfWA7XG4gIH1cbn1cbiJdfQ==