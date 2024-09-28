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
exports.ServerRunner = exports.MicroserviceFramework = void 0;
exports.RequestHandler = RequestHandler;
const RateLimitedTaskScheduler_1 = require("./RateLimitedTaskScheduler");
const Loggable_1 = require("./utils/logging/Loggable");
const ServiceDiscoveryManager_1 = require("./ServiceDiscoveryManager");
require("reflect-metadata");
const uuid_1 = require("uuid");
const LogStrategy_1 = require("./utils/logging/LogStrategy");
const ServerRunner_1 = require("./ServerRunner");
Object.defineProperty(exports, "ServerRunner", { enumerable: true, get: function () { return ServerRunner_1.ServerRunner; } });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQWdDQSx3Q0FlQztBQTlDRCx5RUFHb0M7QUFDcEMsdURBQStFO0FBQy9FLHVFQUFvRTtBQUVwRSw0QkFBMEI7QUFDMUIsK0JBQW9DO0FBQ3BDLDZEQUEwRDtBQUMxRCxpREFBOEM7QUFvckJyQyw2RkFwckJBLDJCQUFZLE9Bb3JCQTtBQWxyQnJCLHVDQUF1QztBQUN2QyxNQUFNLDRCQUE0QixHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0FBWTlELG1FQUFtRTtBQUNuRSxTQUFTLG9CQUFvQjtJQUMzQixPQUFPLEVBQWlDLENBQUM7QUFDM0MsQ0FBQztBQUVELHVCQUF1QjtBQUN2QixTQUFnQixjQUFjLENBQUksV0FBbUI7SUFDbkQsT0FBTyxVQUNMLE1BQVcsRUFDWCxXQUFtQixFQUNuQixVQUFzQztRQUV0QyxNQUFNLGtCQUFrQixHQUFHLG9CQUFvQixFQUFLLENBQUM7UUFDckQsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsSUFBSSxLQUFLLGVBQWUsQ0FBQztRQUN2RSxPQUFPLENBQUMsY0FBYyxDQUNwQiw0QkFBNEIsRUFDNUIsRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxrQkFBa0IsRUFBRSxPQUFPLEVBQUUsRUFDakUsTUFBTSxFQUNOLFdBQVcsQ0FDWixDQUFDO0lBQ0osQ0FBQyxDQUFDO0FBQ0osQ0FBQztBQUVELHVFQUF1RTtBQUN2RSxTQUFTLGtCQUFrQixDQUFDLE1BQVc7SUFDckMsTUFBTSxRQUFRLEdBQUcsSUFBSSxHQUFHLEVBQWtDLENBQUM7SUFFM0QsSUFBSSxhQUFhLEdBQUcsTUFBTSxDQUFDLFNBQVMsQ0FBQztJQUNyQyxP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QUM7YUFDM0QsQ0FBQyxDQUFDO1lBQ0gsTUFBTSxJQUFJLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsV0FBVyxDQUFDLFdBQVcsQ0FBQyxDQUFDO1lBRWxFLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsS0FBSyxDQUFDLENBQUMsS0FBVSxFQUFFLEVBQUU7Z0JBQ3RDLElBQUksQ0FBQyxlQUFlLENBQUMsTUFBTSxDQUFDLFNBQVMsQ0FBQyxDQUFDO2dCQUN2QyxJQUFJLENBQUMsS0FBSyxDQUFDLDZCQUE2QixFQUFFLEVBQUUsRUFBRTtvQkFDNUMsS0FBSztvQkFDTCxTQUFTO29CQUNULFdBQVc7aUJBQ1osQ0FBQyxDQUFDO2dCQUNILE1BQU0sQ0FBQyxJQUFJLHdCQUFhLENBQUMsNkJBQTZCLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDLENBQUM7WUFDdEUsQ0FBQyxDQUFDLENBQUM7UUFDTCxDQUFDLENBQUMsQ0FBQztJQUNMLENBQUM7SUFFTyxpQkFBaUI7UUFDdkIsT0FBTyxHQUFHLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUU7YUFDcEQsUUFBUSxDQUFDLEVBQUUsQ0FBQzthQUNaLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUNwQixDQUFDO0NBQ0Y7QUF0akJELHNEQXNqQkM7QUE3UE87SUFETCxtQkFBUSxDQUFDLFlBQVk7Ozs7a0RBR3JCO0FBR0s7SUFETCxtQkFBUSxDQUFDLFlBQVk7Ozs7aURBY3JCO0FBOE9ILCtDQUE2QiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElNZXNzYWdlLCBJQmFja0VuZCwgQ2hhbm5lbEJpbmRpbmcgfSBmcm9tIFwiLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQge1xuICBSYXRlTGltaXRlZFRhc2tTY2hlZHVsZXIsXG4gIFRhc2tPdXRwdXQsXG59IGZyb20gXCIuL1JhdGVMaW1pdGVkVGFza1NjaGVkdWxlclwiO1xuaW1wb3J0IHsgTG9nZ2FibGUsIExvZ2dhYmxlRXJyb3IsIExvZ01lc3NhZ2UgfSBmcm9tIFwiLi91dGlscy9sb2dnaW5nL0xvZ2dhYmxlXCI7XG5pbXBvcnQgeyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciB9IGZyb20gXCIuL1NlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyXCI7XG5pbXBvcnQgeyBJUmVxdWVzdCwgSVJlc3BvbnNlLCBJUmVxdWVzdEhlYWRlciB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCBcInJlZmxlY3QtbWV0YWRhdGFcIjtcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gXCJ1dWlkXCI7XG5pbXBvcnQgeyBMb2dTdHJhdGVneSB9IGZyb20gXCIuL3V0aWxzL2xvZ2dpbmcvTG9nU3RyYXRlZ3lcIjtcbmltcG9ydCB7IFNlcnZlclJ1bm5lciB9IGZyb20gXCIuL1NlcnZlclJ1bm5lclwiO1xuXG4vLyBEZWZpbmUgYSBzeW1ib2wgZm9yIG91ciBtZXRhZGF0YSBrZXlcbmNvbnN0IFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVkgPSBTeW1ib2woXCJyZXF1ZXN0SGFuZGxlclwiKTtcblxuLy8gRGVmaW5lIGFuIGludGVyZmFjZSBmb3IgdGhlIG1ldGFkYXRhIHdlJ2xsIHN0b3JlXG5pbnRlcmZhY2UgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YSB7XG4gIHJlcXVlc3RUeXBlOiBzdHJpbmc7XG4gIG1ldGhvZDogc3RyaW5nO1xuICBhY2NlcHRzRnVsbFJlcXVlc3Q6IGJvb2xlYW47XG4gIGlzQXN5bmM6IGJvb2xlYW47XG59XG5cbnR5cGUgSXNGdWxsUmVxdWVzdDxUPiA9IFQgZXh0ZW5kcyBJUmVxdWVzdDxhbnk+ID8gdHJ1ZSA6IGZhbHNlO1xuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZGV0ZXJtaW5lIGlmIHRoZSBoYW5kbGVyIGFjY2VwdHMgZnVsbCByZXF1ZXN0XG5mdW5jdGlvbiBpc0Z1bGxSZXF1ZXN0SGFuZGxlcjxUPigpOiBib29sZWFuIHtcbiAgcmV0dXJuIHt9IGFzIElzRnVsbFJlcXVlc3Q8VD4gYXMgYm9vbGVhbjtcbn1cblxuLy8gQ3JlYXRlIHRoZSBkZWNvcmF0b3JcbmV4cG9ydCBmdW5jdGlvbiBSZXF1ZXN0SGFuZGxlcjxUPihyZXF1ZXN0VHlwZTogc3RyaW5nKSB7XG4gIHJldHVybiBmdW5jdGlvbiA8TSBleHRlbmRzIChhcmc6IFQpID0+IFByb21pc2U8YW55PiB8IGFueT4oXG4gICAgdGFyZ2V0OiBhbnksXG4gICAgcHJvcGVydHlLZXk6IHN0cmluZyxcbiAgICBkZXNjcmlwdG9yOiBUeXBlZFByb3BlcnR5RGVzY3JpcHRvcjxNPlxuICApIHtcbiAgICBjb25zdCBhY2NlcHRzRnVsbFJlcXVlc3QgPSBpc0Z1bGxSZXF1ZXN0SGFuZGxlcjxUPigpO1xuICAgIGNvbnN0IGlzQXN5bmMgPSBkZXNjcmlwdG9yLnZhbHVlPy5jb25zdHJ1Y3Rvci5uYW1lID09PSBcIkFzeW5jRnVuY3Rpb25cIjtcbiAgICBSZWZsZWN0LmRlZmluZU1ldGFkYXRhKFxuICAgICAgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSxcbiAgICAgIHsgcmVxdWVzdFR5cGUsIG1ldGhvZDogcHJvcGVydHlLZXksIGFjY2VwdHNGdWxsUmVxdWVzdCwgaXNBc3luYyB9LFxuICAgICAgdGFyZ2V0LFxuICAgICAgcHJvcGVydHlLZXlcbiAgICApO1xuICB9O1xufVxuXG4vLyBIZWxwZXIgZnVuY3Rpb24gdG8gZ2V0IGFsbCBtZXRob2RzIHdpdGggdGhlIFJlcXVlc3RIYW5kbGVyIGRlY29yYXRvclxuZnVuY3Rpb24gZ2V0UmVxdWVzdEhhbmRsZXJzKHRhcmdldDogYW55KTogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT4ge1xuICBjb25zdCBoYW5kbGVycyA9IG5ldyBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhPigpO1xuXG4gIGxldCBjdXJyZW50VGFyZ2V0ID0gdGFyZ2V0LnByb3RvdHlwZTtcbiAgd2hpbGUgKGN1cnJlbnRUYXJnZXQpIHtcbiAgICBmb3IgKGNvbnN0IHByb3BlcnR5TmFtZSBvZiBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhjdXJyZW50VGFyZ2V0KSkge1xuICAgICAgY29uc3QgbWV0YWRhdGE6IFJlcXVlc3RIYW5kbGVyTWV0YWRhdGEgfCB1bmRlZmluZWQgPSBSZWZsZWN0LmdldE1ldGFkYXRhKFxuICAgICAgICBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZLFxuICAgICAgICBjdXJyZW50VGFyZ2V0LFxuICAgICAgICBwcm9wZXJ0eU5hbWVcbiAgICAgICk7XG4gICAgICBpZiAobWV0YWRhdGEpIHtcbiAgICAgICAgaGFuZGxlcnMuc2V0KG1ldGFkYXRhLnJlcXVlc3RUeXBlLCBtZXRhZGF0YSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY3VycmVudFRhcmdldCA9IE9iamVjdC5nZXRQcm90b3R5cGVPZihjdXJyZW50VGFyZ2V0KTtcbiAgfVxuXG4gIHJldHVybiBoYW5kbGVycztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBJU2VydmVyQ29uZmlnIHtcbiAgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIGNvbmN1cnJlbmN5TGltaXQ6IG51bWJlcjtcbiAgcmVxdWVzdHNQZXJJbnRlcnZhbDogbnVtYmVyO1xuICB0cHNJbnRlcnZhbDogbnVtYmVyO1xuICBzZXJ2aWNlSWQ6IHN0cmluZztcbiAgcmVxdWVzdENhbGxiYWNrVGltZW91dD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2aWNlU3RhdHVzIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIGluc3RhbmNlSWQ6IHN0cmluZztcbiAgcGVuZGluZ1JlcXVlc3RzOiBudW1iZXI7XG4gIHF1ZXVlU2l6ZTogbnVtYmVyO1xuICBydW5uaW5nVGFza3M6IG51bWJlcjtcbiAgdGltZXN0YW1wOiBudW1iZXI7XG4gIGFkZHJlc3M6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNVcGRhdGUge1xuICBzdGF0dXM6IHN0cmluZztcbiAgcHJvZ3Jlc3M/OiBudW1iZXI7XG4gIG1ldGFkYXRhPzogYW55O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlcXVlc3RQcm9wcyB7XG4gIHJlcXVlc3RUeXBlOiBzdHJpbmc7XG4gIHRvOiBzdHJpbmc7XG4gIGJvZHk6IGFueTtcbiAgcmVwbHlUbz86IHN0cmluZztcbiAgaGFuZGxlU3RhdHVzVXBkYXRlPzogKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB0aW1lb3V0Q2FsbGJhY2s/OiAoKSA9PiB2b2lkO1xuICB0aW1lb3V0PzogbnVtYmVyO1xuICBoZWFkZXJzPzogSVJlcXVlc3RIZWFkZXI7XG4gIGlzQnJvYWRjYXN0PzogYm9vbGVhbjtcbn1cblxudHlwZSBDYWxsYmFja0Z1bmN0aW9uPFQ+ID0gKHJlc3BvbnNlOiBJUmVzcG9uc2U8VD4pID0+IFByb21pc2U8dm9pZD47XG50eXBlIENhbGxiYWNrT2JqZWN0PFQ+ID0ge1xuICBjYWxsYmFjazogQ2FsbGJhY2tGdW5jdGlvbjxUPjtcbiAgdGltZW91dENhbGxiYWNrOiAoKSA9PiB2b2lkO1xuICBoYW5kbGVTdGF0dXNVcGRhdGU6IChcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUPixcbiAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICApID0+IFByb21pc2U8dm9pZD47XG4gIHRpbWVPdXRJZDogTm9kZUpTLlRpbWVvdXQ7XG59O1xuXG5jbGFzcyBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneSBleHRlbmRzIExvZ1N0cmF0ZWd5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBsb2dDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxMb2dNZXNzYWdlPj4pIHtcbiAgICBzdXBlcigpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHNlbmRQYWNrYWdlZChcbiAgICBwYWNrYWdlZE1lc3NhZ2U6IElSZXF1ZXN0PGFueT4sXG4gICAgb3B0aW9ucz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sb2dDaGFubmVsLnNlbmQocGFja2FnZWRNZXNzYWdlKTtcbiAgfVxufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBUUmVxdWVzdEJvZHksXG4gIFRSZXNwb25zZURhdGFcbj4gZXh0ZW5kcyBSYXRlTGltaXRlZFRhc2tTY2hlZHVsZXI8XG4gIElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gIElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuPiB7XG4gIC8vIFJlZmFjdG9yaW5nIFpvbmVcbiAgcmVhZG9ubHkgbmFtZXNwYWNlOiBzdHJpbmc7XG4gIHByaXZhdGUgbG9iYnk6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcml2YXRlIHNlcnZpY2VDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxhbnk+PjtcbiAgcHJvdGVjdGVkIGJyb2FkY2FzdENoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICByZWFkb25seSBhZGRyZXNzOiBzdHJpbmc7XG4gIC8vIEVuZCBvZiByZWZhY3RvcmluZyB6b25lLlxuXG4gIHByb3RlY3RlZCBiYWNrZW5kOiBJQmFja0VuZDtcbiAgcHJvdGVjdGVkIHNlcnZlckNvbmZpZzogSVNlcnZlckNvbmZpZztcbiAgcHJvdGVjdGVkIHNlcnZpY2VJZDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgaXNFeGVjdXRpbmc6IGJvb2xlYW4gPSBmYWxzZTtcbiAgcHJvdGVjdGVkIHN0YXR1c1VwZGF0ZUludGVydmFsOiBudW1iZXIgPSAxMjAwMDA7XG4gIHByb3RlY3RlZCByZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0OiBudW1iZXIgPSAzMDAwMDtcbiAgcHJpdmF0ZSBzdGF0dXNVcGRhdGVUaW1lb3V0SWQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGVuZGluZ1JlcXVlc3RzOiBNYXA8c3RyaW5nLCBDYWxsYmFja09iamVjdDxhbnk+PiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSByZXF1ZXN0SGFuZGxlcnM6IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+O1xuICByZWFkb25seSBzZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcjogU2VydmljZURpc2NvdmVyeU1hbmFnZXI7XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogSVNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKFxuICAgICAgY29uZmlnLmNvbmN1cnJlbmN5TGltaXQsXG4gICAgICBjb25maWcucmVxdWVzdHNQZXJJbnRlcnZhbCxcbiAgICAgIGNvbmZpZy50cHNJbnRlcnZhbFxuICAgICk7XG4gICAgdGhpcy5uYW1lc3BhY2UgPSBjb25maWcubmFtZXNwYWNlO1xuICAgIHRoaXMuc2VydmVyQ29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuYmFja2VuZCA9IGJhY2tlbmQ7XG4gICAgdGhpcy5zZXJ2aWNlSWQgPSBjb25maWcuc2VydmljZUlkO1xuICAgIHRoaXMuYWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfToke3RoaXMuaW5zdGFuY2VJZH1gO1xuICAgIHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dCA9XG4gICAgICBjb25maWcucmVxdWVzdENhbGxiYWNrVGltZW91dCB8fCB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQ7XG4gICAgdGhpcy5yZXF1ZXN0SGFuZGxlcnMgPSBnZXRSZXF1ZXN0SGFuZGxlcnModGhpcy5jb25zdHJ1Y3Rvcik7XG4gICAgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciA9IG5ldyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcihcbiAgICAgIHRoaXMuYmFja2VuZC5zZXJ2aWNlUmVnaXN0cnlcbiAgICApO1xuICAgIHRoaXMuaW5pdGlhbGl6ZSgpO1xuICB9XG5cbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcbiAgICB0aGlzLnNlcnZpY2VDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9YCxcbiAgICAgIHRoaXMuaGFuZGxlU2VydmljZU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIHRoaXMuYnJvYWRjYXN0Q2hhbm5lbCA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChcbiAgICAgIGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfTpicm9hZGNhc3RgXG4gICAgKTtcbiAgICB0aGlzLmxvYmJ5ID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OmxvYmJ5YCxcbiAgICAgIHRoaXMuaGFuZGxlTG9iYnlNZXNzYWdlcy5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBjb25zdCBsb2dDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmxvZ3NgXG4gICAgKTtcbiAgICBjb25zdCBtaWNyb3Nlcml2Y2VMb2dTdHJhdGVneSA9IG5ldyBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneShsb2dDaGFubmVsKTtcbiAgICBMb2dnYWJsZS5zZXRMb2dTdHJhdGVneShtaWNyb3Nlcml2Y2VMb2dTdHJhdGVneSk7XG4gICAgdGhpcy5pbmZvKFwiTG9nIFN0cmF0ZWd5IHNldCB0byBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneVwiKTtcbiAgICB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICB0aGlzLmhhbmRsZUluY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgdGhpcy5xdWV1ZS5zaXplKClcbiAgICApO1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tJTlwiLFxuICAgICAgICB0aGlzLmdldFNlcnZlclN0YXR1cygpXG4gICAgICApXG4gICAgKTtcbiAgICB0aGlzLm9uVGFza0NvbXBsZXRlKHRoaXMucHJvY2Vzc0FuZE5vdGlmeS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIHRoaXMuaW5mbyhgU2VydmljZSAke3RoaXMuc2VydmljZUlkfSBbJHt0aGlzLmluc3RhbmNlSWR9XSBpbml0aWFsaXplZC5gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlTG9hZExldmVsKCkge1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIudXBkYXRlTm9kZUxvYWQoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHRoaXMucXVldWUuc2l6ZSgpXG4gICAgKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCkge31cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKSB7fVxuXG4gIHN0YXRpYyBjcmVhdGVSZXF1ZXN0PFQ+KFxuICAgIHJlcXVlc3RlckFkZHJlc3M6IHN0cmluZyxcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IFQsXG4gICAgcmVjaXBpZW50QWRkcmVzcz86IHN0cmluZ1xuICApOiBJUmVxdWVzdDxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZDogdXVpZHY0KCksXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgfSxcbiAgICAgIGJvZHksXG4gICAgfTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVSZXNwb25zZTxUPihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgIHJlc3BvbmRlckFkZHJlc3M6IHN0cmluZyxcbiAgICBkYXRhOiBULFxuICAgIHN1Y2Nlc3M6IGJvb2xlYW4gPSB0cnVlLFxuICAgIGVycm9yOiBFcnJvciB8IG51bGwgPSBudWxsXG4gICk6IElSZXNwb25zZTxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgcmVzcG9uZGVyQWRkcmVzcyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldFNlcnZlclN0YXR1cygpOiBTZXJ2aWNlU3RhdHVzIHtcbiAgICBjb25zdCBzdGF0dXMgPSB7XG4gICAgICAuLi50aGlzLnNlcnZlckNvbmZpZyxcbiAgICAgIGluc3RhbmNlSWQ6IHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHBlbmRpbmdSZXF1ZXN0czogdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2l6ZSxcbiAgICAgIHF1ZXVlU2l6ZTogdGhpcy5xdWV1ZS5zaXplKCksXG4gICAgICBydW5uaW5nVGFza3M6IHRoaXMucnVubmluZ1Rhc2tzLFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgYWRkcmVzczogdGhpcy5hZGRyZXNzLFxuICAgIH07XG5cbiAgICByZXR1cm4gc3RhdHVzO1xuICB9XG5cbiAgcHVibGljIGdldHNlcnZpY2VJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLnNlcnZpY2VJZDtcbiAgfVxuXG4gIHB1YmxpYyBnZXRCYWNrZW5kKCk6IElCYWNrRW5kIHtcbiAgICByZXR1cm4gdGhpcy5iYWNrZW5kO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVNlcnZpY2VNZXNzYWdlczxUPihtZXNzYWdlOiBUKSB7fVxuXG4gIHByb3RlY3RlZCBhc3luYyBoYW5kbGVMb2JieU1lc3NhZ2VzKFxuICAgIG1lc3NhZ2U6IElNZXNzYWdlPElSZXF1ZXN0PFNlcnZpY2VTdGF0dXM+PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAobWVzc2FnZS5wYXlsb2FkLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJDSEVDS0lOXCIpIHtcbiAgICAgIHRoaXMuaW5mbyhcbiAgICAgICAgYFJlY2VpdmVkIENIRUNLSU4gZnJvbSAke21lc3NhZ2UucGF5bG9hZC5oZWFkZXIucmVxdWVzdGVyQWRkcmVzc31gXG4gICAgICApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkKTtcbiAgICB9XG4gICAgdGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMudXBkYXRlTG9hZExldmVsKCk7XG4gICAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIH0sIHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXF1ZXN0VHlwZSA9IGlucHV0LmhlYWRlci5yZXF1ZXN0VHlwZTtcbiAgICBpZiAoIXJlcXVlc3RUeXBlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1ZXN0IHR5cGUgbm90IHNwZWNpZmllZFwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYW5kbGVyTWV0YWRhdGEgPSB0aGlzLnJlcXVlc3RIYW5kbGVycy5nZXQocmVxdWVzdFR5cGUpO1xuICAgIGlmICghaGFuZGxlck1ldGFkYXRhKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE5vIGhhbmRsZXIgZm91bmQgZm9yIHJlcXVlc3QgdHlwZTogJHtyZXF1ZXN0VHlwZX1gKTtcbiAgICB9XG5cbiAgICAvLyBDYWxsIHRoZSBoYW5kbGVyIG1ldGhvZFxuICAgIGNvbnN0IGhhbmRsZXJNZXRob2QgPSAodGhpcyBhcyBhbnkpW2hhbmRsZXJNZXRhZGF0YS5tZXRob2RdLmJpbmQodGhpcyk7XG4gICAgY29uc3QgYXJncyA9IGhhbmRsZXJNZXRhZGF0YS5hY2NlcHRzRnVsbFJlcXVlc3QgPyBpbnB1dCA6IGlucHV0LmJvZHk7XG5cbiAgICBjb25zdCBoYW5kbGVyUmVzcG9uc2UgPSBoYW5kbGVyTWV0YWRhdGEuaXNBc3luY1xuICAgICAgPyBhd2FpdCBoYW5kbGVyTWV0aG9kKGFyZ3MpXG4gICAgICA6IGhhbmRsZXJNZXRob2QoYXJncyk7XG5cbiAgICByZXR1cm4gaGFuZGxlclJlc3BvbnNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB3cmFwQW5kUHJvY2Vzc1JlcXVlc3QoXG4gICAgaW5wdXQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogUHJvbWlzZTxJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5wcm9jZXNzUmVxdWVzdChpbnB1dCk7XG4gICAgICBsZXQgcmVzcG9uc2UgPSB0aGlzLm1ha2VSZXNwb25zZShyZXN1bHQsIGlucHV0LCBudWxsKTtcbiAgICAgIHJlc3BvbnNlID0gdGhpcy5lbnJpY2hSZXNwb25zZShyZXNwb25zZSwgaW5wdXQpO1xuICAgICAgcmV0dXJuIHJlc3BvbnNlO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBsZXQgcmVzcG9uc2UgPSB0aGlzLm1ha2VSZXNwb25zZShcbiAgICAgICAge30gYXMgVFJlc3BvbnNlRGF0YSxcbiAgICAgICAgaW5wdXQsXG4gICAgICAgIGVycm9yIGFzIEVycm9yXG4gICAgICApO1xuICAgICAgcmVzcG9uc2UgPSB0aGlzLmVucmljaFJlc3BvbnNlKHJlc3BvbnNlLCBpbnB1dCk7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGhhbmRsZVN0YXR1c1VwZGF0ZShcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICk6IFByb21pc2U8dm9pZD4ge31cblxuICBwcm90ZWN0ZWQgZW5yaWNoUmVzcG9uc2UoXG4gICAgcmVzcG9uc2U6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPixcbiAgICBvcmlnaW5hbFJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT5cbiAgKTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+IHtcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9uIGRvZXMgbm90aGluZ1xuICAgIC8vIENvbmNyZXRlIGNsYXNzZXMgY2FuIG92ZXJyaWRlIHRoaXMgbWV0aG9kIHRvIGFkZCBjdXN0b20gZW5yaWNobWVudFxuICAgIC8vIEZJWE1FOiBGb3Igbm93LCBsb2dnaW5nIHdpdGhpbiB0aGlzIG1ldGhvZCBjYXVzZXMgaW5maW5pdGUgbG9vcC5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgZW5yaWNoUmVxdWVzdChoZWFkZXI6IElSZXF1ZXN0SGVhZGVyLCBib2R5OiBhbnkpOiBJUmVxdWVzdEhlYWRlciB7XG4gICAgLy8gRGVmYXVsdCBpbXBsZW1lbnRhdGlvbjogcmV0dXJuIHRoZSBoZWFkZXIgdW5jaGFuZ2VkXG4gICAgcmV0dXJuIGhlYWRlcjtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlSW5jb21pbmdNZXNzYWdlKFxuICAgIG1lc3NhZ2U6IElNZXNzYWdlPElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4gfCBJUmVzcG9uc2U8YW55Pj5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcGF5bG9hZCA9IG1lc3NhZ2UucGF5bG9hZDtcblxuICAgIC8vIHJpZ2h0IG5vdyB3ZSBkb24ndCB3YWl0IHRvIHNlZSBpZiB0aGUgYWNrbm93bGVkZ2VtZW50IHN1Y2NlZWRlZC5cbiAgICAvLyB3ZSBtaWdodCB3YW50IHRvIGRvIHRoaXMgaW4gdGhlIGZ1dHVyZS5cbiAgICBhd2FpdCB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYWNrKG1lc3NhZ2UpO1xuXG4gICAgaWYgKHRoaXMuaXNSZXNwb25zZShwYXlsb2FkKSkge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVSZXNwb25zZShwYXlsb2FkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKFxuICAgICAgICBwYXlsb2FkLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJNaWNyb3NlcnZpY2VGcmFtZXdvcms6OlN0YXR1c1VwZGF0ZVwiXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdElkID0gcGF5bG9hZC5oZWFkZXIucmVxdWVzdElkO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBwYXlsb2FkLmJvZHkgYXMgU3RhdHVzVXBkYXRlO1xuICAgICAgICBjb25zdCBjYWxsYmFja09iamVjdCA9IHRoaXMucGVuZGluZ1JlcXVlc3RzLmdldChyZXF1ZXN0SWQpO1xuICAgICAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgICAgICBjb25zdCB7IGNhbGxiYWNrLCB0aW1lb3V0Q2FsbGJhY2ssIHRpbWVPdXRJZCwgaGFuZGxlU3RhdHVzVXBkYXRlIH0gPVxuICAgICAgICAgICAgY2FsbGJhY2tPYmplY3Q7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVPdXRJZCk7XG4gICAgICAgICAgY29uc3QgbmV3VGltZU91dCA9IHNldFRpbWVvdXQoXG4gICAgICAgICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXRcbiAgICAgICAgICApO1xuICAgICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgICAgIGNhbGxiYWNrLFxuICAgICAgICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgICAgICAgICAgdGltZU91dElkOiBuZXdUaW1lT3V0LFxuICAgICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IGhhbmRsZVN0YXR1c1VwZGF0ZShwYXlsb2FkLCBzdGF0dXMpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5zY2hlZHVsZU5ld01lc3NhZ2UobWVzc2FnZSBhcyBJTWVzc2FnZTxJUmVxdWVzdDxUUmVxdWVzdEJvZHk+Pik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBpc1Jlc3BvbnNlKFxuICAgIHBheWxvYWQ6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBwYXlsb2FkIGlzIElSZXNwb25zZTxhbnk+IHtcbiAgICByZXR1cm4gXCJyZXNwb25zZUhlYWRlclwiIGluIHBheWxvYWQ7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZVJlc3BvbnNlKHJlc3BvbnNlOiBJUmVzcG9uc2U8YW55Pikge1xuICAgIGNvbnN0IHJlcXVlc3RJZCA9IHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVxdWVzdElkO1xuICAgIGNvbnN0IGNhbGxiYWNrT2JqZWN0ID0gdGhpcy5wZW5kaW5nUmVxdWVzdHMuZ2V0KHJlcXVlc3RJZCk7XG4gICAgaWYgKGNhbGxiYWNrT2JqZWN0KSB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBjYWxsYmFja09iamVjdC5jYWxsYmFjayhyZXNwb25zZSk7XG4gICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgIHRoaXMuZXJyb3IoYEVycm9yIGV4ZWN1dGluZyBjYWxsYmFjayBmb3IgcmVxdWVzdCAke3JlcXVlc3RJZH1gLCBlcnJvcik7XG4gICAgICB9IGZpbmFsbHkge1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy53YXJuKGBSZWNlaXZlZCByZXNwb25zZSBmb3IgdW5rbm93biByZXF1ZXN0OiAke3JlcXVlc3RJZH1gKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlTmV3TWVzc2FnZShtZXNzYWdlOiBJTWVzc2FnZTxJUmVxdWVzdDxUUmVxdWVzdEJvZHk+Pikge1xuICAgIHRoaXMuc2NoZWR1bGVUYXNrKFxuICAgICAgYXN5bmMgKGlucHV0KSA9PiBhd2FpdCB0aGlzLndyYXBBbmRQcm9jZXNzUmVxdWVzdChpbnB1dCksXG4gICAgICBtZXNzYWdlLnBheWxvYWRcbiAgICApO1xuICB9XG5cbiAgQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBzdGFydCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnN0YXJ0RGVwZW5kZW5jaWVzKCk7XG4gIH1cblxuICBATG9nZ2FibGUuaGFuZGxlRXJyb3JzXG4gIGFzeW5jIHN0b3AoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zdG9wRGVwZW5kZW5jaWVzKCk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci51bnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLmxvYmJ5LnNlbmQoXG4gICAgICBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVxdWVzdChcbiAgICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgICBcIkNIRUNLT1VUXCIsXG4gICAgICAgIHRoaXMuZ2V0U2VydmVyU3RhdHVzKClcbiAgICAgIClcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzQW5kTm90aWZ5KFxuICAgIG91dHB1dDogVGFza091dHB1dDxJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEZJWE1FOiBETyBOT1QgTE9HIFdJVEhJTiBUSElTIE1FVEhPRCwgaXQgY2F1c2VzIGluZmluaXRlIGxvb3AhXG4gICAgaWYgKG91dHB1dC5yZXN1bHQpIHtcbiAgICAgIGlmIChvdXRwdXQucmVzdWx0LnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcykge1xuICAgICAgICBhd2FpdCB0aGlzLnNlbmROb3RpZmljYXRpb24ob3V0cHV0LnJlc3VsdCk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kTm90aWZpY2F0aW9uKFxuICAgIHJlc3BvbnNlOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVjaXBpZW50SWQgPSByZXNwb25zZS5yZXF1ZXN0SGVhZGVyLnJlY2lwaWVudEFkZHJlc3M7XG4gICAgaWYgKHJlY2lwaWVudElkKSB7XG4gICAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHJlY2lwaWVudElkKTtcbiAgICAgIHBlZXIuc2VuZChyZXNwb25zZSk7XG4gICAgICAvLyBUT0RPOiB2YWxpZGF0ZSBpZiBwZWVyIGV4aXN0cyBiZWZvcmUgc2VuZGluZyBtZXNzYWdlXG4gICAgICAvLyBUaHJvdyBpZiBwZWVyIG5vdCBmb3VuZC5cbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFN0YXR1c1VwZGF0ZShcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICBcIk1pY3Jvc2VydmljZUZyYW1ld29yazo6U3RhdHVzVXBkYXRlXCIsXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgc3RhdHVzLFxuICAgICAgcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBtYWtlUmVzcG9uc2UoXG4gICAgZGF0YTogVFJlc3BvbnNlRGF0YSxcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIGVycm9yOiBFcnJvciB8IG51bGxcbiAgKTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXNwb25kZXJBZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgICB9LFxuICAgICAgYm9keToge1xuICAgICAgICBkYXRhLFxuICAgICAgICBzdWNjZXNzOiBlcnJvciA9PT0gbnVsbCxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBpZiAoXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZWNpcGllbnRBZGRyZXNzICYmXG4gICAgICAoIWRhdGEgfHwgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIE9iamVjdC5rZXlzKGRhdGEpLmxlbmd0aCA9PT0gMCkpICYmXG4gICAgICAhZXJyb3JcbiAgICApIHtcbiAgICAgIHRoaXMuZXJyb3IoXG4gICAgICAgIGBBdHRlbXB0aW5nIHRvIHNlbmQgZW1wdHkgZGF0YSBmb3IgJHtcbiAgICAgICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZVxuICAgICAgICB9LiBEYXRhOiAke0pTT04uc3RyaW5naWZ5KGRhdGEpfWAsXG4gICAgICAgIHsgcmVxdWVzdCwgZXJyb3IgfVxuICAgICAgKTtcbiAgICAgIGVycm9yID0gbmV3IEVycm9yKFwiRW1wdHkgcmVzcG9uc2UgZGF0YVwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgbWVzc2FnZVR5cGU6IHN0cmluZyxcbiAgICB0bzogc3RyaW5nLFxuICAgIGJvZHk6IGFueSxcbiAgICByZXF1ZXN0SWQ/OiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmVxdWVzdElkID0gcmVxdWVzdElkIHx8IHRoaXMuZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcblxuICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgaWYgKHRvLnN0YXJ0c1dpdGgoYCR7dGhpcy5uYW1lc3BhY2V9OmApKSB7XG4gICAgICBwZWVyQWRkcmVzcyA9IHRvO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBub2RlSWQgPSBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLmdldExlYXN0TG9hZGVkTm9kZSh0byk7XG4gICAgICBpZiAoIW5vZGVJZCkge1xuICAgICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgTm8gbm9kZXMgYXZhaWxhYmxlIGZvciBzZXJ2aWNlICR7dG99LmApO1xuICAgICAgfVxuICAgICAgcGVlckFkZHJlc3MgPSBgJHt0aGlzLm5hbWVzcGFjZX06JHt0b306JHtub2RlSWR9YDtcbiAgICB9XG5cbiAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHBlZXJBZGRyZXNzKTtcblxuICAgIGxldCBoZWFkZXI6IElSZXF1ZXN0SGVhZGVyID0ge1xuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgcmVxdWVzdElkLFxuICAgICAgcmVxdWVzdGVyQWRkcmVzczogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICByZXF1ZXN0VHlwZTogbWVzc2FnZVR5cGUsXG4gICAgICAvLyBOb3RlOiByZWNpcGllbnRBZGRyZXNzIGlzIGludGVudGlvbmFsbHkgb21pdHRlZFxuICAgIH07XG5cbiAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgIGNvbnN0IG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gPSB7XG4gICAgICBoZWFkZXIsXG4gICAgICBib2R5LFxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVlci5zZW5kKG1lc3NhZ2UpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCBvbmUtd2F5IG1lc3NhZ2UgdG8gJHt0b31gLCB7XG4gICAgICAgIGVycm9yLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIG1lc3NhZ2VUeXBlLFxuICAgICAgfSk7XG4gICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgb25lLXdheSBtZXNzYWdlIHRvICR7dG99YCwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBtYWtlUmVxdWVzdDxUPihwcm9wczogUmVxdWVzdFByb3BzKTogUHJvbWlzZTxJUmVzcG9uc2U8VD4+IHtcbiAgICBjb25zdCB7XG4gICAgICB0byxcbiAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgYm9keSxcbiAgICAgIHJlcGx5VG8sXG4gICAgICBoYW5kbGVTdGF0dXNVcGRhdGUsXG4gICAgICBoZWFkZXJzLFxuICAgICAgdGltZW91dCxcbiAgICAgIHRpbWVvdXRDYWxsYmFjayxcbiAgICB9ID0gcHJvcHM7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IGhlYWRlcnM/LnJlcXVlc3RJZCB8fCB0aGlzLmdlbmVyYXRlUmVxdWVzdElkKCk7XG5cbiAgICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgICBpZiAodG8uc3RhcnRzV2l0aChgJHt0aGlzLm5hbWVzcGFjZX06YCkpIHtcbiAgICAgICAgcGVlckFkZHJlc3MgPSB0bztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIuZ2V0TGVhc3RMb2FkZWROb2RlKFxuICAgICAgICAgIHRvXG4gICAgICAgICk7XG4gICAgICAgIGlmICghbm9kZUlkKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBMb2dnYWJsZUVycm9yKGBObyBub2RlcyBhdmFpbGFibGUgZm9yIHNlcnZpY2UgJHt0b30uYCkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBwZWVyQWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RvfToke25vZGVJZH1gO1xuICAgICAgfVxuXG4gICAgICBsZXQgaGVhZGVyOiBJUmVxdWVzdEhlYWRlciA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3M6IGhlYWRlcnM/LnJlcXVlc3RlckFkZHJlc3MgfHwgdGhpcy5hZGRyZXNzLFxuICAgICAgICByZWNpcGllbnRBZGRyZXNzOiByZXBseVRvIHx8IHRoaXMuYWRkcmVzcyxcbiAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICB9O1xuXG4gICAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgICAgY29uc3QgcmVxdWVzdDogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgICAgaGVhZGVyLFxuICAgICAgICBib2R5LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD4gPSBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAocmVzcG9uc2UuYm9keS5zdWNjZXNzKSB7XG4gICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgZXJyb3I6IHJlc3BvbnNlLmJvZHkuZXJyb3IsXG4gICAgICAgICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICAgICAgICB0byxcbiAgICAgICAgICAgICAgcmVwbHlUbyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgaW4gY2FsbGJhY2sgZm9yIHJlcXVlc3QgJHtyZXF1ZXN0SWR9YCwgZXJyb3IpO1xuICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKGBFcnJvciBwcm9jZXNzaW5nIHJlc3BvbnNlIGZyb20gJHt0b31gLCBlcnJvcilcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0IHx8IHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dDtcbiAgICAgIGNvbnN0IHRpbWVvdXRDYiA9XG4gICAgICAgIHRpbWVvdXRDYWxsYmFjayB8fFxuICAgICAgICAoKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLnBlbmRpbmdSZXF1ZXN0cy5oYXMocmVxdWVzdElkKSkge1xuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgICAgICAgICB0aGlzLndhcm4oYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0YCwge1xuICAgICAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoXG4gICAgICAgICAgICAgICAgYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICBjb25zdCB0aW1lT3V0SWQgPSBzZXRUaW1lb3V0KHRpbWVvdXRDYiwgdGltZW91dE1zKTtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgIHRpbWVvdXRDYWxsYmFjazogdGltZW91dENiLFxuICAgICAgICB0aW1lT3V0SWQsXG4gICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTpcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGUgfHwgdGhpcy5oYW5kbGVTdGF0dXNVcGRhdGUuYmluZCh0aGlzKSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcGVlciA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChwZWVyQWRkcmVzcyk7XG5cbiAgICAgIHBlZXIuc2VuZChyZXF1ZXN0KS5jYXRjaCgoZXJyb3I6IGFueSkgPT4ge1xuICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgICAgdGhpcy5lcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIHtcbiAgICAgICAgICBlcnJvcixcbiAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgIH0pO1xuICAgICAgICByZWplY3QobmV3IExvZ2dhYmxlRXJyb3IoYEZhaWxlZCB0byBzZW5kIHJlcXVlc3QgdG8gJHt0b31gLCBlcnJvcikpO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGdlbmVyYXRlUmVxdWVzdElkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIGAke3RoaXMuc2VydmljZUlkfS0ke0RhdGUubm93KCl9LSR7TWF0aC5yYW5kb20oKVxuICAgICAgLnRvU3RyaW5nKDM2KVxuICAgICAgLnN1YnN0cigyLCA5KX1gO1xuICB9XG59XG5cbmV4cG9ydCB7IFNlcnZlclJ1bm5lciB9O1xuZXhwb3J0ICogZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuIl19