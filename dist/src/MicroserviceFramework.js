"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Loggable = exports.PubSubConsumer = exports.ServerRunner = exports.MicroserviceFramework = void 0;
exports.RequestHandler = RequestHandler;
const RateLimitedTaskScheduler_1 = require("./RateLimitedTaskScheduler");
const Loggable_1 = require("./utils/logging/Loggable");
Object.defineProperty(exports, "Loggable", { enumerable: true, get: function () { return Loggable_1.Loggable; } });
const ServiceDiscoveryManager_1 = require("./ServiceDiscoveryManager");
require("reflect-metadata");
const uuid_1 = require("uuid");
const LogStrategy_1 = require("./utils/logging/LogStrategy");
const ServerRunner_1 = require("./ServerRunner");
Object.defineProperty(exports, "ServerRunner", { enumerable: true, get: function () { return ServerRunner_1.ServerRunner; } });
const PubSubConsumer_1 = require("./PubSubConsumer");
Object.defineProperty(exports, "PubSubConsumer", { enumerable: true, get: function () { return PubSubConsumer_1.PubSubConsumer; } });
// Define a symbol for our metadata key
const REQUEST_HANDLER_METADATA_KEY = Symbol("requestHandler");
// Helper function to determine if the handler accepts full request
function isFullRequestHandler() {
    return {};
}
// Create the decorator
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
class MicroserviceFramework extends RateLimitedTaskScheduler_1.RateLimitedTaskScheduler {
    constructor(backend, config) {
        super(config.concurrencyLimit, config.requestsPerInterval, config.tpsInterval);
        this.isExecuting = false;
        this.statusUpdateInterval = 120000;
        this.requestCallbackTimeout = 30000;
        this.statusUpdateTimeoutId = null;
        this.pendingRequests = new Map();
        this.namespace = config.namespace;
        this.serverConfig = config;
        this.backend = backend;
        this.serviceId = config.serviceId;
        this.address = `${this.namespace}:${this.serviceId}:${this.instanceId}`;
        this.requestCallbackTimeout =
            config.requestCallbackTimeout || this.requestCallbackTimeout;
        this.requestHandlers = getRequestHandlers(this.constructor);
        this.serviceDiscoveryManager = new ServiceDiscoveryManager_1.ServiceDiscoveryManager(this.backend.serviceRegistry);
        this.initialize();
    }
    async initialize() {
        this.serviceChannel = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:${this.serviceId}`, this.handleServiceMessages.bind(this));
        this.broadcastChannel = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:${this.serviceId}:broadcast`);
        this.lobby = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:lobby`, this.handleLobbyMessages.bind(this));
        const logChannel = this.backend.pubSubConsumer.bindChannel(`${this.namespace}:${this.serviceId}:logs`);
        const microserivceLogStrategy = new MicroserviceLogStrategy(logChannel);
        Loggable_1.Loggable.setLogStrategy(microserivceLogStrategy);
        this.info("Log Strategy set to MicroserviceLogStrategy");
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
    async startDependencies() { }
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
        if (message.payload.header.requestType === "CHECKIN") {
            this.info(`Received CHECKIN from ${message.payload.header.requesterAddress}`);
        }
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
            throw new Error(`No handler found for request type: ${requestType}`);
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
    async handleIncomingMessage(message) {
        const payload = message.payload;
        // right now we don't wait to see if the acknowledgement succeeded.
        // we might want to do this in the future.
        await this.backend.pubSubConsumer.ack(message);
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
            this.scheduleNewMessage(message);
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
        this.scheduleTask(async (input) => await this.wrapAndProcessRequest(input), message.payload);
    }
    async start() {
        await this.startDependencies();
    }
    async stop() {
        await this.stopDependencies();
        await this.serviceDiscoveryManager.unregisterNode(this.serviceId, this.instanceId);
        await this.lobby.send(MicroserviceFramework.createRequest(this.address, "CHECKOUT", this.getServerStatus()));
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
                throw new Loggable_1.LoggableError(`No nodes available for service ${to}.`);
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
            throw new Loggable_1.LoggableError(`Failed to send one-way message to ${to}`, error);
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
                    reject(new Loggable_1.LoggableError(`No nodes available for service ${to}.`));
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
                        reject(new Loggable_1.LoggableError(`Request to ${to} failed`, {
                            request,
                            response,
                        }));
                    }
                }
                catch (error) {
                    this.error(`Error in callback for request ${requestId}`, error);
                    reject(new Loggable_1.LoggableError(`Error processing response from ${to}`, error));
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
                        reject(new Loggable_1.LoggableError(`Request to ${to} timed out after ${timeoutMs}ms`));
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
            peer.send(request).catch((error) => {
                this.pendingRequests.delete(requestId);
                this.error(`Failed to send request to ${to}`, {
                    error,
                    requestId,
                    requestType,
                });
                reject(new Loggable_1.LoggableError(`Failed to send request to ${to}`, error));
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
    Loggable_1.Loggable.handleErrors,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MicroserviceFramework.prototype, "start", null);
__decorate([
    Loggable_1.Loggable.handleErrors,
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], MicroserviceFramework.prototype, "stop", null);
__exportStar(require("./interfaces"), exports);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQXFDQSx3Q0FlQztBQW5ERCx5RUFHb0M7QUFDcEMsdURBQStFO0FBb3NCN0UseUZBcHNCTyxtQkFBUSxPQW9zQlA7QUFuc0JWLHVFQUFvRTtBQUVwRSw0QkFBMEI7QUFDMUIsK0JBQW9DO0FBQ3BDLDZEQUEwRDtBQUMxRCxpREFBOEM7QUEwckI1Qyw2RkExckJPLDJCQUFZLE9BMHJCUDtBQXpyQmQscURBSTBCO0FBc3JCeEIsK0ZBenJCQSwrQkFBYyxPQXlyQkE7QUFwckJoQix1Q0FBdUM7QUFDdkMsTUFBTSw0QkFBNEIsR0FBRyxNQUFNLENBQUMsZ0JBQWdCLENBQUMsQ0FBQztBQVk5RCxtRUFBbUU7QUFDbkUsU0FBUyxvQkFBb0I7SUFDM0IsT0FBTyxFQUFpQyxDQUFDO0FBQzNDLENBQUM7QUFFRCx1QkFBdUI7QUFDdkIsU0FBZ0IsY0FBYyxDQUFJLFdBQW1CO0lBQ25ELE9BQU8sVUFDTCxNQUFXLEVBQ1gsV0FBbUIsRUFDbkIsVUFBc0M7UUFFdEMsTUFBTSxrQkFBa0IsR0FBRyxvQkFBb0IsRUFBSyxDQUFDO1FBQ3JELE1BQU0sT0FBTyxHQUFHLFVBQVUsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLElBQUksS0FBSyxlQUFlLENBQUM7UUFDdkUsT0FBTyxDQUFDLGNBQWMsQ0FDcEIsNEJBQTRCLEVBQzVCLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxXQUFXLEVBQUUsa0JBQWtCLEVBQUUsT0FBTyxFQUFFLEVBQ2pFLE1BQU0sRUFDTixXQUFXLENBQ1osQ0FBQztJQUNKLENBQUMsQ0FBQztBQUNKLENBQUM7QUFFRCx1RUFBdUU7QUFDdkUsU0FBUyxrQkFBa0IsQ0FBQyxNQUFXO0lBQ3JDLE1BQU0sUUFBUSxH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QVM7Z0JBQ1Qsa0JBQWtCLEVBQ2hCLGtCQUFrQixJQUFJLElBQUksQ0FBQyxrQkFBa0IsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO2FBQzNELENBQUMsQ0FBQztZQUNILE1BQU0sSUFBSSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsY0FBYyxDQUFDLFdBQVcsQ0FBQyxXQUFXLENBQUMsQ0FBQztZQUVsRSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLEtBQVUsRUFBRSxFQUFFO2dCQUN0QyxJQUFJLENBQUMsZUFBZSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQztnQkFDdkMsSUFBSSxDQUFDLEtBQUssQ0FBQyw2QkFBNkIsRUFBRSxFQUFFLEVBQUU7b0JBQzVDLEtBQUs7b0JBQ0wsU0FBUztvQkFDVCxXQUFXO2lCQUNaLENBQUMsQ0FBQztnQkFDSCxNQUFNLENBQUMsSUFBSSx3QkFBYSxDQUFDLDZCQUE2QixFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQ3RFLENBQUMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU8saUJBQWlCO1FBQ3ZCLE9BQU8sR0FBRyxJQUFJLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFO2FBQ3BELFFBQVEsQ0FBQyxFQUFFLENBQUM7YUFDWixNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUM7SUFDcEIsQ0FBQztDQUNGO0FBdGpCRCxzREFzakJDO0FBN1BPO0lBREwsbUJBQVEsQ0FBQyxZQUFZOzs7O2tEQUdyQjtBQUdLO0lBREwsbUJBQVEsQ0FBQyxZQUFZOzs7O2lEQWNyQjtBQW9QSCwrQ0FBNkIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBJTWVzc2FnZSwgSUJhY2tFbmQsIENoYW5uZWxCaW5kaW5nIH0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHtcbiAgUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyLFxuICBUYXNrT3V0cHV0LFxufSBmcm9tIFwiLi9SYXRlTGltaXRlZFRhc2tTY2hlZHVsZXJcIjtcbmltcG9ydCB7IExvZ2dhYmxlLCBMb2dnYWJsZUVycm9yLCBMb2dNZXNzYWdlIH0gZnJvbSBcIi4vdXRpbHMvbG9nZ2luZy9Mb2dnYWJsZVwiO1xuaW1wb3J0IHsgU2VydmljZURpc2NvdmVyeU1hbmFnZXIgfSBmcm9tIFwiLi9TZXJ2aWNlRGlzY292ZXJ5TWFuYWdlclwiO1xuaW1wb3J0IHsgSVJlcXVlc3QsIElSZXNwb25zZSwgSVJlcXVlc3RIZWFkZXIgfSBmcm9tIFwiLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgXCJyZWZsZWN0LW1ldGFkYXRhXCI7XG5pbXBvcnQgeyB2NCBhcyB1dWlkdjQgfSBmcm9tIFwidXVpZFwiO1xuaW1wb3J0IHsgTG9nU3RyYXRlZ3kgfSBmcm9tIFwiLi91dGlscy9sb2dnaW5nL0xvZ1N0cmF0ZWd5XCI7XG5pbXBvcnQgeyBTZXJ2ZXJSdW5uZXIgfSBmcm9tIFwiLi9TZXJ2ZXJSdW5uZXJcIjtcbmltcG9ydCB7XG4gIFB1YlN1YkNvbnN1bWVyLFxuICBQdWJTdWJDb25zdW1lck9wdGlvbnMsXG4gIE1lc3NhZ2VIYW5kbGVyLFxufSBmcm9tIFwiLi9QdWJTdWJDb25zdW1lclwiO1xuXG4vLyBEZWZpbmUgYSBzeW1ib2wgZm9yIG91ciBtZXRhZGF0YSBrZXlcbmNvbnN0IFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVkgPSBTeW1ib2woXCJyZXF1ZXN0SGFuZGxlclwiKTtcblxuLy8gRGVmaW5lIGFuIGludGVyZmFjZSBmb3IgdGhlIG1ldGFkYXRhIHdlJ2xsIHN0b3JlXG5pbnRlcmZhY2UgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YSB7XG4gIHJlcXVlc3RUeXBlOiBzdHJpbmc7XG4gIG1ldGhvZDogc3RyaW5nO1xuICBhY2NlcHRzRnVsbFJlcXVlc3Q6IGJvb2xlYW47XG4gIGlzQXN5bmM6IGJvb2xlYW47XG59XG5cbnR5cGUgSXNGdWxsUmVxdWVzdDxUPiA9IFQgZXh0ZW5kcyBJUmVxdWVzdDxhbnk+ID8gdHJ1ZSA6IGZhbHNlO1xuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGlmIHRoZSBoYW5kbGVyIGFjY2VwdHMgZnVsbCByZXF1ZXN0XG5mdW5jdGlvbiBpc0Z1bGxSZXF1ZXN0SGFuZGxlcjxUPigpOiBib29sZWFuIHtcbiAgcmV0dXJuIHt9IGFzIElzRnVsbFJlcXVlc3Q8VD4gYXMgYm9vbGVhbjtcbn1cblxuLy8gQ3JlYXRlIHRoZSBkZWNvcmF0b3JcbmV4cG9ydCBmdW5jdGlvbiBSZXF1ZXN0SGFuZGxlcjxUPihyZXF1ZXN0VHlwZTogc3RyaW5nKSB7XG4gIHJldHVybiBmdW5jdGlvbiA8TSBleHRlbmRzIChhcmc6IFQpID0+IFByb21pc2U8YW55PiB8IGFueT4oXG4gICAgdGFyZ2V0OiBhbnksXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxNPlxuICApIHtcbiAgICBjb25zdCBhY2NlcHRzRnVsbFJlcXVlc3QgPSBpc0Z1bGxSZXF1ZXN0SGFuZGxlcjxUPigpO1xuICAgIGNvbnN0IGlzQXN5bmMgPSBkZXNjcmlwdG9yLnZhbHVlPy5jb25zdHJ1Y3Rvci5uYW1lID09PSBcIkFzeW5jRnVuY3Rpb25cIjtcbiAgICBSZWZsZWN0LmRlZmluZU1ldGFkYXRhKFxuICAgICAgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSxcbiAgICAgIHsgcmVxdWVzdFR5cGUsIG1ldGhvZDogcHJvcGVydHlLZXksIGFjY2VwdHNGdWxsUmVxdWVzdCwgaXNBc3luYyB9LFxuICAgICAgdGFyZ2V0LFxuICAgICAgcHJvcGVydHlLZXlcbiAgICApO1xuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFsbCBtZXRob2RzIHdpdGggdGhlIFJlcXVlc3RIYW5kbGVyIGRlY29yYXRvclxuZnVuY3Rpb24gZ2V0UmVxdWVzdEhhbmRsZXJzKHRhcmdldDogYW55KTogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT4ge1xuICBjb25zdCBoYW5kbGVycyA9IG5ldyBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhPigpO1xuXG4gIGxldCBjdXJyZW50VGFyZ2V0ID0gdGFyZ2V0LnByb3RvdHlwZTtcbiAgd2hpbGUgKGN1cnJlbnRUYXJnZXQpIHtcbiAgICBmb3IgKGNvbnN0IHByb3BlcnR5TmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhjdXJyZW50VGFyZ2V0KSkge1xuICAgICAgY29uc3QgbWV0YWRhdGE6IFJlcXVlc3RIYW5kbGVyTWV0YWRhdGEgfCB1bmRlZmluZWQgPSBSZWZsZWN0LmdldE1ldGFkYXRhKFxuICAgICAgICBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZLFxuICAgICAgICBjdXJyZW50VGFyZ2V0LFxuICAgICAgICBwcm9wZXJ0eU5hbWVcbiAgICAgICk7XG4gICAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgICAgaGFuZGxlcnMuc2V0KG1ldGFkYXRhLnJlcXVlc3RUeXBlLCBtZXRhZGF0YSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY3VycmVudFRhcmdldCA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50VGFyZ2V0KTtcbiAgfVxuXG4gIHJldHVybiBoYW5kbGVycztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJU2VydmVyQ29uZmlnIHtcbiAgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIGNvbmN1cnJlbmN5TGltaXQ6IG51bWJlcjtcbiAgcmVxdWVzdHNQZXJJbnRlcnZhbDogbnVtYmVyO1xuICB0cHNJbnRlcnZhbDogbnVtYmVyO1xuICBzZXJ2aWNlSWQ6IHN0cmluZztcbiAgcmVxdWVzdENhbGxiYWNrVGltZW91dD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2aWNlU3RhdHVzIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIGluc3RhbmNlSWQ6IHN0cmluZztcbiAgcGVuZGluZ1JlcXVlc3RzOiBudW1iZXI7XG4gIHF1ZXVlU2l6ZTogbnVtYmVyO1xuICBydW5uaW5nVGFza3M6IG51bWJlcjtcbiAgdGltZXN0YW1wOiBudW1iZXI7XG4gIGFkZHJlc3M6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNVcGRhdGUge1xuICBzdGF0dXM6IHN0cmluZztcbiAgcHJvZ3Jlc3M/OiBudW1iZXI7XG4gIG1ldGFkYXRhPzogYW55O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlcXVlc3RQcm9wcyB7XG4gIHJlcXVlc3RUeXBlOiBzdHJpbmc7XG4gIHRvOiBzdHJpbmc7XG4gIGJvZHk6IGFueTtcbiAgcmVwbHlUbz86IHN0cmluZztcbiAgaGFuZGxlU3RhdHVzVXBkYXRlPzogKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB0aW1lb3V0Q2FsbGJhY2s/OiAoKSA9PiB2b2lkO1xuICB0aW1lb3V0PzogbnVtYmVyO1xuICBoZWFkZXJzPzogSVJlcXVlc3RIZWFkZXI7XG4gIGlzQnJvYWRjYXN0PzogYm9vbGVhbjtcbn1cblxudHlwZSBDYWxsYmFja0Z1bmN0aW9uPFQ+ID0gKHJlc3BvbnNlOiBJUmVzcG9uc2U8VD4pID0+IFByb21pc2U8dm9pZD47XG50eXBlIENhbGxiYWNrT2JqZWN0PFQ+ID0ge1xuICBjYWxsYmFjazogQ2FsbGJhY2tGdW5jdGlvbjxUPjtcbiAgdGltZW91dENhbGxiYWNrOiAoKSA9PiB2b2lkO1xuICBoYW5kbGVTdGF0dXNVcGRhdGU6IChcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUPixcbiAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICApID0+IFByb21pc2U8dm9pZD47XG4gIHRpbWVPdXRJZDogTm9kZUpTLlRpbWVvdXQ7XG59O1xuXG5jbGFzcyBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneSBleHRlbmRzIExvZ1N0cmF0ZWd5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBsb2dDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxMb2dNZXNzYWdlPj4pIHtcbiAgICBzdXBlcigpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHNlbmRQYWNrYWdlZChcbiAgICBwYWNrYWdlZE1lc3NhZ2U6IElSZXF1ZXN0PGFueT4sXG4gICAgb3B0aW9ucz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sb2dDaGFubmVsLnNlbmQocGFja2FnZWRNZXNzYWdlKTtcbiAgfVxufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBUUmVxdWVzdEJvZHksXG4gIFRSZXNwb25zZURhdGFcbj4gZXh0ZW5kcyBSYXRlTGltaXRlZFRhc2tTY2hlZHVsZXI8XG4gIElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gIElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuPiB7XG4gIC8vIFJlZmFjdG9yaW5nIFpvbmVcbiAgcmVhZG9ubHkgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIHByaXZhdGUgbG9iYnk6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcml2YXRlIHNlcnZpY2VDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxhbnk+PjtcbiAgcHJvdGVjdGVkIGJyb2FkY2FzdENoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICByZWFkb25seSBhZGRyZXNzOiBzdHJpbmc7XG4gIC8vIEVuZCBvZiByZWZhY3RvcmluZyB6b25lLlxuXG4gIHByb3RlY3RlZCBiYWNrZW5kOiBJQmFja0VuZDtcbiAgcHJvdGVjdGVkIHNlcnZlckNvbmZpZzogSVNlcnZlckNvbmZpZztcbiAgcHJvdGVjdGVkIHNlcnZpY2VJZDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgaXNFeGVjdXRpbmc6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJvdGVjdGVkIHN0YXR1c1VwZGF0ZUludGVydmFsOiBudW1iZXIgPSAxMjAwMDA7XG4gIHByb3RlY3RlZCByZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0OiBudW1iZXIgPSAzMDAwMDtcbiAgcHJpdmF0ZSBzdGF0dXNVcGRhdGVUaW1lb3V0SWQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGVuZGluZ1JlcXVlc3RzOiBNYXA8c3RyaW5nLCBDYWxsYmFja09iamVjdDxhbnk+PiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSByZXF1ZXN0SGFuZGxlcnM6IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+O1xuICByZWFkb25seSBzZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcjogU2VydmljZURpc2NvdmVyeU1hbmFnZXI7XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogSVNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKFxuICAgICAgY29uZmlnLmNvbmN1cnJlbmN5TGltaXQsXG4gICAgICBjb25maWcucmVxdWVzdHNQZXJJbnRlcnZhbCxcbiAgICAgIGNvbmZpZy50cHNJbnRlcnZhbFxuICAgICk7XG4gICAgdGhpcy5uYW1lc3BhY2UgPSBjb25maWcubmFtZXNwYWNlO1xuICAgIHRoaXMuc2VydmVyQ29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuYmFja2VuZCA9IGJhY2tlbmQ7XG4gICAgdGhpcy5zZXJ2aWNlSWQgPSBjb25maWcuc2VydmljZUlkO1xuICAgIHRoaXMuYWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfToke3RoaXMuaW5zdGFuY2VJZH1gO1xuICAgIHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dCA9XG4gICAgICBjb25maWcucmVxdWVzdENhbGxiYWNrVGltZW91dCB8fCB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQ7XG4gICAgdGhpcy5yZXF1ZXN0SGFuZGxlcnMgPSBnZXRSZXF1ZXN0SGFuZGxlcnModGhpcy5jb25zdHJ1Y3Rvcik7XG4gICAgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciA9IG5ldyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcihcbiAgICAgIHRoaXMuYmFja2VuZC5zZXJ2aWNlUmVnaXN0cnlcbiAgICApO1xuICAgIHRoaXMuaW5pdGlhbGl6ZSgpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcbiAgICB0aGlzLnNlcnZpY2VDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9YCxcbiAgICAgIHRoaXMuaGFuZGxlU2VydmljZU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIHRoaXMuYnJvYWRjYXN0Q2hhbm5lbCA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChcbiAgICAgIGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfTpicm9hZGNhc3RgXG4gICAgKTtcbiAgICB0aGlzLmxvYmJ5ID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OmxvYmJ5YCxcbiAgICAgIHRoaXMuaGFuZGxlTG9iYnlNZXNzYWdlcy5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBjb25zdCBsb2dDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmxvZ3NgXG4gICAgKTtcbiAgICBjb25zdCBtaWNyb3Nlcml2Y2VMb2dTdHJhdGVneSA9IG5ldyBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneShsb2dDaGFubmVsKTtcbiAgICBMb2dnYWJsZS5zZXRMb2dTdHJhdGVneShtaWNyb3Nlcml2Y2VMb2dTdHJhdGVneSk7XG4gICAgdGhpcy5pbmZvKFwiTG9nIFN0cmF0ZWd5IHNldCB0byBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneVwiKTtcbiAgICB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICB0aGlzLmhhbmRsZUluY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgdGhpcy5xdWV1ZS5zaXplKClcbiAgICApO1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tJTlwiLFxuICAgICAgICB0aGlzLmdldFNlcnZlclN0YXR1cygpXG4gICAgICApXG4gICAgKTtcbiAgICB0aGlzLm9uVGFza0NvbXBsZXRlKHRoaXMucHJvY2Vzc0FuZE5vdGlmeS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIHRoaXMuaW5mbyhgU2VydmljZSAke3RoaXMuc2VydmljZUlkfSBbJHt0aGlzLmluc3RhbmNlSWR9XSBpbml0aWFsaXplZC5gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlTG9hZExldmVsKCkge1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIudXBkYXRlTm9kZUxvYWQoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHRoaXMucXVldWUuc2l6ZSgpXG4gICAgKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCkge31cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKSB7fVxuXG4gIHN0YXRpYyBjcmVhdGVSZXF1ZXN0PFQ+KFxuICAgIHJlcXVlc3RlckFkZHJlc3M6IHN0cmluZyxcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IFQsXG4gICAgcmVjaXBpZW50QWRkcmVzcz86IHN0cmluZ1xuICApOiBJUmVxdWVzdDxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZDogdXVpZHY0KCksXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgfSxcbiAgICAgIGJvZHksXG4gICAgfTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVSZXNwb25zZTxUPihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgIHJlc3BvbmRlckFkZHJlc3M6IHN0cmluZyxcbiAgICBkYXRhOiBULFxuICAgIHN1Y2Nlc3M6IGJvb2xlYW4gPSB0cnVlLFxuICAgIGVycm9yOiBFcnJvciB8IG51bGwgPSBudWxsXG4gICk6IElSZXNwb25zZTxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgcmVzcG9uZGVyQWRkcmVzcyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldFNlcnZlclN0YXR1cygpOiBTZXJ2aWNlU3RhdHVzIHtcbiAgICBjb25zdCBzdGF0dXMgPSB7XG4gICAgICAuLi50aGlzLnNlcnZlckNvbmZpZyxcbiAgICAgIGluc3RhbmNlSWQ6IHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHBlbmRpbmdSZXF1ZXN0czogdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2l6ZSxcbiAgICAgIHF1ZXVlU2l6ZTogdGhpcy5xdWV1ZS5zaXplKCksXG4gICAgICBydW5uaW5nVGFza3M6IHRoaXMucnVubmluZ1Rhc2tzLFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgYWRkcmVzczogdGhpcy5hZGRyZXNzLFxuICAgIH07XG5cbiAgICByZXR1cm4gc3RhdHVzO1xuICB9XG5cbiAgcHVibGljIGdldHNlcnZpY2VJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLnNlcnZpY2VJZDtcbiAgfVxuXG4gIHB1YmxpYyBnZXRCYWNrZW5kKCk6IElCYWNrRW5kIHtcbiAgICByZXR1cm4gdGhpcy5iYWNrZW5kO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVNlcnZpY2VNZXNzYWdlczxUPihtZXNzYWdlOiBUKSB7fVxuXG4gIHByb3RlY3RlZCBhc3luYyBoYW5kbGVMb2JieU1lc3NhZ2VzKFxuICAgIG1lc3NhZ2U6IElNZXNzYWdlPElSZXF1ZXN0PFNlcnZpY2VTdGF0dXM+PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAobWVzc2FnZS5wYXlsb2FkLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJDSEVDS0lOXCIpIHtcbiAgICAgIHRoaXMuaW5mbyhcbiAgICAgICAgYFJlY2VpdmVkIENIRUNLSU4gZnJvbSAke21lc3NhZ2UucGF5bG9hZC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzc31gXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkKTtcbiAgICB9XG4gICAgdGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMudXBkYXRlTG9hZExldmVsKCk7XG4gICAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIH0sIHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXF1ZXN0VHlwZSA9IGlucHV0LmhlYWRlci5yZXF1ZXN0VHlwZTtcbiAgICBpZiAoIXJlcXVlc3RUeXBlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1ZXN0IHR5cGUgbm90IHNwZWNpZmllZFwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYW5kbGVyTWV0YWRhdGEgPSB0aGlzLnJlcXVlc3RIYW5kbGVycy5nZXQocmVxdWVzdFR5cGUpO1xuICAgIGlmICghaGFuZGxlck1ldGFkYXRhKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGhhbmRsZXIgZm91bmQgZm9yIHJlcXVlc3QgdHlwZTogJHtyZXF1ZXN0VHlwZX1gKTtcbiAgICB9XG5cbiAgICAvLyBDYWxsIHRoZSBoYW5kbGVyIG1ldGhvZFxuICAgIGNvbnN0IGhhbmRsZXJNZXRob2QgPSAodGhpcyBhcyBhbnkpW2hhbmRsZXJNZXRhZGF0YS5tZXRob2RdLmJpbmQodGhpcyk7XG4gICAgY29uc3QgYXJncyA9IGhhbmRsZXJNZXRhZGF0YS5hY2NlcHRzRnVsbFJlcXVlc3QgPyBpbnB1dCA6IGlucHV0LmJvZHk7XG5cbiAgICBjb25zdCBoYW5kbGVyUmVzcG9uc2UgPSBoYW5kbGVyTWV0YWRhdGEuaXNBc3luY1xuICAgICAgPyBhd2FpdCBoYW5kbGVyTWV0aG9kKGFyZ3MpXG4gICAgICA6IGhhbmRsZXJNZXRob2QoYXJncyk7XG5cbiAgICByZXR1cm4gaGFuZGxlclJlc3BvbnNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cmFwQW5kUHJvY2Vzc1JlcXVlc3QoXG4gICAgaW5wdXQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogUHJvbWlzZTxJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzUmVxdWVzdChpbnB1dCk7XG4gICAgICBsZXQgcmVzcG9uc2UgPSB0aGlzLm1ha2VSZXNwb25zZShyZXN1bHQsIGlucHV0LCBudWxsKTtcbiAgICAgIHJlc3BvbnNlID0gdGhpcy5lbnJpY2hSZXNwb25zZShyZXNwb25zZSwgaW5wdXQpO1xuICAgICAgcmV0dXJuIHJlc3BvbnNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgcmVzcG9uc2UgPSB0aGlzLm1ha2VSZXNwb25zZShcbiAgICAgICAge30gYXMgVFJlc3BvbnNlRGF0YSxcbiAgICAgICAgaW5wdXQsXG4gICAgICAgIGVycm9yIGFzIEVycm9yXG4gICAgICApO1xuICAgICAgcmVzcG9uc2UgPSB0aGlzLmVucmljaFJlc3BvbnNlKHJlc3BvbnNlLCBpbnB1dCk7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGhhbmRsZVN0YXR1c1VwZGF0ZShcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICk6IFByb21pc2U8dm9pZD4ge31cblxuICBwcm90ZWN0ZWQgZW5yaWNoUmVzcG9uc2UoXG4gICAgcmVzcG9uc2U6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPixcbiAgICBvcmlnaW5hbFJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+IHtcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9uIGRvZXMgbm90aGluZ1xuICAgIC8vIENvbmNyZXRlIGNsYXNzZXMgY2FuIG92ZXJyaWRlIHRoaXMgbWV0aG9kIHRvIGFkZCBjdXN0b20gZW5yaWNobWVudFxuICAgIC8vIEZJWE1FOiBGb3Igbm93LCBsb2dnaW5nIHdpdGhpbiB0aGlzIG1ldGhvZCBjYXVzZXMgaW5maW5pdGUgbG9vcC5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgZW5yaWNoUmVxdWVzdChoZWFkZXI6IElSZXF1ZXN0SGVhZGVyLCBib2R5OiBhbnkpOiBJUmVxdWVzdEhlYWRlciB7XG4gICAgLy8gRGVmYXVsdCBpbXBsZW1lbnRhdGlvbjogcmV0dXJuIHRoZSBoZWFkZXIgdW5jaGFuZ2VkXG4gICAgcmV0dXJuIGhlYWRlcjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlSW5jb21pbmdNZXNzYWdlKFxuICAgIG1lc3NhZ2U6IElNZXNzYWdlPElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4gfCBJUmVzcG9uc2U8YW55Pj5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcGF5bG9hZCA9IG1lc3NhZ2UucGF5bG9hZDtcblxuICAgIC8vIHJpZ2h0IG5vdyB3ZSBkb24ndCB3YWl0IHRvIHNlZSBpZiB0aGUgYWNrbm93bGVkZ2VtZW50IHN1Y2NlZWRlZC5cbiAgICAvLyB3ZSBtaWdodCB3YW50IHRvIGRvIHRoaXMgaW4gdGhlIGZ1dHVyZS5cbiAgICBhd2FpdCB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYWNrKG1lc3NhZ2UpO1xuXG4gICAgaWYgKHRoaXMuaXNSZXNwb25zZShwYXlsb2FkKSkge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVSZXNwb25zZShwYXlsb2FkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKFxuICAgICAgICBwYXlsb2FkLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJNaWNyb3NlcnZpY2VGcmFtZXdvcms6OlN0YXR1c1VwZGF0ZVwiXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdElkID0gcGF5bG9hZC5oZWFkZXIucmVxdWVzdElkO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBwYXlsb2FkLmJvZHkgYXMgU3RhdHVzVXBkYXRlO1xuICAgICAgICBjb25zdCBjYWxsYmFja09iamVjdCA9IHRoaXMucGVuZGluZ1JlcXVlc3RzLmdldChyZXF1ZXN0SWQpO1xuICAgICAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgICAgICBjb25zdCB7IGNhbGxiYWNrLCB0aW1lb3V0Q2FsbGJhY2ssIHRpbWVPdXRJZCwgaGFuZGxlU3RhdHVzVXBkYXRlIH0gPVxuICAgICAgICAgICAgY2FsbGJhY2tPYmplY3Q7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVPdXRJZCk7XG4gICAgICAgICAgY29uc3QgbmV3VGltZU91dCA9IHNldFRpbWVvdXQoXG4gICAgICAgICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXRcbiAgICAgICAgICApO1xuICAgICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgICAgIGNhbGxiYWNrLFxuICAgICAgICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgICAgICAgICAgdGltZU91dElkOiBuZXdUaW1lT3V0LFxuICAgICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IGhhbmRsZVN0YXR1c1VwZGF0ZShwYXlsb2FkLCBzdGF0dXMpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5zY2hlZHVsZU5ld01lc3NhZ2UobWVzc2FnZSBhcyBJTWVzc2FnZTxJUmVxdWVzdDxUUmVxdWVzdEJvZHk+Pik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Jlc3BvbnNlKFxuICAgIHBheWxvYWQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBwYXlsb2FkIGlzIElSZXNwb25zZTxhbnk+IHtcbiAgICByZXR1cm4gXCJyZXNwb25zZUhlYWRlclwiIGluIHBheWxvYWQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZVJlc3BvbnNlKHJlc3BvbnNlOiBJUmVzcG9uc2U8YW55Pikge1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdElkO1xuICAgIGNvbnN0IGNhbGxiYWNrT2JqZWN0ID0gdGhpcy5wZW5kaW5nUmVxdWVzdHMuZ2V0KHJlcXVlc3RJZCk7XG4gICAgaWYgKGNhbGxiYWNrT2JqZWN0KSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjYWxsYmFja09iamVjdC5jYWxsYmFjayhyZXNwb25zZSk7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHRoaXMuZXJyb3IoYEVycm9yIGV4ZWN1dGluZyBjYWxsYmFjayBmb3IgcmVxdWVzdCAke3JlcXVlc3RJZH1gLCBlcnJvcik7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBSZWNlaXZlZCByZXNwb25zZSBmb3IgdW5rbm93biByZXF1ZXN0OiAke3JlcXVlc3RJZH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlTmV3TWVzc2FnZShtZXNzYWdlOiBJTWVzc2FnZTxJUmVxdWVzdDxUUmVxdWVzdEJvZHk+Pikge1xuICAgIHRoaXMuc2NoZWR1bGVUYXNrKFxuICAgICAgYXN5bmMgKGlucHV0KSA9PiBhd2FpdCB0aGlzLndyYXBBbmRQcm9jZXNzUmVxdWVzdChpbnB1dCksXG4gICAgICBtZXNzYWdlLnBheWxvYWRcbiAgICApO1xuICB9XG5cbiAgQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnN0YXJ0RGVwZW5kZW5jaWVzKCk7XG4gIH1cblxuICBATG9nZ2FibGUuaGFuZGxlRXJyb3JzXG4gIGFzeW5jIHN0b3AoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zdG9wRGVwZW5kZW5jaWVzKCk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci51bnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLmxvYmJ5LnNlbmQoXG4gICAgICBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVxdWVzdChcbiAgICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgICBcIkNIRUNLT1VUXCIsXG4gICAgICAgIHRoaXMuZ2V0U2VydmVyU3RhdHVzKClcbiAgICAgIClcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzQW5kTm90aWZ5KFxuICAgIG91dHB1dDogVGFza091dHB1dDxJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEZJWE1FOiBETyBOT1QgTE9HIFdJVEhJTiBUSElTIE1FVEhPRCwgaXQgY2F1c2VzIGluZmluaXRlIGxvb3AhXG4gICAgaWYgKG91dHB1dC5yZXN1bHQpIHtcbiAgICAgIGlmIChvdXRwdXQucmVzdWx0LnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcykge1xuICAgICAgICBhd2FpdCB0aGlzLnNlbmROb3RpZmljYXRpb24ob3V0cHV0LnJlc3VsdCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kTm90aWZpY2F0aW9uKFxuICAgIHJlc3BvbnNlOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVjaXBpZW50SWQgPSByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3M7XG4gICAgaWYgKHJlY2lwaWVudElkKSB7XG4gICAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHJlY2lwaWVudElkKTtcbiAgICAgIHBlZXIuc2VuZChyZXNwb25zZSk7XG4gICAgICAvLyBUT0RPOiB2YWxpZGF0ZSBpZiBwZWVyIGV4aXN0cyBiZWZvcmUgc2VuZGluZyBtZXNzYWdlXG4gICAgICAvLyBUaHJvdyBpZiBwZWVyIG5vdCBmb3VuZC5cbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFN0YXR1c1VwZGF0ZShcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICBcIk1pY3Jvc2VydmljZUZyYW1ld29yazo6U3RhdHVzVXBkYXRlXCIsXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgc3RhdHVzLFxuICAgICAgcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBtYWtlUmVzcG9uc2UoXG4gICAgZGF0YTogVFJlc3BvbnNlRGF0YSxcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIGVycm9yOiBFcnJvciB8IG51bGxcbiAgKTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXNwb25kZXJBZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgICB9LFxuICAgICAgYm9keToge1xuICAgICAgICBkYXRhLFxuICAgICAgICBzdWNjZXNzOiBlcnJvciA9PT0gbnVsbCxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBpZiAoXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZWNpcGllbnRBZGRyZXNzICYmXG4gICAgICAoIWRhdGEgfHwgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIE9iamVjdC5rZXlzKGRhdGEpLmxlbmd0aCA9PT0gMCkpICYmXG4gICAgICAhZXJyb3JcbiAgICApIHtcbiAgICAgIHRoaXMuZXJyb3IoXG4gICAgICAgIGBBdHRlbXB0aW5nIHRvIHNlbmQgZW1wdHkgZGF0YSBmb3IgJHtcbiAgICAgICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZVxuICAgICAgICB9LiBEYXRhOiAke0pTT04uc3RyaW5naWZ5KGRhdGEpfWAsXG4gICAgICAgIHsgcmVxdWVzdCwgZXJyb3IgfVxuICAgICAgKTtcbiAgICAgIGVycm9yID0gbmV3IEVycm9yKFwiRW1wdHkgcmVzcG9uc2UgZGF0YVwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgbWVzc2FnZVR5cGU6IHN0cmluZyxcbiAgICB0bzogc3RyaW5nLFxuICAgIGJvZHk6IGFueSxcbiAgICByZXF1ZXN0SWQ/OiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmVxdWVzdElkID0gcmVxdWVzdElkIHx8IHRoaXMuZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcblxuICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgaWYgKHRvLnN0YXJ0c1dpdGgoYCR7dGhpcy5uYW1lc3BhY2V9OmApKSB7XG4gICAgICBwZWVyQWRkcmVzcyA9IHRvO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBub2RlSWQgPSBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLmdldExlYXN0TG9hZGVkTm9kZSh0byk7XG4gICAgICBpZiAoIW5vZGVJZCkge1xuICAgICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgTm8gbm9kZXMgYXZhaWxhYmxlIGZvciBzZXJ2aWNlICR7dG99LmApO1xuICAgICAgfVxuICAgICAgcGVlckFkZHJlc3MgPSBgJHt0aGlzLm5hbWVzcGFjZX06JHt0b306JHtub2RlSWR9YDtcbiAgICB9XG5cbiAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHBlZXJBZGRyZXNzKTtcblxuICAgIGxldCBoZWFkZXI6IElSZXF1ZXN0SGVhZGVyID0ge1xuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgcmVxdWVzdElkLFxuICAgICAgcmVxdWVzdGVyQWRkcmVzczogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICByZXF1ZXN0VHlwZTogbWVzc2FnZVR5cGUsXG4gICAgICAvLyBOb3RlOiByZWNpcGllbnRBZGRyZXNzIGlzIGludGVudGlvbmFsbHkgb21pdHRlZFxuICAgIH07XG5cbiAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgIGNvbnN0IG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gPSB7XG4gICAgICBoZWFkZXIsXG4gICAgICBib2R5LFxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVlci5zZW5kKG1lc3NhZ2UpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCBvbmUtd2F5IG1lc3NhZ2UgdG8gJHt0b31gLCB7XG4gICAgICAgIGVycm9yLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIG1lc3NhZ2VUeXBlLFxuICAgICAgfSk7XG4gICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgb25lLXdheSBtZXNzYWdlIHRvICR7dG99YCwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBtYWtlUmVxdWVzdDxUPihwcm9wczogUmVxdWVzdFByb3BzKTogUHJvbWlzZTxJUmVzcG9uc2U8VD4+IHtcbiAgICBjb25zdCB7XG4gICAgICB0byxcbiAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgYm9keSxcbiAgICAgIHJlcGx5VG8sXG4gICAgICBoYW5kbGVTdGF0dXNVcGRhdGUsXG4gICAgICBoZWFkZXJzLFxuICAgICAgdGltZW91dCxcbiAgICAgIHRpbWVvdXRDYWxsYmFjayxcbiAgICB9ID0gcHJvcHM7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IGhlYWRlcnM/LnJlcXVlc3RJZCB8fCB0aGlzLmdlbmVyYXRlUmVxdWVzdElkKCk7XG5cbiAgICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgICBpZiAodG8uc3RhcnRzV2l0aChgJHt0aGlzLm5hbWVzcGFjZX06YCkpIHtcbiAgICAgICAgcGVlckFkZHJlc3MgPSB0bztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIuZ2V0TGVhc3RMb2FkZWROb2RlKFxuICAgICAgICAgIHRvXG4gICAgICAgICk7XG4gICAgICAgIGlmICghbm9kZUlkKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBMb2dnYWJsZUVycm9yKGBObyBub2RlcyBhdmFpbGFibGUgZm9yIHNlcnZpY2UgJHt0b30uYCkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBwZWVyQWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RvfToke25vZGVJZH1gO1xuICAgICAgfVxuXG4gICAgICBsZXQgaGVhZGVyOiBJUmVxdWVzdEhlYWRlciA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3M6IGhlYWRlcnM/LnJlcXVlc3RlckFkZHJlc3MgfHwgdGhpcy5hZGRyZXNzLFxuICAgICAgICByZWNpcGllbnRBZGRyZXNzOiByZXBseVRvIHx8IHRoaXMuYWRkcmVzcyxcbiAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICB9O1xuXG4gICAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgICAgY29uc3QgcmVxdWVzdDogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgICAgaGVhZGVyLFxuICAgICAgICBib2R5LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD4gPSBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAocmVzcG9uc2UuYm9keS5zdWNjZXNzKSB7XG4gICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgZXJyb3I6IHJlc3BvbnNlLmJvZHkuZXJyb3IsXG4gICAgICAgICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICAgICAgICB0byxcbiAgICAgICAgICAgICAgcmVwbHlUbyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgaW4gY2FsbGJhY2sgZm9yIHJlcXVlc3QgJHtyZXF1ZXN0SWR9YCwgZXJyb3IpO1xuICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKGBFcnJvciBwcm9jZXNzaW5nIHJlc3BvbnNlIGZyb20gJHt0b31gLCBlcnJvcilcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0IHx8IHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dDtcbiAgICAgIGNvbnN0IHRpbWVvdXRDYiA9XG4gICAgICAgIHRpbWVvdXRDYWxsYmFjayB8fFxuICAgICAgICAoKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLnBlbmRpbmdSZXF1ZXN0cy5oYXMocmVxdWVzdElkKSkge1xuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgICAgICAgICB0aGlzLndhcm4oYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0YCwge1xuICAgICAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoXG4gICAgICAgICAgICAgICAgYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICBjb25zdCB0aW1lT3V0SWQgPSBzZXRUaW1lb3V0KHRpbWVvdXRDYiwgdGltZW91dE1zKTtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgIHRpbWVvdXRDYWxsYmFjazogdGltZW91dENiLFxuICAgICAgICB0aW1lT3V0SWQsXG4gICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTpcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGUgfHwgdGhpcy5oYW5kbGVTdGF0dXNVcGRhdGUuYmluZCh0aGlzKSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcGVlciA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChwZWVyQWRkcmVzcyk7XG5cbiAgICAgIHBlZXIuc2VuZChyZXF1ZXN0KS5jYXRjaCgoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgICAgdGhpcy5lcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIHtcbiAgICAgICAgICBlcnJvcixcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgIH0pO1xuICAgICAgICByZWplY3QobmV3IExvZ2dhYmxlRXJyb3IoYEZhaWxlZCB0byBzZW5kIHJlcXVlc3QgdG8gJHt0b31gLCBlcnJvcikpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdlbmVyYXRlUmVxdWVzdElkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke3RoaXMuc2VydmljZUlkfS0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKVxuICAgICAgLnRvU3RyaW5nKDM2KVxuICAgICAgLnN1YnN0cigyLCA5KX1gO1xuICB9XG59XG5cbmV4cG9ydCB7XG4gIFNlcnZlclJ1bm5lcixcbiAgUHViU3ViQ29uc3VtZXIsXG4gIFB1YlN1YkNvbnN1bWVyT3B0aW9ucyxcbiAgTWVzc2FnZUhhbmRsZXIsXG4gIExvZ2dhYmxlLFxufTtcbmV4cG9ydCAqIGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbiJdfQ==