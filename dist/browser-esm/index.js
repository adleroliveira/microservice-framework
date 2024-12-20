var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/eventemitter3/index.js
var require_eventemitter3 = __commonJS({
  "node_modules/eventemitter3/index.js"(exports, module) {
    "use strict";
    var has = Object.prototype.hasOwnProperty;
    var prefix = "~";
    function Events() {
    }
    if (Object.create) {
      Events.prototype = /* @__PURE__ */ Object.create(null);
      if (!new Events().__proto__) prefix = false;
    }
    function EE(fn, context, once) {
      this.fn = fn;
      this.context = context;
      this.once = once || false;
    }
    function addListener(emitter, event, fn, context, once) {
      if (typeof fn !== "function") {
        throw new TypeError("The listener must be a function");
      }
      var listener = new EE(fn, context || emitter, once), evt = prefix ? prefix + event : event;
      if (!emitter._events[evt]) emitter._events[evt] = listener, emitter._eventsCount++;
      else if (!emitter._events[evt].fn) emitter._events[evt].push(listener);
      else emitter._events[evt] = [emitter._events[evt], listener];
      return emitter;
    }
    function clearEvent(emitter, evt) {
      if (--emitter._eventsCount === 0) emitter._events = new Events();
      else delete emitter._events[evt];
    }
    function EventEmitter2() {
      this._events = new Events();
      this._eventsCount = 0;
    }
    EventEmitter2.prototype.eventNames = function eventNames() {
      var names = [], events, name;
      if (this._eventsCount === 0) return names;
      for (name in events = this._events) {
        if (has.call(events, name)) names.push(prefix ? name.slice(1) : name);
      }
      if (Object.getOwnPropertySymbols) {
        return names.concat(Object.getOwnPropertySymbols(events));
      }
      return names;
    };
    EventEmitter2.prototype.listeners = function listeners(event) {
      var evt = prefix ? prefix + event : event, handlers = this._events[evt];
      if (!handlers) return [];
      if (handlers.fn) return [handlers.fn];
      for (var i = 0, l = handlers.length, ee = new Array(l); i < l; i++) {
        ee[i] = handlers[i].fn;
      }
      return ee;
    };
    EventEmitter2.prototype.listenerCount = function listenerCount(event) {
      var evt = prefix ? prefix + event : event, listeners = this._events[evt];
      if (!listeners) return 0;
      if (listeners.fn) return 1;
      return listeners.length;
    };
    EventEmitter2.prototype.emit = function emit(event, a1, a2, a3, a4, a5) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return false;
      var listeners = this._events[evt], len = arguments.length, args, i;
      if (listeners.fn) {
        if (listeners.once) this.removeListener(event, listeners.fn, void 0, true);
        switch (len) {
          case 1:
            return listeners.fn.call(listeners.context), true;
          case 2:
            return listeners.fn.call(listeners.context, a1), true;
          case 3:
            return listeners.fn.call(listeners.context, a1, a2), true;
          case 4:
            return listeners.fn.call(listeners.context, a1, a2, a3), true;
          case 5:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4), true;
          case 6:
            return listeners.fn.call(listeners.context, a1, a2, a3, a4, a5), true;
        }
        for (i = 1, args = new Array(len - 1); i < len; i++) {
          args[i - 1] = arguments[i];
        }
        listeners.fn.apply(listeners.context, args);
      } else {
        var length = listeners.length, j;
        for (i = 0; i < length; i++) {
          if (listeners[i].once) this.removeListener(event, listeners[i].fn, void 0, true);
          switch (len) {
            case 1:
              listeners[i].fn.call(listeners[i].context);
              break;
            case 2:
              listeners[i].fn.call(listeners[i].context, a1);
              break;
            case 3:
              listeners[i].fn.call(listeners[i].context, a1, a2);
              break;
            case 4:
              listeners[i].fn.call(listeners[i].context, a1, a2, a3);
              break;
            default:
              if (!args) for (j = 1, args = new Array(len - 1); j < len; j++) {
                args[j - 1] = arguments[j];
              }
              listeners[i].fn.apply(listeners[i].context, args);
          }
        }
      }
      return true;
    };
    EventEmitter2.prototype.on = function on(event, fn, context) {
      return addListener(this, event, fn, context, false);
    };
    EventEmitter2.prototype.once = function once(event, fn, context) {
      return addListener(this, event, fn, context, true);
    };
    EventEmitter2.prototype.removeListener = function removeListener(event, fn, context, once) {
      var evt = prefix ? prefix + event : event;
      if (!this._events[evt]) return this;
      if (!fn) {
        clearEvent(this, evt);
        return this;
      }
      var listeners = this._events[evt];
      if (listeners.fn) {
        if (listeners.fn === fn && (!once || listeners.once) && (!context || listeners.context === context)) {
          clearEvent(this, evt);
        }
      } else {
        for (var i = 0, events = [], length = listeners.length; i < length; i++) {
          if (listeners[i].fn !== fn || once && !listeners[i].once || context && listeners[i].context !== context) {
            events.push(listeners[i]);
          }
        }
        if (events.length) this._events[evt] = events.length === 1 ? events[0] : events;
        else clearEvent(this, evt);
      }
      return this;
    };
    EventEmitter2.prototype.removeAllListeners = function removeAllListeners(event) {
      var evt;
      if (event) {
        evt = prefix ? prefix + event : event;
        if (this._events[evt]) clearEvent(this, evt);
      } else {
        this._events = new Events();
        this._eventsCount = 0;
      }
      return this;
    };
    EventEmitter2.prototype.off = EventEmitter2.prototype.removeListener;
    EventEmitter2.prototype.addListener = EventEmitter2.prototype.on;
    EventEmitter2.prefixed = prefix;
    EventEmitter2.EventEmitter = EventEmitter2;
    if ("undefined" !== typeof module) {
      module.exports = EventEmitter2;
    }
  }
});

// node_modules/eventemitter3/index.mjs
var import_index = __toESM(require_eventemitter3(), 1);
var eventemitter3_default = import_index.default;

// node_modules/uuid/dist/esm-browser/rng.js
var getRandomValues;
var rnds8 = new Uint8Array(16);
function rng() {
  if (!getRandomValues) {
    getRandomValues = typeof crypto !== "undefined" && crypto.getRandomValues && crypto.getRandomValues.bind(crypto) || typeof msCrypto !== "undefined" && typeof msCrypto.getRandomValues === "function" && msCrypto.getRandomValues.bind(msCrypto);
    if (!getRandomValues) {
      throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");
    }
  }
  return getRandomValues(rnds8);
}

// node_modules/uuid/dist/esm-browser/regex.js
var regex_default = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;

// node_modules/uuid/dist/esm-browser/validate.js
function validate(uuid) {
  return typeof uuid === "string" && regex_default.test(uuid);
}
var validate_default = validate;

// node_modules/uuid/dist/esm-browser/stringify.js
var byteToHex = [];
for (i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).substr(1));
}
var i;
function stringify(arr) {
  var offset = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : 0;
  var uuid = (byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]]).toLowerCase();
  if (!validate_default(uuid)) {
    throw TypeError("Stringified UUID is invalid");
  }
  return uuid;
}
var stringify_default = stringify;

// node_modules/uuid/dist/esm-browser/v4.js
function v4(options, buf, offset) {
  options = options || {};
  var rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (var i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return stringify_default(rnds);
}
var v4_default = v4;

// src/logging/LogStrategy.ts
var LogStrategy = class _LogStrategy {
  constructor() {
  }
  async send(message, options) {
    const truncatedMessage = _LogStrategy.truncateAndStringify(
      message,
      0,
      this.MAX_STRING_LENGTH,
      this.MAX_DEPTH
    );
    const packagedMessage = {
      header: this.createRequestHeader(),
      body: truncatedMessage
    };
    await this.sendPackaged(packagedMessage, options);
  }
  createRequestHeader() {
    return {
      timestamp: Date.now(),
      requestId: v4_default(),
      requesterAddress: "log-strategy",
      requestType: "LOG::MESSAGE"
    };
  }
  static truncateAndStringify(value, depth = 0, maxStringLength = 5e3, maxDepth = 10) {
    if (depth > maxDepth) {
      return "[Object depth limit exceeded]";
    }
    if (value === void 0 || value === null) {
      return value;
    }
    if (typeof value === "string") {
      return value.length > maxStringLength ? value.substring(0, maxStringLength) + "..." : value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: this.truncateAndStringify(value.message),
        stack: this.truncateAndStringify(value.stack)
      };
    }
    if (this.isBufferOrArrayBufferView(value)) {
      return `[Binary data of length ${value.byteLength}]`;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.truncateAndStringify(item, depth + 1));
    }
    if (typeof value === "object") {
      const truncatedObject = {};
      for (const [key, prop] of Object.entries(value)) {
        truncatedObject[key] = this.truncateAndStringify(prop, depth + 1);
      }
      return truncatedObject;
    }
    return "[Unserializable data]";
  }
  static isBufferOrArrayBufferView(value) {
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
      return true;
    }
    if (ArrayBuffer.isView(value)) {
      return true;
    }
    if (value instanceof ArrayBuffer) {
      return true;
    }
    return false;
  }
};

