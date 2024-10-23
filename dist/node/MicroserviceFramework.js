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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiTWljcm9zZXJ2aWNlRnJhbWV3b3JrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL01pY3Jvc2VydmljZUZyYW1ld29yay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7QUE2QkEsd0NBZUM7QUEzQ0QsK0VBRzBDO0FBQzFDLHVDQUFnRTtBQUNoRSw2RUFBMEU7QUFFMUUsNEJBQTBCO0FBQzFCLCtCQUFvQztBQUNwQyx1REFBb0Q7QUFDcEQsa0RBQTBCO0FBRTFCLE1BQU0sNEJBQTRCLEdBQUcsTUFBTSxDQUFDLGdCQUFnQixDQUFDLENBQUM7QUFXOUQsbUVBQW1FO0FBQ25FLFNBQVMsb0JBQW9CO0lBQzNCLE9BQU8sRUFBaUMsQ0FBQztBQUMzQyxDQUFDO0FBQ0QsWUFBWTtBQUNaLFNBQWdCLGNBQWMsQ0FBSSxXQUFtQjtJQUNuRCxPQUFPLFVBQ0wsTUFBVyxFQUNYLFdBQW1CLEVBQ25CLFVBQXNDO1FBRXRDLE1BQU0sa0JBQWtCLEdBQUcsb0JBQW9CLEVBQUssQ0FBQztRQUNyRCxNQUFNLE9BQU8sR0FBRyxVQUFVLENBQUMsS0FBSyxFQUFFLFdBQVcsQ0FBQyxJQUFJLEtBQUssZUFBZSxDQUFDO1FBQ3ZFLE9BQU8sQ0FBQyxjQUFjLENBQ3BCLDRCQUE0QixFQUM1QixFQUFFLFdBQVcsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLGtCQUFrQixFQUFFLE9BQU8sRUFBRSxFQUNqRSxNQUFNLEVBQ04sV0FBVyxDQUNaLENBQUM7SUFDSixDQUFDLENBQUM7QUFDSixDQUFDO0FBRUQsdUVBQXVFO0FBQ3ZFLFNBQVMsa0JBQWtCLENBQUMsTUFBVztJQUNyQyxNQUFNLFFBQVEsR0FBRyxJQUFJLEdBQUcsRUFBa0MsQ0FBQztJQUUzRCxJQUFJLGFBQWEsR0FBRyxNQUFNLENBQUMsU0FBUyxDQUFDO0lBQ3JDLE9BQU8sYUFBYSxFQUFFLENBQUM7UUFDckIsS0FBSyxNQUFNLFlBQVksSUFBSSxNQUFNLENBQUMsbUJB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SUFFTyxpQkFBaUI7UUFDdkIsT0FBTyxHQUFHLElBQUksQ0FBQyxTQUFTLElBQUksSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLElBQUksQ0FBQyxNQUFNLEVBQUU7YUFDcEQsUUFBUSxDQUFDLEVBQUUsQ0FBQzthQUNaLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUUsQ0FBQztJQUNwQixDQUFDO0NBQ0Y7QUE5bUJELHNEQThtQkM7QUExUU87SUFETCxrQkFBUSxDQUFDLFlBQVk7Ozs7a0RBSXJCO0FBR0s7SUFETCxrQkFBUSxDQUFDLFlBQVk7Ozs7aURBaUJyQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IElCYWNrRW5kLCBDaGFubmVsQmluZGluZyB9IGZyb20gXCIuL2ludGVyZmFjZXNcIjtcbmltcG9ydCB7XG4gIFJhdGVMaW1pdGVkVGFza1NjaGVkdWxlcixcbiAgVGFza091dHB1dCxcbn0gZnJvbSBcIi4vY29yZS8vUmF0ZUxpbWl0ZWRUYXNrU2NoZWR1bGVyXCI7XG5pbXBvcnQgeyBMb2dnYWJsZSwgTG9nZ2FibGVFcnJvciwgTG9nTWVzc2FnZSB9IGZyb20gXCIuL2xvZ2dpbmdcIjtcbmltcG9ydCB7IFNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyIH0gZnJvbSBcIi4vY29yZS8vU2VydmljZURpc2NvdmVyeU1hbmFnZXJcIjtcbmltcG9ydCB7IElSZXF1ZXN0LCBJUmVzcG9uc2UsIElSZXF1ZXN0SGVhZGVyIH0gZnJvbSBcIi4vaW50ZXJmYWNlc1wiO1xuaW1wb3J0IFwicmVmbGVjdC1tZXRhZGF0YVwiO1xuaW1wb3J0IHsgdjQgYXMgdXVpZHY0IH0gZnJvbSBcInV1aWRcIjtcbmltcG9ydCB7IExvZ1N0cmF0ZWd5IH0gZnJvbSBcIi4vbG9nZ2luZy9Mb2dTdHJhdGVneVwiO1xuaW1wb3J0IGNoYWxrIGZyb20gXCJjaGFsa1wiO1xuXG5jb25zdCBSRVFVRVNUX0hBTkRMRVJfTUVUQURBVEFfS0VZID0gU3ltYm9sKFwicmVxdWVzdEhhbmRsZXJcIik7XG5cbmludGVyZmFjZSBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhIHtcbiAgcmVxdWVzdFR5cGU6IHN0cmluZztcbiAgbWV0aG9kOiBzdHJpbmc7XG4gIGFjY2VwdHNGdWxsUmVxdWVzdDogYm9vbGVhbjtcbiAgaXNBc3luYzogYm9vbGVhbjtcbn1cblxudHlwZSBJc0Z1bGxSZXF1ZXN0PFQ+ID0gVCBleHRlbmRzIElSZXF1ZXN0PGFueT4gPyB0cnVlIDogZmFsc2U7XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byBkZXRlcm1pbmUgaWYgdGhlIGhhbmRsZXIgYWNjZXB0cyBmdWxsIHJlcXVlc3RcbmZ1bmN0aW9uIGlzRnVsbFJlcXVlc3RIYW5kbGVyPFQ+KCk6IGJvb2xlYW4ge1xuICByZXR1cm4ge30gYXMgSXNGdWxsUmVxdWVzdDxUPiBhcyBib29sZWFuO1xufVxuLy8gRGVjb3JhdG9yXG5leHBvcnQgZnVuY3Rpb24gUmVxdWVzdEhhbmRsZXI8VD4ocmVxdWVzdFR5cGU6IHN0cmluZykge1xuICByZXR1cm4gZnVuY3Rpb24gPE0gZXh0ZW5kcyAoYXJnOiBUKSA9PiBQcm9taXNlPGFueT4gfCBhbnk+KFxuICAgIHRhcmdldDogYW55LFxuICAgIHByb3BlcnR5S2V5OiBzdHJpbmcsXG4gICAgZGVzY3JpcHRvcjogVHlwZWRQcm9wZXJ0eURlc2NyaXB0b3I8TT5cbiAgKSB7XG4gICAgY29uc3QgYWNjZXB0c0Z1bGxSZXF1ZXN0ID0gaXNGdWxsUmVxdWVzdEhhbmRsZXI8VD4oKTtcbiAgICBjb25zdCBpc0FzeW5jID0gZGVzY3JpcHRvci52YWx1ZT8uY29uc3RydWN0b3IubmFtZSA9PT0gXCJBc3luY0Z1bmN0aW9uXCI7XG4gICAgUmVmbGVjdC5kZWZpbmVNZXRhZGF0YShcbiAgICAgIFJFUVVFU1RfSEFORExFUl9NRVRBREFUQV9LRVksXG4gICAgICB7IHJlcXVlc3RUeXBlLCBtZXRob2Q6IHByb3BlcnR5S2V5LCBhY2NlcHRzRnVsbFJlcXVlc3QsIGlzQXN5bmMgfSxcbiAgICAgIHRhcmdldCxcbiAgICAgIHByb3BlcnR5S2V5XG4gICAgKTtcbiAgfTtcbn1cblxuLy8gSGVscGVyIGZ1bmN0aW9uIHRvIGdldCBhbGwgbWV0aG9kcyB3aXRoIHRoZSBSZXF1ZXN0SGFuZGxlciBkZWNvcmF0b3JcbmZ1bmN0aW9uIGdldFJlcXVlc3RIYW5kbGVycyh0YXJnZXQ6IGFueSk6IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+IHtcbiAgY29uc3QgaGFuZGxlcnMgPSBuZXcgTWFwPHN0cmluZywgUmVxdWVzdEhhbmRsZXJNZXRhZGF0YT4oKTtcblxuICBsZXQgY3VycmVudFRhcmdldCA9IHRhcmdldC5wcm90b3R5cGU7XG4gIHdoaWxlIChjdXJyZW50VGFyZ2V0KSB7XG4gICAgZm9yIChjb25zdCBwcm9wZXJ0eU5hbWUgb2YgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoY3VycmVudFRhcmdldCkpIHtcbiAgICAgIGNvbnN0IG1ldGFkYXRhOiBSZXF1ZXN0SGFuZGxlck1ldGFkYXRhIHwgdW5kZWZpbmVkID0gUmVmbGVjdC5nZXRNZXRhZGF0YShcbiAgICAgICAgUkVRVUVTVF9IQU5ETEVSX01FVEFEQVRBX0tFWSxcbiAgICAgICAgY3VycmVudFRhcmdldCxcbiAgICAgICAgcHJvcGVydHlOYW1lXG4gICAgICApO1xuICAgICAgaWYgKG1ldGFkYXRhKSB7XG4gICAgICAgIGhhbmRsZXJzLnNldChtZXRhZGF0YS5yZXF1ZXN0VHlwZSwgbWV0YWRhdGEpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGN1cnJlbnRUYXJnZXQgPSBPYmplY3QuZ2V0UHJvdG90eXBlT2YoY3VycmVudFRhcmdldCk7XG4gIH1cblxuICByZXR1cm4gaGFuZGxlcnM7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSVNlcnZlckNvbmZpZyB7XG4gIG5hbWVzcGFjZTogc3RyaW5nO1xuICBjb25jdXJyZW5jeUxpbWl0PzogbnVtYmVyO1xuICByZXF1ZXN0c1BlckludGVydmFsPzogbnVtYmVyO1xuICBpbnRlcnZhbD86IG51bWJlcjtcbiAgdHBzSW50ZXJ2YWw/OiBudW1iZXI7XG4gIHNlcnZpY2VJZDogc3RyaW5nO1xuICByZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0PzogbnVtYmVyO1xuICBsb2dTdHJhdGVneT86IExvZ1N0cmF0ZWd5O1xuICBzdGF0dXNVcGRhdGVJbnRlcnZhbD86IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTZXJ2aWNlU3RhdHVzIGV4dGVuZHMgSVNlcnZlckNvbmZpZyB7XG4gIGluc3RhbmNlSWQ6IHN0cmluZztcbiAgcGVuZGluZ1JlcXVlc3RzOiBudW1iZXI7XG4gIHF1ZXVlU2l6ZTogbnVtYmVyO1xuICBydW5uaW5nVGFza3M6IG51bWJlcjtcbiAgdGltZXN0YW1wOiBudW1iZXI7XG4gIGFkZHJlc3M6IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNVcGRhdGUge1xuICBzdGF0dXM6IHN0cmluZztcbiAgcHJvZ3Jlc3M/OiBudW1iZXI7XG4gIG1ldGFkYXRhPzogYW55O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlcXVlc3RQcm9wcyB7XG4gIHJlcXVlc3RUeXBlOiBzdHJpbmc7XG4gIHRvOiBzdHJpbmc7XG4gIGJvZHk6IGFueTtcbiAgcmVwbHlUbz86IHN0cmluZztcbiAgaGFuZGxlU3RhdHVzVXBkYXRlPzogKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PGFueT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKSA9PiBQcm9taXNlPHZvaWQ+O1xuICB0aW1lb3V0Q2FsbGJhY2s/OiAoKSA9PiB2b2lkO1xuICB0aW1lb3V0PzogbnVtYmVyO1xuICBoZWFkZXJzPzogSVJlcXVlc3RIZWFkZXI7XG4gIGlzQnJvYWRjYXN0PzogYm9vbGVhbjtcbn1cblxuZXhwb3J0IHR5cGUgQ2FsbGJhY2tGdW5jdGlvbjxUPiA9IChyZXNwb25zZTogSVJlc3BvbnNlPFQ+KSA9PiBQcm9taXNlPHZvaWQ+O1xuZXhwb3J0IHR5cGUgQ2FsbGJhY2tPYmplY3Q8VD4gPSB7XG4gIGNhbGxiYWNrOiBDYWxsYmFja0Z1bmN0aW9uPFQ+O1xuICB0aW1lb3V0Q2FsbGJhY2s6ICgpID0+IHZvaWQ7XG4gIGhhbmRsZVN0YXR1c1VwZGF0ZTogKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFQ+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgdGltZU91dElkOiBOb2RlSlMuVGltZW91dDtcbn07XG5cbmV4cG9ydCBjbGFzcyBNaWNyb3NlcnZpY2VMb2dTdHJhdGVneSBleHRlbmRzIExvZ1N0cmF0ZWd5IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBsb2dDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxMb2dNZXNzYWdlPj4pIHtcbiAgICBzdXBlcigpO1xuICB9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIHNlbmRQYWNrYWdlZChcbiAgICBwYWNrYWdlZE1lc3NhZ2U6IElSZXF1ZXN0PGFueT4sXG4gICAgb3B0aW9ucz86IFJlY29yZDxzdHJpbmcsIGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sb2dDaGFubmVsLnNlbmQocGFja2FnZWRNZXNzYWdlKTtcbiAgfVxufVxuXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgTWljcm9zZXJ2aWNlRnJhbWV3b3JrPFxuICBUUmVxdWVzdEJvZHksXG4gIFRSZXNwb25zZURhdGFcbj4gZXh0ZW5kcyBSYXRlTGltaXRlZFRhc2tTY2hlZHVsZXI8XG4gIElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gIElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuPiB7XG4gIHByaXZhdGUgbG9iYnk6IENoYW5uZWxCaW5kaW5nPElSZXF1ZXN0PGFueT4+O1xuICBwcml2YXRlIHNlcnZpY2VDaGFubmVsOiBDaGFubmVsQmluZGluZzxJUmVxdWVzdDxhbnk+PjtcbiAgcHJpdmF0ZSBzdGF0dXNVcGRhdGVUaW1lb3V0SWQ6IE5vZGVKUy5UaW1lb3V0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGVuZGluZ1JlcXVlc3RzOiBNYXA8c3RyaW5nLCBDYWxsYmFja09iamVjdDxhbnk+PiA9IG5ldyBNYXAoKTtcbiAgcHJpdmF0ZSByZXF1ZXN0SGFuZGxlcnM6IE1hcDxzdHJpbmcsIFJlcXVlc3RIYW5kbGVyTWV0YWRhdGE+O1xuICBwcm90ZWN0ZWQgYnJvYWRjYXN0Q2hhbm5lbDogQ2hhbm5lbEJpbmRpbmc8SVJlcXVlc3Q8YW55Pj47XG4gIHByb3RlY3RlZCBiYWNrZW5kOiBJQmFja0VuZDtcbiAgcHJvdGVjdGVkIHNlcnZlckNvbmZpZzogSVNlcnZlckNvbmZpZztcbiAgcHJvdGVjdGVkIHNlcnZpY2VJZDogc3RyaW5nO1xuICBwcm90ZWN0ZWQgcnVubmluZzogYm9vbGVhbiA9IGZhbHNlO1xuICBwcm90ZWN0ZWQgc3RhdHVzVXBkYXRlSW50ZXJ2YWw6IG51bWJlciA9IDEyMDAwMDtcbiAgcHJvdGVjdGVkIHJlcXVlc3RDYWxsYmFja1RpbWVvdXQ6IG51bWJlciA9IDMwMDAwO1xuICByZWFkb25seSBhZGRyZXNzOiBzdHJpbmc7XG4gIHJlYWRvbmx5IHNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyOiBTZXJ2aWNlRGlzY292ZXJ5TWFuYWdlcjtcbiAgcmVhZG9ubHkgbmFtZXNwYWNlOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3IoYmFja2VuZDogSUJhY2tFbmQsIGNvbmZpZzogSVNlcnZlckNvbmZpZykge1xuICAgIHN1cGVyKFxuICAgICAgY29uZmlnLmNvbmN1cnJlbmN5TGltaXQgfHwgMTAwLFxuICAgICAgY29uZmlnLnJlcXVlc3RzUGVySW50ZXJ2YWwgfHwgMTAwLFxuICAgICAgY29uZmlnLmludGVydmFsIHx8IDEwMDBcbiAgICApO1xuICAgIHRoaXMubmFtZXNwYWNlID0gY29uZmlnLm5hbWVzcGFjZTtcbiAgICB0aGlzLnNlcnZlckNvbmZpZyA9IGNvbmZpZztcbiAgICB0aGlzLmJhY2tlbmQgPSBiYWNrZW5kO1xuICAgIHRoaXMuc2VydmljZUlkID0gY29uZmlnLnNlcnZpY2VJZDtcbiAgICB0aGlzLnN0YXR1c1VwZGF0ZUludGVydmFsID0gY29uZmlnLnN0YXR1c1VwZGF0ZUludGVydmFsIHx8IDEyMDAwMDtcbiAgICB0aGlzLmFkZHJlc3MgPSBgJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06JHt0aGlzLmluc3RhbmNlSWR9YDtcbiAgICB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQgPVxuICAgICAgY29uZmlnLnJlcXVlc3RDYWxsYmFja1RpbWVvdXQgfHwgdGhpcy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0O1xuICAgIHRoaXMucmVxdWVzdEhhbmRsZXJzID0gZ2V0UmVxdWVzdEhhbmRsZXJzKHRoaXMuY29uc3RydWN0b3IpO1xuICAgIHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIgPSBuZXcgU2VydmljZURpc2NvdmVyeU1hbmFnZXIoXG4gICAgICB0aGlzLmJhY2tlbmQuc2VydmljZVJlZ2lzdHJ5XG4gICAgKTtcbiAgfVxuXG4gIC8vIEBMb2dnYWJsZS5oYW5kbGVFcnJvcnNcbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcbiAgICB0aGlzLnNlcnZpY2VDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9YCxcbiAgICAgIHRoaXMuaGFuZGxlU2VydmljZU1lc3NhZ2VzLmJpbmQodGhpcylcbiAgICApO1xuICAgIHRoaXMuYnJvYWRjYXN0Q2hhbm5lbCA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChcbiAgICAgIGAke3RoaXMubmFtZXNwYWNlfToke3RoaXMuc2VydmljZUlkfTpicm9hZGNhc3RgXG4gICAgKTtcbiAgICB0aGlzLmxvYmJ5ID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OmxvYmJ5YCxcbiAgICAgIHRoaXMuaGFuZGxlTG9iYnlNZXNzYWdlcy5iaW5kKHRoaXMpXG4gICAgKTtcbiAgICBjb25zdCBsb2dDaGFubmVsID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgYCR7dGhpcy5uYW1lc3BhY2V9OiR7dGhpcy5zZXJ2aWNlSWR9OmxvZ3NgXG4gICAgKTtcbiAgICBpZiAoIXRoaXMuc2VydmVyQ29uZmlnLmxvZ1N0cmF0ZWd5KSB7XG4gICAgICBMb2dnYWJsZS5zZXRMb2dTdHJhdGVneShcbiAgICAgICAgdGhpcy5zZXJ2ZXJDb25maWcubG9nU3RyYXRlZ3kgfHwgbmV3IE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5KGxvZ0NoYW5uZWwpXG4gICAgICApO1xuICAgICAgY29uc29sZS53YXJuKFxuICAgICAgICBjaGFsay55ZWxsb3coYFxuW1dBUk5JTkddXG5Mb2cgU3RyYXRlZ3kgaXMgc2V0IHRvIE1pY3Jvc2VydmljZUxvZ1N0cmF0ZWd5LlxuTWljcm9zZXJ2aWNlRnJhbWV3b3JrIHdpbGwgc3RyZWFtIGxvZ3MgdG8gJHt0aGlzLm5hbWVzcGFjZX06JHt0aGlzLnNlcnZpY2VJZH06bG9ncyBjaGFubmVsXG5JZiB5b3UgYXJlIG5vdCBzZWVpbmcgYW55IGxvZ3MsIHRyeSBhZGRpbmcgdGhlIGZvbGxvd2luZyB0byBNaWNyb3NlcnZpY2VGcmFtZXdvcmsgY29uZmlndXJhdGlvbiBvYmplY3Q6XG5cbmltcG9ydCB7IENvbnNvbGVTdHJhdGVneSB9IGZyb20gXCJtaWNyb3NlcnZpY2UtZnJhbWV3b3JrXCI7XG5jb25maWcgPSB7XG4gIC4uLixcbiAgbG9nU3RyYXRlZ3k6IG5ldyBDb25zb2xlU3RyYXRlZ3koKVxufVxuICAgICAgYClcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIExvZ2dhYmxlLnNldExvZ1N0cmF0ZWd5KHRoaXMuc2VydmVyQ29uZmlnLmxvZ1N0cmF0ZWd5KTtcbiAgICB9XG4gICAgdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKFxuICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgdGhpcy5oYW5kbGVJbmNvbWluZ01lc3NhZ2UuYmluZCh0aGlzKVxuICAgICk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci5yZWdpc3Rlck5vZGUoXG4gICAgICB0aGlzLnNlcnZpY2VJZCxcbiAgICAgIHRoaXMuaW5zdGFuY2VJZCxcbiAgICAgIHRoaXMucXVldWUuc2l6ZSgpXG4gICAgKTtcbiAgICBhd2FpdCB0aGlzLmxvYmJ5LnNlbmQoXG4gICAgICBNaWNyb3NlcnZpY2VGcmFtZXdvcmsuY3JlYXRlUmVxdWVzdChcbiAgICAgICAgdGhpcy5hZGRyZXNzLFxuICAgICAgICBcIkNIRUNLSU5cIixcbiAgICAgICAgdGhpcy5nZXRTZXJ2ZXJTdGF0dXMoKVxuICAgICAgKVxuICAgICk7XG4gICAgdGhpcy5vblRhc2tDb21wbGV0ZSh0aGlzLnByb2Nlc3NBbmROb3RpZnkuYmluZCh0aGlzKSk7XG4gICAgdGhpcy5zY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKTtcbiAgICB0aGlzLmluZm8oYFNlcnZpY2UgJHt0aGlzLnNlcnZpY2VJZH0gWyR7dGhpcy5pbnN0YW5jZUlkfV0gaW5pdGlhbGl6ZWQuYCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHVwZGF0ZUxvYWRMZXZlbCgpIHtcbiAgICBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLnVwZGF0ZU5vZGVMb2FkKFxuICAgICAgdGhpcy5zZXJ2aWNlSWQsXG4gICAgICB0aGlzLmluc3RhbmNlSWQsXG4gICAgICB0aGlzLnF1ZXVlLnNpemUoKVxuICAgICk7XG4gICAgdGhpcy5zY2hlZHVsZU5leHRMb2FkTGV2ZWxVcGRhdGUoKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBzdGFydERlcGVuZGVuY2llcygpIHtcbiAgICB0aGlzLmluZm8oXG4gICAgICBgU2VydmljZTogJHt0aGlzLnNlcnZpY2VJZH0gc3RhcnRlZCBzdWNjZXNzZnVsbHkuIEluc3RhbmNlSUQ6ICR7dGhpcy5pbnN0YW5jZUlkfWBcbiAgICApO1xuICB9XG4gIHByb3RlY3RlZCBhc3luYyBzdG9wRGVwZW5kZW5jaWVzKCkge31cblxuICBzdGF0aWMgY3JlYXRlUmVxdWVzdDxUPihcbiAgICByZXF1ZXN0ZXJBZGRyZXNzOiBzdHJpbmcsXG4gICAgcmVxdWVzdFR5cGU6IHN0cmluZyxcbiAgICBib2R5OiBULFxuICAgIHJlY2lwaWVudEFkZHJlc3M/OiBzdHJpbmdcbiAgKTogSVJlcXVlc3Q8VD4ge1xuICAgIHJldHVybiB7XG4gICAgICBoZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQ6IHV1aWR2NCgpLFxuICAgICAgICByZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgICByZWNpcGllbnRBZGRyZXNzLFxuICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgIH0sXG4gICAgICBib2R5LFxuICAgIH07XG4gIH1cblxuICBzdGF0aWMgY3JlYXRlUmVzcG9uc2U8VD4oXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8YW55PixcbiAgICByZXNwb25kZXJBZGRyZXNzOiBzdHJpbmcsXG4gICAgZGF0YTogVCxcbiAgICBzdWNjZXNzOiBib29sZWFuID0gdHJ1ZSxcbiAgICBlcnJvcjogRXJyb3IgfCBudWxsID0gbnVsbFxuICApOiBJUmVzcG9uc2U8VD4ge1xuICAgIHJldHVybiB7XG4gICAgICByZXF1ZXN0SGVhZGVyOiByZXF1ZXN0LmhlYWRlcixcbiAgICAgIHJlc3BvbnNlSGVhZGVyOiB7XG4gICAgICAgIHJlc3BvbmRlckFkZHJlc3MsXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKSxcbiAgICAgIH0sXG4gICAgICBib2R5OiB7XG4gICAgICAgIGRhdGEsXG4gICAgICAgIHN1Y2Nlc3MsXG4gICAgICAgIGVycm9yLFxuICAgICAgfSxcbiAgICB9O1xuICB9XG5cbiAgcHJvdGVjdGVkIGdldFNlcnZlclN0YXR1cygpOiBTZXJ2aWNlU3RhdHVzIHtcbiAgICBjb25zdCBzdGF0dXMgPSB7XG4gICAgICBuYW1lc3BhY2U6IHRoaXMubmFtZXNwYWNlLFxuICAgICAgaW5zdGFuY2VJZDogdGhpcy5pbnN0YW5jZUlkLFxuICAgICAgcGVuZGluZ1JlcXVlc3RzOiB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5zaXplLFxuICAgICAgcXVldWVTaXplOiB0aGlzLnF1ZXVlLnNpemUoKSxcbiAgICAgIHJ1bm5pbmdUYXNrczogdGhpcy5ydW5uaW5nVGFza3MsXG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KCksXG4gICAgICBhZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgICBjb25jdXJyZW5jeUxpbWl0OiB0aGlzLmNvbmN1cnJlbmN5TGltaXQsXG4gICAgICByZXF1ZXN0c1BlckludGVydmFsOiB0aGlzLnNlcnZlckNvbmZpZy5yZXF1ZXN0c1BlckludGVydmFsLFxuICAgICAgaW50ZXJ2YWw6IHRoaXMuaW50ZXJ2YWwsXG4gICAgICBzZXJ2aWNlSWQ6IHRoaXMuc2VydmljZUlkLFxuICAgICAgcmVxdWVzdENhbGxiYWNrVGltZW91dDogdGhpcy5yZXF1ZXN0Q2FsbGJhY2tUaW1lb3V0LFxuICAgICAgc3RhdHVzVXBkYXRlSW50ZXJ2YWw6IHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwsXG4gICAgfTtcblxuICAgIHJldHVybiBzdGF0dXM7XG4gIH1cblxuICBwdWJsaWMgZ2V0c2VydmljZUlkKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmljZUlkO1xuICB9XG5cbiAgcHVibGljIGdldEJhY2tlbmQoKTogSUJhY2tFbmQge1xuICAgIHJldHVybiB0aGlzLmJhY2tlbmQ7XG4gIH1cblxuICBwcm90ZWN0ZWQgaGFuZGxlU2VydmljZU1lc3NhZ2VzPFQ+KG1lc3NhZ2U6IFQpIHt9XG5cbiAgcHJvdGVjdGVkIGFzeW5jIGhhbmRsZUxvYmJ5TWVzc2FnZXMoXG4gICAgbWVzc2FnZTogSVJlcXVlc3Q8YW55PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLmlzU2VydmljZVN0YXR1c1JlcXVlc3QobWVzc2FnZSkpIHtcbiAgICAgIGlmIChtZXNzYWdlLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJDSEVDS0lOXCIpIHtcbiAgICAgICAgdGhpcy5pbmZvKGBSZWNlaXZlZCBDSEVDS0lOIGZyb20gJHttZXNzYWdlLmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzfWApO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBkZWZhdWx0TWVzc2FnZUhhbmRsZXIoXG4gICAgcmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPFRSZXNwb25zZURhdGE+IHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgTm8gaGFuZGxlciBmb3VuZCBmb3IgcmVxdWVzdCB0eXBlOiAke3JlcXVlc3QuaGVhZGVyLnJlcXVlc3RUeXBlfWBcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBpc1NlcnZpY2VTdGF0dXNSZXF1ZXN0KFxuICAgIG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gfCBJUmVzcG9uc2U8YW55PlxuICApOiBtZXNzYWdlIGlzIElSZXF1ZXN0PFNlcnZpY2VTdGF0dXM+IHtcbiAgICByZXR1cm4gXCJoZWFkZXJcIiBpbiBtZXNzYWdlICYmIFwicmVxdWVzdFR5cGVcIiBpbiBtZXNzYWdlLmhlYWRlcjtcbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXh0TG9hZExldmVsVXBkYXRlKCkge1xuICAgIGlmICh0aGlzLnN0YXR1c1VwZGF0ZVRpbWVvdXRJZCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc3RhdHVzVXBkYXRlVGltZW91dElkKTtcbiAgICB9XG4gICAgdGhpcy5zdGF0dXNVcGRhdGVUaW1lb3V0SWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMudXBkYXRlTG9hZExldmVsKCk7XG4gICAgICB0aGlzLnNjaGVkdWxlTmV4dExvYWRMZXZlbFVwZGF0ZSgpO1xuICAgIH0sIHRoaXMuc3RhdHVzVXBkYXRlSW50ZXJ2YWwpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXF1ZXN0VHlwZSA9IGlucHV0LmhlYWRlci5yZXF1ZXN0VHlwZTtcbiAgICBpZiAoIXJlcXVlc3RUeXBlKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJSZXF1ZXN0IHR5cGUgbm90IHNwZWNpZmllZFwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBoYW5kbGVyTWV0YWRhdGEgPSB0aGlzLnJlcXVlc3RIYW5kbGVycy5nZXQocmVxdWVzdFR5cGUpO1xuICAgIGlmICghaGFuZGxlck1ldGFkYXRhKSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5kZWZhdWx0TWVzc2FnZUhhbmRsZXIoaW5wdXQpO1xuICAgIH1cblxuICAgIC8vIENhbGwgdGhlIGhhbmRsZXIgbWV0aG9kXG4gICAgY29uc3QgaGFuZGxlck1ldGhvZCA9ICh0aGlzIGFzIGFueSlbaGFuZGxlck1ldGFkYXRhLm1ldGhvZF0uYmluZCh0aGlzKTtcbiAgICBjb25zdCBhcmdzID0gaGFuZGxlck1ldGFkYXRhLmFjY2VwdHNGdWxsUmVxdWVzdCA/IGlucHV0IDogaW5wdXQuYm9keTtcblxuICAgIGNvbnN0IGhhbmRsZXJSZXNwb25zZSA9IGhhbmRsZXJNZXRhZGF0YS5pc0FzeW5jXG4gICAgICA/IGF3YWl0IGhhbmRsZXJNZXRob2QoYXJncylcbiAgICAgIDogaGFuZGxlck1ldGhvZChhcmdzKTtcblxuICAgIHJldHVybiBoYW5kbGVyUmVzcG9uc2U7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHdyYXBBbmRQcm9jZXNzUmVxdWVzdChcbiAgICBpbnB1dDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBQcm9taXNlPElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPj4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnByb2Nlc3NSZXF1ZXN0KGlucHV0KTtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKHJlc3VsdCwgaW5wdXQsIG51bGwpO1xuICAgICAgcmVzcG9uc2UgPSB0aGlzLmVucmljaFJlc3BvbnNlKHJlc3BvbnNlLCBpbnB1dCk7XG4gICAgICByZXR1cm4gcmVzcG9uc2U7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGxldCByZXNwb25zZSA9IHRoaXMubWFrZVJlc3BvbnNlKFxuICAgICAgICB7fSBhcyBUUmVzcG9uc2VEYXRhLFxuICAgICAgICBpbnB1dCxcbiAgICAgICAgZXJyb3IgYXMgRXJyb3JcbiAgICAgICk7XG4gICAgICByZXNwb25zZSA9IHRoaXMuZW5yaWNoUmVzcG9uc2UocmVzcG9uc2UsIGlucHV0KTtcbiAgICAgIHJldHVybiByZXNwb25zZTtcbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgaGFuZGxlU3RhdHVzVXBkYXRlKFxuICAgIHJlcXVlc3Q6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4sXG4gICAgc3RhdHVzOiBTdGF0dXNVcGRhdGVcbiAgKTogUHJvbWlzZTx2b2lkPiB7fVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXNwb25zZShcbiAgICByZXNwb25zZTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+LFxuICAgIG9yaWdpbmFsUmVxdWVzdDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PlxuICApOiBJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4ge1xuICAgIC8vIERlZmF1bHQgaW1wbGVtZW50YXRpb24gZG9lcyBub3RoaW5nXG4gICAgLy8gQ29uY3JldGUgY2xhc3NlcyBjYW4gb3ZlcnJpZGUgdGhpcyBtZXRob2QgdG8gYWRkIGN1c3RvbSBlbnJpY2htZW50XG4gICAgLy8gRklYTUU6IEZvciBub3csIGxvZ2dpbmcgd2l0aGluIHRoaXMgbWV0aG9kIGNhdXNlcyBpbmZpbml0ZSBsb29wLlxuICAgIHJldHVybiByZXNwb25zZTtcbiAgfVxuXG4gIHByb3RlY3RlZCBlbnJpY2hSZXF1ZXN0KGhlYWRlcjogSVJlcXVlc3RIZWFkZXIsIGJvZHk6IGFueSk6IElSZXF1ZXN0SGVhZGVyIHtcbiAgICAvLyBEZWZhdWx0IGltcGxlbWVudGF0aW9uOiByZXR1cm4gdGhlIGhlYWRlciB1bmNoYW5nZWRcbiAgICByZXR1cm4gaGVhZGVyO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVJbmNvbWluZ01lc3NhZ2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIHJpZ2h0IG5vdyB3ZSBkb24ndCB3YWl0IHRvIHNlZSBpZiB0aGUgYWNrbm93bGVkZ2VtZW50IHN1Y2NlZWRlZC5cbiAgICAvLyB3ZSBtaWdodCB3YW50IHRvIGRvIHRoaXMgaW4gdGhlIGZ1dHVyZS5cbiAgICBhd2FpdCB0aGlzLmJhY2tlbmQucHViU3ViQ29uc3VtZXIuYWNrKHBheWxvYWQpO1xuICAgIHRoaXMucHJvY2Vzc0luY29taW5nTWVzc2FnZShwYXlsb2FkKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcHJvY2Vzc0luY29taW5nTWVzc2FnZShcbiAgICBwYXlsb2FkOiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+IHwgSVJlc3BvbnNlPGFueT5cbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMuaXNSZXNwb25zZShwYXlsb2FkKSkge1xuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVSZXNwb25zZShwYXlsb2FkKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKFxuICAgICAgICBwYXlsb2FkLmhlYWRlci5yZXF1ZXN0VHlwZSA9PT0gXCJNaWNyb3NlcnZpY2VGcmFtZXdvcms6OlN0YXR1c1VwZGF0ZVwiXG4gICAgICApIHtcbiAgICAgICAgY29uc3QgcmVxdWVzdElkID0gcGF5bG9hZC5oZWFkZXIucmVxdWVzdElkO1xuICAgICAgICBjb25zdCBzdGF0dXMgPSBwYXlsb2FkLmJvZHkgYXMgU3RhdHVzVXBkYXRlO1xuICAgICAgICBjb25zdCBjYWxsYmFja09iamVjdCA9IHRoaXMucGVuZGluZ1JlcXVlc3RzLmdldChyZXF1ZXN0SWQpO1xuICAgICAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgICAgICBjb25zdCB7IGNhbGxiYWNrLCB0aW1lb3V0Q2FsbGJhY2ssIHRpbWVPdXRJZCwgaGFuZGxlU3RhdHVzVXBkYXRlIH0gPVxuICAgICAgICAgICAgY2FsbGJhY2tPYmplY3Q7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRpbWVPdXRJZCk7XG4gICAgICAgICAgY29uc3QgbmV3VGltZU91dCA9IHNldFRpbWVvdXQoXG4gICAgICAgICAgICB0aW1lb3V0Q2FsbGJhY2ssXG4gICAgICAgICAgICB0aGlzLnJlcXVlc3RDYWxsYmFja1RpbWVvdXRcbiAgICAgICAgICApO1xuICAgICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgICAgIGNhbGxiYWNrLFxuICAgICAgICAgICAgdGltZW91dENhbGxiYWNrLFxuICAgICAgICAgICAgdGltZU91dElkOiBuZXdUaW1lT3V0LFxuICAgICAgICAgICAgaGFuZGxlU3RhdHVzVXBkYXRlLFxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGF3YWl0IGhhbmRsZVN0YXR1c1VwZGF0ZShwYXlsb2FkLCBzdGF0dXMpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgdGhpcy5zY2hlZHVsZU5ld01lc3NhZ2UocGF5bG9hZCBhcyBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGlzUmVzcG9uc2UoXG4gICAgcGF5bG9hZDogSVJlcXVlc3Q8VFJlcXVlc3RCb2R5PiB8IElSZXNwb25zZTxhbnk+XG4gICk6IHBheWxvYWQgaXMgSVJlc3BvbnNlPGFueT4ge1xuICAgIHJldHVybiBcInJlc3BvbnNlSGVhZGVyXCIgaW4gcGF5bG9hZDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUmVzcG9uc2UocmVzcG9uc2U6IElSZXNwb25zZTxhbnk+KSB7XG4gICAgY29uc3QgcmVxdWVzdElkID0gcmVzcG9uc2UucmVxdWVzdEhlYWRlci5yZXF1ZXN0SWQ7XG4gICAgY29uc3QgY2FsbGJhY2tPYmplY3QgPSB0aGlzLnBlbmRpbmdSZXF1ZXN0cy5nZXQocmVxdWVzdElkKTtcbiAgICBpZiAoY2FsbGJhY2tPYmplY3QpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrT2JqZWN0LmNhbGxiYWNrKHJlc3BvbnNlKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yOiBhbnkpIHtcbiAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgZXhlY3V0aW5nIGNhbGxiYWNrIGZvciByZXF1ZXN0ICR7cmVxdWVzdElkfWAsIGVycm9yKTtcbiAgICAgIH0gZmluYWxseSB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLndhcm4oYFJlY2VpdmVkIHJlc3BvbnNlIGZvciB1bmtub3duIHJlcXVlc3Q6ICR7cmVxdWVzdElkfWApO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVOZXdNZXNzYWdlKG1lc3NhZ2U6IElSZXF1ZXN0PFRSZXF1ZXN0Qm9keT4pIHtcbiAgICB0aGlzLnNjaGVkdWxlVGFzayhcbiAgICAgIGFzeW5jIChpbnB1dCkgPT4gYXdhaXQgdGhpcy53cmFwQW5kUHJvY2Vzc1JlcXVlc3QoaW5wdXQpLFxuICAgICAgbWVzc2FnZVxuICAgICk7XG4gIH1cblxuICBATG9nZ2FibGUuaGFuZGxlRXJyb3JzXG4gIGFzeW5jIHN0YXJ0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc3RhcnREZXBlbmRlbmNpZXMoKTtcbiAgICB0aGlzLnJ1bm5pbmcgPSB0cnVlO1xuICB9XG5cbiAgQExvZ2dhYmxlLmhhbmRsZUVycm9yc1xuICBhc3luYyBzdG9wKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9iYnkuc2VuZChcbiAgICAgIE1pY3Jvc2VydmljZUZyYW1ld29yay5jcmVhdGVSZXF1ZXN0KFxuICAgICAgICB0aGlzLmFkZHJlc3MsXG4gICAgICAgIFwiQ0hFQ0tPVVRcIixcbiAgICAgICAgdGhpcy5nZXRTZXJ2ZXJTdGF0dXMoKVxuICAgICAgKVxuICAgICk7XG4gICAgdGhpcy5pbmZvKGBTZXJ2aWNlICR7dGhpcy5zZXJ2aWNlSWR9IFske3RoaXMuaW5zdGFuY2VJZH1dIGNoZWNrZWQgb3V0YCk7XG4gICAgYXdhaXQgdGhpcy5zdG9wRGVwZW5kZW5jaWVzKCk7XG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlRGlzY292ZXJ5TWFuYWdlci51bnJlZ2lzdGVyTm9kZShcbiAgICAgIHRoaXMuc2VydmljZUlkLFxuICAgICAgdGhpcy5pbnN0YW5jZUlkXG4gICAgKTtcblxuICAgIHRoaXMucnVubmluZyA9IGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcm9jZXNzQW5kTm90aWZ5KFxuICAgIG91dHB1dDogVGFza091dHB1dDxJUmVzcG9uc2U8VFJlc3BvbnNlRGF0YT4+XG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEZJWE1FOiBETyBOT1QgTE9HIFdJVEhJTiBUSElTIE1FVEhPRCwgaXQgY2F1c2VzIGluZmluaXRlIGxvb3AhXG4gICAgaWYgKG91dHB1dC5yZXN1bHQpIHtcbiAgICAgIGNvbnN0IHJlY2lwaWVudEFkZHJlc3MgPSBvdXRwdXQucmVzdWx0LnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcztcbiAgICAgIGlmIChyZWNpcGllbnRBZGRyZXNzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZE5vdGlmaWNhdGlvbihvdXRwdXQucmVzdWx0KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmROb3RpZmljYXRpb24oXG4gICAgcmVzcG9uc2U6IElSZXNwb25zZTxUUmVzcG9uc2VEYXRhPlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZWNpcGllbnRJZCA9IHJlc3BvbnNlLnJlcXVlc3RIZWFkZXIucmVjaXBpZW50QWRkcmVzcztcbiAgICBpZiAocmVjaXBpZW50SWQpIHtcbiAgICAgIGNvbnN0IFtfbmFtZXNwYWNlLCBzZXJ2aWNlSWQsIF9pbnN0YW5jZUlkXSA9IHJlY2lwaWVudElkLnNwbGl0KFwiOlwiKTtcbiAgICAgIGlmIChzZXJ2aWNlSWQgJiYgc2VydmljZUlkID09PSB0aGlzLnNlcnZpY2VJZCkge1xuICAgICAgICB0aGlzLnByb2Nlc3NJbmNvbWluZ01lc3NhZ2UocmVzcG9uc2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHJlY2lwaWVudElkKTtcbiAgICAgIHBlZXIuc2VuZChyZXNwb25zZSk7XG4gICAgICAvLyBUT0RPOiB2YWxpZGF0ZSBpZiBwZWVyIGV4aXN0cyBiZWZvcmUgc2VuZGluZyBtZXNzYWdlXG4gICAgICAvLyBUaHJvdyBpZiBwZWVyIG5vdCBmb3VuZC5cbiAgICB9XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFN0YXR1c1VwZGF0ZShcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIHN0YXR1czogU3RhdHVzVXBkYXRlXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgICBcIk1pY3Jvc2VydmljZUZyYW1ld29yazo6U3RhdHVzVXBkYXRlXCIsXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0ZXJBZGRyZXNzLFxuICAgICAgc3RhdHVzLFxuICAgICAgcmVxdWVzdC5oZWFkZXIucmVxdWVzdElkXG4gICAgKTtcbiAgfVxuXG4gIHByb3RlY3RlZCBtYWtlUmVzcG9uc2UoXG4gICAgZGF0YTogVFJlc3BvbnNlRGF0YSxcbiAgICByZXF1ZXN0OiBJUmVxdWVzdDxUUmVxdWVzdEJvZHk+LFxuICAgIGVycm9yOiBFcnJvciB8IG51bGxcbiAgKTogSVJlc3BvbnNlPFRSZXNwb25zZURhdGE+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IHtcbiAgICAgIHJlcXVlc3RIZWFkZXI6IHJlcXVlc3QuaGVhZGVyLFxuICAgICAgcmVzcG9uc2VIZWFkZXI6IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXNwb25kZXJBZGRyZXNzOiB0aGlzLmFkZHJlc3MsXG4gICAgICB9LFxuICAgICAgYm9keToge1xuICAgICAgICBkYXRhLFxuICAgICAgICBzdWNjZXNzOiBlcnJvciA9PT0gbnVsbCxcbiAgICAgICAgZXJyb3IsXG4gICAgICB9LFxuICAgIH07XG5cbiAgICBpZiAoXG4gICAgICByZXF1ZXN0LmhlYWRlci5yZWNpcGllbnRBZGRyZXNzICYmXG4gICAgICAoIWRhdGEgfHwgKHR5cGVvZiBkYXRhID09PSBcIm9iamVjdFwiICYmIE9iamVjdC5rZXlzKGRhdGEpLmxlbmd0aCA9PT0gMCkpICYmXG4gICAgICAhZXJyb3JcbiAgICApIHtcbiAgICAgIHRoaXMuZXJyb3IoXG4gICAgICAgIGBBdHRlbXB0aW5nIHRvIHNlbmQgZW1wdHkgZGF0YSBmb3IgJHtcbiAgICAgICAgICByZXF1ZXN0LmhlYWRlci5yZXF1ZXN0VHlwZVxuICAgICAgICB9LiBEYXRhOiAke0pTT04uc3RyaW5naWZ5KGRhdGEpfWAsXG4gICAgICAgIHsgcmVxdWVzdCwgZXJyb3IgfVxuICAgICAgKTtcbiAgICAgIGVycm9yID0gbmV3IEVycm9yKFwiRW1wdHkgcmVzcG9uc2UgZGF0YVwiKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVzcG9uc2U7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZE9uZVdheU1lc3NhZ2UoXG4gICAgbWVzc2FnZVR5cGU6IHN0cmluZyxcbiAgICB0bzogc3RyaW5nLFxuICAgIGJvZHk6IGFueSxcbiAgICByZXF1ZXN0SWQ/OiBzdHJpbmdcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmVxdWVzdElkID0gcmVxdWVzdElkIHx8IHRoaXMuZ2VuZXJhdGVSZXF1ZXN0SWQoKTtcblxuICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgaWYgKHRvLnN0YXJ0c1dpdGgoYCR7dGhpcy5uYW1lc3BhY2V9OmApKSB7XG4gICAgICBwZWVyQWRkcmVzcyA9IHRvO1xuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCBub2RlSWQgPSBhd2FpdCB0aGlzLnNlcnZpY2VEaXNjb3ZlcnlNYW5hZ2VyLmdldExlYXN0TG9hZGVkTm9kZSh0byk7XG4gICAgICBpZiAoIW5vZGVJZCkge1xuICAgICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgTm8gbm9kZXMgYXZhaWxhYmxlIGZvciBzZXJ2aWNlICR7dG99LmApO1xuICAgICAgfVxuICAgICAgcGVlckFkZHJlc3MgPSBgJHt0aGlzLm5hbWVzcGFjZX06JHt0b306JHtub2RlSWR9YDtcbiAgICB9XG5cbiAgICBjb25zdCBwZWVyID0gdGhpcy5iYWNrZW5kLnB1YlN1YkNvbnN1bWVyLmJpbmRDaGFubmVsKHBlZXJBZGRyZXNzKTtcblxuICAgIGxldCBoZWFkZXI6IElSZXF1ZXN0SGVhZGVyID0ge1xuICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgcmVxdWVzdElkLFxuICAgICAgcmVxdWVzdGVyQWRkcmVzczogdGhpcy5zZXJ2aWNlSWQsXG4gICAgICByZXF1ZXN0VHlwZTogbWVzc2FnZVR5cGUsXG4gICAgICAvLyBOb3RlOiByZWNpcGllbnRBZGRyZXNzIGlzIGludGVudGlvbmFsbHkgb21pdHRlZFxuICAgIH07XG5cbiAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgIGNvbnN0IG1lc3NhZ2U6IElSZXF1ZXN0PGFueT4gPSB7XG4gICAgICBoZWFkZXIsXG4gICAgICBib2R5LFxuICAgIH07XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVlci5zZW5kKG1lc3NhZ2UpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCBvbmUtd2F5IG1lc3NhZ2UgdG8gJHt0b31gLCB7XG4gICAgICAgIGVycm9yLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIG1lc3NhZ2VUeXBlLFxuICAgICAgfSk7XG4gICAgICB0aHJvdyBuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgb25lLXdheSBtZXNzYWdlIHRvICR7dG99YCwgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIHByb3RlY3RlZCBhc3luYyBtYWtlUmVxdWVzdDxUPihwcm9wczogUmVxdWVzdFByb3BzKTogUHJvbWlzZTxJUmVzcG9uc2U8VD4+IHtcbiAgICBjb25zdCB7XG4gICAgICB0byxcbiAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgYm9keSxcbiAgICAgIHJlcGx5VG8sXG4gICAgICBoYW5kbGVTdGF0dXNVcGRhdGUsXG4gICAgICBoZWFkZXJzLFxuICAgICAgdGltZW91dCxcbiAgICAgIHRpbWVvdXRDYWxsYmFjayxcbiAgICB9ID0gcHJvcHM7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGFzeW5jIChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IHJlcXVlc3RJZCA9IGhlYWRlcnM/LnJlcXVlc3RJZCB8fCB0aGlzLmdlbmVyYXRlUmVxdWVzdElkKCk7XG5cbiAgICAgIGxldCBwZWVyQWRkcmVzcyA9IFwiXCI7XG4gICAgICBpZiAodG8uc3RhcnRzV2l0aChgJHt0aGlzLm5hbWVzcGFjZX06YCkpIHtcbiAgICAgICAgcGVlckFkZHJlc3MgPSB0bztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IG5vZGVJZCA9IGF3YWl0IHRoaXMuc2VydmljZURpc2NvdmVyeU1hbmFnZXIuZ2V0TGVhc3RMb2FkZWROb2RlKFxuICAgICAgICAgIHRvXG4gICAgICAgICk7XG4gICAgICAgIGlmICghbm9kZUlkKSB7XG4gICAgICAgICAgcmVqZWN0KG5ldyBMb2dnYWJsZUVycm9yKGBObyBub2RlcyBhdmFpbGFibGUgZm9yIHNlcnZpY2UgJHt0b30uYCkpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBwZWVyQWRkcmVzcyA9IGAke3RoaXMubmFtZXNwYWNlfToke3RvfToke25vZGVJZH1gO1xuICAgICAgfVxuXG4gICAgICBsZXQgaGVhZGVyOiBJUmVxdWVzdEhlYWRlciA9IHtcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpLFxuICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgIHJlcXVlc3RlckFkZHJlc3M6IGhlYWRlcnM/LnJlcXVlc3RlckFkZHJlc3MgfHwgdGhpcy5hZGRyZXNzLFxuICAgICAgICByZWNpcGllbnRBZGRyZXNzOiByZXBseVRvIHx8IHRoaXMuYWRkcmVzcyxcbiAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICB9O1xuXG4gICAgICBoZWFkZXIgPSB0aGlzLmVucmljaFJlcXVlc3QoaGVhZGVyLCBib2R5KTtcblxuICAgICAgY29uc3QgcmVxdWVzdDogSVJlcXVlc3Q8YW55PiA9IHtcbiAgICAgICAgaGVhZGVyLFxuICAgICAgICBib2R5LFxuICAgICAgfTtcblxuICAgICAgY29uc3QgY2FsbGJhY2s6IENhbGxiYWNrRnVuY3Rpb248VD4gPSBhc3luYyAocmVzcG9uc2UpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBpZiAocmVzcG9uc2UuYm9keS5zdWNjZXNzKSB7XG4gICAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5lcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICAgICAgZXJyb3I6IHJlc3BvbnNlLmJvZHkuZXJyb3IsXG4gICAgICAgICAgICAgIHJlcXVlc3RUeXBlLFxuICAgICAgICAgICAgICB0byxcbiAgICAgICAgICAgICAgcmVwbHlUbyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmVqZWN0KFxuICAgICAgICAgICAgICBuZXcgTG9nZ2FibGVFcnJvcihgUmVxdWVzdCB0byAke3RvfSBmYWlsZWRgLCB7XG4gICAgICAgICAgICAgICAgcmVxdWVzdCxcbiAgICAgICAgICAgICAgICByZXNwb25zZSxcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGNhdGNoIChlcnJvcjogYW55KSB7XG4gICAgICAgICAgdGhpcy5lcnJvcihgRXJyb3IgaW4gY2FsbGJhY2sgZm9yIHJlcXVlc3QgJHtyZXF1ZXN0SWR9YCwgZXJyb3IpO1xuICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgIG5ldyBMb2dnYWJsZUVycm9yKGBFcnJvciBwcm9jZXNzaW5nIHJlc3BvbnNlIGZyb20gJHt0b31gLCBlcnJvcilcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCB0aW1lb3V0TXMgPSB0aW1lb3V0IHx8IHRoaXMucmVxdWVzdENhbGxiYWNrVGltZW91dDtcbiAgICAgIGNvbnN0IHRpbWVvdXRDYiA9XG4gICAgICAgIHRpbWVvdXRDYWxsYmFjayB8fFxuICAgICAgICAoKCkgPT4ge1xuICAgICAgICAgIGlmICh0aGlzLnBlbmRpbmdSZXF1ZXN0cy5oYXMocmVxdWVzdElkKSkge1xuICAgICAgICAgICAgdGhpcy5wZW5kaW5nUmVxdWVzdHMuZGVsZXRlKHJlcXVlc3RJZCk7XG4gICAgICAgICAgICB0aGlzLndhcm4oYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0YCwge1xuICAgICAgICAgICAgICByZXF1ZXN0SWQsXG4gICAgICAgICAgICAgIHRpbWVvdXRNcyxcbiAgICAgICAgICAgICAgcmVxdWVzdFR5cGUsXG4gICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIHJlamVjdChcbiAgICAgICAgICAgICAgbmV3IExvZ2dhYmxlRXJyb3IoXG4gICAgICAgICAgICAgICAgYFJlcXVlc3QgdG8gJHt0b30gdGltZWQgb3V0IGFmdGVyICR7dGltZW91dE1zfW1zYFxuICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICBjb25zdCB0aW1lT3V0SWQgPSBzZXRUaW1lb3V0KHRpbWVvdXRDYiwgdGltZW91dE1zKTtcbiAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLnNldChyZXF1ZXN0SWQsIHtcbiAgICAgICAgY2FsbGJhY2ssXG4gICAgICAgIHRpbWVvdXRDYWxsYmFjazogdGltZW91dENiLFxuICAgICAgICB0aW1lT3V0SWQsXG4gICAgICAgIGhhbmRsZVN0YXR1c1VwZGF0ZTpcbiAgICAgICAgICBoYW5kbGVTdGF0dXNVcGRhdGUgfHwgdGhpcy5oYW5kbGVTdGF0dXNVcGRhdGUuYmluZCh0aGlzKSxcbiAgICAgIH0pO1xuICAgICAgY29uc3QgcGVlciA9IHRoaXMuYmFja2VuZC5wdWJTdWJDb25zdW1lci5iaW5kQ2hhbm5lbChwZWVyQWRkcmVzcyk7XG4gICAgICBjb25zdCBzZW5kTWV0aG9kID1cbiAgICAgICAgdG8gPT0gdGhpcy5zZXJ2aWNlSWRcbiAgICAgICAgICA/IHRoaXMucHJvY2Vzc0luY29taW5nTWVzc2FnZS5iaW5kKHRoaXMpXG4gICAgICAgICAgOiBwZWVyLnNlbmQ7XG4gICAgICBzZW5kTWV0aG9kKHJlcXVlc3QpLmNhdGNoKChlcnJvcjogYW55KSA9PiB7XG4gICAgICAgIHRoaXMucGVuZGluZ1JlcXVlc3RzLmRlbGV0ZShyZXF1ZXN0SWQpO1xuICAgICAgICB0aGlzLmVycm9yKGBGYWlsZWQgdG8gc2VuZCByZXF1ZXN0IHRvICR7dG99YCwge1xuICAgICAgICAgIGVycm9yLFxuICAgICAgICAgIHJlcXVlc3RJZCxcbiAgICAgICAgICByZXF1ZXN0VHlwZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHJlamVjdChuZXcgTG9nZ2FibGVFcnJvcihgRmFpbGVkIHRvIHNlbmQgcmVxdWVzdCB0byAke3RvfWAsIGVycm9yKSk7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZ2VuZXJhdGVSZXF1ZXN0SWQoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gYCR7dGhpcy5zZXJ2aWNlSWR9LSR7RGF0ZS5ub3coKX0tJHtNYXRoLnJhbmRvbSgpXG4gICAgICAudG9TdHJpbmcoMzYpXG4gICAgICAuc3Vic3RyKDIsIDkpfWA7XG4gIH1cbn1cbiJdfQ==