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
            if (output.result.requestHeader.recipientAddress) {
                await this.sendNotification(output.result);
            }
        }
    }
    async sendNotification(response) {
        const recipientId = response.requestHeader.recipientAddress;
        if (recipientId) {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7QUE2QkEsd0NBZUM7QUEzQ0QsK0VBRzBDO0FBQzFDLHVDQUFnRTtBQUNoRSw2RUFBMEU7QUFFMUUsNEJBQTBCO0FBQzFCLCtCQUFvQztBQUNwQyx1REFBb0Q7QUFDcEQsa0RBQTBCO0FBRTFCLE1BQU0sNEJBQTRCLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFXOUQsbUVBQW1FO0FBQ25FLFNBQVMsb0JBQW9CO0lBQzNCLE9BQU8sRUFBaUMsQ0FBQztBQUMzQyxDQUFDO0FBQ0QsWUFBWTtBQUNaLFNBQWdCLGNBQWMsQ0FBSSxXQUFtQjtJQUNuRCxPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQXNDO1FBRXRDLE1BQU0sa0JBQWtCLEdBQUcsb0JBQW9CLEVBQUssQ0FBQztRQUNyRCxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFDO1FBQ3ZFLE9BQU8sQ0FBQyxjQUFjLENBQ3BCLDRCQUE0QixFQUM1QixFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxFQUNqRSxNQUFNLEVBQ04sV0FBVyxDQUNaLENBQUM7SUFDSixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsdUVBQXVFO0FBQ3ZFLFNBQVMsa0JBQWtCLENBQUMsTUFBVztJQUNyQyxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBa0MsQ0FBQztJQUUzRCxJQUFJLGFBQWEsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDO0lBQ3JDLE9BQU8sYUFBYSxFQUFFLENBQUM7UUFDckIsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsbUJBQW1CLENBQUMsYUFBYSxDQUFDLEVBQUUsQ0FBQztZQUNyRSxNQUFNLFFBQVEsR0FBdUMsT0FBTyxDQUFDLFdBQVcsQ0FDdEUsNEJBQTRCLEVBQzVCLGFBQWEsRUFDYixZQUFZLENBQ2IsQ0FBQztZQUNGLElBQUksUUFBUSxFQUFFLENBQUM7Z0JBQ2IsUUFBUSxDQUFDLEdBQUcsQ0FBQyxRQUFRLENBQUMsV0FBVyxFQUFFLFFBQVEsQ0FBQyxDQUFDO1lBQy9DLENBQUM7UUFDSCxDQUFDO1FBRUQsYUFBYSxHQUFHLE1BQU0sQ0FBQyxjQUFjLENBQUMsYUFBYSxDQUFDLENBQUM7SUFDdkQsQ0FBQztJQUVELE9BQU8sUUFBUSxDQUFDO0FBQ2xCLENBQUM7QUF1REQsTUFBYSx1QkFBd0IsU0FBUSx5QkFBVztJQUN0RCxZQUFvQixVQUFnRDtRQUNsRSxLQUFLLEVBQUUsQ0FBQztRQURVLGVBQVUsR0FBVixVQUFVLENBQXNDO0lBRXBFLENBQUM7SUFFUyxLQUFLLENBQUMsWUFBWSxDQUMxQixlQUE4QixFQUM5QixPQUE2QjtRQUU3QixJQUFJLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxlQUFlLENBQUMsQ0FBQztJQUN4QyxDQUFDO0NBQ0Y7QUFYRCwwREFXQztBQUVELE1BQXNCLHFCQUdwQixTQUFRLG1EQUdUO0lBaUJDLFlBQVksT0FBaUIsRUFBRSxNQUFxQjtRQUNsRCxLQUFLLENBQ0gsTUFBTSxDQUFDLGdCQUFnQixJQUFJLEdBQUcsRUFDOUIsTUFBTSxDQUFDLG1CQUFtQixJQUFJLEdBQUcsRUFDakMsTUFBTSxDQUFDLFFBQVEsSUFBSSxJQUFJLENBQ3hCLENBQUM7UUFuQkksMEJBQXFCLEdBQTBCLElBQUksQ0FBQztRQUNwRCxvQkFBZSxHQUFxQyxJQUFJLEdBQUcsRUFBRSxDQUFDO1FBTTVELFlBQU8sR0FBWSxLQUFLLENBQUM7UUFDekIseUJBQW9CLEdBQVcsTUFBTSxDQUFDO1FBQ3RDLDJCQUFzQixHQUFXLEtBQUssQ0FBQztRQVcvQyxJQUFJLENBQUMsU0FBUyxHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUM7UUFDbEMsSUFBSSxDQUFDLFlBQVksR0FBRyxNQUFNLENBQUM7UUFDM0IsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxDQUFDLFNBQVMsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDO1FBQ2xDLElBQUksQ0FBQyxvQkFBb0IsR0FBRyxNQUFNLENBQUMsb0JBQW9CLElBQUksTUFBTSxDQUFDO1FBQ2xFLElBQUksQ0FBQyxPQUFPLEdBQUcsR0FBRyxJQUFJLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLFVBQVUsRUFBRSxDQUFDO1FBQ3hFLElBQUksQ0FBQyxzQkFBc0I7WUFDekIsTUFBTSxDQUFDLHNCQUFzQixJQUFJLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztRQUMvRCxJQUFJLENBQUMsZUFBZSxHQUFHLGtCQUFrQixDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUM1RCxJQUFJLENBQUMsdUJBQXVCLEdBQUcsSUFBSSxpREFBdUIsQ0FDeEQsSUFBSSxDQUFDLE9BQU8sQ0FBQyxlQUFlLENBQzdCLENBQUM7SUFDSixDQUFDO0lBRUQseUJBQXlCO0lBQ3pCLEtBQUssQ0FBQyxVQUFVO1FBQ2QsSUFBSSxDQUFDLGNBQWMsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQzNELEdBQUcsSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFLEVBQ3JDLElBQUksQ0FBQyxxQkFBcUIsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQ3RDLENBQUM7UUFDRixJQUFJLENBQUMsZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUM3RCxHQUFHLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLFNBQVMsWUFBWSxDQUNoRCxDQUFDO1FBQ0YsSUFBSSxDQUFDLEtBQUssR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQ2xELEdBQUcsSUFBSSxDQUFDLFNBQVMsUUFBUSxFQUN6QixJQUFJLENBQUMsbUJBQW1CLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUNwQyxDQUFDO1FBQ0YsTUFBTSxVQUFVLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUN4RCxHQUFHLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLFNBQVMsT0FBTyxDQUMzQyxDQUFDO1FBQ0YsSUFBSSxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxFQUFFLENBQUM7WUFDbkMsa0JBQVEsQ0FBQyxjQUFjLENBQ3JCLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxJQUFJLElBQUksdUJBQXVCLENBQUMsVUFBVSxDQUFDLENBQ3pFLENBQUM7WUFDRixPQUFPLENBQUMsSUFBSSxDQUNWLGVBQUssQ0FBQyxNQUFNLENBQUM7Ozs0Q0FHdUIsSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsU0FBUzs7Ozs7Ozs7T0FRckUsQ0FBQyxDQUNELENBQUM7UUFDSixDQUFDO2FBQU0sQ0FBQztZQUNOLGtCQUFRLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxZQUFZLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDekQsQ0FBQztRQUNELElBQUksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FDckMsSUFBSSxDQUFDLE9BQU8sRUFDWixJQUFJLENBQUMscUJBQXFCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUN0QyxDQUFDO1FBQ0YsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsWUFBWSxDQUM3QyxJQUFJLENBQUMsU0FBUyxFQUNkLElBQUksQ0FBQyxVQUFVLEVBQ2YsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsQ0FDbEIsQ0FBQztRQUNGLE1BQU0sSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQ25CLHFCQUFxQixDQUFDLGFBQWEsQ0FDakMsSUFBSSxDQUFDLE9BQU8sRUFDWixTQUFTLEVBQ1QsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUN2QixDQUNGLENBQUM7UUFDRixJQUFJLENBQUMsY0FBYyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQztRQUN0RCxJQUFJLENBQUMsMkJBQTJCLEVBQUUsQ0FBQztRQUNuQyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsSUFBSSxDQUFDLFNBQVMsS0FBSyxJQUFJLENBQUMsVUFBVSxnQkFBZ0IsQ0FBQyxDQUFDO0lBQzNFLENBQUM7SUFFTyxLQUFLLENBQUMsZUFBZTtRQUMzQixNQUFNLElBQUksQ0FBQyx1QkFBdUIsQ0FBQyxjQUFjLENBQy9DLElBQUksQ0FBQyxTQUFTLEVBQ2QsSUFBSSxDQUFDLFVBQVUsRUFDZixJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxDQUNsQixDQUFDO1FBQ0YsSUFBSSxDQUFDLDJCQUEyQixFQUFFLENBQUM7SUFDckMsQ0FBQztJQUVTLEtBQUssQ0FBQyxpQkFBaUI7UUFDL0IsSUFBSSxDQUFDLElBQUksQ0FDUCxZQUFZLElBQUksQ0FBQyxTQUFTLHNDQUFzQyxJQUFJLENBQUMsVUFBVSxFQUFFLENBQ2xGLENBQUM7SUFDSixDQUFDO0lBQ1MsS0FBSyxDQUFDLGdCQUFnQixLQUFJLENBQUM7SUFFckMsTUFBTSxDQUFDLGFBQWEsQ0FDbEIsZ0JBQXdCLEVBQ3hCLFdBQW1CLEVBQ25CLElBQU8sRUFDUCxnQkFBeUI7UUFFekIsT0FBTztZQUNMLE1BQU0sRUFBRTtnQkFDTixTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtnQkFDckIsU0FBUyxFQUFFLElBQUEsU0FBTSxHQUFFO2dCQUNuQixnQkFBZ0I7Z0JBQ2hCLGdCQUFnQjtnQkFDaEIsV0FBVzthQUNaO1lBQ0QsSUFBSTtTQUNMLENBQUM7SUFDSixDQUFDO0lBRUQsTUFBTSxDQUFDLGNBQWMsQ0FDbkIsT0FBc0IsRUFDdEIsZ0JBQXdCLEVBQ3hCLElBQU8sRUFDUCxVQUFtQixJQUFJLEVBQ3ZCLFFBQXNCLElBQUk7UUFFMUIsT0FBTztZQUNMLGFBQWEsRUFBRSxPQUFPLENBQUMsTUFBTTtZQUM3QixjQUFjLEVBQUU7Z0JBQ2QsZ0JBQWdCO2dCQUNoQixTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTthQUN0QjtZQUNELElBQUksRUFBRTtnQkFDSixJQUFJO2dCQUNKLE9BQU87Z0JBQ1AsS0FBSzthQUNOO1NBQ0YsQ0FBQztJQUNKLENBQUM7SUFFUyxlQUFlO1FBQ3ZCLE1BQU0sTUFBTSxHQUFHO1lBQ2IsR0FBRyxJQUFJLENBQUMsWUFBWTtZQUNwQixVQUFVLEVBQUUsSUFBSSxDQUFDLFVBQVU7WUFDM0IsZUFBZSxFQUFFLElBQUksQ0FBQyxlQUFlLENBQUMsSUFBSTtZQUMxQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUU7WUFDNUIsWUFBWSxFQUFFLElBQUksQ0FBQyxZQUFZO1lBQy9CLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxFQUFFO1lBQ3JCLE9BQU8sRUFBRSxJQUFJLENBQUMsT0FBTztTQUN0QixDQUFDO1FBRUYsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVNLFlBQVk7UUFDakIsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDO0lBQ3hCLENBQUM7SUFFTSxVQUFVO1FBQ2YsT0FBTyxJQUFJLENBQUMsT0FBTyxDQUFDO0lBQ3RCLENBQUM7SUFFUyxxQkFBcUIsQ0FBSSxPQUFVLElBQUcsQ0FBQztJQUV2QyxLQUFLLENBQUMsbUJBQW1CLENBQ2pDLE9BQXVDO1FBRXZDLElBQUksSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7WUFDekMsSUFBSSxPQUFPLENBQUMsTUFBTSxDQUFDLFdBQVcsS0FBSyxTQUFTLEVBQUUsQ0FBQztnQkFDN0MsSUFBSSxDQUFDLElBQUksQ0FBQyx5QkFBeUIsT0FBTyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDLENBQUM7WUFDeEUsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRVMsS0FBSyxDQUFDLHFCQUFxQixDQUNuQyxPQUErQjtRQUUvQixNQUFNLElBQUksS0FBSyxDQUNiLHNDQUFzQyxPQUFPLENBQUMsTUFBTSxDQUFDLFdBQVcsRUFBRSxDQUNuRSxDQUFDO0lBQ0osQ0FBQztJQUVPLHNCQUFzQixDQUM1QixPQUF1QztRQUV2QyxPQUFPLFFBQVEsSUFBSSxPQUFPLElBQUksYUFBYSxJQUFJLE9BQU8sQ0FBQyxNQUFNLENBQUM7SUFDaEUsQ0FBQztJQUVPLDJCQUEyQjtRQUNqQyxJQUFJLElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1lBQy9CLFlBQVksQ0FBQyxJQUFJLENBQUMscUJBQXFCLENBQUMsQ0FBQztRQUMzQyxDQUFDO1FBQ0QsSUFBSSxDQUFDLHFCQUFxQixHQUFHLFVBQVUsQ0FBQyxHQUFHLEVBQUU7WUFDM0MsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3ZCLElBQUksQ0FBQywyQkFBMkIsRUFBRSxDQUFDO1FBQ3JDLENBQUMsRUFBRSxJQUFJLENBQUMsb0JBQW9CLENBQUMsQ0FBQztJQUNoQyxDQUFDO0lBRU8sS0FBSyxDQUFDLGNBQWMsQ0FDMUIsS0FBNkI7UUFFN0IsTUFBTSxXQUFXLEdBQUcsS0FBSyxDQUFDLE1BQU0sQ0FBQyxXQUFXLENBQUM7UUFDN0MsSUFBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO1lBQ2pCLE1BQU0sSUFBSSxLQUFLLENBQUMsNEJBQTRCLENBQUMsQ0FBQztRQUNoRCxDQUFDO1FBRUQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsV0FBVyxDQUFDLENBQUM7UUFDOUQsSUFBSSxDQUFDLGVBQWUsRUFBRSxDQUFDO1lBQ3JCLE9BQU8sTUFBTSxJQUFJLENBQUMscUJBQXFCLENBQUMsS0FBSyxDQUFDLENBQUM7UUFDakQsQ0FBQztRQUVELDBCQUEwQjtRQUMxQixNQUFNLGFBQWEsR0FBSSxJQUFZLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztRQUN2RSxNQUFNLElBQUksR0FBRyxlQUFlLENBQUMsa0JBQWtCLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztRQUVyRSxNQUFNLGVBQWUsR0FBRyxlQUFlLENBQUMsT0FBTztZQUM3QyxDQUFDLENBQUMsTUFBTSxhQUFhLENBQUMsSUFBSSxDQUFDO1lBQzNCLENBQUMsQ0FBQyxhQUFhLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFeEIsT0FBTyxlQUFlLENBQUM7SUFDekIsQ0FBQztJQUVPLEtBQUssQ0FBQyxxQkFBcUIsQ0FDakMsS0FBNkI7UUFFN0IsSUFBSSxDQUFDO1lBQ0gsTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2hELElBQUksUUFBUSxHQUFHLElBQUksQ0FBQyxZQUFZLENBQUMsTUFBTSxFQUFFLEtBQUssRUFBRSxJQUFJLENBQUMsQ0FBQztZQUN0RCxRQUFRLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDaEQsT0FBTyxRQUFRLENBQUM7UUFDbEIsQ0FBQztRQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7WUFDZixJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsWUFBWSxDQUM5QixFQUFtQixFQUNuQixLQUFLLEVBQ0wsS0FBYyxDQUNmLENBQUM7WUFDRixRQUFRLEdBQUcsSUFBSSxDQUFDLGNBQWMsQ0FBQyxRQUFRLEVBQUUsS0FBSyxDQUFDLENBQUM7WUFDaEQsT0FBTyxRQUFRLENBQUM7UUFDbEIsQ0FBQztJQUNILENBQUM7SUFFUyxLQUFLLENBQUMsa0JBQWtCLENBQ2hDLE9BQStCLEVBQy9CLE1BQW9CLElBQ0osQ0FBQztJQUVULGNBQWMsQ0FDdEIsUUFBa0MsRUFDbEMsZUFBdUM7UUFFdkMsc0NBQXNDO1FBQ3RDLHFFQUFxRTtRQUNyRSxtRUFBbUU7UUFDbkUsT0FBTyxRQUFRLENBQUM7SUFDbEIsQ0FBQztJQUVTLGFBQWEsQ0FBQyxNQUFzQixFQUFFLElBQVM7UUFDdkQsc0RBQXNEO1FBQ3RELE9BQU8sTUFBTSxDQUFDO0lBQ2hCLENBQUM7SUFFTyxLQUFLLENBQUMscUJBQXFCLENBQ2pDLE9BQWdEO1FBRWhELG1FQUFtRTtRQUNuRSwwQ0FBMEM7UUFDMUMsTUFBTSxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUMsT0FBTyxDQUFDLENBQUM7UUFDL0MsSUFBSSxDQUFDLHNCQUFzQixDQUFDLE9BQU8sQ0FBQyxDQUFDO0lBQ3ZDLENBQUM7SUFFTyxLQUFLLENBQUMsc0JBQXNCLENBQ2xDLE9BQWdEO1FBRWhELElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxPQUFPLENBQUMsRUFBRSxDQUFDO1lBQzdCLE1BQU0sSUFBSSxDQUFDLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUNyQyxDQUFDO2FBQU0sQ0FBQztZQUNOLElBQ0UsT0FBTyxDQUFDLE1BQU0sQ0FBQyxXQUFXLEtBQUsscUNBQXFDLEVBQ3BFLENBQUM7Z0JBQ0QsTUFBTSxTQUFTLEdBQUcsT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUM7Z0JBQzNDLE1BQU0sTUFBTSxHQUFHLE9BQU8sQ0FBQyxJQUFvQixDQUFDO2dCQUM1QyxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMsZUFBZSxDQUFDLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDM0QsSUFBSSxjQUFjLEVBQUUsQ0FBQztvQkFDbkIsTUFBTSxFQUFFLFFBQVEsRUFBRSxlQUFlLEVBQUUsU0FBUyxFQUFFLGtCQUFrQixFQUFFLEdBQ2hFLGNBQWMsQ0FBQztvQkFDakIsWUFBWSxDQUFDLFNBQVMsQ0FBQyxDQUFDO29CQUN4QixNQUFNLFVBQVUsR0FBRyxVQUFVLENBQzNCLGVBQWUsRUFDZixJQUFJLENBQUMsc0JBQXNCLENBQzVCLENBQUM7b0JBQ0YsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFO3dCQUNsQyxRQUFRO3dCQUNSLGVBQWU7d0JBQ2YsU0FBUyxFQUFFLFVBQVU7d0JBQ3JCLGtCQUFrQjtxQkFDbkIsQ0FBQyxDQUFDO29CQUNILE1BQU0sa0JBQWtCLENBQUMsT0FBTyxFQUFFLE1BQU0sQ0FBQyxDQUFDO29CQUMxQyxPQUFPO2dCQUNULENBQUM7WUFDSCxDQUFDO1lBQ0QsSUFBSSxDQUFDLGtCQUFrQixDQUFDLE9BQWlDLENBQUMsQ0FBQztRQUM3RCxDQUFDO0lBQ0gsQ0FBQztJQUVPLFVBQVUsQ0FDaEIsT0FBZ0Q7UUFFaEQsT0FBTyxnQkFBZ0IsSUFBSSxPQUFPLENBQUM7SUFDckMsQ0FBQztJQUVPLEtBQUssQ0FBQyxjQUFjLENBQUMsUUFBd0I7UUFDbkQsTUFBTSxTQUFTLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxTQUFTLENBQUM7UUFDbkQsTUFBTSxjQUFjLEdBQUcsSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLENBQUM7UUFDM0QsSUFBSSxjQUFjLEVBQUUsQ0FBQztZQUNuQixJQUFJLENBQUM7Z0JBQ0gsTUFBTSxjQUFjLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDO1lBQzFDLENBQUM7WUFBQyxPQUFPLEtBQVUsRUFBRSxDQUFDO2dCQUNwQixJQUFJLENBQUMsS0FBSyxDQUFDLHdDQUF3QyxTQUFTLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztZQUN6RSxDQUFDO29CQUFTLENBQUM7Z0JBQ1QsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7WUFDekMsQ0FBQztRQUNILENBQUM7YUFBTSxDQUFDO1lBQ04sSUFBSSxDQUFDLElBQUksQ0FBQywwQ0FBMEMsU0FBUyxFQUFFLENBQUMsQ0FBQztRQUNuRSxDQUFDO0lBQ0gsQ0FBQztJQUVPLGtCQUFrQixDQUFDLE9BQStCO1FBQ3hELElBQUksQ0FBQyxZQUFZLENBQ2YsS0FBSyxFQUFFLEtBQUssRUFBRSxFQUFFLENBQUMsTUFBTSxJQUFJLENBQUMscUJBQXFCLENBQUMsS0FBSyxDQUFDLEVBQ3hELE9BQU8sQ0FDUixDQUFDO0lBQ0osQ0FBQztJQUdLLEFBQU4sS0FBSyxDQUFDLEtBQUs7UUFDVCxNQUFNLElBQUksQ0FBQyxpQkFBaUIsRUFBRSxDQUFDO1FBQy9CLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxDQUFDO0lBQ3RCLENBQUM7SUFHSyxBQUFOLEtBQUssQ0FBQyxJQUFJO1FBQ1IsTUFBTSxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FDbkIscUJBQXFCLENBQUMsYUFBYSxDQUNqQyxJQUFJLENBQUMsT0FBTyxFQUNaLFVBQVUsRUFDVixJQUFJLENBQUMsZUFBZSxFQUFFLENBQ3ZCLENBQ0YsQ0FBQztRQUNGLElBQUksQ0FBQyxJQUFJLENBQUMsV0FBVyxJQUFJLENBQUMsU0FBUyxLQUFLLElBQUksQ0FBQyxVQUFVLGVBQWUsQ0FBQyxDQUFDO1FBQ3hFLE1BQU0sSUFBSSxDQUFDLGdCQUFnQixFQUFFLENBQUM7UUFDOUIsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsY0FBYyxDQUMvQyxJQUFJLENBQUMsU0FBUyxFQUNkLElBQUksQ0FBQyxVQUFVLENBQ2hCLENBQUM7UUFFRixJQUFJLENBQUMsT0FBTyxHQUFHLEtBQUssQ0FBQztJQUN2QixDQUFDO0lBRU8sS0FBSyxDQUFDLGdCQUFnQixDQUM1QixNQUE0QztRQUU1QyxpRUFBaUU7UUFDakUsSUFBSSxNQUFNLENBQUMsTUFBTSxFQUFFLENBQUM7WUFDbEIsSUFBSSxNQUFNLENBQUMsTUFBTSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsRUFBRSxDQUFDO2dCQUNqRCxNQUFNLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLENBQUM7WUFDN0MsQ0FBQztRQUNILENBQUM7SUFDSCxDQUFDO0lBRU8sS0FBSyxDQUFDLGdCQUFnQixDQUM1QixRQUFrQztRQUVsQyxNQUFNLFdBQVcsR0FBRyxRQUFRLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDO1FBQzVELElBQUksV0FBVyxFQUFFLENBQUM7WUFDaEIsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQ2xFLElBQUksQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUM7WUFDcEIsdURBQXVEO1lBQ3ZELDJCQUEyQjtRQUM3QixDQUFDO0lBQ0gsQ0FBQztJQUVTLEtBQUssQ0FBQyxnQkFBZ0IsQ0FDOUIsT0FBK0IsRUFDL0IsTUFBb0I7UUFFcEIsTUFBTSxJQUFJLENBQUMsaUJBQWlCLENBQzFCLHFDQUFxQyxFQUNyQyxPQUFPLENBQUMsTUFBTSxDQUFDLGdCQUFnQixFQUMvQixNQUFNLEVBQ04sT0FBTyxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQ3pCLENBQUM7SUFDSixDQUFDO0lBRVMsWUFBWSxDQUNwQixJQUFtQixFQUNuQixPQUErQixFQUMvQixLQUFtQjtRQUVuQixNQUFNLFFBQVEsR0FBRztZQUNmLGFBQWEsRUFBRSxPQUFPLENBQUMsTUFBTTtZQUM3QixjQUFjLEVBQUU7Z0JBQ2QsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7Z0JBQ3JCLGdCQUFnQixFQUFFLElBQUksQ0FBQyxPQUFPO2FBQy9CO1lBQ0QsSUFBSSxFQUFFO2dCQUNKLElBQUk7Z0JBQ0osT0FBTyxFQUFFLEtBQUssS0FBSyxJQUFJO2dCQUN2QixLQUFLO2FBQ047U0FDRixDQUFDO1FBRUYsSUFDRSxPQUFPLENBQUMsTUFBTSxDQUFDLGdCQUFnQjtZQUMvQixDQUFDLENBQUMsSUFBSSxJQUFJLENBQUMsT0FBTyxJQUFJLEtBQUssUUFBUSxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLENBQUMsTUFBTSxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQ3ZFLENBQUMsS0FBSyxFQUNOLENBQUM7WUFDRCxJQUFJLENBQUMsS0FBSyxDQUNSLHFDQUNFLE9BQU8sQ0FBQyxNQUFNLENBQUMsV0FDakIsV0FBVyxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQ2pDLEVBQUUsT0FBTyxFQUFFLEtBQUssRUFBRSxDQUNuQixDQUFDO1lBQ0YsS0FBSyxHQUFHLElBQUksS0FBSyxDQUFDLHFCQUFxQixDQUFDLENBQUM7UUFDM0MsQ0FBQztRQUVELE9BQU8sUUFBUSxDQUFDO0lBQ2xCLENBQUM7SUFFUyxLQUFLLENBQUMsaUJBQWlCLENBQy9CLFdBQW1CLEVBQ25CLEVBQVUsRUFDVixJQUFTLEVBQ1QsU0FBa0I7UUFFbEIsU0FBUyxHQUFHLFNBQVMsSUFBSSxJQUFJLENBQUMsaUJBQWlCLEVBQUUsQ0FBQztRQUVsRCxJQUFJLFdBQVcsR0FBRyxFQUFFLENBQUM7UUFDckIsSUFBSSxFQUFFLENBQUMsVUFBVSxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsR0FBRyxDQUFDLEVBQUUsQ0FBQztZQUN4QyxXQUFXLEdBQUcsRUFBRSxDQUFDO1FBQ25CLENBQUM7YUFBTSxDQUFDO1lBQ04sTUFBTSxNQUFNLEdBQUcsTUFBTSxJQUFJLENBQUMsdUJBQXVCLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDLENBQUM7WUFDekUsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO2dCQUNaLE1BQU0sSUFBSSx1QkFBYSxDQUFDLGtDQUFrQyxFQUFFLEdBQUcsQ0FBQyxDQUFDO1lBQ25FLENBQUM7WUFDRCxXQUFXLEdBQUcsR0FBRyxJQUFJLENBQUMsU0FBUyxJQUFJLEVBQUUsSUFBSSxNQUFNLEVBQUUsQ0FBQztRQUNwRCxDQUFDO1FBRUQsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1FBRWxFLElBQUksTUFBTSxHQUFtQjtZQUMzQixTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsRUFBRTtZQUNyQixTQUFTO1lBQ1QsZ0JBQWdCLEVBQUUsSUFBSSxDQUFDLFNBQVM7WUFDaEMsV0FBVyxFQUFFLFdBQVc7WUFDeEIsa0RBQWtEO1NBQ25ELENBQUM7UUFFRixNQUFNLEdBQUcsSUFBSSxDQUFDLGFBQWEsQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFMUMsTUFBTSxPQUFPLEdBQWtCO1lBQzdCLE1BQU07WUFDTixJQUFJO1NBQ0wsQ0FBQztRQUVGLElBQUksQ0FBQztZQUNILE1BQU0sSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQztRQUMzQixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLElBQUksQ0FBQyxLQUFLLENBQUMscUNBQXFDLEVBQUUsRUFBRSxFQUFFO2dCQUNwRCxLQUFLO2dCQUNMLFNBQVM7Z0JBQ1QsV0FBVzthQUNaLENBQUMsQ0FBQztZQUNILE1BQU0sSUFBSSx1QkFBYSxDQUFDLHFDQUFxQyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUM1RSxDQUFDO0lBQ0gsQ0FBQztJQUVTLEtBQUssQ0FBQyxXQUFXLENBQUksS0FBbUI7UUFDaEQsTUFBTSxFQUNKLEVBQUUsRUFDRixXQUFXLEVBQ1gsSUFBSSxFQUNKLE9BQU8sRUFDUCxrQkFBa0IsRUFDbEIsT0FBTyxFQUNQLE9BQU8sRUFDUCxlQUFlLEdBQ2hCLEdBQUcsS0FBSyxDQUFDO1FBQ1YsT0FBTyxJQUFJLE9BQU8sQ0FBQyxLQUFLLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxFQUFFO1lBQzNDLE1BQU0sU0FBUyxHQUFHLE9BQU8sRUFBRSxTQUFTLElBQUksSUFBSSxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFFakUsSUFBSSxXQUFXLEdBQUcsRUFBRSxDQUFDO1lBQ3JCLElBQUksRUFBRSxDQUFDLFVBQVUsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLEdBQUcsQ0FBQyxFQUFFLENBQUM7Z0JBQ3hDLFdBQVcsR0FBRyxFQUFFLENBQUM7WUFDbkIsQ0FBQztpQkFBTSxDQUFDO2dCQUNOLE1BQU0sTUFBTSxHQUFHLE1BQU0sSUFBSSxDQUFDLHVCQUF1QixDQUFDLGtCQUFrQixDQUNsRSxFQUFFLENBQ0gsQ0FBQztnQkFDRixJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7b0JBQ1osTUFBTSxDQUFDLElBQUksdUJBQWEsQ0FBQyxrQ0FBa0MsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDO29CQUNuRSxPQUFPO2dCQUNULENBQUM7Z0JBQ0QsV0FBVyxHQUFHLEdBQUcsSUFBSSxDQUFDLFNBQVMsSUFBSSxFQUFFLElBQUksTUFBTSxFQUFFLENBQUM7WUFDcEQsQ0FBQztZQUVELElBQUksTUFBTSxHQUFtQjtnQkFDM0IsU0FBUyxFQUFFLElBQUksQ0FBQyxHQUFHLEVBQUU7Z0JBQ3JCLFNBQVM7Z0JBQ1QsZ0JBQWdCLEVBQUUsT0FBTyxFQUFFLGdCQUFnQixJQUFJLElBQUksQ0FBQyxPQUFPO2dCQUMzRCxnQkFBZ0IsRUFBRSxPQUFPLElBQUksSUFBSSxDQUFDLE9BQU87Z0JBQ3pDLFdBQVc7YUFDWixDQUFDO1lBRUYsTUFBTSxHQUFHLElBQUksQ0FBQyxhQUFhLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO1lBRTFDLE1BQU0sT0FBTyxHQUFrQjtnQkFDN0IsTUFBTTtnQkFDTixJQUFJO2FBQ0wsQ0FBQztZQUVGLE1BQU0sUUFBUSxHQUF3QixLQUFLLEVBQUUsUUFBUSxFQUFFLEVBQUU7Z0JBQ3ZELElBQUksQ0FBQztvQkFDSCxJQUFJLFFBQVEsQ0FBQyxJQUFJLENBQUMsT0FBTyxFQUFFLENBQUM7d0JBQzFCLE9BQU8sQ0FBQyxRQUFRLENBQUMsQ0FBQztvQkFDcEIsQ0FBQzt5QkFBTSxDQUFDO3dCQUNOLElBQUksQ0FBQyxLQUFLLENBQUMsY0FBYyxFQUFFLFNBQVMsRUFBRTs0QkFDcEMsU0FBUzs0QkFDVCxLQUFLLEVBQUUsUUFBUSxDQUFDLElBQUksQ0FBQyxLQUFLOzRCQUMxQixXQUFXOzRCQUNYLEVBQUU7NEJBQ0YsT0FBTzt5QkFDUixDQUFDLENBQUM7d0JBQ0gsTUFBTSxDQUNKLElBQUksdUJBQWEsQ0FBQyxjQUFjLEVBQUUsU0FBUyxFQUFFOzRCQUMzQyxPQUFPOzRCQUNQLFFBQVE7eUJBQ1QsQ0FBQyxDQUNILENBQUM7b0JBQ0osQ0FBQztnQkFDSCxDQUFDO2dCQUFDLE9BQU8sS0FBVSxFQUFFLENBQUM7b0JBQ3BCLElBQUksQ0FBQyxLQUFLLENBQUMsaUNBQWlDLFNBQVMsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO29CQUNoRSxNQUFNLENBQ0osSUFBSSx1QkFBYSxDQUFDLGtDQUFrQyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FDakUsQ0FBQztnQkFDSixDQUFDO1lBQ0gsQ0FBQyxDQUFDO1lBRUYsTUFBTSxTQUFTLEdBQUcsT0FBTyxJQUFJLElBQUksQ0FBQyxzQkFBc0IsQ0FBQztZQUN6RCxNQUFNLFNBQVMsR0FDYixlQUFlO2dCQUNmLENBQUMsR0FBRyxFQUFFO29CQUNKLElBQUksSUFBSSxDQUFDLGVBQWUsQ0FBQyxHQUFHLENBQUMsU0FBUyxDQUFDLEVBQUUsQ0FBQzt3QkFDeEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7d0JBQ3ZDLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLFlBQVksRUFBRTs0QkFDdEMsU0FBUzs0QkFDVCxTQUFTOzRCQUNULFdBQVc7eUJBQ1osQ0FBQyxDQUFDO3dCQUNILE1BQU0sQ0FDSixJQUFJLHVCQUFhLENBQ2YsY0FBYyxFQUFFLG9CQUFvQixTQUFTLElBQUksQ0FDbEQsQ0FDRixDQUFDO29CQUNKLENBQUM7Z0JBQ0gsQ0FBQyxDQUFDLENBQUM7WUFDTCxNQUFNLFNBQVMsR0FBRyxVQUFVLENBQUMsU0FBUyxFQUFFLFNBQVMsQ0FBQyxDQUFDO1lBQ25ELElBQUksQ0FBQyxlQUFlLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRTtnQkFDbEMsUUFBUTtnQkFDUixlQUFlLEVBQUUsU0FBUztnQkFDMUIsU0FBUztnQkFDVCxrQkFBa0IsRUFDaEIsa0JBQWtCLElBQUksSUFBSSxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7YUFDM0QsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBQ2xFLE1BQU0sVUFBVSxHQUNkLEVBQUUsSUFBSSxJQUFJLENBQUMsU0FBUztnQkFDbEIsQ0FBQyxDQUFDLElBQUksQ0FBQyxzQkFBc0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO2dCQUN4QyxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztZQUNoQixVQUFVLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUU7Z0JBQ3ZDLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUN2QyxJQUFJLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFFLEVBQUUsRUFBRTtvQkFDNUMsS0FBSztvQkFDTCxTQUFTO29CQUNULFdBQVc7aUJBQ1osQ0FBQyxDQUFDO2dCQUNILE1BQU0sQ0FBQyxJQUFJLHVCQUFhLENBQUMsNkJBQTZCLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7WUFDdEUsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxpQkFBaUI7UUFDdkIsT0FBTyxHQUFHLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUU7YUFDcEQsUUFBUSxDQUFDLEVBQUUsQ0FBQzthQUNaLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUNwQixDQUFDO0NBQ0Y7QUFsbUJELHNEQWttQkM7QUFwUU87SUFETCxrQkFBUSxDQUFDLFlBQVk7Ozs7a0RBSXJCO0FBR0s7SUFETCxrQkFBUSxDQUFDLFlBQVk7Ozs7aURBaUJyQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElCYWNrRW5kLCBDaGFubmVsQmluZGluZyB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7XG4gIFJhdGVMaW1pdGVkVGFza1NjaGVkdWxlcixcbiAgVGFza091dHB1dCxcbn0gZnJvbSBcIi4vY29yZS8vUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyXCI7XG5pbXBvcnQgeyBMb2dnYWJsZSwgTG9nZ2FibGVFcnJvciwgTG9nTWVzc2FnZSB9IGZyb20gXCIuL2xvZ2dpbmdcIjtcbmltcG9ydCB7IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyIH0gZnJvbSBcIi4vY29yZS8vU2VydmljZURpc2NvdmVyeU1hbmFnZXJcIjtcbmltcG9ydCB7IElSZXF1ZXN0LCBJUmVzcG9uc2UsIElSZXF1ZXN0SGVhZGVyIH0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IFwicmVmbGVjdC1tZXRhZGF0YVwiO1xuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSBcInV1aWRcIjtcbmltcG9ydCB7IExvZ1N0cmF0ZWd5IH0gZnJvbSBcIi4vbG9nZ2luZy9Mb2dTdHJhdGVneVwiO1xuaW1wb3J0IGNoYWxrIGZyb20gXCJjaGFsa1wiO1xuXG5jb25zdCBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZID0gU3ltYm9sKFwicmVxdWVzdEhhbmRsZXJcIik7XG5cbmludGVyZmFjZSBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhIHtcbiAgcmVxdWVzdFR5cGU6IHN0cmluZztcbiAgbWV0aG9kOiBzdHJpbmc7XG4gIGFjY2VwdHNGdWxsUmVxdWVzdDogYm9vbGVhbjtcbiAgaXNBc3luYzogYm9vbGVhbjtcbn1cblxudHlwZSBJc0Z1bGxSZXF1ZXN0PFQ+ID0gVCBleHRlbmRzIElSZXF1ZXN0PGFueT4gPyB0cnVlIDogZmFsc2U7XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgaWYgdGhlIGhhbmRsZXIgYWNjZXB0cyBmdWxsIHJlcXVlc3RcbmZ1bmN0aW9uIGlzRnVsbFJlcXVlc3RIYW5kbGVyPFQ+KCk6IGJvb2xlYW4ge1xuICByZXR1cm4ge30gYXMgSXNGdWxsUmVxdWVzdDxUPiBhcyBib29sZWFuO1xufVxuLy8gRGVjb3JhdG9yXG5leHBvcnQgZnVuY3Rpb24gUmVxdWVzdEhhbmRsZXI8VD4ocmVxdWVzdFR5cGU6IHN0cmluZykge1xuICByZXR1cm4gZnVuY3Rpb24gPE0gZXh0ZW5kcyAoYXJnOiBUKSA9PiBQcm9taXNlPGFueT4gfCBhbnk+KFxuICAgIHRhcmdldDogYW55LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8TT5cbiAgKSB7XG4gICAgY29uc3QgYWNjZXB0c0Z1bGxSZXF1ZXN0ID0gaXNGdWxsUmVxdWVzdEhhbmRsZXI8VD4oKTtcbiAgICBjb25zdCBpc0FzeW5jID0gZGVzY3JpcHRvci52YWx1ZT8uY29uc3RydWN0b3IubmFtZSA9PT0gXCJBc3luY0Z1bmN0aW9uXCI7XG4gICAgUmVmbGVjdC5kZWZpbmVNZXRhZGF0YShcbiAgICAgIFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVksXG4gICAgICB7IHJlcXVlc3RUeXBlLCBtZXRob2Q6IHByb3BlcnR5S2V5LCBhY2NlcHRzRnVsbFJlcXVlc3QsIGlzQXN5bmMgfSxcbiAgICAgIHRhcmdldCxcbiAgICAgIHByb3BlcnR5S2V5XG4gICAgKTtcbiAgfTtcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBhbGwgbWV0aG9kcyB3aXRoIHRoZSBSZXF1ZXN0SGFuZGxlciBkZWNvcmF0b3JcbmZ1bmN0aW9uIGdldFJlcXVlc3RIYW5kbGVycyh0YXJnZXQ6IGFueSk6IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+IHtcbiAgY29uc3QgaGFuZGxlcnMgPSBuZXcgTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT4oKTtcblxuICBsZXQgY3VycmVudFRhcmdldCA9IHRhcmdldC5wcm90b3R5cGU7XG4gIHdoaWxlIChjdXJyZW50VGFyZ2V0KSB7XG4gICAgZm9yIChjb25zdCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoY3VycmVudFRhcmdldCkpIHtcbiAgICAgIGNvbnN0IG1ldGFkYXRhOiBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhIHwgdW5kZWZpbmVkID0gUmVmbGVjdC5nZXRNZXRhZGF0YShcbiAgICAgICAgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSxcbiAgICAgICAgY3VycmVudFRhcmdldCxcbiAgICAgICAgcHJvcGVydHlOYW1lXG4gICAgICApO1xuICAgICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICAgIGhhbmRsZXJzLnNldChtZXRhZGF0YS5yZXF1ZXN0VHlwZSwgbWV0YWRhdGEpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGN1cnJlbnRUYXJnZXQgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudFRhcmdldCk7XG4gIH1cblxuICByZXR1cm4gaGFuZGxlcnM7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSVNlcnZlckNvbmZpZyB7XG4gIG5hbWVzcGFjZTogc3RyaW5nO1xuICBjb25jdXJyZW5jeUxpbWl0PzogbnVtYmVyO1xuICByZXF1ZXN0c1BlckludGVydmFsPzogbnVtYmVyO1xuICBpbnRlcnZhbD86IG51bWJlcjtcbiAgdHBzSW50ZXJ2YWw/OiBudW1iZXI7XG4gIHNlcnZpY2VJZDogc3RyaW5nO1xuICByZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0PzogbnVtYmVyO1xuICBsb2dTdHJhdGVneT86IExvZ1N0cmF0ZWd5O1xuICBzdGF0dXNVcGRhdGVJbnRlcnZhbD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2aWNlU3RhdHVzIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIGluc3RhbmNlSWQ6IHN0cmluZztcbiAgcGVuZGluZ1JlcXVlc3RzOiBudW1iZXI7XG4gIHF1ZXVlU2l6ZTogbnVtYmVyO1xuICBydW5uaW5nVGFza3M6IG51bWJlcjtcbiAgdGltZXN0YW1wOiBudW1iZXI7XG4gIGFkZHJlc3M6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNVcGRhdGUge1xuICBzdGF0dXM6IHN0cmluZztcbiAgcHJvZ3Jlc3M/OiBudW1iZXI7XG4gIG1ldGFkYXRhPzogYW55O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlcXVlc3RQcm9wcyB7XG4gIHJlcXVlc3RUeXBlOiBzdHJpbmc7XG4gIHRvOiBzdHJpbmc7XG4gIGJvZHk6IGFueTtcbiAgcmVwbHlUbz86IHN0cmluZztcbiAgaGFuZGxlU3RhdHVzVXBkYXRlPzogKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB0aW1lb3V0Q2FsbGJhY2s/OiAoKSA9PiB2b2lkO1xuICB0aW1lb3V0PzogbnVtYmVyO1xuICBoZWFkZXJzPzogSVJlcXVlc3RIZWFkZXI7XG4gIGlzQnJvYWRjYXN0PzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IHR5cGUgQ2FsbGJhY2tGdW5jdGlvbjxUPiA9IChyZXNwb25zZTogSVJlc3BvbnNlPFQ+KSA9PiBQcm9taXNlPHZvaWQ+O1xuZXhwb3J0IHR5cGUgQ2FsbGJhY2tPYmplY3Q8VD4gPSB7XG4gIGNhbGxiYWNrOiBDYWxsYmFja0Z1bmN0aW9uPFQ+O1xuICB0aW1lb3V0Q2FsbGJhY2s6ICgpID0+IHZvaWQ7XG4gIGhhbmRsZVN0YXR1c1VwZGF0ZTogKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFQ+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgdGltZU91dElkOiBOb2RlSlMuVGltZW91dDtcbn07XG5cbmV4cG9ydCBjbGFzcyBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneSBleHRlbmRzIExvZ1N0cmF0ZWd5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBsb2dDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxMb2dNZXNzYWdlPj4pIHtcbiAgICBzdXBlcigpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHNlbmRQYWNrYWdlZChcbiAgICBwYWNrYWdlZE1lc3NhZ2U6IElSZXF1ZXN0PGFueT4sXG4gICAgb3B0aW9ucz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sb2dDaGFubmVsLnNlbmQocGFja2FnZWRNZXNzYWdlKTtcbiAgfVxufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBUUmVxdWVzdEJvZHksXG4gIFRSZXNwb25zZURhdGFcbj4gZXh0ZW5kcyBSYXRlTGltaXRlZFRhc2tTY2hlZHVsZXI8XG4gIElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gIElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuPiB7XG4gIHByaXZhdGUgbG9iYnk6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcml2YXRlIHNlcnZpY2VDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxhbnk+PjtcbiAgcHJpdmF0ZSBzdGF0dXNVcGRhdGVUaW1lb3V0SWQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGVuZGluZ1JlcXVlc3RzOiBNYXA8c3RyaW5nLCBDYWxsYmFja09iamVjdDxhbnk+PiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSByZXF1ZXN0SGFuZGxlcnM6IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+O1xuICBwcm90ZWN0ZWQgYnJvYWRjYXN0Q2hhbm5lbDogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8YW55Pj47XG4gIHByb3RlY3RlZCBiYWNrZW5kOiBJQmFja0VuZDtcbiAgcHJvdGVjdGVkIHNlcnZlckNvbmZpZzogSVNlcnZlckNvbmZpZztcbiAgcHJvdGVjdGVkIHNlcnZpY2VJZDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgcnVubmluZzogYm9vbGVhbiA9IGZhbHNlO1xuICBwcm90ZWN0ZWQgc3RhdHVzVXBkYXRlSW50ZXJ2YWw6IG51bWJlciA9IDEyMDAwMDtcbiAgcHJvdGVjdGVkIHJlcXVlc3RDYWxsYmFja1RpbWVvdXQ6IG51bWJlciA9IDMwMDAwO1xuICByZWFkb25seSBhZGRyZXNzOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyOiBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcjtcbiAgcmVhZG9ubHkgbmFtZXNwYWNlOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogSVNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKFxuICAgICAgY29uZmlnLmNvbmN1cnJlbmN5TGltaXQgfHwgMTAwLFxuICAgICAgY29uZmlnLnJlcXVlc3RzUGVySW50ZXJ2YWwgfHwgMTAwLFxuICAgICAgY29uZmlnLmludGVydmFsIHx8IDEwMDBcbiAgICApO1xuICAgIHRoaXMubmFtZXNwYWNlID0gY29uZmlnLm5hbWVzcGFjZTtcbiAgICB0aGlzLnNlcnZlckNvbmZpZyA9IGNvbmZpZztcbiAgICB0aGlzLmJhY2tlbmQgPSBiYWNrZW5kO1xuICAgIHRoaXMuc2VydmljZUlkID0gY29uZmlnLnNlcnZpY2VJZDtcbiAgICB0aGlzLnN0YXR1c1VwZGF0ZUludGVydmFsID0gY29uZmlnLnN0YXR1c1VwZGF0ZUludGVydmFsIHx8IDEyMDAwMDtcbiAgICB0aGlzLmFkZHJlc3MgPSBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06JHt0aGlzLmluc3RhbmNlSWR9YDtcbiAgICB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQgPVxuICAgICAgY29uZmlnLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQgfHwgdGhpcy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0O1xuICAgIHRoaXMucmVxdWVzdEhhbmRsZXJzID0gZ2V0UmVxdWVzdEhhbmRsZXJzKHRoaXMuY29uc3RydWN0b3IpO1xuICAgIHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIgPSBuZXcgU2VydmljZURpc2NvdmVyeU1hbmFnZXIoXG4gICAgICB0aGlzLmJhY2tlbmQuc2VydmljZVJlZ2lzdHJ5XG4gICAgKTtcbiAgfVxuXG4gIC8vIEBMb2dnYWJsZS5oYW5kbGVFcnJvcnNcbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcbiAgICB0aGlzLnNlcnZpY2VDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9YCxcbiAgICAgIHRoaXMuaGFuZGxlU2VydmljZU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIHRoaXMuYnJvYWRjYXN0Q2hhbm5lbCA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChcbiAgICAgIGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfTpicm9hZGNhc3RgXG4gICAgKTtcbiAgICB0aGlzLmxvYmJ5ID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OmxvYmJ5YCxcbiAgICAgIHRoaXMuaGFuZGxlTG9iYnlNZXNzYWdlcy5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBjb25zdCBsb2dDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmxvZ3NgXG4gICAgKTtcbiAgICBpZiAoIXRoaXMuc2VydmVyQ29uZmlnLmxvZ1N0cmF0ZWd5KSB7XG4gICAgICBMb2dnYWJsZS5zZXRMb2dTdHJhdGVneShcbiAgICAgICAgdGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kgfHwgbmV3IE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5KGxvZ0NoYW5uZWwpXG4gICAgICApO1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBjaGFsay55ZWxsb3coYFxuW1dBUk5JTkddXG5Mb2cgU3RyYXRlZ3kgaXMgc2V0IHRvIE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5LlxuTWljcm9zZXJ2aWNlRnJhbWV3b3JrIHdpbGwgc3RyZWFtIGxvZ3MgdG8gJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06bG9ncyBjaGFubmVsXG5JZiB5b3UgYXJlIG5vdCBzZWVpbmcgYW55IGxvZ3MsIHRyeSBhZGRpbmcgdGhlIGZvbGxvd2luZyB0byBNaWNyb3NlcnZpY2VGcmFtZXdvcmsgY29uZmlndXJhdGlvbiBvYmplY3Q6XG5cbmltcG9ydCB7IENvbnNvbGVTdHJhdGVneSB9IGZyb20gXCJtaWNyb3NlcnZpY2UtZnJhbWV3b3JrXCI7XG5jb25maWcgPSB7XG4gIC4uLixcbiAgbG9nU3RyYXRlZ3k6IG5ldyBDb25zb2xlU3RyYXRlZ3koKVxufVxuICAgICAgYClcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIExvZ2dhYmxlLnNldExvZ1N0cmF0ZWd5KHRoaXMuc2VydmVyQ29uZmlnLmxvZ1N0cmF0ZWd5KTtcbiAgICB9XG4gICAgdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgdGhpcy5oYW5kbGVJbmNvbWluZ01lc3NhZ2UuYmluZCh0aGlzKVxuICAgICk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci5yZWdpc3Rlck5vZGUoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHRoaXMucXVldWUuc2l6ZSgpXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLmxvYmJ5LnNlbmQoXG4gICAgICBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVxdWVzdChcbiAgICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgICBcIkNIRUNLSU5cIixcbiAgICAgICAgdGhpcy5nZXRTZXJ2ZXJTdGF0dXMoKVxuICAgICAgKVxuICAgICk7XG4gICAgdGhpcy5vblRhc2tDb21wbGV0ZSh0aGlzLnByb2Nlc3NBbmROb3RpZnkuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5zY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKTtcbiAgICB0aGlzLmluZm8oYFNlcnZpY2UgJHt0aGlzLnNlcnZpY2VJZH0gWyR7dGhpcy5pbnN0YW5jZUlkfV0gaW5pdGlhbGl6ZWQuYCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHVwZGF0ZUxvYWRMZXZlbCgpIHtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnVwZGF0ZU5vZGVMb2FkKFxuICAgICAgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICB0aGlzLmluc3RhbmNlSWQsXG4gICAgICB0aGlzLnF1ZXVlLnNpemUoKVxuICAgICk7XG4gICAgdGhpcy5zY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpIHtcbiAgICB0aGlzLmluZm8oXG4gICAgICBgU2VydmljZTogJHt0aGlzLnNlcnZpY2VJZH0gc3RhcnRlZCBzdWNjZXNzZnVsbHkuIEluc3RhbmNlSUQ6ICR7dGhpcy5pbnN0YW5jZUlkfWBcbiAgICApO1xuICB9XG4gIHByb3RlY3RlZCBhc3luYyBzdG9wRGVwZW5kZW5jaWVzKCkge31cblxuICBzdGF0aWMgY3JlYXRlUmVxdWVzdDxUPihcbiAgICByZXF1ZXN0ZXJBZGRyZXNzOiBzdHJpbmcsXG4gICAgcmVxdWVzdFR5cGU6IHN0cmluZyxcbiAgICBib2R5OiBULFxuICAgIHJlY2lwaWVudEFkZHJlc3M/OiBzdHJpbmdcbiAgKTogSVJlcXVlc3Q8VD4ge1xuICAgIHJldHVybiB7XG4gICAgICBoZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQ6IHV1aWR2NCgpLFxuICAgICAgICByZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICByZWNpcGllbnRBZGRyZXNzLFxuICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgIH0sXG4gICAgICBib2R5LFxuICAgIH07XG4gIH1cblxuICBzdGF0aWMgY3JlYXRlUmVzcG9uc2U8VD4oXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICByZXNwb25kZXJBZGRyZXNzOiBzdHJpbmcsXG4gICAgZGF0YTogVCxcbiAgICBzdWNjZXNzOiBib29sZWFuID0gdHJ1ZSxcbiAgICBlcnJvcjogRXJyb3IgfCBudWxsID0gbnVsbFxuICApOiBJUmVzcG9uc2U8VD4ge1xuICAgIHJldHVybiB7XG4gICAgICByZXF1ZXN0SGVhZGVyOiByZXF1ZXN0LmhlYWRlcixcbiAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgIHJlc3BvbmRlckFkZHJlc3MsXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgIH0sXG4gICAgICBib2R5OiB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIHN1Y2Nlc3MsXG4gICAgICAgIGVycm9yLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldFNlcnZlclN0YXR1cygpOiBTZXJ2aWNlU3RhdHVzIHtcbiAgICBjb25zdCBzdGF0dXMgPSB7XG4gICAgICAuLi50aGlzLnNlcnZlckNvbmZpZyxcbiAgICAgIGluc3RhbmNlSWQ6IHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHBlbmRpbmdSZXF1ZXN0czogdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2l6ZSxcbiAgICAgIHF1ZXVlU2l6ZTogdGhpcy5xdWV1ZS5zaXplKCksXG4gICAgICBydW5uaW5nVGFza3M6IHRoaXMucnVubmluZ1Rhc2tzLFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgYWRkcmVzczogdGhpcy5hZGRyZXNzLFxuICAgIH07XG5cbiAgICByZXR1cm4gc3RhdHVzO1xuICB9XG5cbiAgcHVibGljIGdldHNlcnZpY2VJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLnNlcnZpY2VJZDtcbiAgfVxuXG4gIHB1YmxpYyBnZXRCYWNrZW5kKCk6IElCYWNrRW5kIHtcbiAgICByZXR1cm4gdGhpcy5iYWNrZW5kO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVNlcnZpY2VNZXNzYWdlczxUPihtZXNzYWdlOiBUKSB7fVxuXG4gIHByb3RlY3RlZCBhc3luYyBoYW5kbGVMb2JieU1lc3NhZ2VzKFxuICAgIG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5pc1NlcnZpY2VTdGF0dXNSZXF1ZXN0KG1lc3NhZ2UpKSB7XG4gICAgICBpZiAobWVzc2FnZS5oZWFkZXIucmVxdWVzdFR5cGUgPT09IFwiQ0hFQ0tJTlwiKSB7XG4gICAgICAgIHRoaXMuaW5mbyhgUmVjZWl2ZWQgQ0hFQ0tJTiBmcm9tICR7bWVzc2FnZS5oZWFkZXIucmVxdWVzdGVyQWRkcmVzc31gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogUHJvbWlzZTxUUmVzcG9uc2VEYXRhPiB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYE5vIGhhbmRsZXIgZm91bmQgZm9yIHJlcXVlc3QgdHlwZTogJHtyZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZX1gXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgaXNTZXJ2aWNlU3RhdHVzUmVxdWVzdChcbiAgICBtZXNzYWdlOiBJUmVxdWVzdDxhbnk+IHwgSVJlc3BvbnNlPGFueT5cbiAgKTogbWVzc2FnZSBpcyBJUmVxdWVzdDxTZXJ2aWNlU3RhdHVzPiB7XG4gICAgcmV0dXJuIFwiaGVhZGVyXCIgaW4gbWVzc2FnZSAmJiBcInJlcXVlc3RUeXBlXCIgaW4gbWVzc2FnZS5oZWFkZXI7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpIHtcbiAgICBpZiAodGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCk7XG4gICAgfVxuICAgIHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnVwZGF0ZUxvYWRMZXZlbCgpO1xuICAgICAgdGhpcy5zY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKTtcbiAgICB9LCB0aGlzLnN0YXR1c1VwZGF0ZUludGVydmFsKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc1JlcXVlc3QoXG4gICAgaW5wdXQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogUHJvbWlzZTxUUmVzcG9uc2VEYXRhPiB7XG4gICAgY29uc3QgcmVxdWVzdFR5cGUgPSBpbnB1dC5oZWFkZXIucmVxdWVzdFR5cGU7XG4gICAgaWYgKCFyZXF1ZXN0VHlwZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiUmVxdWVzdCB0eXBlIG5vdCBzcGVjaWZpZWRcIik7XG4gICAgfVxuXG4gICAgY29uc3QgaGFuZGxlck1ldGFkYXRhID0gdGhpcy5yZXF1ZXN0SGFuZGxlcnMuZ2V0KHJlcXVlc3RUeXBlKTtcbiAgICBpZiAoIWhhbmRsZXJNZXRhZGF0YSkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZGVmYXVsdE1lc3NhZ2VIYW5kbGVyKGlucHV0KTtcbiAgICB9XG5cbiAgICAvLyBDYWxsIHRoZSBoYW5kbGVyIG1ldGhvZFxuICAgIGNvbnN0IGhhbmRsZXJNZXRob2QgPSAodGhpcyBhcyBhbnkpW2hhbmRsZXJNZXRhZGF0YS5tZXRob2RdLmJpbmQodGhpcyk7XG4gICAgY29uc3QgYXJncyA9IGhhbmRsZXJNZXRhZGF0YS5hY2NlcHRzRnVsbFJlcXVlc3QgPyBpbnB1dCA6IGlucHV0LmJvZHk7XG5cbiAgICBjb25zdCBoYW5kbGVyUmVzcG9uc2UgPSBoYW5kbGVyTWV0YWRhdGEuaXNBc3luY1xuICAgICAgPyBhd2FpdCBoYW5kbGVyTWV0aG9kKGFyZ3MpXG4gICAgICA6IGhhbmRsZXJNZXRob2QoYXJncyk7XG5cbiAgICByZXR1cm4gaGFuZGxlclJlc3BvbnNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cmFwQW5kUHJvY2Vzc1JlcXVlc3QoXG4gICAgaW5wdXQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogUHJvbWlzZTxJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzUmVxdWVzdChpbnB1dCk7XG4gICAgICBsZXQgcmVzcG9uc2UgPSB0aGlzLm1ha2VSZXNwb25zZShyZXN1bHQsIGlucHV0LCBudWxsKTtcbiAgICAgIHJlc3BvbnNlID0gdGhpcy5lbnJpY2hSZXNwb25zZShyZXNwb25zZSwgaW5wdXQpO1xuICAgICAgcmV0dXJuIHJlc3BvbnNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgcmVzcG9uc2UgPSB0aGlzLm1ha2VSZXNwb25zZShcbiAgICAgICAge30gYXMgVFJlc3BvbnNlRGF0YSxcbiAgICAgICAgaW5wdXQsXG4gICAgICAgIGVycm9yIGFzIEVycm9yXG4gICAgICApO1xuICAgICAgcmVzcG9uc2UgPSB0aGlzLmVucmljaFJlc3BvbnNlKHJlc3BvbnNlLCBpbnB1dCk7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGhhbmRsZVN0YXR1c1VwZGF0ZShcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICk6IFByb21pc2U8dm9pZD4ge31cblxuICBwcm90ZWN0ZWQgZW5yaWNoUmVzcG9uc2UoXG4gICAgcmVzcG9uc2U6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPixcbiAgICBvcmlnaW5hbFJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+IHtcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9uIGRvZXMgbm90aGluZ1xuICAgIC8vIENvbmNyZXRlIGNsYXNzZXMgY2FuIG92ZXJyaWRlIHRoaXMgbWV0aG9kIHRvIGFkZCBjdXN0b20gZW5yaWNobWVudFxuICAgIC8vIEZJWE1FOiBGb3Igbm93LCBsb2dnaW5nIHdpdGhpbiB0aGlzIG1ldGhvZCBjYXVzZXMgaW5maW5pdGUgbG9vcC5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgZW5yaWNoUmVxdWVzdChoZWFkZXI6IElSZXF1ZXN0SGVhZGVyLCBib2R5OiBhbnkpOiBJUmVxdWVzdEhlYWRlciB7XG4gICAgLy8gRGVmYXVsdCBpbXBsZW1lbnRhdGlvbjogcmV0dXJuIHRoZSBoZWFkZXIgdW5jaGFuZ2VkXG4gICAgcmV0dXJuIGhlYWRlcjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlSW5jb21pbmdNZXNzYWdlKFxuICAgIHBheWxvYWQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyByaWdodCBub3cgd2UgZG9uJ3Qgd2FpdCB0byBzZWUgaWYgdGhlIGFja25vd2xlZGdlbWVudCBzdWNjZWVkZWQuXG4gICAgLy8gd2UgbWlnaHQgd2FudCB0byBkbyB0aGlzIGluIHRoZSBmdXR1cmUuXG4gICAgYXdhaXQgdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmFjayhwYXlsb2FkKTtcbiAgICB0aGlzLnByb2Nlc3NJbmNvbWluZ01lc3NhZ2UocGF5bG9hZCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NJbmNvbWluZ01lc3NhZ2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmlzUmVzcG9uc2UocGF5bG9hZCkpIHtcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlUmVzcG9uc2UocGF5bG9hZCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChcbiAgICAgICAgcGF5bG9hZC5oZWFkZXIucmVxdWVzdFR5cGUgPT09IFwiTWljcm9zZXJ2aWNlRnJhbWV3b3JrOjpTdGF0dXNVcGRhdGVcIlxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IHBheWxvYWQuaGVhZGVyLnJlcXVlc3RJZDtcbiAgICAgICAgY29uc3Qgc3RhdHVzID0gcGF5bG9hZC5ib2R5IGFzIFN0YXR1c1VwZGF0ZTtcbiAgICAgICAgY29uc3QgY2FsbGJhY2tPYmplY3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQocmVxdWVzdElkKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrT2JqZWN0KSB7XG4gICAgICAgICAgY29uc3QgeyBjYWxsYmFjaywgdGltZW91dENhbGxiYWNrLCB0aW1lT3V0SWQsIGhhbmRsZVN0YXR1c1VwZGF0ZSB9ID1cbiAgICAgICAgICAgIGNhbGxiYWNrT2JqZWN0O1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lT3V0SWQpO1xuICAgICAgICAgIGNvbnN0IG5ld1RpbWVPdXQgPSBzZXRUaW1lb3V0KFxuICAgICAgICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgICAgICAgICAgdGhpcy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0XG4gICAgICAgICAgKTtcbiAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5zZXQocmVxdWVzdElkLCB7XG4gICAgICAgICAgICBjYWxsYmFjayxcbiAgICAgICAgICAgIHRpbWVvdXRDYWxsYmFjayxcbiAgICAgICAgICAgIHRpbWVPdXRJZDogbmV3VGltZU91dCxcbiAgICAgICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZSxcbiAgICAgICAgICB9KTtcbiAgICAgICAgICBhd2FpdCBoYW5kbGVTdGF0dXNVcGRhdGUocGF5bG9hZCwgc3RhdHVzKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHRoaXMuc2NoZWR1bGVOZXdNZXNzYWdlKHBheWxvYWQgYXMgSVJlcXVlc3Q8VFJlcXVlc3RCb2R5Pik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Jlc3BvbnNlKFxuICAgIHBheWxvYWQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBwYXlsb2FkIGlzIElSZXNwb25zZTxhbnk+IHtcbiAgICByZXR1cm4gXCJyZXNwb25zZUhlYWRlclwiIGluIHBheWxvYWQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZVJlc3BvbnNlKHJlc3BvbnNlOiBJUmVzcG9uc2U8YW55Pikge1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdElkO1xuICAgIGNvbnN0IGNhbGxiYWNrT2JqZWN0ID0gdGhpcy5wZW5kaW5nUmVxdWVzdHMuZ2V0KHJlcXVlc3RJZCk7XG4gICAgaWYgKGNhbGxiYWNrT2JqZWN0KSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjYWxsYmFja09iamVjdC5jYWxsYmFjayhyZXNwb25zZSk7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHRoaXMuZXJyb3IoYEVycm9yIGV4ZWN1dGluZyBjYWxsYmFjayBmb3IgcmVxdWVzdCAke3JlcXVlc3RJZH1gLCBlcnJvcik7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBSZWNlaXZlZCByZXNwb25zZSBmb3IgdW5rbm93biByZXF1ZXN0OiAke3JlcXVlc3RJZH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlTmV3TWVzc2FnZShtZXNzYWdlOiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+KSB7XG4gICAgdGhpcy5zY2hlZHVsZVRhc2soXG4gICAgICBhc3luYyAoaW5wdXQpID0+IGF3YWl0IHRoaXMud3JhcEFuZFByb2Nlc3NSZXF1ZXN0KGlucHV0KSxcbiAgICAgIG1lc3NhZ2VcbiAgICApO1xuICB9XG5cbiAgQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnN0YXJ0RGVwZW5kZW5jaWVzKCk7XG4gICAgdGhpcy5ydW5uaW5nID0gdHJ1ZTtcbiAgfVxuXG4gIEBMb2dnYWJsZS5oYW5kbGVFcnJvcnNcbiAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmxvYmJ5LnNlbmQoXG4gICAgICBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVxdWVzdChcbiAgICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgICBcIkNIRUNLT1VUXCIsXG4gICAgICAgIHRoaXMuZ2V0U2VydmVyU3RhdHVzKClcbiAgICAgIClcbiAgICApO1xuICAgIHRoaXMuaW5mbyhgU2VydmljZSAke3RoaXMuc2VydmljZUlkfSBbJHt0aGlzLmluc3RhbmNlSWR9XSBjaGVja2VkIG91dGApO1xuICAgIGF3YWl0IHRoaXMuc3RvcERlcGVuZGVuY2llcygpO1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIudW5yZWdpc3Rlck5vZGUoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZFxuICAgICk7XG5cbiAgICB0aGlzLnJ1bm5pbmcgPSBmYWxzZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0FuZE5vdGlmeShcbiAgICBvdXRwdXQ6IFRhc2tPdXRwdXQ8SVJlc3BvbnNlPFRSZXNwb25zZURhdGE+PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAvLyBGSVhNRTogRE8gTk9UIExPRyBXSVRISU4gVEhJUyBNRVRIT0QsIGl0IGNhdXNlcyBpbmZpbml0ZSBsb29wIVxuICAgIGlmIChvdXRwdXQucmVzdWx0KSB7XG4gICAgICBpZiAob3V0cHV0LnJlc3VsdC5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3MpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kTm90aWZpY2F0aW9uKG91dHB1dC5yZXN1bHQpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VuZE5vdGlmaWNhdGlvbihcbiAgICByZXNwb25zZTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlY2lwaWVudElkID0gcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzO1xuICAgIGlmIChyZWNpcGllbnRJZCkge1xuICAgICAgY29uc3QgcGVlciA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChyZWNpcGllbnRJZCk7XG4gICAgICBwZWVyLnNlbmQocmVzcG9uc2UpO1xuICAgICAgLy8gVE9ETzogdmFsaWRhdGUgaWYgcGVlciBleGlzdHMgYmVmb3JlIHNlbmRpbmcgbWVzc2FnZVxuICAgICAgLy8gVGhyb3cgaWYgcGVlciBub3QgZm91bmQuXG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHNlbmRTdGF0dXNVcGRhdGUoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PixcbiAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNlbmRPbmVXYXlNZXNzYWdlKFxuICAgICAgXCJNaWNyb3NlcnZpY2VGcmFtZXdvcms6OlN0YXR1c1VwZGF0ZVwiLFxuICAgICAgcmVxdWVzdC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RJZFxuICAgICk7XG4gIH1cblxuICBwcm90ZWN0ZWQgbWFrZVJlc3BvbnNlKFxuICAgIGRhdGE6IFRSZXNwb25zZURhdGEsXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PixcbiAgICBlcnJvcjogRXJyb3IgfCBudWxsXG4gICk6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSB7XG4gICAgICByZXF1ZXN0SGVhZGVyOiByZXF1ZXN0LmhlYWRlcixcbiAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgcmVzcG9uZGVyQWRkcmVzczogdGhpcy5hZGRyZXNzLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgc3VjY2VzczogZXJyb3IgPT09IG51bGwsXG4gICAgICAgIGVycm9yLFxuICAgICAgfSxcbiAgICB9O1xuXG4gICAgaWYgKFxuICAgICAgcmVxdWVzdC5oZWFkZXIucmVjaXBpZW50QWRkcmVzcyAmJlxuICAgICAgKCFkYXRhIHx8ICh0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiBPYmplY3Qua2V5cyhkYXRhKS5sZW5ndGggPT09IDApKSAmJlxuICAgICAgIWVycm9yXG4gICAgKSB7XG4gICAgICB0aGlzLmVycm9yKFxuICAgICAgICBgQXR0ZW1wdGluZyB0byBzZW5kIGVtcHR5IGRhdGEgZm9yICR7XG4gICAgICAgICAgcmVxdWVzdC5oZWFkZXIucmVxdWVzdFR5cGVcbiAgICAgICAgfS4gRGF0YTogJHtKU09OLnN0cmluZ2lmeShkYXRhKX1gLFxuICAgICAgICB7IHJlcXVlc3QsIGVycm9yIH1cbiAgICAgICk7XG4gICAgICBlcnJvciA9IG5ldyBFcnJvcihcIkVtcHR5IHJlc3BvbnNlIGRhdGFcIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHNlbmRPbmVXYXlNZXNzYWdlKFxuICAgIG1lc3NhZ2VUeXBlOiBzdHJpbmcsXG4gICAgdG86IHN0cmluZyxcbiAgICBib2R5OiBhbnksXG4gICAgcmVxdWVzdElkPzogc3RyaW5nXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJlcXVlc3RJZCA9IHJlcXVlc3RJZCB8fCB0aGlzLmdlbmVyYXRlUmVxdWVzdElkKCk7XG5cbiAgICBsZXQgcGVlckFkZHJlc3MgPSBcIlwiO1xuICAgIGlmICh0by5zdGFydHNXaXRoKGAke3RoaXMubmFtZXNwYWNlfTpgKSkge1xuICAgICAgcGVlckFkZHJlc3MgPSB0bztcbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3Qgbm9kZUlkID0gYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci5nZXRMZWFzdExvYWRlZE5vZGUodG8pO1xuICAgICAgaWYgKCFub2RlSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IExvZ2dhYmxlRXJyb3IoYE5vIG5vZGVzIGF2YWlsYWJsZSBmb3Igc2VydmljZSAke3RvfS5gKTtcbiAgICAgIH1cbiAgICAgIHBlZXJBZGRyZXNzID0gYCR7dGhpcy5uYW1lc3BhY2V9OiR7dG99OiR7bm9kZUlkfWA7XG4gICAgfVxuXG4gICAgY29uc3QgcGVlciA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChwZWVyQWRkcmVzcyk7XG5cbiAgICBsZXQgaGVhZGVyOiBJUmVxdWVzdEhlYWRlciA9IHtcbiAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgIHJlcXVlc3RJZCxcbiAgICAgIHJlcXVlc3RlckFkZHJlc3M6IHRoaXMuc2VydmljZUlkLFxuICAgICAgcmVxdWVzdFR5cGU6IG1lc3NhZ2VUeXBlLFxuICAgICAgLy8gTm90ZTogcmVjaXBpZW50QWRkcmVzcyBpcyBpbnRlbnRpb25hbGx5IG9taXR0ZWRcbiAgICB9O1xuXG4gICAgaGVhZGVyID0gdGhpcy5lbnJpY2hSZXF1ZXN0KGhlYWRlciwgYm9keSk7XG5cbiAgICBjb25zdCBtZXNzYWdlOiBJUmVxdWVzdDxhbnk+ID0ge1xuICAgICAgaGVhZGVyLFxuICAgICAgYm9keSxcbiAgICB9O1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHBlZXIuc2VuZChtZXNzYWdlKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5lcnJvcihgRmFpbGVkIHRvIHNlbmQgb25lLXdheSBtZXNzYWdlIHRvICR7dG99YCwge1xuICAgICAgICBlcnJvcixcbiAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICBtZXNzYWdlVHlwZSxcbiAgICAgIH0pO1xuICAgICAgdGhyb3cgbmV3IExvZ2dhYmxlRXJyb3IoYEZhaWxlZCB0byBzZW5kIG9uZS13YXkgbWVzc2FnZSB0byAke3RvfWAsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgbWFrZVJlcXVlc3Q8VD4ocHJvcHM6IFJlcXVlc3RQcm9wcyk6IFByb21pc2U8SVJlc3BvbnNlPFQ+PiB7XG4gICAgY29uc3Qge1xuICAgICAgdG8sXG4gICAgICByZXF1ZXN0VHlwZSxcbiAgICAgIGJvZHksXG4gICAgICByZXBseVRvLFxuICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlLFxuICAgICAgaGVhZGVycyxcbiAgICAgIHRpbWVvdXQsXG4gICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgfSA9IHByb3BzO1xuICAgIHJldHVybiBuZXcgUHJvbWlzZShhc3luYyAocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCByZXF1ZXN0SWQgPSBoZWFkZXJzPy5yZXF1ZXN0SWQgfHwgdGhpcy5nZW5lcmF0ZVJlcXVlc3RJZCgpO1xuXG4gICAgICBsZXQgcGVlckFkZHJlc3MgPSBcIlwiO1xuICAgICAgaWYgKHRvLnN0YXJ0c1dpdGgoYCR7dGhpcy5uYW1lc3BhY2V9OmApKSB7XG4gICAgICAgIHBlZXJBZGRyZXNzID0gdG87XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBub2RlSWQgPSBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLmdldExlYXN0TG9hZGVkTm9kZShcbiAgICAgICAgICB0b1xuICAgICAgICApO1xuICAgICAgICBpZiAoIW5vZGVJZCkge1xuICAgICAgICAgIHJlamVjdChuZXcgTG9nZ2FibGVFcnJvcihgTm8gbm9kZXMgYXZhaWxhYmxlIGZvciBzZXJ2aWNlICR7dG99LmApKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgcGVlckFkZHJlc3MgPSBgJHt0aGlzLm5hbWVzcGFjZX06JHt0b306JHtub2RlSWR9YDtcbiAgICAgIH1cblxuICAgICAgbGV0IGhlYWRlcjogSVJlcXVlc3RIZWFkZXIgPSB7XG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICByZXF1ZXN0ZXJBZGRyZXNzOiBoZWFkZXJzPy5yZXF1ZXN0ZXJBZGRyZXNzIHx8IHRoaXMuYWRkcmVzcyxcbiAgICAgICAgcmVjaXBpZW50QWRkcmVzczogcmVwbHlUbyB8fCB0aGlzLmFkZHJlc3MsXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgfTtcblxuICAgICAgaGVhZGVyID0gdGhpcy5lbnJpY2hSZXF1ZXN0KGhlYWRlciwgYm9keSk7XG5cbiAgICAgIGNvbnN0IHJlcXVlc3Q6IElSZXF1ZXN0PGFueT4gPSB7XG4gICAgICAgIGhlYWRlcixcbiAgICAgICAgYm9keSxcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IGNhbGxiYWNrOiBDYWxsYmFja0Z1bmN0aW9uPFQ+ID0gYXN5bmMgKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgaWYgKHJlc3BvbnNlLmJvZHkuc3VjY2Vzcykge1xuICAgICAgICAgICAgcmVzb2x2ZShyZXNwb25zZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuZXJyb3IoYFJlcXVlc3QgdG8gJHt0b30gZmFpbGVkYCwge1xuICAgICAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgICAgIGVycm9yOiByZXNwb25zZS5ib2R5LmVycm9yLFxuICAgICAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgICAgICAgdG8sXG4gICAgICAgICAgICAgIHJlcGx5VG8sXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoYFJlcXVlc3QgdG8gJHt0b30gZmFpbGVkYCwge1xuICAgICAgICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICAgICAgICAgcmVzcG9uc2UsXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBjYXRjaCAoZXJyb3I6IGFueSkge1xuICAgICAgICAgIHRoaXMuZXJyb3IoYEVycm9yIGluIGNhbGxiYWNrIGZvciByZXF1ZXN0ICR7cmVxdWVzdElkfWAsIGVycm9yKTtcbiAgICAgICAgICByZWplY3QoXG4gICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihgRXJyb3IgcHJvY2Vzc2luZyByZXNwb25zZSBmcm9tICR7dG99YCwgZXJyb3IpXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgdGltZW91dE1zID0gdGltZW91dCB8fCB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQ7XG4gICAgICBjb25zdCB0aW1lb3V0Q2IgPVxuICAgICAgICB0aW1lb3V0Q2FsbGJhY2sgfHxcbiAgICAgICAgKCgpID0+IHtcbiAgICAgICAgICBpZiAodGhpcy5wZW5kaW5nUmVxdWVzdHMuaGFzKHJlcXVlc3RJZCkpIHtcbiAgICAgICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgICAgICAgdGhpcy53YXJuKGBSZXF1ZXN0IHRvICR7dG99IHRpbWVkIG91dGAsIHtcbiAgICAgICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgICAgICB0aW1lb3V0TXMsXG4gICAgICAgICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZWplY3QoXG4gICAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKFxuICAgICAgICAgICAgICAgIGBSZXF1ZXN0IHRvICR7dG99IHRpbWVkIG91dCBhZnRlciAke3RpbWVvdXRNc31tc2BcbiAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgY29uc3QgdGltZU91dElkID0gc2V0VGltZW91dCh0aW1lb3V0Q2IsIHRpbWVvdXRNcyk7XG4gICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5zZXQocmVxdWVzdElkLCB7XG4gICAgICAgIGNhbGxiYWNrLFxuICAgICAgICB0aW1lb3V0Q2FsbGJhY2s6IHRpbWVvdXRDYixcbiAgICAgICAgdGltZU91dElkLFxuICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGU6XG4gICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlIHx8IHRoaXMuaGFuZGxlU3RhdHVzVXBkYXRlLmJpbmQodGhpcyksXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHBlZXIgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwocGVlckFkZHJlc3MpO1xuICAgICAgY29uc3Qgc2VuZE1ldGhvZCA9XG4gICAgICAgIHRvID09IHRoaXMuc2VydmljZUlkXG4gICAgICAgICAgPyB0aGlzLnByb2Nlc3NJbmNvbWluZ01lc3NhZ2UuYmluZCh0aGlzKVxuICAgICAgICAgIDogcGVlci5zZW5kO1xuICAgICAgc2VuZE1ldGhvZChyZXF1ZXN0KS5jYXRjaCgoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgICAgdGhpcy5lcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIHtcbiAgICAgICAgICBlcnJvcixcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgIH0pO1xuICAgICAgICByZWplY3QobmV3IExvZ2dhYmxlRXJyb3IoYEZhaWxlZCB0byBzZW5kIHJlcXVlc3QgdG8gJHt0b31gLCBlcnJvcikpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdlbmVyYXRlUmVxdWVzdElkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke3RoaXMuc2VydmljZUlkfS0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKVxuICAgICAgLnRvU3RyaW5nKDM2KVxuICAgICAgLnN1YnN0cigyLCA5KX1gO1xuICB9XG59XG4iXX0=