// src/browser/BrowserConsoleStrategy.ts
var _BrowserConsoleStrategy = class _BrowserConsoleStrategy extends LogStrategy {
  constructor(maxStringLength = 5e3, maxDepth = 10) {
    super();
    this.MAX_STRING_LENGTH = maxStringLength;
    this.MAX_DEPTH = maxDepth;
  }
  isLogMessage(body) {
    return typeof body === "object" && body !== null && "timestamp" in body && "level" in body && "message" in body;
  }
  async sendPackaged(packagedMessage, options) {
    const { header, body } = packagedMessage;
    const logLevel = options?.logLevel || 1 /* INFO */;
    if (this.isLogMessage(body)) {
      this.formatLogMessage(body, header.requestId);
    } else {
      this.formatGenericMessage(
        body,
        logLevel,
        header.timestamp,
        header.requestId
      );
    }
  }
  formatLogMessage(logMessage, requestId) {
    const { sender, timestamp, level, message, payload } = logMessage;
    const logLevel = parseInt(level) || 1 /* INFO */;
    const color = _BrowserConsoleStrategy.LOG_COLORS[logLevel];
    console.groupCollapsed(
      `%c[${logLevel}] ${new Date(timestamp).toISOString()}`,
      color
    );
    if (sender) {
      console.log(`Sender: ${sender}`);
    }
    console.log(`Message: ${message}`);
    console.log(`RequestID: ${requestId}`);
    if (payload) {
      console.log("Payload:", payload);
    }
    console.groupEnd();
  }
  formatGenericMessage(message, logLevel, timestamp, requestId) {
    const color = _BrowserConsoleStrategy.LOG_COLORS[logLevel];
    console.groupCollapsed(
      `%c[${logLevel}] ${new Date(timestamp).toISOString()}`,
      color
    );
    console.log(`RequestID: ${requestId}`);
    if (typeof message === "object" && message !== null) {
      console.log("Message:", message);
    } else {
      console.log(`Message: ${message}`);
    }
    console.groupEnd();
  }
  async log(message, logLevel = 1 /* INFO */) {
    await this.send(message, { logLevel });
  }
  async info(message, data) {
    await this.log({ message, data }, 1 /* INFO */);
  }
  async warn(message, data) {
    await this.log({ message, data }, 2 /* WARN */);
  }
  async error(message, data) {
    await this.log({ message, data }, 3 /* ERROR */);
  }
  async debug(message, data) {
    await this.log({ message, data }, 0 /* DEBUG */);
  }
};
_BrowserConsoleStrategy.LOG_COLORS = {
  [1 /* INFO */]: "color: blue",
  [2 /* WARN */]: "color: orange",
  [3 /* ERROR */]: "color: red",
  [0 /* DEBUG */]: "color: green"
};
var BrowserConsoleStrategy = _BrowserConsoleStrategy;

// src/browser/WebSocketManager.ts
var WebSocketState = /* @__PURE__ */ ((WebSocketState2) => {
  WebSocketState2[WebSocketState2["CONNECTING"] = 0] = "CONNECTING";
  WebSocketState2[WebSocketState2["OPEN"] = 1] = "OPEN";
  WebSocketState2[WebSocketState2["CLOSING"] = 2] = "CLOSING";
  WebSocketState2[WebSocketState2["CLOSED"] = 3] = "CLOSED";
  return WebSocketState2;
})(WebSocketState || {});
var AuthMethod = /* @__PURE__ */ ((AuthMethod2) => {
  AuthMethod2["TOKEN"] = "token";
  AuthMethod2["CREDENTIALS"] = "credentials";
  AuthMethod2["ANONYMOUS"] = "anonymous";
  return AuthMethod2;
})(AuthMethod || {});
var WebSocketManager = class extends eventemitter3_default {
  constructor(config) {
    super();
    this.reconnectAttempts = 0;
    this.state = 3 /* CLOSED */;
    this.protocols = [];
    this.logger = new BrowserConsoleStrategy();
    this.url = config.url;
    this.secure = config.secure || false;
    this.auth = config.auth;
    this.maxReconnectAttempts = config.maxReconnectAttempts || 5;
    this.reconnectInterval = config.reconnectInterval || 5e3;
    this.connectionTimeout = config.connectionTimeout || 1e4;
    this.setupAuthProtocols();
    this.connect();
  }
  setupAuthProtocols() {
    if (!this.auth) return;
    switch (this.auth.method) {
      case "token" /* TOKEN */:
        if (this.auth.token) {
          this.protocols.push(`token-${this.auth.token}`);
        }
        break;
      case "credentials" /* CREDENTIALS */:
        if (this.auth.credentials) {
          const { username, password } = this.auth.credentials;
          const credentials = btoa(encodeURIComponent(password)).replace(
            /=/g,
            ""
          );
          this.protocols.push(`auth-${username}-${credentials}`);
          this.logger.debug(`Auth protocol`, this.protocols);
        }
        break;
    }
  }
  connect() {
    this.state = 0 /* CONNECTING */;
    const secureUrl = this.getSecureUrl(this.url, this.secure);
    const urlWithAuth = this.auth?.method === "token" /* TOKEN */ && this.auth.token ? `${secureUrl}?token=${this.auth.token}` : secureUrl;
    this.logger.info(`Attempting to connect to ${urlWithAuth}`);
    try {
      this.ws = new WebSocket(urlWithAuth, this.protocols);
      this.setHooks();
      this.setConnectionTimeout();
    } catch (error) {
      this.handleConnectionError(error);
    }
  }
  handleConnectionError(error) {
    this.logger.error("Connection error:", error);
    this.emit("error", {
      type: "CONNECTION_ERROR",
      message: "Failed to establish WebSocket connection",
      error
    });
  }
  getSecureUrl(url, secure) {
    return secure ? url.replace(/^ws:/, "wss:") : url;
  }
  setHooks() {
    this.ws.onopen = () => {
      this.clearConnectionTimeout();
      this.state = 1 /* OPEN */;
      this.reconnectAttempts = 0;
      this.logger.info(`WebSocket opened. ReadyState: ${this.ws.readyState}`);
      this.emit("open");
    };
    this.ws.onerror = (error) => {
      const wsError = error.target;
      if (wsError.readyState === WebSocket.CLOSED) {
        const errorDetails = {
          type: "CONNECTION_ERROR",
          message: "Connection failed",
          readyState: wsError.readyState,
          url: wsError.url
        };
        if (this.reconnectAttempts === 0) {
          errorDetails.type = "AUTH_ERROR";
          errorDetails.message = "Authentication required";
        }
        this.logger.error("WebSocket error:", errorDetails);
        this.emit("error", errorDetails);
      } else {
        this.logger.error("WebSocket error:", error);
        this.emit("error", error);
      }
    };
    this.ws.onclose = (event) => {
      this.clearConnectionTimeout();
      this.state = 3 /* CLOSED */;
      if (event.code === 1001 || // Going Away
      event.code === 1006 || // Abnormal Closure (what browsers often use for 401)
      event.code === 1008) {
        const error = {
          type: "AUTH_ERROR",
          code: event.code,
          reason: event.reason || "Authentication required"
        };
        this.emit("error", error);
        return;
      }
      this.logger.info(
        `WebSocket closed. ReadyState: ${this.ws.readyState}. Code: ${event.code}, Reason: ${event.reason}`
      );
      this.emit("close", event);
      this.handleReconnection();
    };
    this.ws.onmessage = (event) => {
      const parsedData = this.parseMessage(event.data);
      this.emit("message", parsedData);
    };
  }
  handleReconnection() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const minDelay = 1e3;
      const delay = Math.max(
        minDelay,
        this.reconnectInterval * Math.pow(2, this.reconnectAttempts - 1)
      );
      this.logger.info(
        `Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms...`
      );
      setTimeout(() => this.connect(), delay);
    } else {
      this.logger.error(
        "Max reconnection attempts reached. Please reconnect manually."
      );
      this.emit("maxReconnectAttemptsReached");
    }
  }
  setConnectionTimeout() {
    this.connectionTimer = window.setTimeout(() => {
      if (this.state === 0 /* CONNECTING */) {
        this.logger.error("Connection attempt timed out");
        this.ws.close();
      }
    }, this.connectionTimeout);
  }
  clearConnectionTimeout() {
    if (this.connectionTimer) {
      window.clearTimeout(this.connectionTimer);
    }
  }
  parseMessage(data) {
    try {
      return JSON.parse(data);
    } catch (error) {
      return data;
    }
  }
  send(message) {
    if (this.state === 1 /* OPEN */) {
      const data = typeof message === "string" ? message : JSON.stringify(message);
      this.ws.send(data);
    } else {
      const error = new Error("WebSocket is not open");
      this.emit("error", error);
    }
  }
  close() {
    this.state = 2 /* CLOSING */;
    this.ws.close();
  }
  reconnect() {
    this.logger.debug("Manual reconnection initiated.");
    this.reconnectAttempts = 0;
    this.close();
    this.connect();
  }
  getState() {
    return this.state;
  }
  getReadyState() {
    return this.ws.readyState;
  }
  setAuthConfig(authConfig) {
    this.auth = authConfig;
    this.setupAuthProtocols();
  }
  isAuthenticated() {
    return this.state === 1 /* OPEN */;
  }
  reconnectWithNewAuth(authConfig) {
    this.setAuthConfig(authConfig);
    this.reconnect();
  }
  destroy() {
    this.clearConnectionTimeout();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      if (this.state !== 3 /* CLOSED */) {
        this.close();
      }
      this.ws = null;
    }
    this.removeAllListeners();
    this.logger = null;
    this.auth = void 0;
    this.protocols = [];
  }
};

// src/browser/RequestManager.ts
var RequestManager = class extends eventemitter3_default {
  constructor(props) {
    super();
    this.pendingRequests = /* @__PURE__ */ new Map();
    this.requestHandlers = /* @__PURE__ */ new Map();
    this.logger = new BrowserConsoleStrategy();
    this.requestTimeout = props.requestTimeout || 3e4;
    this.webSocketManager = props.webSocketManager;
    this.webSocketManager.on("message", this.handleMessage.bind(this));
  }
  async request(requestType, body, to) {
    return new Promise((resolve, reject) => {
      const request = this.createRequest(requestType, body, to);
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(request.header.requestId);
        reject(new Error("Request timeout"));
      }, this.requestTimeout);
      const requestCallback = (response) => {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(request.header.requestId);
        if (response.body.success) {
          resolve(response.body);
        } else {
          reject(response.body.error || response.body.data);
        }
      };
      this.pendingRequests.set(request.header.requestId, requestCallback);
      this.webSocketManager.send(JSON.stringify(request));
    });
  }
  createRequest(requestType, body, to) {
    return {
      header: {
        timestamp: Date.now(),
        requestId: `RM-${v4_default()}`,
        requesterAddress: "RequestManager",
        recipientAddress: to,
        requestType,
        authToken: this.authToken
      },
      body
    };
  }
  handleMessage(parsed) {
    try {
      if (parsed.header && parsed.header.requestType) {
        this.handleIncomingRequest(parsed);
      } else if (parsed.requestHeader) {
        this.handleResponse(parsed);
      } else {
        this.logger.warn("Received message with unknown structure:", parsed);
      }
    } catch (error) {
      this.logger.error("Error parsing message:", error);
    }
  }
  async handleIncomingRequest(request) {
    const { requestType } = request.header;
    if (!requestType) {
      this.logger.warn("Received request without requestType");
      return;
    }
    if (this.listenerCount(requestType) > 0) {
      this.emit(requestType, request.body, request.header);
    } else {
      this.logger.warn(
        `No handlers registered for requestType: ${requestType}`
      );
      const errorResponse = {
        requestHeader: request.header,
        responseHeader: {
          responderAddress: "RequestManager",
          timestamp: Date.now()
        },
        body: {
          data: null,
          success: false,
          error: new Error(
            `No handler registered for requestType: ${requestType}`
          )
        }
      };
      this.webSocketManager.send(JSON.stringify(errorResponse));
    }
  }
  handleResponse(response) {
    const { requestType } = response.requestHeader;
    if (requestType == "MicroserviceFramework::StatusUpdate" && this.listenerCount(requestType) > 0) {
      this.emit(requestType, response.body.data, response.requestHeader);
      return;
    }
    const pendingRequest = this.pendingRequests.get(
      response.requestHeader.requestId
    );
    if (pendingRequest) {
      pendingRequest(response);
      this.pendingRequests.delete(response.requestHeader.requestId);
    }
  }
  // Method to register handlers for incoming requests
  registerHandler(requestType, handler) {
    if (this.requestHandlers.has(requestType)) {
      throw new Error(
        `Handler already registered for requestType: ${requestType}`
      );
    }
    this.requestHandlers.set(requestType, handler);
    this.on(requestType, async (payload, requestHeader) => {
      try {
        const result = await handler(payload, requestHeader);
        if (!requestHeader.requiresResponse) {
          return;
        }
        const response = {
          requestHeader,
          responseHeader: {
            responderAddress: "RequestManager",
            timestamp: Date.now()
          },
          body: {
            data: result,
            success: true,
            error: null
          }
        };
        this.webSocketManager.send(JSON.stringify(response));
      } catch (error) {
        if (!requestHeader.requiresResponse) {
          this.logger.warn(
            `Request error not sent. No response required for requestType: ${requestType}`,
            error
          );
          return;
        }
        const errorResponse = {
          requestHeader,
          responseHeader: {
            responderAddress: "RequestManager",
            timestamp: Date.now()
          },
          body: {
            data: null,
            success: false,
            error: error instanceof Error ? error : new Error(String(error))
          }
        };
        this.webSocketManager.send(JSON.stringify(errorResponse));
      }
    });
  }
  // Method to remove handlers
  removeHandler(requestType) {
    this.requestHandlers.delete(requestType);
    this.removeAllListeners(requestType);
  }
  setAuthToken(token) {
    this.authToken = token;
  }
  clearAuthToken() {
    this.authToken = void 0;
  }
  clearState() {
    for (const [requestId] of this.pendingRequests) {
      this.pendingRequests.delete(requestId);
    }
    this.clearAuthToken();
  }
  destroy() {
    for (const [requestId] of this.pendingRequests) {
      this.pendingRequests.delete(requestId);
    }
    this.webSocketManager.removeListener(
      "message",
      this.handleMessage.bind(this)
    );
    this.removeAllListeners();
    this.clearAuthToken();
    this.webSocketManager = null;
    this.logger = null;
    this.pendingRequests = null;
  }
};

// src/browser/CommunicationsManager.ts
var CommunicationsManager = class extends eventemitter3_default {
  constructor(config) {
    super();
    this.logger = new BrowserConsoleStrategy();
    this.lastHeartbeatTimestamp = 0;
    this.config = config;
    this.validateConfig(config);
    try {
      this.initializeManagers(config);
    } catch (error) {
      this.logger.error("Error initializing CommunicationsManager", { error });
      throw new Error("Failed to initialize CommunicationsManager");
    }
  }
  initializeManagers(config) {
    this.webSocketManager = new WebSocketManager({
      url: config.url,
      secure: config.secure,
      auth: config.auth,
      maxReconnectAttempts: config.maxReconnectAttempts,
      reconnectInterval: config.reconnectInterval
    });
    this.requestManager = new RequestManager({
      webSocketManager: this.webSocketManager,
      requestTimeout: config.requestTimeout
    });
    this.setupWebSocketHooks();
  }
  async cleanupCurrentState() {
    this.webSocketManager.removeAllListeners();
    this.requestManager.removeAllListeners();
    if (this.webSocketManager) {
      await new Promise((resolve) => {
        this.webSocketManager.once("close", () => resolve());
        this.webSocketManager.close();
      });
    }
    if (this.requestManager) {
      this.requestManager.clearState();
    }
  }
  setupWebSocketHooks() {
    this.webSocketManager.on(
      "maxReconnectAttemptsReached",
      this.handleMaxReconnectAttemptsReached.bind(this)
    );
    this.webSocketManager.on("authError", (error) => {
      this.logger.error("Authentication error", error);
      this.emit("authError", error);
    });
    this.registerMessageHandler(
      "heartbeat",
      async (heartbeat, header) => {
        const latency = Date.now() - heartbeat.timestamp;
        this.lastHeartbeatTimestamp = Date.now();
        this.emit("heartbeat", { latency });
        return {
          requestTimestamp: heartbeat.timestamp,
          responseTimestamp: Date.now()
        };
      }
    );
  }
  async authenticate(authConfig) {
    try {
      await this.cleanupCurrentState();
      const newConfig = {
        ...this.config,
        auth: authConfig
      };
      this.initializeManagers(newConfig);
      this.logger.info("Switched to authenticated mode");
      this.emit("modeChanged", "authenticated");
    } catch (error) {
      this.logger.error("Error switching to authenticated mode", error);
      throw error;
    }
  }
  async switchToAnonymous() {
    try {
      await this.cleanupCurrentState();
      const anonymousConfig = {
        ...this.config,
        auth: {
          method: "anonymous" /* ANONYMOUS */
        }
      };
      this.initializeManagers(anonymousConfig);
      this.logger.info("Switched to anonymous mode");
      this.emit("modeChanged", "anonymous");
    } catch (error) {
      this.logger.error("Error switching to anonymous mode", error);
      throw error;
    }
  }
  onOpen(callback) {
    this.logger.info("onOpen callback registered");
    this.webSocketManager.on("open", callback);
  }
  onClose(callback) {
    this.logger.info("onClose callback registered");
    this.webSocketManager.on("close", callback);
  }
  onError(callback) {
    this.logger.info("onError callback registered");
    this.webSocketManager.on("error", callback);
  }
  onMessage(callback) {
    this.logger.info("onMessage callback registered");
    this.webSocketManager.on("message", callback);
  }
  handleMaxReconnectAttemptsReached() {
    this.logger.error(
      "Maximum reconnection attempts reached. To try again, please refresh the page."
    );
  }
  validateConfig(config) {
    if (!config.url) {
      throw new Error("URL is required in the configuration");
    }
  }
  async request(requestType, body, to) {
    try {
      return this.requestManager.request(requestType, body, to);
    } catch (error) {
      this.logger.error("Error making request", { requestType, error });
      throw error;
    }
  }
  registerMessageHandler(messageType, handler) {
    this.requestManager.registerHandler(
      messageType,
      async (payload, header) => {
        try {
          return await handler(payload, header);
        } catch (error) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      }
    );
  }
  getConnectionState() {
    return this.webSocketManager.getState();
  }
  updateAuthentication(auth) {
    this.webSocketManager.reconnectWithNewAuth(auth);
  }
  isAuthenticated() {
    return this.webSocketManager.isAuthenticated();
  }
  getCurrentMode() {
    return this.config.auth?.method === "anonymous" /* ANONYMOUS */ ? "anonymous" : "authenticated";
  }
  destroy() {
    this.removeAllListeners();
    if (this.webSocketManager) {
      this.webSocketManager.destroy();
      this.webSocketManager = null;
    }
    if (this.requestManager) {
      this.requestManager.destroy();
      this.requestManager = null;
    }
    this.logger = null;
    this.config = null;
  }
  getConnectionHealth() {
    return {
      connected: this.webSocketManager.getState() === 1 /* OPEN */,
      lastHeartbeat: this.lastHeartbeatTimestamp
    };
  }
};
export {
  AuthMethod,
  BrowserConsoleStrategy,
  CommunicationsManager,
  WebSocketManager,
  WebSocketState
};
//# sourceMappingURL=index.js.map
