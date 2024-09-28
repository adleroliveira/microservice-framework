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
exports.PubSubConsumer = exports.ServerRunner = exports.MicroserviceFramework = void 0;
exports.RequestHandler = RequestHandler;
const RateLimitedTaskScheduler_1 = require("./RateLimitedTaskScheduler");
const Loggable_1 = require("./utils/logging/Loggable");
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQWlDQSx3Q0FlQztBQS9DRCx5RUFHb0M7QUFDcEMsdURBQStFO0FBQy9FLHVFQUFvRTtBQUVwRSw0QkFBMEI7QUFDMUIsK0JBQW9DO0FBQ3BDLDZEQUEwRDtBQUMxRCxpREFBOEM7QUFxckJyQyw2RkFyckJBLDJCQUFZLE9BcXJCQTtBQXByQnJCLHFEQUFrRDtBQW9yQjNCLCtGQXByQmQsK0JBQWMsT0FvckJjO0FBbHJCckMsdUNBQXVDO0FBQ3ZDLE1BQU0sNEJBQTRCLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFZOUQsbUVBQW1FO0FBQ25FLFNBQVMsb0JBQW9CO0lBQzNCLE9BQU8sRUFBaUMsQ0FBQztBQUMzQyxDQUFDO0FBRUQsdUJBQXVCO0FBQ3ZCLFNBQWdCLGNBQWMsQ0FBSSxXQUFtQjtJQUNuRCxPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQXNDO1FBRXRDLE1BQU0sa0JBQWtCLEdBQUcsb0JBQW9CLEVBQUssQ0FBQztRQUNyRCxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFDO1FBQ3ZFLE9BQU8sQ0FBQyxjQUFjLENBQ3BCLDRCQUE0QixFQUM1QixFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxFQUNqRSxNQUFNLEVBQ04sV0FBVyxDQUNaLENBQUM7SUFDSixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsdUVBQXVFO0FBQ3ZFLFNBQVMsa0JBQWtCLENBQUMsTUFBVztJQUNyQyxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBa0MsQ0FBQztJQUUz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SUFBSSxJQUFJLENBQUMsa0JBQWtCLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQzthQUMzRCxDQUFDLENBQUM7WUFDSCxNQUFNLElBQUksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQUMsV0FBVyxDQUFDLENBQUM7WUFFbEUsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxLQUFVLEVBQUUsRUFBRTtnQkFDdEMsSUFBSSxDQUFDLGVBQWUsQ0FBQyxNQUFNLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQ3ZDLElBQUksQ0FBQyxLQUFLLENBQUMsNkJBQTZCLEVBQUUsRUFBRSxFQUFFO29CQUM1QyxLQUFLO29CQUNMLFNBQVM7b0JBQ1QsV0FBVztpQkFDWixDQUFDLENBQUM7Z0JBQ0gsTUFBTSxDQUFDLElBQUksd0JBQWEsQ0FBQyw2QkFBNkIsRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQztZQUN0RSxDQUFDLENBQUMsQ0FBQztRQUNMLENBQUMsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztJQUVPLGlCQUFpQjtRQUN2QixPQUFPLEdBQUcsSUFBSSxDQUFDLFNBQVMsSUFBSSxJQUFJLENBQUMsR0FBRyxFQUFFLElBQUksSUFBSSxDQUFDLE1BQU0sRUFBRTthQUNwRCxRQUFRLENBQUMsRUFBRSxDQUFDO2FBQ1osTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUMsRUFBRSxDQUFDO0lBQ3BCLENBQUM7Q0FDRjtBQXRqQkQsc0RBc2pCQztBQTdQTztJQURMLG1CQUFRLENBQUMsWUFBWTs7OztrREFHckI7QUFHSztJQURMLG1CQUFRLENBQUMsWUFBWTs7OztpREFjckI7QUE4T0gsK0NBQTZCIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgSU1lc3NhZ2UsIElCYWNrRW5kLCBDaGFubmVsQmluZGluZyB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7XG4gIFJhdGVMaW1pdGVkVGFza1NjaGVkdWxlcixcbiAgVGFza091dHB1dCxcbn0gZnJvbSBcIi4vUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyXCI7XG5pbXBvcnQgeyBMb2dnYWJsZSwgTG9nZ2FibGVFcnJvciwgTG9nTWVzc2FnZSB9IGZyb20gXCIuL3V0aWxzL2xvZ2dpbmcvTG9nZ2FibGVcIjtcbmltcG9ydCB7IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyIH0gZnJvbSBcIi4vU2VydmljZURpc2NvdmVyeU1hbmFnZXJcIjtcbmltcG9ydCB7IElSZXF1ZXN0LCBJUmVzcG9uc2UsIElSZXF1ZXN0SGVhZGVyIH0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IFwicmVmbGVjdC1tZXRhZGF0YVwiO1xuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSBcInV1aWRcIjtcbmltcG9ydCB7IExvZ1N0cmF0ZWd5IH0gZnJvbSBcIi4vdXRpbHMvbG9nZ2luZy9Mb2dTdHJhdGVneVwiO1xuaW1wb3J0IHsgU2VydmVyUnVubmVyIH0gZnJvbSBcIi4vU2VydmVyUnVubmVyXCI7XG5pbXBvcnQgeyBQdWJTdWJDb25zdW1lciB9IGZyb20gXCIuL1B1YlN1YkNvbnN1bWVyXCI7XG5cbi8vIERlZmluZSBhIHN5bWJvbCBmb3Igb3VyIG1ldGFkYXRhIGtleVxuY29uc3QgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSA9IFN5bWJvbChcInJlcXVlc3RIYW5kbGVyXCIpO1xuXG4vLyBEZWZpbmUgYW4gaW50ZXJmYWNlIGZvciB0aGUgbWV0YWRhdGEgd2UnbGwgc3RvcmVcbmludGVyZmFjZSBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhIHtcbiAgcmVxdWVzdFR5cGU6IHN0cmluZztcbiAgbWV0aG9kOiBzdHJpbmc7XG4gIGFjY2VwdHNGdWxsUmVxdWVzdDogYm9vbGVhbjtcbiAgaXNBc3luYzogYm9vbGVhbjtcbn1cblxudHlwZSBJc0Z1bGxSZXF1ZXN0PFQ+ID0gVCBleHRlbmRzIElSZXF1ZXN0PGFueT4gPyB0cnVlIDogZmFsc2U7XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgaWYgdGhlIGhhbmRsZXIgYWNjZXB0cyBmdWxsIHJlcXVlc3RcbmZ1bmN0aW9uIGlzRnVsbFJlcXVlc3RIYW5kbGVyPFQ+KCk6IGJvb2xlYW4ge1xuICByZXR1cm4ge30gYXMgSXNGdWxsUmVxdWVzdDxUPiBhcyBib29sZWFuO1xufVxuXG4vLyBDcmVhdGUgdGhlIGRlY29yYXRvclxuZXhwb3J0IGZ1bmN0aW9uIFJlcXVlc3RIYW5kbGVyPFQ+KHJlcXVlc3RUeXBlOiBzdHJpbmcpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIDxNIGV4dGVuZHMgKGFyZzogVCkgPT4gUHJvbWlzZTxhbnk+IHwgYW55PihcbiAgICB0YXJnZXQ6IGFueSxcbiAgICBwcm9wZXJ0eUtleTogc3RyaW5nLFxuICAgIGRlc2NyaXB0b3I6IFR5cGVkUHJvcGVydHlEZXNjcmlwdG9yPE0+XG4gICkge1xuICAgIGNvbnN0IGFjY2VwdHNGdWxsUmVxdWVzdCA9IGlzRnVsbFJlcXVlc3RIYW5kbGVyPFQ+KCk7XG4gICAgY29uc3QgaXNBc3luYyA9IGRlc2NyaXB0b3IudmFsdWU/LmNvbnN0cnVjdG9yLm5hbWUgPT09IFwiQXN5bmNGdW5jdGlvblwiO1xuICAgIFJlZmxlY3QuZGVmaW5lTWV0YWRhdGEoXG4gICAgICBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZLFxuICAgICAgeyByZXF1ZXN0VHlwZSwgbWV0aG9kOiBwcm9wZXJ0eUtleSwgYWNjZXB0c0Z1bGxSZXF1ZXN0LCBpc0FzeW5jIH0sXG4gICAgICB0YXJnZXQsXG4gICAgICBwcm9wZXJ0eUtleVxuICAgICk7XG4gIH07XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBnZXQgYWxsIG1ldGhvZHMgd2l0aCB0aGUgUmVxdWVzdEhhbmRsZXIgZGVjb3JhdG9yXG5mdW5jdGlvbiBnZXRSZXF1ZXN0SGFuZGxlcnModGFyZ2V0OiBhbnkpOiBNYXA8c3RyaW5nLCBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhPiB7XG4gIGNvbnN0IGhhbmRsZXJzID0gbmV3IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+KCk7XG5cbiAgbGV0IGN1cnJlbnRUYXJnZXQgPSB0YXJnZXQucHJvdG90eXBlO1xuICB3aGlsZSAoY3VycmVudFRhcmdldCkge1xuICAgIGZvciAoY29uc3QgcHJvcGVydHlOYW1lIG9mIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKGN1cnJlbnRUYXJnZXQpKSB7XG4gICAgICBjb25zdCBtZXRhZGF0YTogUmVxdWVzdEhhbmRsZXJNZXRhZGF0YSB8IHVuZGVmaW5lZCA9IFJlZmxlY3QuZ2V0TWV0YWRhdGEoXG4gICAgICAgIFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVksXG4gICAgICAgIGN1cnJlbnRUYXJnZXQsXG4gICAgICAgIHByb3BlcnR5TmFtZVxuICAgICAgKTtcbiAgICAgIGlmIChtZXRhZGF0YSkge1xuICAgICAgICBoYW5kbGVycy5zZXQobWV0YWRhdGEucmVxdWVzdFR5cGUsIG1ldGFkYXRhKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjdXJyZW50VGFyZ2V0ID0gT2JqZWN0LmdldFByb3RvdHlwZU9mKGN1cnJlbnRUYXJnZXQpO1xuICB9XG5cbiAgcmV0dXJuIGhhbmRsZXJzO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIElTZXJ2ZXJDb25maWcge1xuICBuYW1lc3BhY2U6IHN0cmluZztcbiAgY29uY3VycmVuY3lMaW1pdDogbnVtYmVyO1xuICByZXF1ZXN0c1BlckludGVydmFsOiBudW1iZXI7XG4gIHRwc0ludGVydmFsOiBudW1iZXI7XG4gIHNlcnZpY2VJZDogc3RyaW5nO1xuICByZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0PzogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFNlcnZpY2VTdGF0dXMgZXh0ZW5kcyBJU2VydmVyQ29uZmlnIHtcbiAgaW5zdGFuY2VJZDogc3RyaW5nO1xuICBwZW5kaW5nUmVxdWVzdHM6IG51bWJlcjtcbiAgcXVldWVTaXplOiBudW1iZXI7XG4gIHJ1bm5pbmdUYXNrczogbnVtYmVyO1xuICB0aW1lc3RhbXA6IG51bWJlcjtcbiAgYWRkcmVzczogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YXR1c1VwZGF0ZSB7XG4gIHN0YXR1czogc3RyaW5nO1xuICBwcm9ncmVzcz86IG51bWJlcjtcbiAgbWV0YWRhdGE/OiBhbnk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVxdWVzdFByb3BzIHtcbiAgcmVxdWVzdFR5cGU6IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgYm9keTogYW55O1xuICByZXBseVRvPzogc3RyaW5nO1xuICBoYW5kbGVTdGF0dXNVcGRhdGU/OiAoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICBzdGF0dXM6IFN0YXR1c1VwZGF0ZVxuICApID0+IFByb21pc2U8dm9pZD47XG4gIHRpbWVvdXRDYWxsYmFjaz86ICgpID0+IHZvaWQ7XG4gIHRpbWVvdXQ/OiBudW1iZXI7XG4gIGhlYWRlcnM/OiBJUmVxdWVzdEhlYWRlcjtcbiAgaXNCcm9hZGNhc3Q/OiBib29sZWFuO1xufVxuXG50eXBlIENhbGxiYWNrRnVuY3Rpb248VD4gPSAocmVzcG9uc2U6IElSZXNwb25zZTxUPikgPT4gUHJvbWlzZTx2b2lkPjtcbnR5cGUgQ2FsbGJhY2tPYmplY3Q8VD4gPSB7XG4gIGNhbGxiYWNrOiBDYWxsYmFja0Z1bmN0aW9uPFQ+O1xuICB0aW1lb3V0Q2FsbGJhY2s6ICgpID0+IHZvaWQ7XG4gIGhhbmRsZVN0YXR1c1VwZGF0ZTogKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFQ+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgdGltZU91dElkOiBOb2RlSlMuVGltZW91dDtcbn07XG5cbmNsYXNzIE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5IGV4dGVuZHMgTG9nU3RyYXRlZ3kge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGxvZ0NoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PExvZ01lc3NhZ2U+Pikge1xuICAgIHN1cGVyKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFBhY2thZ2VkKFxuICAgIHBhY2thZ2VkTWVzc2FnZTogSVJlcXVlc3Q8YW55PixcbiAgICBvcHRpb25zPzogUmVjb3JkPHN0cmluZywgYW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxvZ0NoYW5uZWwuc2VuZChwYWNrYWdlZE1lc3NhZ2UpO1xuICB9XG59XG5cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBNaWNyb3NlcnZpY2VGcmFtZXdvcms8XG4gIFRSZXF1ZXN0Qm9keSxcbiAgVFJlc3BvbnNlRGF0YVxuPiBleHRlbmRzIFJhdGVMaW1pdGVkVGFza1NjaGVkdWxlcjxcbiAgSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PixcbiAgSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+XG4+IHtcbiAgLy8gUmVmYWN0b3JpbmcgWm9uZVxuICByZWFkb25seSBuYW1lc3BhY2U6IHN0cmluZztcbiAgcHJpdmF0ZSBsb2JieTogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8YW55Pj47XG4gIHByaXZhdGUgc2VydmljZUNoYW5uZWw6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcm90ZWN0ZWQgYnJvYWRjYXN0Q2hhbm5lbDogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8YW55Pj47XG4gIHJlYWRvbmx5IGFkZHJlc3M6IHN0cmluZztcbiAgLy8gRW5kIG9mIHJlZmFjdG9yaW5nIHpvbmUuXG5cbiAgcHJvdGVjdGVkIGJhY2tlbmQ6IElCYWNrRW5kO1xuICBwcm90ZWN0ZWQgc2VydmVyQ29uZmlnOiBJU2VydmVyQ29uZmlnO1xuICBwcm90ZWN0ZWQgc2VydmljZUlkOiBzdHJpbmc7XG4gIHByb3RlY3RlZCBpc0V4ZWN1dGluZzogYm9vbGVhbiA9IGZhbHNlO1xuICBwcm90ZWN0ZWQgc3RhdHVzVXBkYXRlSW50ZXJ2YWw6IG51bWJlciA9IDEyMDAwMDtcbiAgcHJvdGVjdGVkIHJlcXVlc3RDYWxsYmFja1RpbWVvdXQ6IG51bWJlciA9IDMwMDAwO1xuICBwcml2YXRlIHN0YXR1c1VwZGF0ZVRpbWVvdXRJZDogTm9kZUpTLlRpbWVvdXQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwZW5kaW5nUmVxdWVzdHM6IE1hcDxzdHJpbmcsIENhbGxiYWNrT2JqZWN0PGFueT4+ID0gbmV3IE1hcCgpO1xuICBwcml2YXRlIHJlcXVlc3RIYW5kbGVyczogTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT47XG4gIHJlYWRvbmx5IHNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyOiBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcjtcblxuICBjb25zdHJ1Y3RvcihiYWNrZW5kOiBJQmFja0VuZCwgY29uZmlnOiBJU2VydmVyQ29uZmlnKSB7XG4gICAgc3VwZXIoXG4gICAgICBjb25maWcuY29uY3VycmVuY3lMaW1pdCxcbiAgICAgIGNvbmZpZy5yZXF1ZXN0c1BlckludGVydmFsLFxuICAgICAgY29uZmlnLnRwc0ludGVydmFsXG4gICAgKTtcbiAgICB0aGlzLm5hbWVzcGFjZSA9IGNvbmZpZy5uYW1lc3BhY2U7XG4gICAgdGhpcy5zZXJ2ZXJDb25maWcgPSBjb25maWc7XG4gICAgdGhpcy5iYWNrZW5kID0gYmFja2VuZDtcbiAgICB0aGlzLnNlcnZpY2VJZCA9IGNvbmZpZy5zZXJ2aWNlSWQ7XG4gICAgdGhpcy5hZGRyZXNzID0gYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OiR7dGhpcy5pbnN0YW5jZUlkfWA7XG4gICAgdGhpcy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0ID1cbiAgICAgIGNvbmZpZy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0IHx8IHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dDtcbiAgICB0aGlzLnJlcXVlc3RIYW5kbGVycyA9IGdldFJlcXVlc3RIYW5kbGVycyh0aGlzLmNvbnN0cnVjdG9yKTtcbiAgICB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyID0gbmV3IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyKFxuICAgICAgdGhpcy5iYWNrZW5kLnNlcnZpY2VSZWdpc3RyeVxuICAgICk7XG4gICAgdGhpcy5pbml0aWFsaXplKCk7XG4gIH1cblxuICBhc3luYyBpbml0aWFsaXplKCkge1xuICAgIHRoaXMuc2VydmljZUNoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH1gLFxuICAgICAgdGhpcy5oYW5kbGVTZXJ2aWNlTWVzc2FnZXMuYmluZCh0aGlzKVxuICAgICk7XG4gICAgdGhpcy5icm9hZGNhc3RDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmJyb2FkY2FzdGBcbiAgICApO1xuICAgIHRoaXMubG9iYnkgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06bG9iYnlgLFxuICAgICAgdGhpcy5oYW5kbGVMb2JieU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIGNvbnN0IGxvZ0NoYW5uZWwgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwoXG4gICAgICBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06bG9nc2BcbiAgICApO1xuICAgIGNvbnN0IG1pY3Jvc2VyaXZjZUxvZ1N0cmF0ZWd5ID0gbmV3IE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5KGxvZ0NoYW5uZWwpO1xuICAgIExvZ2dhYmxlLnNldExvZ1N0cmF0ZWd5KG1pY3Jvc2VyaXZjZUxvZ1N0cmF0ZWd5KTtcbiAgICB0aGlzLmluZm8oXCJMb2cgU3RyYXRlZ3kgc2V0IHRvIE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5XCIpO1xuICAgIHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChcbiAgICAgIHRoaXMuYWRkcmVzcyxcbiAgICAgIHRoaXMuaGFuZGxlSW5jb21pbmdNZXNzYWdlLmJpbmQodGhpcylcbiAgICApO1xuICAgIGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIucmVnaXN0ZXJOb2RlKFxuICAgICAgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICB0aGlzLmluc3RhbmNlSWQsXG4gICAgICB0aGlzLnF1ZXVlLnNpemUoKVxuICAgICk7XG4gICAgYXdhaXQgdGhpcy5sb2JieS5zZW5kKFxuICAgICAgTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmNyZWF0ZVJlcXVlc3QoXG4gICAgICAgIHRoaXMuYWRkcmVzcyxcbiAgICAgICAgXCJDSEVDS0lOXCIsXG4gICAgICAgIHRoaXMuZ2V0U2VydmVyU3RhdHVzKClcbiAgICAgIClcbiAgICApO1xuICAgIHRoaXMub25UYXNrQ29tcGxldGUodGhpcy5wcm9jZXNzQW5kTm90aWZ5LmJpbmQodGhpcykpO1xuICAgIHRoaXMuc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCk7XG4gICAgdGhpcy5pbmZvKGBTZXJ2aWNlICR7dGhpcy5zZXJ2aWNlSWR9IFske3RoaXMuaW5zdGFuY2VJZH1dIGluaXRpYWxpemVkLmApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1cGRhdGVMb2FkTGV2ZWwoKSB7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci51cGRhdGVOb2RlTG9hZChcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgdGhpcy5xdWV1ZS5zaXplKClcbiAgICApO1xuICAgIHRoaXMuc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc3RhcnREZXBlbmRlbmNpZXMoKSB7fVxuICBwcm90ZWN0ZWQgYXN5bmMgc3RvcERlcGVuZGVuY2llcygpIHt9XG5cbiAgc3RhdGljIGNyZWF0ZVJlcXVlc3Q8VD4oXG4gICAgcmVxdWVzdGVyQWRkcmVzczogc3RyaW5nLFxuICAgIHJlcXVlc3RUeXBlOiBzdHJpbmcsXG4gICAgYm9keTogVCxcbiAgICByZWNpcGllbnRBZGRyZXNzPzogc3RyaW5nXG4gICk6IElSZXF1ZXN0PFQ+IHtcbiAgICByZXR1cm4ge1xuICAgICAgaGVhZGVyOiB7XG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgICAgcmVxdWVzdElkOiB1dWlkdjQoKSxcbiAgICAgICAgcmVxdWVzdGVyQWRkcmVzcyxcbiAgICAgICAgcmVjaXBpZW50QWRkcmVzcyxcbiAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICB9LFxuICAgICAgYm9keSxcbiAgICB9O1xuICB9XG5cbiAgc3RhdGljIGNyZWF0ZVJlc3BvbnNlPFQ+KFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgcmVzcG9uZGVyQWRkcmVzczogc3RyaW5nLFxuICAgIGRhdGE6IFQsXG4gICAgc3VjY2VzczogYm9vbGVhbiA9IHRydWUsXG4gICAgZXJyb3I6IEVycm9yIHwgbnVsbCA9IG51bGxcbiAgKTogSVJlc3BvbnNlPFQ+IHtcbiAgICByZXR1cm4ge1xuICAgICAgcmVxdWVzdEhlYWRlcjogcmVxdWVzdC5oZWFkZXIsXG4gICAgICByZXNwb25zZUhlYWRlcjoge1xuICAgICAgICByZXNwb25kZXJBZGRyZXNzLFxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICB9LFxuICAgICAgYm9keToge1xuICAgICAgICBkYXRhLFxuICAgICAgICBzdWNjZXNzLFxuICAgICAgICBlcnJvcixcbiAgICAgIH0sXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0U2VydmVyU3RhdHVzKCk6IFNlcnZpY2VTdGF0dXMge1xuICAgIGNvbnN0IHN0YXR1cyA9IHtcbiAgICAgIC4uLnRoaXMuc2VydmVyQ29uZmlnLFxuICAgICAgaW5zdGFuY2VJZDogdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgcGVuZGluZ1JlcXVlc3RzOiB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5zaXplLFxuICAgICAgcXVldWVTaXplOiB0aGlzLnF1ZXVlLnNpemUoKSxcbiAgICAgIHJ1bm5pbmdUYXNrczogdGhpcy5ydW5uaW5nVGFza3MsXG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICBhZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgfTtcblxuICAgIHJldHVybiBzdGF0dXM7XG4gIH1cblxuICBwdWJsaWMgZ2V0c2VydmljZUlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmljZUlkO1xuICB9XG5cbiAgcHVibGljIGdldEJhY2tlbmQoKTogSUJhY2tFbmQge1xuICAgIHJldHVybiB0aGlzLmJhY2tlbmQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlU2VydmljZU1lc3NhZ2VzPFQ+KG1lc3NhZ2U6IFQpIHt9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGhhbmRsZUxvYmJ5TWVzc2FnZXMoXG4gICAgbWVzc2FnZTogSU1lc3NhZ2U8SVJlcXVlc3Q8U2VydmljZVN0YXR1cz4+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChtZXNzYWdlLnBheWxvYWQuaGVhZGVyLnJlcXVlc3RUeXBlID09PSBcIkNIRUNLSU5cIikge1xuICAgICAgdGhpcy5pbmZvKFxuICAgICAgICBgUmVjZWl2ZWQgQ0hFQ0tJTiBmcm9tICR7bWVzc2FnZS5wYXlsb2FkLmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzfWBcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKSB7XG4gICAgaWYgKHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQpO1xuICAgIH1cbiAgICB0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy51cGRhdGVMb2FkTGV2ZWwoKTtcbiAgICAgIHRoaXMuc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCk7XG4gICAgfSwgdGhpcy5zdGF0dXNVcGRhdGVJbnRlcnZhbCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NSZXF1ZXN0KFxuICAgIGlucHV0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+XG4gICk6IFByb21pc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIGNvbnN0IHJlcXVlc3RUeXBlID0gaW5wdXQuaGVhZGVyLnJlcXVlc3RUeXBlO1xuICAgIGlmICghcmVxdWVzdFR5cGUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIlJlcXVlc3QgdHlwZSBub3Qgc3BlY2lmaWVkXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IGhhbmRsZXJNZXRhZGF0YSA9IHRoaXMucmVxdWVzdEhhbmRsZXJzLmdldChyZXF1ZXN0VHlwZSk7XG4gICAgaWYgKCFoYW5kbGVyTWV0YWRhdGEpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTm8gaGFuZGxlciBmb3VuZCBmb3IgcmVxdWVzdCB0eXBlOiAke3JlcXVlc3RUeXBlfWApO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIGhhbmRsZXIgbWV0aG9kXG4gICAgY29uc3QgaGFuZGxlck1ldGhvZCA9ICh0aGlzIGFzIGFueSlbaGFuZGxlck1ldGFkYXRhLm1ldGhvZF0uYmluZCh0aGlzKTtcbiAgICBjb25zdCBhcmdzID0gaGFuZGxlck1ldGFkYXRhLmFjY2VwdHNGdWxsUmVxdWVzdCA/IGlucHV0IDogaW5wdXQuYm9keTtcblxuICAgIGNvbnN0IGhhbmRsZXJSZXNwb25zZSA9IGhhbmRsZXJNZXRhZGF0YS5pc0FzeW5jXG4gICAgICA/IGF3YWl0IGhhbmRsZXJNZXRob2QoYXJncylcbiAgICAgIDogaGFuZGxlck1ldGhvZChhcmdzKTtcblxuICAgIHJldHVybiBoYW5kbGVyUmVzcG9uc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyYXBBbmRQcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPj4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NSZXF1ZXN0KGlucHV0KTtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKHJlc3VsdCwgaW5wdXQsIG51bGwpO1xuICAgICAgcmVzcG9uc2UgPSB0aGlzLmVucmljaFJlc3BvbnNlKHJlc3BvbnNlLCBpbnB1dCk7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKFxuICAgICAgICB7fSBhcyBUUmVzcG9uc2VEYXRhLFxuICAgICAgICBpbnB1dCxcbiAgICAgICAgZXJyb3IgYXMgRXJyb3JcbiAgICAgICk7XG4gICAgICByZXNwb25zZSA9IHRoaXMuZW5yaWNoUmVzcG9uc2UocmVzcG9uc2UsIGlucHV0KTtcbiAgICAgIHJldHVybiByZXNwb25zZTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaGFuZGxlU3RhdHVzVXBkYXRlKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKTogUHJvbWlzZTx2b2lkPiB7fVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXNwb25zZShcbiAgICByZXNwb25zZTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+LFxuICAgIG9yaWdpbmFsUmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb24gZG9lcyBub3RoaW5nXG4gICAgLy8gQ29uY3JldGUgY2xhc3NlcyBjYW4gb3ZlcnJpZGUgdGhpcyBtZXRob2QgdG8gYWRkIGN1c3RvbSBlbnJpY2htZW50XG4gICAgLy8gRklYTUU6IEZvciBub3csIGxvZ2dpbmcgd2l0aGluIHRoaXMgbWV0aG9kIGNhdXNlcyBpbmZpbml0ZSBsb29wLlxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXF1ZXN0KGhlYWRlcjogSVJlcXVlc3RIZWFkZXIsIGJvZHk6IGFueSk6IElSZXF1ZXN0SGVhZGVyIHtcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9uOiByZXR1cm4gdGhlIGhlYWRlciB1bmNoYW5nZWRcbiAgICByZXR1cm4gaGVhZGVyO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVJbmNvbWluZ01lc3NhZ2UoXG4gICAgbWVzc2FnZTogSU1lc3NhZ2U8SVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwYXlsb2FkID0gbWVzc2FnZS5wYXlsb2FkO1xuXG4gICAgLy8gcmlnaHQgbm93IHdlIGRvbid0IHdhaXQgdG8gc2VlIGlmIHRoZSBhY2tub3dsZWRnZW1lbnQgc3VjY2VlZGVkLlxuICAgIC8vIHdlIG1pZ2h0IHdhbnQgdG8gZG8gdGhpcyBpbiB0aGUgZnV0dXJlLlxuICAgIGF3YWl0IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5hY2sobWVzc2FnZSk7XG5cbiAgICBpZiAodGhpcy5pc1Jlc3BvbnNlKHBheWxvYWQpKSB7XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZVJlc3BvbnNlKHBheWxvYWQpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoXG4gICAgICAgIHBheWxvYWQuaGVhZGVyLnJlcXVlc3RUeXBlID09PSBcIk1pY3Jvc2VydmljZUZyYW1ld29yazo6U3RhdHVzVXBkYXRlXCJcbiAgICAgICkge1xuICAgICAgICBjb25zdCByZXF1ZXN0SWQgPSBwYXlsb2FkLmhlYWRlci5yZXF1ZXN0SWQ7XG4gICAgICAgIGNvbnN0IHN0YXR1cyA9IHBheWxvYWQuYm9keSBhcyBTdGF0dXNVcGRhdGU7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrT2JqZWN0ID0gdGhpcy5wZW5kaW5nUmVxdWVzdHMuZ2V0KHJlcXVlc3RJZCk7XG4gICAgICAgIGlmIChjYWxsYmFja09iamVjdCkge1xuICAgICAgICAgIGNvbnN0IHsgY2FsbGJhY2ssIHRpbWVvdXRDYWxsYmFjaywgdGltZU91dElkLCBoYW5kbGVTdGF0dXNVcGRhdGUgfSA9XG4gICAgICAgICAgICBjYWxsYmFja09iamVjdDtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGltZU91dElkKTtcbiAgICAgICAgICBjb25zdCBuZXdUaW1lT3V0ID0gc2V0VGltZW91dChcbiAgICAgICAgICAgIHRpbWVvdXRDYWxsYmFjayxcbiAgICAgICAgICAgIHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dFxuICAgICAgICAgICk7XG4gICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KHJlcXVlc3RJZCwge1xuICAgICAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgICAgICAgICB0aW1lT3V0SWQ6IG5ld1RpbWVPdXQsXG4gICAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGUsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYXdhaXQgaGFuZGxlU3RhdHVzVXBkYXRlKHBheWxvYWQsIHN0YXR1cyk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aGlzLnNjaGVkdWxlTmV3TWVzc2FnZShtZXNzYWdlIGFzIElNZXNzYWdlPElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4+KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUmVzcG9uc2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IHBheWxvYWQgaXMgSVJlc3BvbnNlPGFueT4ge1xuICAgIHJldHVybiBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGF5bG9hZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUmVzcG9uc2UocmVzcG9uc2U6IElSZXNwb25zZTxhbnk+KSB7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0SWQ7XG4gICAgY29uc3QgY2FsbGJhY2tPYmplY3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQocmVxdWVzdElkKTtcbiAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrT2JqZWN0LmNhbGxiYWNrKHJlc3BvbnNlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgZXhlY3V0aW5nIGNhbGxiYWNrIGZvciByZXF1ZXN0ICR7cmVxdWVzdElkfWAsIGVycm9yKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJlc3BvbnNlIGZvciB1bmtub3duIHJlcXVlc3Q6ICR7cmVxdWVzdElkfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXdNZXNzYWdlKG1lc3NhZ2U6IElNZXNzYWdlPElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4+KSB7XG4gICAgdGhpcy5zY2hlZHVsZVRhc2soXG4gICAgICBhc3luYyAoaW5wdXQpID0+IGF3YWl0IHRoaXMud3JhcEFuZFByb2Nlc3NSZXF1ZXN0KGlucHV0KSxcbiAgICAgIG1lc3NhZ2UucGF5bG9hZFxuICAgICk7XG4gIH1cblxuICBATG9nZ2FibGUuaGFuZGxlRXJyb3JzXG4gIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc3RhcnREZXBlbmRlbmNpZXMoKTtcbiAgfVxuXG4gIEBMb2dnYWJsZS5oYW5kbGVFcnJvcnNcbiAgYXN5bmMgc3RvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnN0b3BEZXBlbmRlbmNpZXMoKTtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnVucmVnaXN0ZXJOb2RlKFxuICAgICAgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICB0aGlzLmluc3RhbmNlSWRcbiAgICApO1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tPVVRcIixcbiAgICAgICAgdGhpcy5nZXRTZXJ2ZXJTdGF0dXMoKVxuICAgICAgKVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHByb2Nlc3NBbmROb3RpZnkoXG4gICAgb3V0cHV0OiBUYXNrT3V0cHV0PElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPj5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gRklYTUU6IERPIE5PVCBMT0cgV0lUSElOIFRISVMgTUVUSE9ELCBpdCBjYXVzZXMgaW5maW5pdGUgbG9vcCFcbiAgICBpZiAob3V0cHV0LnJlc3VsdCkge1xuICAgICAgaWYgKG91dHB1dC5yZXN1bHQucmVxdWVzdEhlYWRlci5yZWNpcGllbnRBZGRyZXNzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE5vdGlmaWNhdGlvbihvdXRwdXQucmVzdWx0KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmROb3RpZmljYXRpb24oXG4gICAgcmVzcG9uc2U6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZWNpcGllbnRJZCA9IHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcztcbiAgICBpZiAocmVjaXBpZW50SWQpIHtcbiAgICAgIGNvbnN0IHBlZXIgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwocmVjaXBpZW50SWQpO1xuICAgICAgcGVlci5zZW5kKHJlc3BvbnNlKTtcbiAgICAgIC8vIFRPRE86IHZhbGlkYXRlIGlmIHBlZXIgZXhpc3RzIGJlZm9yZSBzZW5kaW5nIG1lc3NhZ2VcbiAgICAgIC8vIFRocm93IGlmIHBlZXIgbm90IGZvdW5kLlxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzZW5kU3RhdHVzVXBkYXRlKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zZW5kT25lV2F5TWVzc2FnZShcbiAgICAgIFwiTWljcm9zZXJ2aWNlRnJhbWV3b3JrOjpTdGF0dXNVcGRhdGVcIixcbiAgICAgIHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RlckFkZHJlc3MsXG4gICAgICBzdGF0dXMsXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0SWRcbiAgICApO1xuICB9XG5cbiAgcHJvdGVjdGVkIG1ha2VSZXNwb25zZShcbiAgICBkYXRhOiBUUmVzcG9uc2VEYXRhLFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgZXJyb3I6IEVycm9yIHwgbnVsbFxuICApOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0ge1xuICAgICAgcmVxdWVzdEhlYWRlcjogcmVxdWVzdC5oZWFkZXIsXG4gICAgICByZXNwb25zZUhlYWRlcjoge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlc3BvbmRlckFkZHJlc3M6IHRoaXMuYWRkcmVzcyxcbiAgICAgIH0sXG4gICAgICBib2R5OiB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIHN1Y2Nlc3M6IGVycm9yID09PSBudWxsLFxuICAgICAgICBlcnJvcixcbiAgICAgIH0sXG4gICAgfTtcblxuICAgIGlmIChcbiAgICAgIHJlcXVlc3QuaGVhZGVyLnJlY2lwaWVudEFkZHJlc3MgJiZcbiAgICAgICghZGF0YSB8fCAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIgJiYgT2JqZWN0LmtleXMoZGF0YSkubGVuZ3RoID09PSAwKSkgJiZcbiAgICAgICFlcnJvclxuICAgICkge1xuICAgICAgdGhpcy5lcnJvcihcbiAgICAgICAgYEF0dGVtcHRpbmcgdG8gc2VuZCBlbXB0eSBkYXRhIGZvciAke1xuICAgICAgICAgIHJlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlXG4gICAgICAgIH0uIERhdGE6ICR7SlNPTi5zdHJpbmdpZnkoZGF0YSl9YCxcbiAgICAgICAgeyByZXF1ZXN0LCBlcnJvciB9XG4gICAgICApO1xuICAgICAgZXJyb3IgPSBuZXcgRXJyb3IoXCJFbXB0eSByZXNwb25zZSBkYXRhXCIpO1xuICAgIH1cblxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzZW5kT25lV2F5TWVzc2FnZShcbiAgICBtZXNzYWdlVHlwZTogc3RyaW5nLFxuICAgIHRvOiBzdHJpbmcsXG4gICAgYm9keTogYW55LFxuICAgIHJlcXVlc3RJZD86IHN0cmluZ1xuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXF1ZXN0SWQgPSByZXF1ZXN0SWQgfHwgdGhpcy5nZW5lcmF0ZVJlcXVlc3RJZCgpO1xuXG4gICAgbGV0IHBlZXJBZGRyZXNzID0gXCJcIjtcbiAgICBpZiAodG8uc3RhcnRzV2l0aChgJHt0aGlzLm5hbWVzcGFjZX06YCkpIHtcbiAgICAgIHBlZXJBZGRyZXNzID0gdG87XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IG5vZGVJZCA9IGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIuZ2V0TGVhc3RMb2FkZWROb2RlKHRvKTtcbiAgICAgIGlmICghbm9kZUlkKSB7XG4gICAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKGBObyBub2RlcyBhdmFpbGFibGUgZm9yIHNlcnZpY2UgJHt0b30uYCk7XG4gICAgICB9XG4gICAgICBwZWVyQWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RvfToke25vZGVJZH1gO1xuICAgIH1cblxuICAgIGNvbnN0IHBlZXIgPSB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYmluZENoYW5uZWwocGVlckFkZHJlc3MpO1xuXG4gICAgbGV0IGhlYWRlcjogSVJlcXVlc3RIZWFkZXIgPSB7XG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICByZXF1ZXN0SWQsXG4gICAgICByZXF1ZXN0ZXJBZGRyZXNzOiB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHJlcXVlc3RUeXBlOiBtZXNzYWdlVHlwZSxcbiAgICAgIC8vIE5vdGU6IHJlY2lwaWVudEFkZHJlc3MgaXMgaW50ZW50aW9uYWxseSBvbWl0dGVkXG4gICAgfTtcblxuICAgIGhlYWRlciA9IHRoaXMuZW5yaWNoUmVxdWVzdChoZWFkZXIsIGJvZHkpO1xuXG4gICAgY29uc3QgbWVzc2FnZTogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgIGhlYWRlcixcbiAgICAgIGJvZHksXG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwZWVyLnNlbmQobWVzc2FnZSk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuZXJyb3IoYEZhaWxlZCB0byBzZW5kIG9uZS13YXkgbWVzc2FnZSB0byAke3RvfWAsIHtcbiAgICAgICAgZXJyb3IsXG4gICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgbWVzc2FnZVR5cGUsXG4gICAgICB9KTtcbiAgICAgIHRocm93IG5ldyBMb2dnYWJsZUVycm9yKGBGYWlsZWQgdG8gc2VuZCBvbmUtd2F5IG1lc3NhZ2UgdG8gJHt0b31gLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIG1ha2VSZXF1ZXN0PFQ+KHByb3BzOiBSZXF1ZXN0UHJvcHMpOiBQcm9taXNlPElSZXNwb25zZTxUPj4ge1xuICAgIGNvbnN0IHtcbiAgICAgIHRvLFxuICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICBib2R5LFxuICAgICAgcmVwbHlUbyxcbiAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZSxcbiAgICAgIGhlYWRlcnMsXG4gICAgICB0aW1lb3V0LFxuICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgIH0gPSBwcm9wcztcbiAgICByZXR1cm4gbmV3IFByb21pc2UoYXN5bmMgKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcmVxdWVzdElkID0gaGVhZGVycz8ucmVxdWVzdElkIHx8IHRoaXMuZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcblxuICAgICAgbGV0IHBlZXJBZGRyZXNzID0gXCJcIjtcbiAgICAgIGlmICh0by5zdGFydHNXaXRoKGAke3RoaXMubmFtZXNwYWNlfTpgKSkge1xuICAgICAgICBwZWVyQWRkcmVzcyA9IHRvO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3Qgbm9kZUlkID0gYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci5nZXRMZWFzdExvYWRlZE5vZGUoXG4gICAgICAgICAgdG9cbiAgICAgICAgKTtcbiAgICAgICAgaWYgKCFub2RlSWQpIHtcbiAgICAgICAgICByZWplY3QobmV3IExvZ2dhYmxlRXJyb3IoYE5vIG5vZGVzIGF2YWlsYWJsZSBmb3Igc2VydmljZSAke3RvfS5gKSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHBlZXJBZGRyZXNzID0gYCR7dGhpcy5uYW1lc3BhY2V9OiR7dG99OiR7bm9kZUlkfWA7XG4gICAgICB9XG5cbiAgICAgIGxldCBoZWFkZXI6IElSZXF1ZXN0SGVhZGVyID0ge1xuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgcmVxdWVzdGVyQWRkcmVzczogaGVhZGVycz8ucmVxdWVzdGVyQWRkcmVzcyB8fCB0aGlzLmFkZHJlc3MsXG4gICAgICAgIHJlY2lwaWVudEFkZHJlc3M6IHJlcGx5VG8gfHwgdGhpcy5hZGRyZXNzLFxuICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgIH07XG5cbiAgICAgIGhlYWRlciA9IHRoaXMuZW5yaWNoUmVxdWVzdChoZWFkZXIsIGJvZHkpO1xuXG4gICAgICBjb25zdCByZXF1ZXN0OiBJUmVxdWVzdDxhbnk+ID0ge1xuICAgICAgICBoZWFkZXIsXG4gICAgICAgIGJvZHksXG4gICAgICB9O1xuXG4gICAgICBjb25zdCBjYWxsYmFjazogQ2FsbGJhY2tGdW5jdGlvbjxUPiA9IGFzeW5jIChyZXNwb25zZSkgPT4ge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGlmIChyZXNwb25zZS5ib2R5LnN1Y2Nlc3MpIHtcbiAgICAgICAgICAgIHJlc29sdmUocmVzcG9uc2UpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmVycm9yKGBSZXF1ZXN0IHRvICR7dG99IGZhaWxlZGAsIHtcbiAgICAgICAgICAgICAgcmVxdWVzdElkLFxuICAgICAgICAgICAgICBlcnJvcjogcmVzcG9uc2UuYm9keS5lcnJvcixcbiAgICAgICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgICAgICAgIHRvLFxuICAgICAgICAgICAgICByZXBseVRvLFxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICByZWplY3QoXG4gICAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKGBSZXF1ZXN0IHRvICR7dG99IGZhaWxlZGAsIHtcbiAgICAgICAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgICAgICAgIHJlc3BvbnNlLFxuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgICB0aGlzLmVycm9yKGBFcnJvciBpbiBjYWxsYmFjayBmb3IgcmVxdWVzdCAke3JlcXVlc3RJZH1gLCBlcnJvcik7XG4gICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoYEVycm9yIHByb2Nlc3NpbmcgcmVzcG9uc2UgZnJvbSAke3RvfWAsIGVycm9yKVxuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHRpbWVvdXRNcyA9IHRpbWVvdXQgfHwgdGhpcy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0O1xuICAgICAgY29uc3QgdGltZW91dENiID1cbiAgICAgICAgdGltZW91dENhbGxiYWNrIHx8XG4gICAgICAgICgoKSA9PiB7XG4gICAgICAgICAgaWYgKHRoaXMucGVuZGluZ1JlcXVlc3RzLmhhcyhyZXF1ZXN0SWQpKSB7XG4gICAgICAgICAgICB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5kZWxldGUocmVxdWVzdElkKTtcbiAgICAgICAgICAgIHRoaXMud2FybihgUmVxdWVzdCB0byAke3RvfSB0aW1lZCBvdXRgLCB7XG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgdGltZW91dE1zLFxuICAgICAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihcbiAgICAgICAgICAgICAgICBgUmVxdWVzdCB0byAke3RvfSB0aW1lZCBvdXQgYWZ0ZXIgJHt0aW1lb3V0TXN9bXNgXG4gICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIGNvbnN0IHRpbWVPdXRJZCA9IHNldFRpbWVvdXQodGltZW91dENiLCB0aW1lb3V0TXMpO1xuICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuc2V0KHJlcXVlc3RJZCwge1xuICAgICAgICBjYWxsYmFjayxcbiAgICAgICAgdGltZW91dENhbGxiYWNrOiB0aW1lb3V0Q2IsXG4gICAgICAgIHRpbWVPdXRJZCxcbiAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlOlxuICAgICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZSB8fCB0aGlzLmhhbmRsZVN0YXR1c1VwZGF0ZS5iaW5kKHRoaXMpLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHBlZXJBZGRyZXNzKTtcblxuICAgICAgcGVlci5zZW5kKHJlcXVlc3QpLmNhdGNoKChlcnJvcjogYW55KSA9PiB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCByZXF1ZXN0IHRvICR7dG99YCwge1xuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlamVjdChuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIGVycm9yKSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVSZXF1ZXN0SWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXJ2aWNlSWR9LSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpXG4gICAgICAudG9TdHJpbmcoMzYpXG4gICAgICAuc3Vic3RyKDIsIDkpfWA7XG4gIH1cbn1cblxuZXhwb3J0IHsgU2VydmVyUnVubmVyLCBQdWJTdWJDb25zdW1lciB9O1xuZXhwb3J0ICogZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuIl19