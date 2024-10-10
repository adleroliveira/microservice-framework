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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logMethod = exports.ConsoleStrategy = exports.Loggable = exports.PubSubConsumer = exports.ServerRunner = exports.MicroserviceFramework = void 0;
exports.RequestHandler = RequestHandler;
const RateLimitedTaskScheduler_1 = require("./RateLimitedTaskScheduler");
const Loggable_1 = require("./utils/logging/Loggable");
Object.defineProperty(exports, "Loggable", { enumerable: true, get: function () { return Loggable_1.Loggable; } });
Object.defineProperty(exports, "logMethod", { enumerable: true, get: function () { return Loggable_1.logMethod; } });
const ConsoleStrategy_1 = require("./utils/logging/ConsoleStrategy");
Object.defineProperty(exports, "ConsoleStrategy", { enumerable: true, get: function () { return ConsoleStrategy_1.ConsoleStrategy; } });
const ServiceDiscoveryManager_1 = require("./ServiceDiscoveryManager");
require("reflect-metadata");
const uuid_1 = require("uuid");
const LogStrategy_1 = require("./utils/logging/LogStrategy");
const ServerRunner_1 = require("./ServerRunner");
Object.defineProperty(exports, "ServerRunner", { enumerable: true, get: function () { return ServerRunner_1.ServerRunner; } });
const PubSubConsumer_1 = require("./PubSubConsumer");
Object.defineProperty(exports, "PubSubConsumer", { enumerable: true, get: function () { return PubSubConsumer_1.PubSubConsumer; } });
const chalk_1 = __importDefault(require("chalk"));
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
        super(config.concurrencyLimit || 100, config.requestsPerInterval || 100, config.interval || 1000);
        this.statusUpdateTimeoutId = null;
        this.pendingRequests = new Map();
        this.isExecuting = false;
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
            Loggable_1.Loggable.setLogStrategy(this.serverConfig.logStrategy || new MicroserviceLogStrategy(logChannel));
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
            Loggable_1.Loggable.setLogStrategy(this.serverConfig.logStrategy);
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
    async handleIncomingMessage(payload) {
        // right now we don't wait to see if the acknowledgement succeeded.
        // we might want to do this in the future.
        await this.backend.pubSubConsumer.ack(payload);
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
    }
    async stop() {
        await this.lobby.send(MicroserviceFramework.createRequest(this.address, "CHECKOUT", this.getServerStatus()));
        await this.stopDependencies();
        await this.serviceDiscoveryManager.unregisterNode(this.serviceId, this.instanceId);
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQTRDQSx3Q0FlQztBQTFERCx5RUFHb0M7QUFDcEMsdURBS2tDO0FBaXVCaEMseUZBcnVCQSxtQkFBUSxPQXF1QkE7QUFFUiwwRkFwdUJBLG9CQUFTLE9Bb3VCQTtBQWx1QlgscUVBQWtFO0FBaXVCaEUsZ0dBanVCTyxpQ0FBZSxPQWl1QlA7QUFodUJqQix1RUFBb0U7QUFFcEUsNEJBQTBCO0FBQzFCLCtCQUFvQztBQUNwQyw2REFBMEQ7QUFDMUQsaURBQThDO0FBc3RCNUMsNkZBdHRCTywyQkFBWSxPQXN0QlA7QUFydEJkLHFEQUkwQjtBQWt0QnhCLCtGQXJ0QkEsK0JBQWMsT0FxdEJBO0FBanRCaEIsa0RBQTBCO0FBRTFCLHVDQUF1QztBQUN2QyxNQUFNLDRCQUE0QixHQUFHLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFDO0FBWTlELG1FQUFtRTtBQUNuRSxTQUFTLG9CQUFvQjtJQUMzQixPQUFPLEVBQWlDLENBQUM7QUFDM0MsQ0FBQztBQUVELHVCQUF1QjtBQUN2QixTQUFnQixjQUFjLENBQUksV0FBbUI7SUFDbkQsT0FBTyxVQUNMLE1BQVcsRUFDWCxXQUFtQixFQUNuQixVQUFzQztRQUV0QyxNQUFNLGtCQUFrQixHQUFHLG9CQUFvQixFQUFLLENBQUM7UUFDckQsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLEtBQUssRUFBRSxXQUFXLENBQUMsSUFBSSxLQUFLLGVBQWUsQ0FBQztRQUN2RSxPQUFPLENBQUMsY0FBYyxDQUNwQiw0QkFBNEIsRUFDNUIsRUFBRSxXQUFXLEVBQUUsTUFBTSxFQUFFLFdBQVcsRUFBRSxrQkFBa0IsRUFBRSxPQUFPLEVBQUUsRUFDakUsTUFBTSxFQUNOLFdBQVcsQ0FDWixD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U0FBUztvQkFDVCxXQUFXO2lCQUNaLENBQUMsQ0FBQztnQkFDSCxNQUFNLENBQUMsSUFBSSx3QkFBYSxDQUFDLDZCQUE2QixFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO1lBQ3RFLENBQUMsQ0FBQyxDQUFDO1FBQ0wsQ0FBQyxDQUFDLENBQUM7SUFDTCxDQUFDO0lBRU8saUJBQWlCO1FBQ3ZCLE9BQU8sR0FBRyxJQUFJLENBQUMsU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFO2FBQ3BELFFBQVEsQ0FBQyxFQUFFLENBQUM7YUFDWixNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFLENBQUM7SUFDcEIsQ0FBQztDQUNGO0FBOWtCRCxzREE4a0JDO0FBN1BPO0lBREwsbUJBQVEsQ0FBQyxZQUFZOzs7O2tEQUdyQjtBQUdLO0lBREwsbUJBQVEsQ0FBQyxZQUFZOzs7O2lEQWNyQjtBQXNQSCwrQ0FBNkIiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBJTWVzc2FnZSwgSUJhY2tFbmQsIENoYW5uZWxCaW5kaW5nIH0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IHtcbiAgUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyLFxuICBUYXNrT3V0cHV0LFxufSBmcm9tIFwiLi9SYXRlTGltaXRlZFRhc2tTY2hlZHVsZXJcIjtcbmltcG9ydCB7XG4gIExvZ2dhYmxlLFxuICBMb2dnYWJsZUVycm9yLFxuICBMb2dNZXNzYWdlLFxuICBsb2dNZXRob2QsXG59IGZyb20gXCIuL3V0aWxzL2xvZ2dpbmcvTG9nZ2FibGVcIjtcbmltcG9ydCB7IENvbnNvbGVTdHJhdGVneSB9IGZyb20gXCIuL3V0aWxzL2xvZ2dpbmcvQ29uc29sZVN0cmF0ZWd5XCI7XG5pbXBvcnQgeyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciB9IGZyb20gXCIuL1NlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyXCI7XG5pbXBvcnQgeyBJUmVxdWVzdCwgSVJlc3BvbnNlLCBJUmVxdWVzdEhlYWRlciB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCBcInJlZmxlY3QtbWV0YWRhdGFcIjtcbmltcG9ydCB7IHY0IGFzIHV1aWR2NCB9IGZyb20gXCJ1dWlkXCI7XG5pbXBvcnQgeyBMb2dTdHJhdGVneSB9IGZyb20gXCIuL3V0aWxzL2xvZ2dpbmcvTG9nU3RyYXRlZ3lcIjtcbmltcG9ydCB7IFNlcnZlclJ1bm5lciB9IGZyb20gXCIuL1NlcnZlclJ1bm5lclwiO1xuaW1wb3J0IHtcbiAgUHViU3ViQ29uc3VtZXIsXG4gIFB1YlN1YkNvbnN1bWVyT3B0aW9ucyxcbiAgTWVzc2FnZUhhbmRsZXIsXG59IGZyb20gXCIuL1B1YlN1YkNvbnN1bWVyXCI7XG5pbXBvcnQgY2hhbGsgZnJvbSBcImNoYWxrXCI7XG5cbi8vIERlZmluZSBhIHN5bWJvbCBmb3Igb3VyIG1ldGFkYXRhIGtleVxuY29uc3QgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSA9IFN5bWJvbChcInJlcXVlc3RIYW5kbGVyXCIpO1xuXG4vLyBEZWZpbmUgYW4gaW50ZXJmYWNlIGZvciB0aGUgbWV0YWRhdGEgd2UnbGwgc3RvcmVcbmludGVyZmFjZSBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhIHtcbiAgcmVxdWVzdFR5cGU6IHN0cmluZztcbiAgbWV0aG9kOiBzdHJpbmc7XG4gIGFjY2VwdHNGdWxsUmVxdWVzdDogYm9vbGVhbjtcbiAgaXNBc3luYzogYm9vbGVhbjtcbn1cblxudHlwZSBJc0Z1bGxSZXF1ZXN0PFQ+ID0gVCBleHRlbmRzIElSZXF1ZXN0PGFueT4gPyB0cnVlIDogZmFsc2U7XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgaWYgdGhlIGhhbmRsZXIgYWNjZXB0cyBmdWxsIHJlcXVlc3RcbmZ1bmN0aW9uIGlzRnVsbFJlcXVlc3RIYW5kbGVyPFQ+KCk6IGJvb2xlYW4ge1xuICByZXR1cm4ge30gYXMgSXNGdWxsUmVxdWVzdDxUPiBhcyBib29sZWFuO1xufVxuXG4vLyBDcmVhdGUgdGhlIGRlY29yYXRvclxuZXhwb3J0IGZ1bmN0aW9uIFJlcXVlc3RIYW5kbGVyPFQ+KHJlcXVlc3RUeXBlOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIDxNIGV4dGVuZHMgKGFyZzogVCkgPT4gUHJvbWlzZTxhbnk+IHwgYW55PihcbiAgICB0YXJnZXQ6IGFueSxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPE0+XG4gICkge1xuICAgIGNvbnN0IGFjY2VwdHNGdWxsUmVxdWVzdCA9IGlzRnVsbFJlcXVlc3RIYW5kbGVyPFQ+KCk7XG4gICAgY29uc3QgaXNBc3luYyA9IGRlc2NyaXB0b3IudmFsdWU/LmNvbnN0cnVjdG9yLm5hbWUgPT09IFwiQXN5bmNGdW5jdGlvblwiO1xuICAgIFJlZmxlY3QuZGVmaW5lTWV0YWRhdGEoXG4gICAgICBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZLFxuICAgICAgeyByZXF1ZXN0VHlwZSwgbWV0aG9kOiBwcm9wZXJ0eUtleSwgYWNjZXB0c0Z1bGxSZXF1ZXN0LCBpc0FzeW5jIH0sXG4gICAgICB0YXJnZXQsXG4gICAgICBwcm9wZXJ0eUtleVxuICAgICk7XG4gIH07XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgYWxsIG1ldGhvZHMgd2l0aCB0aGUgUmVxdWVzdEhhbmRsZXIgZGVjb3JhdG9yXG5mdW5jdGlvbiBnZXRSZXF1ZXN0SGFuZGxlcnModGFyZ2V0OiBhbnkpOiBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhPiB7XG4gIGNvbnN0IGhhbmRsZXJzID0gbmV3IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+KCk7XG5cbiAgbGV0IGN1cnJlbnRUYXJnZXQgPSB0YXJnZXQucHJvdG90eXBlO1xuICB3aGlsZSAoY3VycmVudFRhcmdldCkge1xuICAgIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKGN1cnJlbnRUYXJnZXQpKSB7XG4gICAgICBjb25zdCBtZXRhZGF0YTogUmVxdWVzdEhhbmRsZXJNZXRhZGF0YSB8IHVuZGVmaW5lZCA9IFJlZmxlY3QuZ2V0TWV0YWRhdGEoXG4gICAgICAgIFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVksXG4gICAgICAgIGN1cnJlbnRUYXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZVxuICAgICAgKTtcbiAgICAgIGlmIChtZXRhZGF0YSkge1xuICAgICAgICBoYW5kbGVycy5zZXQobWV0YWRhdGEucmVxdWVzdFR5cGUsIG1ldGFkYXRhKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjdXJyZW50VGFyZ2V0ID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRUYXJnZXQpO1xuICB9XG5cbiAgcmV0dXJuIGhhbmRsZXJzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElTZXJ2ZXJDb25maWcge1xuICBuYW1lc3BhY2U6IHN0cmluZztcbiAgY29uY3VycmVuY3lMaW1pdD86IG51bWJlcjtcbiAgcmVxdWVzdHNQZXJJbnRlcnZhbD86IG51bWJlcjtcbiAgaW50ZXJ2YWw/OiBudW1iZXI7XG4gIHRwc0ludGVydmFsPzogbnVtYmVyO1xuICBzZXJ2aWNlSWQ6IHN0cmluZztcbiAgcmVxdWVzdENhbGxiYWNrVGltZW91dD86IG51bWJlcjtcbiAgbG9nU3RyYXRlZ3k/OiBMb2dTdHJhdGVneTtcbiAgc3RhdHVzVXBkYXRlSW50ZXJ2YWw/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU2VydmljZVN0YXR1cyBleHRlbmRzIElTZXJ2ZXJDb25maWcge1xuICBpbnN0YW5jZUlkOiBzdHJpbmc7XG4gIHBlbmRpbmdSZXF1ZXN0czogbnVtYmVyO1xuICBxdWV1ZVNpemU6IG51bWJlcjtcbiAgcnVubmluZ1Rhc2tzOiBudW1iZXI7XG4gIHRpbWVzdGFtcDogbnVtYmVyO1xuICBhZGRyZXNzOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzVXBkYXRlIHtcbiAgc3RhdHVzOiBzdHJpbmc7XG4gIHByb2dyZXNzPzogbnVtYmVyO1xuICBtZXRhZGF0YT86IGFueTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXF1ZXN0UHJvcHMge1xuICByZXF1ZXN0VHlwZTogc3RyaW5nO1xuICB0bzogc3RyaW5nO1xuICBib2R5OiBhbnk7XG4gIHJlcGx5VG8/OiBzdHJpbmc7XG4gIGhhbmRsZVN0YXR1c1VwZGF0ZT86IChcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgdGltZW91dENhbGxiYWNrPzogKCkgPT4gdm9pZDtcbiAgdGltZW91dD86IG51bWJlcjtcbiAgaGVhZGVycz86IElSZXF1ZXN0SGVhZGVyO1xuICBpc0Jyb2FkY2FzdD86IGJvb2xlYW47XG59XG5cbnR5cGUgQ2FsbGJhY2tGdW5jdGlvbjxUPiA9IChyZXNwb25zZTogSVJlc3BvbnNlPFQ+KSA9PiBQcm9taXNlPHZvaWQ+O1xudHlwZSBDYWxsYmFja09iamVjdDxUPiA9IHtcbiAgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD47XG4gIHRpbWVvdXRDYWxsYmFjazogKCkgPT4gdm9pZDtcbiAgaGFuZGxlU3RhdHVzVXBkYXRlOiAoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VD4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB0aW1lT3V0SWQ6IE5vZGVKUy5UaW1lb3V0O1xufTtcblxuY2xhc3MgTWljcm9zZXJ2aWNlTG9nU3RyYXRlZ3kgZXh0ZW5kcyBMb2dTdHJhdGVneSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgbG9nQ2hhbm5lbDogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8TG9nTWVzc2FnZT4+KSB7XG4gICAgc3VwZXIoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzZW5kUGFja2FnZWQoXG4gICAgcGFja2FnZWRNZXNzYWdlOiBJUmVxdWVzdDxhbnk+LFxuICAgIG9wdGlvbnM/OiBSZWNvcmQ8c3RyaW5nLCBhbnk+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMubG9nQ2hhbm5lbC5zZW5kKHBhY2thZ2VkTWVzc2FnZSk7XG4gIH1cbn1cblxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIE1pY3Jvc2VydmljZUZyYW1ld29yazxcbiAgVFJlcXVlc3RCb2R5LFxuICBUUmVzcG9uc2VEYXRhXG4+IGV4dGVuZHMgUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyPFxuICBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT5cbj4ge1xuICBwcml2YXRlIGxvYmJ5OiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxhbnk+PjtcbiAgcHJpdmF0ZSBzZXJ2aWNlQ2hhbm5lbDogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8YW55Pj47XG4gIHByaXZhdGUgc3RhdHVzVXBkYXRlVGltZW91dElkOiBOb2RlSlMuVGltZW91dCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBlbmRpbmdSZXF1ZXN0czogTWFwPHN0cmluZywgQ2FsbGJhY2tPYmplY3Q8YW55Pj4gPSBuZXcgTWFwKCk7XG4gIHByaXZhdGUgcmVxdWVzdEhhbmRsZXJzOiBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhPjtcbiAgcHJvdGVjdGVkIGJyb2FkY2FzdENoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcm90ZWN0ZWQgYmFja2VuZDogSUJhY2tFbmQ7XG4gIHByb3RlY3RlZCBzZXJ2ZXJDb25maWc6IElTZXJ2ZXJDb25maWc7XG4gIHByb3RlY3RlZCBzZXJ2aWNlSWQ6IHN0cmluZztcbiAgcHJvdGVjdGVkIGlzRXhlY3V0aW5nOiBib29sZWFuID0gZmFsc2U7XG4gIHByb3RlY3RlZCBzdGF0dXNVcGRhdGVJbnRlcnZhbDogbnVtYmVyID0gMTIwMDAwO1xuICBwcm90ZWN0ZWQgcmVxdWVzdENhbGxiYWNrVGltZW91dDogbnVtYmVyID0gMzAwMDA7XG4gIHJlYWRvbmx5IGFkZHJlc3M6IHN0cmluZztcbiAgcmVhZG9ubHkgc2VydmljZURpc2NvdmVyeU1hbmFnZXI6IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyO1xuICByZWFkb25seSBuYW1lc3BhY2U6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBJU2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoXG4gICAgICBjb25maWcuY29uY3VycmVuY3lMaW1pdCB8fCAxMDAsXG4gICAgICBjb25maWcucmVxdWVzdHNQZXJJbnRlcnZhbCB8fCAxMDAsXG4gICAgICBjb25maWcuaW50ZXJ2YWwgfHwgMTAwMFxuICAgICk7XG4gICAgdGhpcy5uYW1lc3BhY2UgPSBjb25maWcubmFtZXNwYWNlO1xuICAgIHRoaXMuc2VydmVyQ29uZmlnID0gY29uZmlnO1xuICAgIHRoaXMuYmFja2VuZCA9IGJhY2tlbmQ7XG4gICAgdGhpcy5zZXJ2aWNlSWQgPSBjb25maWcuc2VydmljZUlkO1xuICAgIHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwgPSBjb25maWcuc3RhdHVzVXBkYXRlSW50ZXJ2YWwgfHwgMTIwMDAwO1xuICAgIHRoaXMuYWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfToke3RoaXMuaW5zdGFuY2VJZH1gO1xuICAgIHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dCA9XG4gICAgICBjb25maWcucmVxdWVzdENhbGxiYWNrVGltZW91dCB8fCB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQ7XG4gICAgdGhpcy5yZXF1ZXN0SGFuZGxlcnMgPSBnZXRSZXF1ZXN0SGFuZGxlcnModGhpcy5jb25zdHJ1Y3Rvcik7XG4gICAgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlciA9IG5ldyBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcihcbiAgICAgIHRoaXMuYmFja2VuZC5zZXJ2aWNlUmVnaXN0cnlcbiAgICApO1xuICB9XG5cbiAgLy8gQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgIHRoaXMuc2VydmljZUNoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH1gLFxuICAgICAgdGhpcy5oYW5kbGVTZXJ2aWNlTWVzc2FnZXMuYmluZCh0aGlzKVxuICAgICk7XG4gICAgdGhpcy5icm9hZGNhc3RDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmJyb2FkY2FzdGBcbiAgICApO1xuICAgIHRoaXMubG9iYnkgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06bG9iYnlgLFxuICAgICAgdGhpcy5oYW5kbGVMb2JieU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIGNvbnN0IGxvZ0NoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06bG9nc2BcbiAgICApO1xuICAgIGlmICghdGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kpIHtcbiAgICAgIExvZ2dhYmxlLnNldExvZ1N0cmF0ZWd5KFxuICAgICAgICB0aGlzLnNlcnZlckNvbmZpZy5sb2dTdHJhdGVneSB8fCBuZXcgTWljcm9zZXJ2aWNlTG9nU3RyYXRlZ3kobG9nQ2hhbm5lbClcbiAgICAgICk7XG4gICAgICBjb25zb2xlLndhcm4oXG4gICAgICAgIGNoYWxrLnllbGxvdyhgXG5bV0FSTklOR11cbkxvZyBTdHJhdGVneSBpcyBzZXQgdG8gTWljcm9zZXJ2aWNlTG9nU3RyYXRlZ3kuXG5NaWNyb3NlcnZpY2VGcmFtZXdvcmsgd2lsbCBzdHJlYW0gbG9ncyB0byAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfTpsb2dzIGNoYW5uZWxcbklmIHlvdSBhcmUgbm90IHNlZWluZyBhbnkgbG9ncywgdHJ5IGFkZGluZyB0aGUgZm9sbG93aW5nIHRvIE1pY3Jvc2VydmljZUZyYW1ld29yayBjb25maWd1cmF0aW9uIG9iamVjdDpcblxuaW1wb3J0IHsgQ29uc29sZVN0cmF0ZWd5IH0gZnJvbSBcIm1pY3Jvc2VydmljZS1mcmFtZXdvcmtcIjtcbmNvbmZpZyA9IHtcbiAgLi4uLFxuICBsb2dTdHJhdGVneTogbmV3IENvbnNvbGVTdHJhdGVneSgpXG59XG4gICAgICBgKVxuICAgICAgKTtcbiAgICB9IGVsc2Uge1xuICAgICAgTG9nZ2FibGUuc2V0TG9nU3RyYXRlZ3kodGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kpO1xuICAgIH1cbiAgICB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICB0aGlzLmhhbmRsZUluY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgdGhpcy5xdWV1ZS5zaXplKClcbiAgICApO1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tJTlwiLFxuICAgICAgICB0aGlzLmdldFNlcnZlclN0YXR1cygpXG4gICAgICApXG4gICAgKTtcbiAgICB0aGlzLm9uVGFza0NvbXBsZXRlKHRoaXMucHJvY2Vzc0FuZE5vdGlmeS5iaW5kKHRoaXMpKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIHRoaXMuaW5mbyhgU2VydmljZSAke3RoaXMuc2VydmljZUlkfSBbJHt0aGlzLmluc3RhbmNlSWR9XSBpbml0aWFsaXplZC5gKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBkYXRlTG9hZExldmVsKCkge1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIudXBkYXRlTm9kZUxvYWQoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHRoaXMucXVldWUuc2l6ZSgpXG4gICAgKTtcbiAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHN0YXJ0RGVwZW5kZW5jaWVzKCkge1xuICAgIHRoaXMuaW5mbyhcbiAgICAgIGBTZXJ2aWNlOiAke3RoaXMuc2VydmljZUlkfSBzdGFydGVkIHN1Y2Nlc3NmdWxseS4gSW5zdGFuY2VJRDogJHt0aGlzLmluc3RhbmNlSWR9YFxuICAgICk7XG4gIH1cbiAgcHJvdGVjdGVkIGFzeW5jIHN0b3BEZXBlbmRlbmNpZXMoKSB7fVxuXG4gIHN0YXRpYyBjcmVhdGVSZXF1ZXN0PFQ+KFxuICAgIHJlcXVlc3RlckFkZHJlc3M6IHN0cmluZyxcbiAgICByZXF1ZXN0VHlwZTogc3RyaW5nLFxuICAgIGJvZHk6IFQsXG4gICAgcmVjaXBpZW50QWRkcmVzcz86IHN0cmluZ1xuICApOiBJUmVxdWVzdDxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZDogdXVpZHY0KCksXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3MsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3MsXG4gICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgfSxcbiAgICAgIGJvZHksXG4gICAgfTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVSZXNwb25zZTxUPihcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+LFxuICAgIHJlc3BvbmRlckFkZHJlc3M6IHN0cmluZyxcbiAgICBkYXRhOiBULFxuICAgIHN1Y2Nlc3M6IGJvb2xlYW4gPSB0cnVlLFxuICAgIGVycm9yOiBFcnJvciB8IG51bGwgPSBudWxsXG4gICk6IElSZXNwb25zZTxUPiB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgcmVzcG9uZGVyQWRkcmVzcyxcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IHtcbiAgICAgICAgZGF0YSxcbiAgICAgICAgc3VjY2VzcyxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGdldFNlcnZlclN0YXR1cygpOiBTZXJ2aWNlU3RhdHVzIHtcbiAgICBjb25zdCBzdGF0dXMgPSB7XG4gICAgICAuLi50aGlzLnNlcnZlckNvbmZpZyxcbiAgICAgIGluc3RhbmNlSWQ6IHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHBlbmRpbmdSZXF1ZXN0czogdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2l6ZSxcbiAgICAgIHF1ZXVlU2l6ZTogdGhpcy5xdWV1ZS5zaXplKCksXG4gICAgICBydW5uaW5nVGFza3M6IHRoaXMucnVubmluZ1Rhc2tzLFxuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgYWRkcmVzczogdGhpcy5hZGRyZXNzLFxuICAgIH07XG5cbiAgICByZXR1cm4gc3RhdHVzO1xuICB9XG5cbiAgcHVibGljIGdldHNlcnZpY2VJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLnNlcnZpY2VJZDtcbiAgfVxuXG4gIHB1YmxpYyBnZXRCYWNrZW5kKCk6IElCYWNrRW5kIHtcbiAgICByZXR1cm4gdGhpcy5iYWNrZW5kO1xuICB9XG5cbiAgcHJvdGVjdGVkIGhhbmRsZVNlcnZpY2VNZXNzYWdlczxUPihtZXNzYWdlOiBUKSB7fVxuXG4gIHByb3RlY3RlZCBhc3luYyBoYW5kbGVMb2JieU1lc3NhZ2VzKFxuICAgIG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5pc1NlcnZpY2VTdGF0dXNSZXF1ZXN0KG1lc3NhZ2UpKSB7XG4gICAgICBpZiAobWVzc2FnZS5oZWFkZXIucmVxdWVzdFR5cGUgPT09IFwiQ0hFQ0tJTlwiKSB7XG4gICAgICAgIHRoaXMuaW5mbyhgUmVjZWl2ZWQgQ0hFQ0tJTiBmcm9tICR7bWVzc2FnZS5oZWFkZXIucmVxdWVzdGVyQWRkcmVzc31gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzU2VydmljZVN0YXR1c1JlcXVlc3QoXG4gICAgbWVzc2FnZTogSVJlcXVlc3Q8YW55PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IG1lc3NhZ2UgaXMgSVJlcXVlc3Q8U2VydmljZVN0YXR1cz4ge1xuICAgIHJldHVybiBcImhlYWRlclwiIGluIG1lc3NhZ2UgJiYgXCJyZXF1ZXN0VHlwZVwiIGluIG1lc3NhZ2UuaGVhZGVyO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKSB7XG4gICAgaWYgKHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQpO1xuICAgIH1cbiAgICB0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy51cGRhdGVMb2FkTGV2ZWwoKTtcbiAgICAgIHRoaXMuc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCk7XG4gICAgfSwgdGhpcy5zdGF0dXNVcGRhdGVJbnRlcnZhbCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NSZXF1ZXN0KFxuICAgIGlucHV0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+XG4gICk6IFByb21pc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIGNvbnN0IHJlcXVlc3RUeXBlID0gaW5wdXQuaGVhZGVyLnJlcXVlc3RUeXBlO1xuICAgIGlmICghcmVxdWVzdFR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVlc3QgdHlwZSBub3Qgc3BlY2lmaWVkXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGhhbmRsZXJNZXRhZGF0YSA9IHRoaXMucmVxdWVzdEhhbmRsZXJzLmdldChyZXF1ZXN0VHlwZSk7XG4gICAgaWYgKCFoYW5kbGVyTWV0YWRhdGEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gaGFuZGxlciBmb3VuZCBmb3IgcmVxdWVzdCB0eXBlOiAke3JlcXVlc3RUeXBlfWApO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIGhhbmRsZXIgbWV0aG9kXG4gICAgY29uc3QgaGFuZGxlck1ldGhvZCA9ICh0aGlzIGFzIGFueSlbaGFuZGxlck1ldGFkYXRhLm1ldGhvZF0uYmluZCh0aGlzKTtcbiAgICBjb25zdCBhcmdzID0gaGFuZGxlck1ldGFkYXRhLmFjY2VwdHNGdWxsUmVxdWVzdCA/IGlucHV0IDogaW5wdXQuYm9keTtcblxuICAgIGNvbnN0IGhhbmRsZXJSZXNwb25zZSA9IGhhbmRsZXJNZXRhZGF0YS5pc0FzeW5jXG4gICAgICA/IGF3YWl0IGhhbmRsZXJNZXRob2QoYXJncylcbiAgICAgIDogaGFuZGxlck1ldGhvZChhcmdzKTtcblxuICAgIHJldHVybiBoYW5kbGVyUmVzcG9uc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyYXBBbmRQcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPj4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NSZXF1ZXN0KGlucHV0KTtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKHJlc3VsdCwgaW5wdXQsIG51bGwpO1xuICAgICAgcmVzcG9uc2UgPSB0aGlzLmVucmljaFJlc3BvbnNlKHJlc3BvbnNlLCBpbnB1dCk7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKFxuICAgICAgICB7fSBhcyBUUmVzcG9uc2VEYXRhLFxuICAgICAgICBpbnB1dCxcbiAgICAgICAgZXJyb3IgYXMgRXJyb3JcbiAgICAgICk7XG4gICAgICByZXNwb25zZSA9IHRoaXMuZW5yaWNoUmVzcG9uc2UocmVzcG9uc2UsIGlucHV0KTtcbiAgICAgIHJldHVybiByZXNwb25zZTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaGFuZGxlU3RhdHVzVXBkYXRlKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKTogUHJvbWlzZTx2b2lkPiB7fVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXNwb25zZShcbiAgICByZXNwb25zZTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+LFxuICAgIG9yaWdpbmFsUmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb24gZG9lcyBub3RoaW5nXG4gICAgLy8gQ29uY3JldGUgY2xhc3NlcyBjYW4gb3ZlcnJpZGUgdGhpcyBtZXRob2QgdG8gYWRkIGN1c3RvbSBlbnJpY2htZW50XG4gICAgLy8gRklYTUU6IEZvciBub3csIGxvZ2dpbmcgd2l0aGluIHRoaXMgbWV0aG9kIGNhdXNlcyBpbmZpbml0ZSBsb29wLlxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXF1ZXN0KGhlYWRlcjogSVJlcXVlc3RIZWFkZXIsIGJvZHk6IGFueSk6IElSZXF1ZXN0SGVhZGVyIHtcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9uOiByZXR1cm4gdGhlIGhlYWRlciB1bmNoYW5nZWRcbiAgICByZXR1cm4gaGVhZGVyO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVJbmNvbWluZ01lc3NhZ2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIHJpZ2h0IG5vdyB3ZSBkb24ndCB3YWl0IHRvIHNlZSBpZiB0aGUgYWNrbm93bGVkZ2VtZW50IHN1Y2NlZWRlZC5cbiAgICAvLyB3ZSBtaWdodCB3YW50IHRvIGRvIHRoaXMgaW4gdGhlIGZ1dHVyZS5cbiAgICBhd2FpdCB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYWNrKHBheWxvYWQpO1xuXG4gICAgaWYgKHRoaXMuaXNSZXNwb25zZShwYXlsb2FkKSkge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVSZXNwb25zZShwYXlsb2FkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKFxuICAgICAgICBwYXlsb2FkLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJNaWNyb3NlcnZpY2VGcmFtZXdvcms6OlN0YXR1c1VwZGF0ZVwiXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdElkID0gcGF5bG9hZC5oZWFkZXIucmVxdWVzdElkO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBwYXlsb2FkLmJvZHkgYXMgU3RhdHVzVXBkYXRlO1xuICAgICAgICBjb25zdCBjYWxsYmFja09iamVjdCA9IHRoaXMucGVuZGluZ1JlcXVlc3RzLmdldChyZXF1ZXN0SWQpO1xuICAgICAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgICAgICBjb25zdCB7IGNhbGxiYWNrLCB0aW1lb3V0Q2FsbGJhY2ssIHRpbWVPdXRJZCwgaGFuZGxlU3RhdHVzVXBkYXRlIH0gPVxuICAgICAgICAgICAgY2FsbGJhY2tPYmplY3Q7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVPdXRJZCk7XG4gICAgICAgICAgY29uc3QgbmV3VGltZU91dCA9IHNldFRpbWVvdXQoXG4gICAgICAgICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXRcbiAgICAgICAgICApO1xuICAgICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgICAgIGNhbGxiYWNrLFxuICAgICAgICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgICAgICAgICAgdGltZU91dElkOiBuZXdUaW1lT3V0LFxuICAgICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IGhhbmRsZVN0YXR1c1VwZGF0ZShwYXlsb2FkLCBzdGF0dXMpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5zY2hlZHVsZU5ld01lc3NhZ2UocGF5bG9hZCBhcyBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUmVzcG9uc2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IHBheWxvYWQgaXMgSVJlc3BvbnNlPGFueT4ge1xuICAgIHJldHVybiBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGF5bG9hZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUmVzcG9uc2UocmVzcG9uc2U6IElSZXNwb25zZTxhbnk+KSB7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0SWQ7XG4gICAgY29uc3QgY2FsbGJhY2tPYmplY3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQocmVxdWVzdElkKTtcbiAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrT2JqZWN0LmNhbGxiYWNrKHJlc3BvbnNlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgZXhlY3V0aW5nIGNhbGxiYWNrIGZvciByZXF1ZXN0ICR7cmVxdWVzdElkfWAsIGVycm9yKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJlc3BvbnNlIGZvciB1bmtub3duIHJlcXVlc3Q6ICR7cmVxdWVzdElkfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXdNZXNzYWdlKG1lc3NhZ2U6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4pIHtcbiAgICB0aGlzLnNjaGVkdWxlVGFzayhcbiAgICAgIGFzeW5jIChpbnB1dCkgPT4gYXdhaXQgdGhpcy53cmFwQW5kUHJvY2Vzc1JlcXVlc3QoaW5wdXQpLFxuICAgICAgbWVzc2FnZVxuICAgICk7XG4gIH1cblxuICBATG9nZ2FibGUuaGFuZGxlRXJyb3JzXG4gIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc3RhcnREZXBlbmRlbmNpZXMoKTtcbiAgfVxuXG4gIEBMb2dnYWJsZS5oYW5kbGVFcnJvcnNcbiAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmxvYmJ5LnNlbmQoXG4gICAgICBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVxdWVzdChcbiAgICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgICBcIkNIRUNLT1VUXCIsXG4gICAgICAgIHRoaXMuZ2V0U2VydmVyU3RhdHVzKClcbiAgICAgIClcbiAgICApO1xuICAgIGF3YWl0IHRoaXMuc3RvcERlcGVuZGVuY2llcygpO1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIudW5yZWdpc3Rlck5vZGUoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NBbmROb3RpZnkoXG4gICAgb3V0cHV0OiBUYXNrT3V0cHV0PElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPj5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gRklYTUU6IERPIE5PVCBMT0cgV0lUSElOIFRISVMgTUVUSE9ELCBpdCBjYXVzZXMgaW5maW5pdGUgbG9vcCFcbiAgICBpZiAob3V0cHV0LnJlc3VsdCkge1xuICAgICAgaWYgKG91dHB1dC5yZXN1bHQucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE5vdGlmaWNhdGlvbihvdXRwdXQucmVzdWx0KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmROb3RpZmljYXRpb24oXG4gICAgcmVzcG9uc2U6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZWNpcGllbnRJZCA9IHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcztcbiAgICBpZiAocmVjaXBpZW50SWQpIHtcbiAgICAgIGNvbnN0IHBlZXIgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwocmVjaXBpZW50SWQpO1xuICAgICAgcGVlci5zZW5kKHJlc3BvbnNlKTtcbiAgICAgIC8vIFRPRE86IHZhbGlkYXRlIGlmIHBlZXIgZXhpc3RzIGJlZm9yZSBzZW5kaW5nIG1lc3NhZ2VcbiAgICAgIC8vIFRocm93IGlmIHBlZXIgbm90IGZvdW5kLlxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzZW5kU3RhdHVzVXBkYXRlKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgIFwiTWljcm9zZXJ2aWNlRnJhbWV3b3JrOjpTdGF0dXNVcGRhdGVcIixcbiAgICAgIHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICBzdGF0dXMsXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWRcbiAgICApO1xuICB9XG5cbiAgcHJvdGVjdGVkIG1ha2VSZXNwb25zZShcbiAgICBkYXRhOiBUUmVzcG9uc2VEYXRhLFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgZXJyb3I6IEVycm9yIHwgbnVsbFxuICApOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgcmVxdWVzdEhlYWRlcjogcmVxdWVzdC5oZWFkZXIsXG4gICAgICByZXNwb25zZUhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlc3BvbmRlckFkZHJlc3M6IHRoaXMuYWRkcmVzcyxcbiAgICAgIH0sXG4gICAgICBib2R5OiB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIHN1Y2Nlc3M6IGVycm9yID09PSBudWxsLFxuICAgICAgICBlcnJvcixcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGlmIChcbiAgICAgIHJlcXVlc3QuaGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgJiZcbiAgICAgICghZGF0YSB8fCAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSkgJiZcbiAgICAgICFlcnJvclxuICAgICkge1xuICAgICAgdGhpcy5lcnJvcihcbiAgICAgICAgYEF0dGVtcHRpbmcgdG8gc2VuZCBlbXB0eSBkYXRhIGZvciAke1xuICAgICAgICAgIHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlXG4gICAgICAgIH0uIERhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZGF0YSl9YCxcbiAgICAgICAgeyByZXF1ZXN0LCBlcnJvciB9XG4gICAgICApO1xuICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoXCJFbXB0eSByZXNwb25zZSBkYXRhXCIpO1xuICAgIH1cblxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzZW5kT25lV2F5TWVzc2FnZShcbiAgICBtZXNzYWdlVHlwZTogc3RyaW5nLFxuICAgIHRvOiBzdHJpbmcsXG4gICAgYm9keTogYW55LFxuICAgIHJlcXVlc3RJZD86IHN0cmluZ1xuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXF1ZXN0SWQgPSByZXF1ZXN0SWQgfHwgdGhpcy5nZW5lcmF0ZVJlcXVlc3RJZCgpO1xuXG4gICAgbGV0IHBlZXJBZGRyZXNzID0gXCJcIjtcbiAgICBpZiAodG8uc3RhcnRzV2l0aChgJHt0aGlzLm5hbWVzcGFjZX06YCkpIHtcbiAgICAgIHBlZXJBZGRyZXNzID0gdG87XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG5vZGVJZCA9IGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIuZ2V0TGVhc3RMb2FkZWROb2RlKHRvKTtcbiAgICAgIGlmICghbm9kZUlkKSB7XG4gICAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKGBObyBub2RlcyBhdmFpbGFibGUgZm9yIHNlcnZpY2UgJHt0b30uYCk7XG4gICAgICB9XG4gICAgICBwZWVyQWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RvfToke25vZGVJZH1gO1xuICAgIH1cblxuICAgIGNvbnN0IHBlZXIgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwocGVlckFkZHJlc3MpO1xuXG4gICAgbGV0IGhlYWRlcjogSVJlcXVlc3RIZWFkZXIgPSB7XG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICByZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0ZXJBZGRyZXNzOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHJlcXVlc3RUeXBlOiBtZXNzYWdlVHlwZSxcbiAgICAgIC8vIE5vdGU6IHJlY2lwaWVudEFkZHJlc3MgaXMgaW50ZW50aW9uYWxseSBvbWl0dGVkXG4gICAgfTtcblxuICAgIGhlYWRlciA9IHRoaXMuZW5yaWNoUmVxdWVzdChoZWFkZXIsIGJvZHkpO1xuXG4gICAgY29uc3QgbWVzc2FnZTogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgIGhlYWRlcixcbiAgICAgIGJvZHksXG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwZWVyLnNlbmQobWVzc2FnZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEZhaWxlZCB0byBzZW5kIG9uZS13YXkgbWVzc2FnZSB0byAke3RvfWAsIHtcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgbWVzc2FnZVR5cGUsXG4gICAgICB9KTtcbiAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKGBGYWlsZWQgdG8gc2VuZCBvbmUtd2F5IG1lc3NhZ2UgdG8gJHt0b31gLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIG1ha2VSZXF1ZXN0PFQ+KHByb3BzOiBSZXF1ZXN0UHJvcHMpOiBQcm9taXNlPElSZXNwb25zZTxUPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgIHRvLFxuICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICBib2R5LFxuICAgICAgcmVwbHlUbyxcbiAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZSxcbiAgICAgIGhlYWRlcnMsXG4gICAgICB0aW1lb3V0LFxuICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgIH0gPSBwcm9wcztcbiAgICByZXR1cm4gbmV3IFByb21pc2UoYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdElkID0gaGVhZGVycz8ucmVxdWVzdElkIHx8IHRoaXMuZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcblxuICAgICAgbGV0IHBlZXJBZGRyZXNzID0gXCJcIjtcbiAgICAgIGlmICh0by5zdGFydHNXaXRoKGAke3RoaXMubmFtZXNwYWNlfTpgKSkge1xuICAgICAgICBwZWVyQWRkcmVzcyA9IHRvO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgbm9kZUlkID0gYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci5nZXRMZWFzdExvYWRlZE5vZGUoXG4gICAgICAgICAgdG9cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFub2RlSWQpIHtcbiAgICAgICAgICByZWplY3QobmV3IExvZ2dhYmxlRXJyb3IoYE5vIG5vZGVzIGF2YWlsYWJsZSBmb3Igc2VydmljZSAke3RvfS5gKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHBlZXJBZGRyZXNzID0gYCR7dGhpcy5uYW1lc3BhY2V9OiR7dG99OiR7bm9kZUlkfWA7XG4gICAgICB9XG5cbiAgICAgIGxldCBoZWFkZXI6IElSZXF1ZXN0SGVhZGVyID0ge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgcmVxdWVzdGVyQWRkcmVzczogaGVhZGVycz8ucmVxdWVzdGVyQWRkcmVzcyB8fCB0aGlzLmFkZHJlc3MsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3M6IHJlcGx5VG8gfHwgdGhpcy5hZGRyZXNzLFxuICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgIH07XG5cbiAgICAgIGhlYWRlciA9IHRoaXMuZW5yaWNoUmVxdWVzdChoZWFkZXIsIGJvZHkpO1xuXG4gICAgICBjb25zdCByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+ID0ge1xuICAgICAgICBoZWFkZXIsXG4gICAgICAgIGJvZHksXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjYWxsYmFjazogQ2FsbGJhY2tGdW5jdGlvbjxUPiA9IGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmIChyZXNwb25zZS5ib2R5LnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgIHJlc29sdmUocmVzcG9uc2UpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmVycm9yKGBSZXF1ZXN0IHRvICR7dG99IGZhaWxlZGAsIHtcbiAgICAgICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgICAgICBlcnJvcjogcmVzcG9uc2UuYm9keS5lcnJvcixcbiAgICAgICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgICAgICAgIHRvLFxuICAgICAgICAgICAgICByZXBseVRvLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZWplY3QoXG4gICAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKGBSZXF1ZXN0IHRvICR7dG99IGZhaWxlZGAsIHtcbiAgICAgICAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLFxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmVycm9yKGBFcnJvciBpbiBjYWxsYmFjayBmb3IgcmVxdWVzdCAke3JlcXVlc3RJZH1gLCBlcnJvcik7XG4gICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVzcG9uc2UgZnJvbSAke3RvfWAsIGVycm9yKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRpbWVvdXQgfHwgdGhpcy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0O1xuICAgICAgY29uc3QgdGltZW91dENiID1cbiAgICAgICAgdGltZW91dENhbGxiYWNrIHx8XG4gICAgICAgICgoKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMucGVuZGluZ1JlcXVlc3RzLmhhcyhyZXF1ZXN0SWQpKSB7XG4gICAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgICAgICAgIHRoaXMud2FybihgUmVxdWVzdCB0byAke3RvfSB0aW1lZCBvdXRgLCB7XG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgdGltZW91dE1zLFxuICAgICAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihcbiAgICAgICAgICAgICAgICBgUmVxdWVzdCB0byAke3RvfSB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0TXN9bXNgXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIGNvbnN0IHRpbWVPdXRJZCA9IHNldFRpbWVvdXQodGltZW91dENiLCB0aW1lb3V0TXMpO1xuICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KHJlcXVlc3RJZCwge1xuICAgICAgICBjYWxsYmFjayxcbiAgICAgICAgdGltZW91dENhbGxiYWNrOiB0aW1lb3V0Q2IsXG4gICAgICAgIHRpbWVPdXRJZCxcbiAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOlxuICAgICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZSB8fCB0aGlzLmhhbmRsZVN0YXR1c1VwZGF0ZS5iaW5kKHRoaXMpLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHBlZXJBZGRyZXNzKTtcblxuICAgICAgcGVlci5zZW5kKHJlcXVlc3QpLmNhdGNoKChlcnJvcjogYW55KSA9PiB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCByZXF1ZXN0IHRvICR7dG99YCwge1xuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlamVjdChuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIGVycm9yKSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVSZXF1ZXN0SWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXJ2aWNlSWR9LSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpXG4gICAgICAudG9TdHJpbmcoMzYpXG4gICAgICAuc3Vic3RyKDIsIDkpfWA7XG4gIH1cbn1cblxuZXhwb3J0IHtcbiAgU2VydmVyUnVubmVyLFxuICBQdWJTdWJDb25zdW1lcixcbiAgUHViU3ViQ29uc3VtZXJPcHRpb25zLFxuICBNZXNzYWdlSGFuZGxlcixcbiAgTG9nZ2FibGUsXG4gIENvbnNvbGVTdHJhdGVneSxcbiAgbG9nTWV0aG9kLFxufTtcbmV4cG9ydCAqIGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbiJdfQ==