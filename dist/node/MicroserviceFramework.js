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
            namespace: this.namespace,
            instanceId: this.instanceId,
            pendingRequests: this.pendingRequests.size,
            queueSize: this.queue.size(),
            runningTasks: this.runningTasks,
            timestamp: Date.now(),
            address: this.address,
            concurrencyLimit: this.concurrencyLimit,
            requestsPerInterval: this.serverConfig.requestsPerInterval,
            interval: this.interval,
            serviceId: this.serviceId,
            requestCallbackTimeout: this.requestCallbackTimeout,
            statusUpdateInterval: this.statusUpdateInterval,
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
                ...{
                    timestamp: Date.now(),
                    requestId,
                    requesterAddress: this.address,
                    recipientAddress: replyTo || this.address,
                    requestType,
                },
                ...headers,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7QUE2QkEsd0NBZUM7QUEzQ0QsK0VBRzBDO0FBQzFDLHVDQUFnRTtBQUNoRSw2RUFBMEU7QUFFMUUsNEJBQTBCO0FBQzFCLCtCQUFvQztBQUNwQyx1REFBb0Q7QUFDcEQsa0RBQTBCO0FBRTFCLE1BQU0sNEJBQTRCLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFXOUQsbUVBQW1FO0FBQ25FLFNBQVMsb0JBQW9CO0lBQzNCLE9BQU8sRUFBaUMsQ0FBQztBQUMzQyxDQUFDO0FBQ0QsWUFBWTtBQUNaLFNBQWdCLGNBQWMsQ0FBSSxXQUFtQjtJQUNuRCxPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQXNDO1FBRXRDLE1BQU0sa0JBQWtCLEdBQUcsb0JBQW9CLEVBQUssQ0FBQztRQUNyRCxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFDO1FBQ3ZFLE9BQU8sQ0FBQyxjQUFjLENBQ3BCLDRCQUE0QixFQUM1QixFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxFQUNqRSxNQUFNLEVBQ04sV0FBVyxDQUNaLENBQUM7SUFDSixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsdUVBQXVFO0FBQ3ZFLFNBQVMsa0JBQWtCLENBQUMsTUFBVztJQUNyQyxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBa0MsQ0FBQztJQUUzRCxJQUFJLGFBQWEsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDO0lBQ3JDLE9BQU8sYUFBYSxFQUFFLENBQUM7UUFDckIsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsbUJB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O0lBQ0wsQ0FBQztJQUVPLGlCQUFpQjtRQUN2QixPQUFPLEdBQUcsSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRTthQUNwRCxRQUFRLENBQUMsRUFBRSxDQUFDO2FBQ1osTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3BCLENBQUM7Q0FDRjtBQWpuQkQsc0RBaW5CQztBQTdRTztJQURMLGtCQUFRLENBQUMsWUFBWTs7OztrREFJckI7QUFHSztJQURMLGtCQUFRLENBQUMsWUFBWTs7OztpREFpQnJCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSUJhY2tFbmQsIENoYW5uZWxCaW5kaW5nIH0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHtcbiAgUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyLFxuICBUYXNrT3V0cHV0LFxufSBmcm9tIFwiLi9jb3JlLy9SYXRlTGltaXRlZFRhc2tTY2hlZHVsZXJcIjtcbmltcG9ydCB7IExvZ2dhYmxlLCBMb2dnYWJsZUVycm9yLCBMb2dNZXNzYWdlIH0gZnJvbSBcIi4vbG9nZ2luZ1wiO1xuaW1wb3J0IHsgU2VydmljZURpc2NvdmVyeU1hbmFnZXIgfSBmcm9tIFwiLi9jb3JlLy9TZXJ2aWNlRGlzY292ZXJ5TWFuYWdlclwiO1xuaW1wb3J0IHsgSVJlcXVlc3QsIElSZXNwb25zZSwgSVJlcXVlc3RIZWFkZXIgfSBmcm9tIFwiLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgXCJyZWZsZWN0LW1ldGFkYXRhXCI7XG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuaW1wb3J0IHsgTG9nU3RyYXRlZ3kgfSBmcm9tIFwiLi9sb2dnaW5nL0xvZ1N0cmF0ZWd5XCI7XG5pbXBvcnQgY2hhbGsgZnJvbSBcImNoYWxrXCI7XG5cbmNvbnN0IFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVkgPSBTeW1ib2woXCJyZXF1ZXN0SGFuZGxlclwiKTtcblxuaW50ZXJmYWNlIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGEge1xuICByZXF1ZXN0VHlwZTogc3RyaW5nO1xuICBtZXRob2Q6IHN0cmluZztcbiAgYWNjZXB0c0Z1bGxSZXF1ZXN0OiBib29sZWFuO1xuICBpc0FzeW5jOiBib29sZWFuO1xufVxuXG50eXBlIElzRnVsbFJlcXVlc3Q8VD4gPSBUIGV4dGVuZHMgSVJlcXVlc3Q8YW55PiA/IHRydWUgOiBmYWxzZTtcblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGRldGVybWluZSBpZiB0aGUgaGFuZGxlciBhY2NlcHRzIGZ1bGwgcmVxdWVzdFxuZnVuY3Rpb24gaXNGdWxsUmVxdWVzdEhhbmRsZXI8VD4oKTogYm9vbGVhbiB7XG4gIHJldHVybiB7fSBhcyBJc0Z1bGxSZXF1ZXN0PFQ+IGFzIGJvb2xlYW47XG59XG4vLyBEZWNvcmF0b3JcbmV4cG9ydCBmdW5jdGlvbiBSZXF1ZXN0SGFuZGxlcjxUPihyZXF1ZXN0VHlwZTogc3RyaW5nKSB7XG4gIHJldHVybiBmdW5jdGlvbiA8TSBleHRlbmRzIChhcmc6IFQpID0+IFByb21pc2U8YW55PiB8IGFueT4oXG4gICAgdGFyZ2V0OiBhbnksXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxNPlxuICApIHtcbiAgICBjb25zdCBhY2NlcHRzRnVsbFJlcXVlc3QgPSBpc0Z1bGxSZXF1ZXN0SGFuZGxlcjxUPigpO1xuICAgIGNvbnN0IGlzQXN5bmMgPSBkZXNjcmlwdG9yLnZhbHVlPy5jb25zdHJ1Y3Rvci5uYW1lID09PSBcIkFzeW5jRnVuY3Rpb25cIjtcbiAgICBSZWZsZWN0LmRlZmluZU1ldGFkYXRhKFxuICAgICAgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSxcbiAgICAgIHsgcmVxdWVzdFR5cGUsIG1ldGhvZDogcHJvcGVydHlLZXksIGFjY2VwdHNGdWxsUmVxdWVzdCwgaXNBc3luYyB9LFxuICAgICAgdGFyZ2V0LFxuICAgICAgcHJvcGVydHlLZXlcbiAgICApO1xuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFsbCBtZXRob2RzIHdpdGggdGhlIFJlcXVlc3RIYW5kbGVyIGRlY29yYXRvclxuZnVuY3Rpb24gZ2V0UmVxdWVzdEhhbmRsZXJzKHRhcmdldDogYW55KTogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT4ge1xuICBjb25zdCBoYW5kbGVycyA9IG5ldyBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhPigpO1xuXG4gIGxldCBjdXJyZW50VGFyZ2V0ID0gdGFyZ2V0LnByb3RvdHlwZTtcbiAgd2hpbGUgKGN1cnJlbnRUYXJnZXQpIHtcbiAgICBmb3IgKGNvbnN0IHByb3BlcnR5TmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhjdXJyZW50VGFyZ2V0KSkge1xuICAgICAgY29uc3QgbWV0YWRhdGE6IFJlcXVlc3RIYW5kbGVyTWV0YWRhdGEgfCB1bmRlZmluZWQgPSBSZWZsZWN0LmdldE1ldGFkYXRhKFxuICAgICAgICBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZLFxuICAgICAgICBjdXJyZW50VGFyZ2V0LFxuICAgICAgICBwcm9wZXJ0eU5hbWVcbiAgICAgICk7XG4gICAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgICAgaGFuZGxlcnMuc2V0KG1ldGFkYXRhLnJlcXVlc3RUeXBlLCBtZXRhZGF0YSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY3VycmVudFRhcmdldCA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50VGFyZ2V0KTtcbiAgfVxuXG4gIHJldHVybiBoYW5kbGVycztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJU2VydmVyQ29uZmlnIHtcbiAgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIGNvbmN1cnJlbmN5TGltaXQ/OiBudW1iZXI7XG4gIHJlcXVlc3RzUGVySW50ZXJ2YWw/OiBudW1iZXI7XG4gIGludGVydmFsPzogbnVtYmVyO1xuICB0cHNJbnRlcnZhbD86IG51bWJlcjtcbiAgc2VydmljZUlkOiBzdHJpbmc7XG4gIHJlcXVlc3RDYWxsYmFja1RpbWVvdXQ/OiBudW1iZXI7XG4gIGxvZ1N0cmF0ZWd5PzogTG9nU3RyYXRlZ3k7XG4gIHN0YXR1c1VwZGF0ZUludGVydmFsPzogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZpY2VTdGF0dXMgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgaW5zdGFuY2VJZDogc3RyaW5nO1xuICBwZW5kaW5nUmVxdWVzdHM6IG51bWJlcjtcbiAgcXVldWVTaXplOiBudW1iZXI7XG4gIHJ1bm5pbmdUYXNrczogbnVtYmVyO1xuICB0aW1lc3RhbXA6IG51bWJlcjtcbiAgYWRkcmVzczogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YXR1c1VwZGF0ZSB7XG4gIHN0YXR1czogc3RyaW5nO1xuICBwcm9ncmVzcz86IG51bWJlcjtcbiAgbWV0YWRhdGE/OiBhbnk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVxdWVzdFByb3BzIHtcbiAgcmVxdWVzdFR5cGU6IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgYm9keTogYW55O1xuICByZXBseVRvPzogc3RyaW5nO1xuICBoYW5kbGVTdGF0dXNVcGRhdGU/OiAoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICApID0+IFByb21pc2U8dm9pZD47XG4gIHRpbWVvdXRDYWxsYmFjaz86ICgpID0+IHZvaWQ7XG4gIHRpbWVvdXQ/OiBudW1iZXI7XG4gIGhlYWRlcnM/OiBJUmVxdWVzdEhlYWRlcjtcbiAgaXNCcm9hZGNhc3Q/OiBib29sZWFuO1xufVxuXG5leHBvcnQgdHlwZSBDYWxsYmFja0Z1bmN0aW9uPFQ+ID0gKHJlc3BvbnNlOiBJUmVzcG9uc2U8VD4pID0+IFByb21pc2U8dm9pZD47XG5leHBvcnQgdHlwZSBDYWxsYmFja09iamVjdDxUPiA9IHtcbiAgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD47XG4gIHRpbWVvdXRDYWxsYmFjazogKCkgPT4gdm9pZDtcbiAgaGFuZGxlU3RhdHVzVXBkYXRlOiAoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VD4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB0aW1lT3V0SWQ6IE5vZGVKUy5UaW1lb3V0O1xufTtcblxuZXhwb3J0IGNsYXNzIE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5IGV4dGVuZHMgTG9nU3RyYXRlZ3kge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGxvZ0NoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PExvZ01lc3NhZ2U+Pikge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFBhY2thZ2VkKFxuICAgIHBhY2thZ2VkTWVzc2FnZTogSVJlcXVlc3Q8YW55PixcbiAgICBvcHRpb25zPzogUmVjb3JkPHN0cmluZywgYW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxvZ0NoYW5uZWwuc2VuZChwYWNrYWdlZE1lc3NhZ2UpO1xuICB9XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFRSZXF1ZXN0Qm9keSxcbiAgVFJlc3BvbnNlRGF0YVxuPiBleHRlbmRzIFJhdGVMaW1pdGVkVGFza1NjaGVkdWxlcjxcbiAgSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PixcbiAgSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+XG4+IHtcbiAgcHJpdmF0ZSBsb2JieTogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8YW55Pj47XG4gIHByaXZhdGUgc2VydmljZUNoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcml2YXRlIHN0YXR1c1VwZGF0ZVRpbWVvdXRJZDogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwZW5kaW5nUmVxdWVzdHM6IE1hcDxzdHJpbmcsIENhbGxiYWNrT2JqZWN0PGFueT4+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlcXVlc3RIYW5kbGVyczogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT47XG4gIHByb3RlY3RlZCBicm9hZGNhc3RDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxhbnk+PjtcbiAgcHJvdGVjdGVkIGJhY2tlbmQ6IElCYWNrRW5kO1xuICBwcm90ZWN0ZWQgc2VydmVyQ29uZmlnOiBJU2VydmVyQ29uZmlnO1xuICBwcm90ZWN0ZWQgc2VydmljZUlkOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBydW5uaW5nOiBib29sZWFuID0gZmFsc2U7XG4gIHByb3RlY3RlZCBzdGF0dXNVcGRhdGVJbnRlcnZhbDogbnVtYmVyID0gMTIwMDAwO1xuICBwcm90ZWN0ZWQgcmVxdWVzdENhbGxiYWNrVGltZW91dDogbnVtYmVyID0gMzAwMDA7XG4gIHJlYWRvbmx5IGFkZHJlc3M6IHN0cmluZztcbiAgcmVhZG9ubHkgc2VydmljZURpc2NvdmVyeU1hbmFnZXI6IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyO1xuICByZWFkb25seSBuYW1lc3BhY2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBJU2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoXG4gICAgICBjb25maWcuY29uY3VycmVuY3lMaW1pdCB8fCAxMDAsXG4gICAgICBjb25maWcucmVxdWVzdHNQZXJJbnRlcnZhbCB8fCAxMDAsXG4gICAgICBjb25maWcuaW50ZXJ2YWwgfHwgMTAwMFxuICAgICk7XG4gICAgdGhpcy5uYW1lc3BhY2UgPSBjb25maWcubmFtZXNwYWNlO1xuICAgIHRoaXMuc2VydmVyQ29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuYmFja2VuZCA9IGJhY2tlbmQ7XG4gICAgdGhpcy5zZXJ2aWNlSWQgPSBjb25maWcuc2VydmljZUlkO1xuICAgIHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwgPSBjb25maWcuc3RhdHVzVXBkYXRlSW50ZXJ2YWwgfHwgMTIwMDAwO1xuICAgIHRoaXMuYWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfToke3RoaXMuaW5zdGFuY2VJZH1gO1xuICAgIHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dCA9XG4gICAgICBjb25maWcucmVxdWVzdENhbGxiYWNrVGltZW91dCB8fCB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQ7XG4gICAgdGhpcy5yZXF1ZXN0SGFuZGxlcnMgPSBnZXRSZXF1ZXN0SGFuZGxlcnModGhpcy5jb25zdHJ1Y3Rvcik7XG4gICAgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciA9IG5ldyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcihcbiAgICAgIHRoaXMuYmFja2VuZC5zZXJ2aWNlUmVnaXN0cnlcbiAgICApO1xuICB9XG5cbiAgLy8gQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgIHRoaXMuc2VydmljZUNoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH1gLFxuICAgICAgdGhpcy5oYW5kbGVTZXJ2aWNlTWVzc2FnZXMuYmluZCh0aGlzKVxuICAgICk7XG4gICAgdGhpcy5icm9hZGNhc3RDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmJyb2FkY2FzdGBcbiAgICApO1xuICAgIHRoaXMubG9iYnkgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06bG9iYnlgLFxuICAgICAgdGhpcy5oYW5kbGVMb2JieU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIGNvbnN0IGxvZ0NoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06bG9nc2BcbiAgICApO1xuICAgIGlmICghdGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kpIHtcbiAgICAgIExvZ2dhYmxlLnNldExvZ1N0cmF0ZWd5KFxuICAgICAgICB0aGlzLnNlcnZlckNvbmZpZy5sb2dTdHJhdGVneSB8fCBuZXcgTWljcm9zZXJ2aWNlTG9nU3RyYXRlZ3kobG9nQ2hhbm5lbClcbiAgICAgICk7XG4gICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgIGNoYWxrLnllbGxvdyhgXG5bV0FSTklOR11cbkxvZyBTdHJhdGVneSBpcyBzZXQgdG8gTWljcm9zZXJ2aWNlTG9nU3RyYXRlZ3kuXG5NaWNyb3NlcnZpY2VGcmFtZXdvcmsgd2lsbCBzdHJlYW0gbG9ncyB0byAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfTpsb2dzIGNoYW5uZWxcbklmIHlvdSBhcmUgbm90IHNlZWluZyBhbnkgbG9ncywgdHJ5IGFkZGluZyB0aGUgZm9sbG93aW5nIHRvIE1pY3Jvc2VydmljZUZyYW1ld29yayBjb25maWd1cmF0aW9uIG9iamVjdDpcblxuaW1wb3J0IHsgQ29uc29sZVN0cmF0ZWd5IH0gZnJvbSBcIm1pY3Jvc2VydmljZS1mcmFtZXdvcmtcIjtcbmNvbmZpZyA9IHtcbiAgLi4uLFxuICBsb2dTdHJhdGVneTogbmV3IENvbnNvbGVTdHJhdGVneSgpXG59XG4gICAgICBgKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgTG9nZ2FibGUuc2V0TG9nU3RyYXRlZ3kodGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kpO1xuICAgIH1cbiAgICB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICB0aGlzLmhhbmRsZUluY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgdGhpcy5xdWV1ZS5zaXplKClcbiAgICApO1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tJTlwiLFxuICAgICAgICB0aGlzLmdldFNlcnZlclN0YXR1cygpXG4gICAgICApXG4gICAgKTtcbiAgICB0aGlzLm9uVGFza0NvbXBsZXRlKHRoaXMucHJvY2Vzc0FuZE5vdGlmeS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIHRoaXMuaW5mbyhgU2VydmljZSAke3RoaXMuc2VydmljZUlkfSBbJHt0aGlzLmluc3RhbmNlSWR9XSBpbml0aWFsaXplZC5gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlTG9hZExldmVsKCkge1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIudXBkYXRlTm9kZUxvYWQoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHRoaXMucXVldWUuc2l6ZSgpXG4gICAgKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCkge1xuICAgIHRoaXMuaW5mbyhcbiAgICAgIGBTZXJ2aWNlOiAke3RoaXMuc2VydmljZUlkfSBzdGFydGVkIHN1Y2Nlc3NmdWxseS4gSW5zdGFuY2VJRDogJHt0aGlzLmluc3RhbmNlSWR9YFxuICAgICk7XG4gIH1cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKSB7fVxuXG4gIHN0YXRpYyBjcmVhdGVSZXF1ZXN0PFQ+KFxuICAgIHJlcXVlc3RlckFkZHJlc3M6IHN0cmluZyxcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IFQsXG4gICAgcmVjaXBpZW50QWRkcmVzcz86IHN0cmluZ1xuICApOiBJUmVxdWVzdDxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZDogdXVpZHY0KCksXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgfSxcbiAgICAgIGJvZHksXG4gICAgfTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVSZXNwb25zZTxUPihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgIHJlc3BvbmRlckFkZHJlc3M6IHN0cmluZyxcbiAgICBkYXRhOiBULFxuICAgIHN1Y2Nlc3M6IGJvb2xlYW4gPSB0cnVlLFxuICAgIGVycm9yOiBFcnJvciB8IG51bGwgPSBudWxsXG4gICk6IElSZXNwb25zZTxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgcmVzcG9uZGVyQWRkcmVzcyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcm90ZWN0ZWQgZ2V0U2VydmVyU3RhdHVzKCk6IFNlcnZpY2VTdGF0dXMge1xuICAgIGNvbnN0IHN0YXR1cyA9IHtcbiAgICAgIG5hbWVzcGFjZTogdGhpcy5uYW1lc3BhY2UsXG4gICAgICBpbnN0YW5jZUlkOiB0aGlzLmluc3RhbmNlSWQsXG4gICAgICBwZW5kaW5nUmVxdWVzdHM6IHRoaXMucGVuZGluZ1JlcXVlc3RzLnNpemUsXG4gICAgICBxdWV1ZVNpemU6IHRoaXMucXVldWUuc2l6ZSgpLFxuICAgICAgcnVubmluZ1Rhc2tzOiB0aGlzLnJ1bm5pbmdUYXNrcyxcbiAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgIGFkZHJlc3M6IHRoaXMuYWRkcmVzcyxcbiAgICAgIGNvbmN1cnJlbmN5TGltaXQ6IHRoaXMuY29uY3VycmVuY3lMaW1pdCxcbiAgICAgIHJlcXVlc3RzUGVySW50ZXJ2YWw6IHRoaXMuc2VydmVyQ29uZmlnLnJlcXVlc3RzUGVySW50ZXJ2YWwsXG4gICAgICBpbnRlcnZhbDogdGhpcy5pbnRlcnZhbCxcbiAgICAgIHNlcnZpY2VJZDogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICByZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0OiB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQsXG4gICAgICBzdGF0dXNVcGRhdGVJbnRlcnZhbDogdGhpcy5zdGF0dXNVcGRhdGVJbnRlcnZhbCxcbiAgICB9O1xuXG4gICAgcmV0dXJuIHN0YXR1cztcbiAgfVxuXG4gIHB1YmxpYyBnZXRzZXJ2aWNlSWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2aWNlSWQ7XG4gIH1cblxuICBwdWJsaWMgZ2V0QmFja2VuZCgpOiBJQmFja0VuZCB7XG4gICAgcmV0dXJuIHRoaXMuYmFja2VuZDtcbiAgfVxuXG4gIHByb3RlY3RlZCBoYW5kbGVTZXJ2aWNlTWVzc2FnZXM8VD4obWVzc2FnZTogVCkge31cblxuICBwcm90ZWN0ZWQgYXN5bmMgaGFuZGxlTG9iYnlNZXNzYWdlcyhcbiAgICBtZXNzYWdlOiBJUmVxdWVzdDxhbnk+IHwgSVJlc3BvbnNlPGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuaXNTZXJ2aWNlU3RhdHVzUmVxdWVzdChtZXNzYWdlKSkge1xuICAgICAgaWYgKG1lc3NhZ2UuaGVhZGVyLnJlcXVlc3RUeXBlID09PSBcIkNIRUNLSU5cIikge1xuICAgICAgICB0aGlzLmluZm8oYFJlY2VpdmVkIENIRUNLSU4gZnJvbSAke21lc3NhZ2UuaGVhZGVyLnJlcXVlc3RlckFkZHJlc3N9YCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGRlZmF1bHRNZXNzYWdlSGFuZGxlcihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+XG4gICk6IFByb21pc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBObyBoYW5kbGVyIGZvdW5kIGZvciByZXF1ZXN0IHR5cGU6ICR7cmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGV9YFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGlzU2VydmljZVN0YXR1c1JlcXVlc3QoXG4gICAgbWVzc2FnZTogSVJlcXVlc3Q8YW55PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IG1lc3NhZ2UgaXMgSVJlcXVlc3Q8U2VydmljZVN0YXR1cz4ge1xuICAgIHJldHVybiBcImhlYWRlclwiIGluIG1lc3NhZ2UgJiYgXCJyZXF1ZXN0VHlwZVwiIGluIG1lc3NhZ2UuaGVhZGVyO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKSB7XG4gICAgaWYgKHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQpO1xuICAgIH1cbiAgICB0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy51cGRhdGVMb2FkTGV2ZWwoKTtcbiAgICAgIHRoaXMuc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCk7XG4gICAgfSwgdGhpcy5zdGF0dXNVcGRhdGVJbnRlcnZhbCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NSZXF1ZXN0KFxuICAgIGlucHV0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+XG4gICk6IFByb21pc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIGNvbnN0IHJlcXVlc3RUeXBlID0gaW5wdXQuaGVhZGVyLnJlcXVlc3RUeXBlO1xuICAgIGlmICghcmVxdWVzdFR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVlc3QgdHlwZSBub3Qgc3BlY2lmaWVkXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGhhbmRsZXJNZXRhZGF0YSA9IHRoaXMucmVxdWVzdEhhbmRsZXJzLmdldChyZXF1ZXN0VHlwZSk7XG4gICAgaWYgKCFoYW5kbGVyTWV0YWRhdGEpIHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmRlZmF1bHRNZXNzYWdlSGFuZGxlcihpbnB1dCk7XG4gICAgfVxuXG4gICAgLy8gQ2FsbCB0aGUgaGFuZGxlciBtZXRob2RcbiAgICBjb25zdCBoYW5kbGVyTWV0aG9kID0gKHRoaXMgYXMgYW55KVtoYW5kbGVyTWV0YWRhdGEubWV0aG9kXS5iaW5kKHRoaXMpO1xuICAgIGNvbnN0IGFyZ3MgPSBoYW5kbGVyTWV0YWRhdGEuYWNjZXB0c0Z1bGxSZXF1ZXN0ID8gaW5wdXQgOiBpbnB1dC5ib2R5O1xuXG4gICAgY29uc3QgaGFuZGxlclJlc3BvbnNlID0gaGFuZGxlck1ldGFkYXRhLmlzQXN5bmNcbiAgICAgID8gYXdhaXQgaGFuZGxlck1ldGhvZChhcmdzKVxuICAgICAgOiBoYW5kbGVyTWV0aG9kKGFyZ3MpO1xuXG4gICAgcmV0dXJuIGhhbmRsZXJSZXNwb25zZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgd3JhcEFuZFByb2Nlc3NSZXF1ZXN0KFxuICAgIGlucHV0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+XG4gICk6IFByb21pc2U8SVJlc3BvbnNlPFRSZXNwb25zZURhdGE+PiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2Vzc1JlcXVlc3QoaW5wdXQpO1xuICAgICAgbGV0IHJlc3BvbnNlID0gdGhpcy5tYWtlUmVzcG9uc2UocmVzdWx0LCBpbnB1dCwgbnVsbCk7XG4gICAgICByZXNwb25zZSA9IHRoaXMuZW5yaWNoUmVzcG9uc2UocmVzcG9uc2UsIGlucHV0KTtcbiAgICAgIHJldHVybiByZXNwb25zZTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgbGV0IHJlc3BvbnNlID0gdGhpcy5tYWtlUmVzcG9uc2UoXG4gICAgICAgIHt9IGFzIFRSZXNwb25zZURhdGEsXG4gICAgICAgIGlucHV0LFxuICAgICAgICBlcnJvciBhcyBFcnJvclxuICAgICAgKTtcbiAgICAgIHJlc3BvbnNlID0gdGhpcy5lbnJpY2hSZXNwb25zZShyZXNwb25zZSwgaW5wdXQpO1xuICAgICAgcmV0dXJuIHJlc3BvbnNlO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBoYW5kbGVTdGF0dXNVcGRhdGUoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PixcbiAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICApOiBQcm9taXNlPHZvaWQ+IHt9XG5cbiAgcHJvdGVjdGVkIGVucmljaFJlc3BvbnNlKFxuICAgIHJlc3BvbnNlOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4sXG4gICAgb3JpZ2luYWxSZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+XG4gICk6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPiB7XG4gICAgLy8gRGVmYXVsdCBpbXBsZW1lbnRhdGlvbiBkb2VzIG5vdGhpbmdcbiAgICAvLyBDb25jcmV0ZSBjbGFzc2VzIGNhbiBvdmVycmlkZSB0aGlzIG1ldGhvZCB0byBhZGQgY3VzdG9tIGVucmljaG1lbnRcbiAgICAvLyBGSVhNRTogRm9yIG5vdywgbG9nZ2luZyB3aXRoaW4gdGhpcyBtZXRob2QgY2F1c2VzIGluZmluaXRlIGxvb3AuXG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG5cbiAgcHJvdGVjdGVkIGVucmljaFJlcXVlc3QoaGVhZGVyOiBJUmVxdWVzdEhlYWRlciwgYm9keTogYW55KTogSVJlcXVlc3RIZWFkZXIge1xuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb246IHJldHVybiB0aGUgaGVhZGVyIHVuY2hhbmdlZFxuICAgIHJldHVybiBoZWFkZXI7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUluY29taW5nTWVzc2FnZShcbiAgICBwYXlsb2FkOiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+IHwgSVJlc3BvbnNlPGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gcmlnaHQgbm93IHdlIGRvbid0IHdhaXQgdG8gc2VlIGlmIHRoZSBhY2tub3dsZWRnZW1lbnQgc3VjY2VlZGVkLlxuICAgIC8vIHdlIG1pZ2h0IHdhbnQgdG8gZG8gdGhpcyBpbiB0aGUgZnV0dXJlLlxuICAgIGF3YWl0IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5hY2socGF5bG9hZCk7XG4gICAgdGhpcy5wcm9jZXNzSW5jb21pbmdNZXNzYWdlKHBheWxvYWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzSW5jb21pbmdNZXNzYWdlKFxuICAgIHBheWxvYWQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5pc1Jlc3BvbnNlKHBheWxvYWQpKSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZVJlc3BvbnNlKHBheWxvYWQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoXG4gICAgICAgIHBheWxvYWQuaGVhZGVyLnJlcXVlc3RUeXBlID09PSBcIk1pY3Jvc2VydmljZUZyYW1ld29yazo6U3RhdHVzVXBkYXRlXCJcbiAgICAgICkge1xuICAgICAgICBjb25zdCByZXF1ZXN0SWQgPSBwYXlsb2FkLmhlYWRlci5yZXF1ZXN0SWQ7XG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IHBheWxvYWQuYm9keSBhcyBTdGF0dXNVcGRhdGU7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrT2JqZWN0ID0gdGhpcy5wZW5kaW5nUmVxdWVzdHMuZ2V0KHJlcXVlc3RJZCk7XG4gICAgICAgIGlmIChjYWxsYmFja09iamVjdCkge1xuICAgICAgICAgIGNvbnN0IHsgY2FsbGJhY2ssIHRpbWVvdXRDYWxsYmFjaywgdGltZU91dElkLCBoYW5kbGVTdGF0dXNVcGRhdGUgfSA9XG4gICAgICAgICAgICBjYWxsYmFja09iamVjdDtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZU91dElkKTtcbiAgICAgICAgICBjb25zdCBuZXdUaW1lT3V0ID0gc2V0VGltZW91dChcbiAgICAgICAgICAgIHRpbWVvdXRDYWxsYmFjayxcbiAgICAgICAgICAgIHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dFxuICAgICAgICAgICk7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KHJlcXVlc3RJZCwge1xuICAgICAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgICAgICAgICB0aW1lT3V0SWQ6IG5ld1RpbWVPdXQsXG4gICAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgaGFuZGxlU3RhdHVzVXBkYXRlKHBheWxvYWQsIHN0YXR1cyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnNjaGVkdWxlTmV3TWVzc2FnZShwYXlsb2FkIGFzIElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4pO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgaXNSZXNwb25zZShcbiAgICBwYXlsb2FkOiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+IHwgSVJlc3BvbnNlPGFueT5cbiAgKTogcGF5bG9hZCBpcyBJUmVzcG9uc2U8YW55PiB7XG4gICAgcmV0dXJuIFwicmVzcG9uc2VIZWFkZXJcIiBpbiBwYXlsb2FkO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVSZXNwb25zZShyZXNwb25zZTogSVJlc3BvbnNlPGFueT4pIHtcbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlcXVlc3RJZDtcbiAgICBjb25zdCBjYWxsYmFja09iamVjdCA9IHRoaXMucGVuZGluZ1JlcXVlc3RzLmdldChyZXF1ZXN0SWQpO1xuICAgIGlmIChjYWxsYmFja09iamVjdCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgYXdhaXQgY2FsbGJhY2tPYmplY3QuY2FsbGJhY2socmVzcG9uc2UpO1xuICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICB0aGlzLmVycm9yKGBFcnJvciBleGVjdXRpbmcgY2FsbGJhY2sgZm9yIHJlcXVlc3QgJHtyZXF1ZXN0SWR9YCwgZXJyb3IpO1xuICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMud2FybihgUmVjZWl2ZWQgcmVzcG9uc2UgZm9yIHVua25vd24gcmVxdWVzdDogJHtyZXF1ZXN0SWR9YCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZU5ld01lc3NhZ2UobWVzc2FnZTogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5Pikge1xuICAgIHRoaXMuc2NoZWR1bGVUYXNrKFxuICAgICAgYXN5bmMgKGlucHV0KSA9PiBhd2FpdCB0aGlzLndyYXBBbmRQcm9jZXNzUmVxdWVzdChpbnB1dCksXG4gICAgICBtZXNzYWdlXG4gICAgKTtcbiAgfVxuXG4gIEBMb2dnYWJsZS5oYW5kbGVFcnJvcnNcbiAgYXN5bmMgc3RhcnQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zdGFydERlcGVuZGVuY2llcygpO1xuICAgIHRoaXMucnVubmluZyA9IHRydWU7XG4gIH1cblxuICBATG9nZ2FibGUuaGFuZGxlRXJyb3JzXG4gIGFzeW5jIHN0b3AoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2JieS5zZW5kKFxuICAgICAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlcXVlc3QoXG4gICAgICAgIHRoaXMuYWRkcmVzcyxcbiAgICAgICAgXCJDSEVDS09VVFwiLFxuICAgICAgICB0aGlzLmdldFNlcnZlclN0YXR1cygpXG4gICAgICApXG4gICAgKTtcbiAgICB0aGlzLmluZm8oYFNlcnZpY2UgJHt0aGlzLnNlcnZpY2VJZH0gWyR7dGhpcy5pbnN0YW5jZUlkfV0gY2hlY2tlZCBvdXRgKTtcbiAgICBhd2FpdCB0aGlzLnN0b3BEZXBlbmRlbmNpZXMoKTtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnVucmVnaXN0ZXJOb2RlKFxuICAgICAgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICB0aGlzLmluc3RhbmNlSWRcbiAgICApO1xuXG4gICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NBbmROb3RpZnkoXG4gICAgb3V0cHV0OiBUYXNrT3V0cHV0PElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPj5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gRklYTUU6IERPIE5PVCBMT0cgV0lUSElOIFRISVMgTUVUSE9ELCBpdCBjYXVzZXMgaW5maW5pdGUgbG9vcCFcbiAgICBpZiAob3V0cHV0LnJlc3VsdCkge1xuICAgICAgY29uc3QgcmVjaXBpZW50QWRkcmVzcyA9IG91dHB1dC5yZXN1bHQucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzO1xuICAgICAgaWYgKHJlY2lwaWVudEFkZHJlc3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kTm90aWZpY2F0aW9uKG91dHB1dC5yZXN1bHQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VuZE5vdGlmaWNhdGlvbihcbiAgICByZXNwb25zZTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlY2lwaWVudElkID0gcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzO1xuICAgIGlmIChyZWNpcGllbnRJZCkge1xuICAgICAgY29uc3QgW19uYW1lc3BhY2UsIHNlcnZpY2VJZCwgX2luc3RhbmNlSWRdID0gcmVjaXBpZW50SWQuc3BsaXQoXCI6XCIpO1xuICAgICAgaWYgKHNlcnZpY2VJZCAmJiBzZXJ2aWNlSWQgPT09IHRoaXMuc2VydmljZUlkKSB7XG4gICAgICAgIHRoaXMucHJvY2Vzc0luY29taW5nTWVzc2FnZShyZXNwb25zZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHBlZXIgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwocmVjaXBpZW50SWQpO1xuICAgICAgcGVlci5zZW5kKHJlc3BvbnNlKTtcbiAgICAgIC8vIFRPRE86IHZhbGlkYXRlIGlmIHBlZXIgZXhpc3RzIGJlZm9yZSBzZW5kaW5nIG1lc3NhZ2VcbiAgICAgIC8vIFRocm93IGlmIHBlZXIgbm90IGZvdW5kLlxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzZW5kU3RhdHVzVXBkYXRlKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgIFwiTWljcm9zZXJ2aWNlRnJhbWV3b3JrOjpTdGF0dXNVcGRhdGVcIixcbiAgICAgIHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICBzdGF0dXMsXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWRcbiAgICApO1xuICB9XG5cbiAgcHJvdGVjdGVkIG1ha2VSZXNwb25zZShcbiAgICBkYXRhOiBUUmVzcG9uc2VEYXRhLFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgZXJyb3I6IEVycm9yIHwgbnVsbFxuICApOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgcmVxdWVzdEhlYWRlcjogcmVxdWVzdC5oZWFkZXIsXG4gICAgICByZXNwb25zZUhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlc3BvbmRlckFkZHJlc3M6IHRoaXMuYWRkcmVzcyxcbiAgICAgIH0sXG4gICAgICBib2R5OiB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIHN1Y2Nlc3M6IGVycm9yID09PSBudWxsLFxuICAgICAgICBlcnJvcixcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGlmIChcbiAgICAgIHJlcXVlc3QuaGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgJiZcbiAgICAgICghZGF0YSB8fCAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSkgJiZcbiAgICAgICFlcnJvclxuICAgICkge1xuICAgICAgdGhpcy5lcnJvcihcbiAgICAgICAgYEF0dGVtcHRpbmcgdG8gc2VuZCBlbXB0eSBkYXRhIGZvciAke1xuICAgICAgICAgIHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlXG4gICAgICAgIH0uIERhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZGF0YSl9YCxcbiAgICAgICAgeyByZXF1ZXN0LCBlcnJvciB9XG4gICAgICApO1xuICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoXCJFbXB0eSByZXNwb25zZSBkYXRhXCIpO1xuICAgIH1cblxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzZW5kT25lV2F5TWVzc2FnZShcbiAgICBtZXNzYWdlVHlwZTogc3RyaW5nLFxuICAgIHRvOiBzdHJpbmcsXG4gICAgYm9keTogYW55LFxuICAgIHJlcXVlc3RJZD86IHN0cmluZ1xuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXF1ZXN0SWQgPSByZXF1ZXN0SWQgfHwgdGhpcy5nZW5lcmF0ZVJlcXVlc3RJZCgpO1xuXG4gICAgbGV0IHBlZXJBZGRyZXNzID0gXCJcIjtcbiAgICBpZiAodG8uc3RhcnRzV2l0aChgJHt0aGlzLm5hbWVzcGFjZX06YCkpIHtcbiAgICAgIHBlZXJBZGRyZXNzID0gdG87XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG5vZGVJZCA9IGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIuZ2V0TGVhc3RMb2FkZWROb2RlKHRvKTtcbiAgICAgIGlmICghbm9kZUlkKSB7XG4gICAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKGBObyBub2RlcyBhdmFpbGFibGUgZm9yIHNlcnZpY2UgJHt0b30uYCk7XG4gICAgICB9XG4gICAgICBwZWVyQWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RvfToke25vZGVJZH1gO1xuICAgIH1cblxuICAgIGNvbnN0IHBlZXIgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwocGVlckFkZHJlc3MpO1xuXG4gICAgbGV0IGhlYWRlcjogSVJlcXVlc3RIZWFkZXIgPSB7XG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICByZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0ZXJBZGRyZXNzOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHJlcXVlc3RUeXBlOiBtZXNzYWdlVHlwZSxcbiAgICAgIC8vIE5vdGU6IHJlY2lwaWVudEFkZHJlc3MgaXMgaW50ZW50aW9uYWxseSBvbWl0dGVkXG4gICAgfTtcblxuICAgIGhlYWRlciA9IHRoaXMuZW5yaWNoUmVxdWVzdChoZWFkZXIsIGJvZHkpO1xuXG4gICAgY29uc3QgbWVzc2FnZTogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgIGhlYWRlcixcbiAgICAgIGJvZHksXG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwZWVyLnNlbmQobWVzc2FnZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEZhaWxlZCB0byBzZW5kIG9uZS13YXkgbWVzc2FnZSB0byAke3RvfWAsIHtcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgbWVzc2FnZVR5cGUsXG4gICAgICB9KTtcbiAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKGBGYWlsZWQgdG8gc2VuZCBvbmUtd2F5IG1lc3NhZ2UgdG8gJHt0b31gLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIG1ha2VSZXF1ZXN0PFQ+KHByb3BzOiBSZXF1ZXN0UHJvcHMpOiBQcm9taXNlPElSZXNwb25zZTxUPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgIHRvLFxuICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICBib2R5LFxuICAgICAgcmVwbHlUbyxcbiAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZSxcbiAgICAgIGhlYWRlcnMsXG4gICAgICB0aW1lb3V0LFxuICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgIH0gPSBwcm9wcztcbiAgICByZXR1cm4gbmV3IFByb21pc2UoYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdElkID0gaGVhZGVycz8ucmVxdWVzdElkIHx8IHRoaXMuZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcblxuICAgICAgbGV0IHBlZXJBZGRyZXNzID0gXCJcIjtcbiAgICAgIGlmICh0by5zdGFydHNXaXRoKGAke3RoaXMubmFtZXNwYWNlfTpgKSkge1xuICAgICAgICBwZWVyQWRkcmVzcyA9IHRvO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgbm9kZUlkID0gYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci5nZXRMZWFzdExvYWRlZE5vZGUoXG4gICAgICAgICAgdG9cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFub2RlSWQpIHtcbiAgICAgICAgICByZWplY3QobmV3IExvZ2dhYmxlRXJyb3IoYE5vIG5vZGVzIGF2YWlsYWJsZSBmb3Igc2VydmljZSAke3RvfS5gKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHBlZXJBZGRyZXNzID0gYCR7dGhpcy5uYW1lc3BhY2V9OiR7dG99OiR7bm9kZUlkfWA7XG4gICAgICB9XG5cbiAgICAgIGxldCBoZWFkZXI6IElSZXF1ZXN0SGVhZGVyID0ge1xuICAgICAgICAuLi57XG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXF1ZXN0ZXJBZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgICAgICAgcmVjaXBpZW50QWRkcmVzczogcmVwbHlUbyB8fCB0aGlzLmFkZHJlc3MsXG4gICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgIH0sXG4gICAgICAgIC4uLmhlYWRlcnMsXG4gICAgICB9O1xuXG4gICAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgICAgY29uc3QgcmVxdWVzdDogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgICAgaGVhZGVyLFxuICAgICAgICBib2R5LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD4gPSBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAocmVzcG9uc2UuYm9keS5zdWNjZXNzKSB7XG4gICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgZXJyb3I6IHJlc3BvbnNlLmJvZHkuZXJyb3IsXG4gICAgICAgICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICAgICAgICB0byxcbiAgICAgICAgICAgICAgcmVwbHlUbyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgaW4gY2FsbGJhY2sgZm9yIHJlcXVlc3QgJHtyZXF1ZXN0SWR9YCwgZXJyb3IpO1xuICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKGBFcnJvciBwcm9jZXNzaW5nIHJlc3BvbnNlIGZyb20gJHt0b31gLCBlcnJvcilcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0IHx8IHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dDtcbiAgICAgIGNvbnN0IHRpbWVvdXRDYiA9XG4gICAgICAgIHRpbWVvdXRDYWxsYmFjayB8fFxuICAgICAgICAoKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLnBlbmRpbmdSZXF1ZXN0cy5oYXMocmVxdWVzdElkKSkge1xuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgICAgICAgICB0aGlzLndhcm4oYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0YCwge1xuICAgICAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoXG4gICAgICAgICAgICAgICAgYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICBjb25zdCB0aW1lT3V0SWQgPSBzZXRUaW1lb3V0KHRpbWVvdXRDYiwgdGltZW91dE1zKTtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgIHRpbWVvdXRDYWxsYmFjazogdGltZW91dENiLFxuICAgICAgICB0aW1lT3V0SWQsXG4gICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTpcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGUgfHwgdGhpcy5oYW5kbGVTdGF0dXNVcGRhdGUuYmluZCh0aGlzKSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcGVlciA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChwZWVyQWRkcmVzcyk7XG4gICAgICBjb25zdCBzZW5kTWV0aG9kID1cbiAgICAgICAgdG8gPT0gdGhpcy5zZXJ2aWNlSWRcbiAgICAgICAgICA/IHRoaXMucHJvY2Vzc0luY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgICAgICAgOiBwZWVyLnNlbmQ7XG4gICAgICBzZW5kTWV0aG9kKHJlcXVlc3QpLmNhdGNoKChlcnJvcjogYW55KSA9PiB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCByZXF1ZXN0IHRvICR7dG99YCwge1xuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlamVjdChuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIGVycm9yKSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVSZXF1ZXN0SWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXJ2aWNlSWR9LSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpXG4gICAgICAudG9TdHJpbmcoMzYpXG4gICAgICAuc3Vic3RyKDIsIDkpfWA7XG4gIH1cbn1cbiJdfQ==