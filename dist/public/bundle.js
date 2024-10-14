"use strict";var MicroserviceFramework=(()=>{var $=Object.create;var M=Object.defineProperty;var B=Object.getOwnPropertyDescriptor;var W=Object.getOwnPropertyNames;var U=Object.getPrototypeOf,j=Object.prototype.hasOwnProperty;var V=(n,t)=>()=>(t||n((t={exports:{}}).exports,t),t.exports),F=(n,t)=>{for(var e in t)M(n,e,{get:t[e],enumerable:!0})},A=(n,t,e,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of W(t))!j.call(n,s)&&s!==e&&M(n,s,{get:()=>t[s],enumerable:!(r=B(t,s))||r.enumerable});return n};var X=(n,t,e)=>(e=n!=null?$(U(n)):{},A(t||!n||!n.__esModule?M(e,"default",{value:n,enumerable:!0}):e,n)),J=n=>A(M({},"__esModule",{value:!0}),n);var N=V((ne,T)=>{"use strict";var z=Object.prototype.hasOwnProperty,g="~";function v(){}Object.create&&(v.prototype=Object.create(null),new v().__proto__||(g=!1));function K(n,t,e){this.fn=n,this.context=t,this.once=e||!1}function C(n,t,e,r,s){if(typeof e!="function")throw new TypeError("The listener must be a function");var i=new K(e,r||n,s),a=g?g+t:t;return n._events[a]?n._events[a].fn?n._events[a]=[n._events[a],i]:n._events[a].push(i):(n._events[a]=i,n._eventsCount++),n}function S(n,t){--n._eventsCount===0?n._events=new v:delete n._events[t]}function l(){this._events=new v,this._eventsCount=0}l.prototype.eventNames=function(){var t=[],e,r;if(this._eventsCount===0)return t;for(r in e=this._events)z.call(e,r)&&t.push(g?r.slice(1):r);return Object.getOwnPropertySymbols?t.concat(Object.getOwnPropertySymbols(e)):t};l.prototype.listeners=function(t){var e=g?g+t:t,r=this._events[e];if(!r)return[];if(r.fn)return[r.fn];for(var s=0,i=r.length,a=new Array(i);s<i;s++)a[s]=r[s].fn;return a};l.prototype.listenerCount=function(t){var e=g?g+t:t,r=this._events[e];return r?r.fn?1:r.length:0};l.prototype.emit=function(t,e,r,s,i,a){var u=g?g+t:t;if(!this._events[u])return!1;var o=this._events[u],f=arguments.length,d,c;if(o.fn){switch(o.once&&this.removeListener(t,o.fn,void 0,!0),f){case 1:return o.fn.call(o.context),!0;case 2:return o.fn.call(o.context,e),!0;case 3:return o.fn.call(o.context,e,r),!0;case 4:return o.fn.call(o.context,e,r,s),!0;case 5:return o.fn.call(o.context,e,r,s,i),!0;case 6:return o.fn.call(o.context,e,r,s,i,a),!0}for(c=1,d=new Array(f-1);c<f;c++)d[c-1]=arguments[c];o.fn.apply(o.context,d)}else{var H=o.length,y;for(c=0;c<H;c++)switch(o[c].once&&this.removeListener(t,o[c].fn,void 0,!0),f){case 1:o[c].fn.call(o[c].context);break;case 2:o[c].fn.call(o[c].context,e);break;case 3:o[c].fn.call(o[c].context,e,r);break;case 4:o[c].fn.call(o[c].context,e,r,s);break;default:if(!d)for(y=1,d=new Array(f-1);y<f;y++)d[y-1]=arguments[y];o[c].fn.apply(o[c].context,d)}}return!0};l.prototype.on=function(t,e,r){return C(this,t,e,r,!1)};l.prototype.once=function(t,e,r){return C(this,t,e,r,!0)};l.prototype.removeListener=function(t,e,r,s){var i=g?g+t:t;if(!this._events[i])return this;if(!e)return S(this,i),this;var a=this._events[i];if(a.fn)a.fn===e&&(!s||a.once)&&(!r||a.context===r)&&S(this,i);else{for(var u=0,o=[],f=a.length;u<f;u++)(a[u].fn!==e||s&&!a[u].once||r&&a[u].context!==r)&&o.push(a[u]);o.length?this._events[i]=o.length===1?o[0]:o:S(this,i)}return this};l.prototype.removeAllListeners=function(t){var e;return t?(e=g?g+t:t,this._events[e]&&S(this,e)):(this._events=new v,this._eventsCount=0),this};l.prototype.off=l.prototype.removeListener;l.prototype.addListener=l.prototype.on;l.prefixed=g;l.EventEmitter=l;typeof T<"u"&&(T.exports=l)});var te={};F(te,{BrowserConsoleStrategy:()=>h,CommunicationsManager:()=>O,WebSocketManager:()=>w,WebSocketState:()=>G});var _=X(N(),1);var m=_.default;var x,Q=new Uint8Array(16);function E(){if(!x&&(x=typeof crypto<"u"&&crypto.getRandomValues&&crypto.getRandomValues.bind(crypto)||typeof msCrypto<"u"&&typeof msCrypto.getRandomValues=="function"&&msCrypto.getRandomValues.bind(msCrypto),!x))throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");return x(Q)}var L=/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/i;function Y(n){return typeof n=="string"&&L.test(n)}var P=Y;var p=[];for(q=0;q<256;++q)p.push((q+256).toString(16).substr(1));var q;function Z(n){var t=arguments.length>1&&arguments[1]!==void 0?arguments[1]:0,e=(p[n[t+0]]+p[n[t+1]]+p[n[t+2]]+p[n[t+3]]+"-"+p[n[t+4]]+p[n[t+5]]+"-"+p[n[t+6]]+p[n[t+7]]+"-"+p[n[t+8]]+p[n[t+9]]+"-"+p[n[t+10]]+p[n[t+11]]+p[n[t+12]]+p[n[t+13]]+p[n[t+14]]+p[n[t+15]]).toLowerCase();if(!P(e))throw TypeError("Stringified UUID is invalid");return e}var D=Z;function ee(n,t,e){n=n||{};var r=n.random||(n.rng||E)();if(r[6]=r[6]&15|64,r[8]=r[8]&63|128,t){e=e||0;for(var s=0;s<16;++s)t[e+s]=r[s];return t}return D(r)}var b=ee;var I=class n{constructor(){}async send(t,e){let r=n.truncateAndStringify(t,0,this.MAX_STRING_LENGTH,this.MAX_DEPTH),s={header:this.createRequestHeader(),body:r};await this.sendPackaged(s,e)}createRequestHeader(){return{timestamp:Date.now(),requestId:b(),requesterAddress:"log-strategy",requestType:"LOG::MESSAGE"}}static truncateAndStringify(t,e=0,r=5e3,s=10){if(e>s)return"[Object depth limit exceeded]";if(t==null)return t;if(typeof t=="string")return t.length>r?t.substring(0,r)+"...":t;if(typeof t=="number"||typeof t=="boolean")return t;if(t instanceof Error)return{name:t.name,message:this.truncateAndStringify(t.message),stack:this.truncateAndStringify(t.stack)};if(this.isBufferOrArrayBufferView(t))return`[Binary data of length ${t.byteLength}]`;if(Array.isArray(t))return t.map(i=>this.truncateAndStringify(i,e+1));if(typeof t=="object"){let i={};for(let[a,u]of Object.entries(t))i[a]=this.truncateAndStringify(u,e+1);return i}return"[Unserializable data]"}static isBufferOrArrayBufferView(t){return!!(typeof Buffer<"u"&&Buffer.isBuffer(t)||ArrayBuffer.isView(t)||t instanceof ArrayBuffer)}};var R=class R extends I{constructor(t=5e3,e=10){super(),this.MAX_STRING_LENGTH=t,this.MAX_DEPTH=e}isLogMessage(t){return typeof t=="object"&&t!==null&&"timestamp"in t&&"level"in t&&"message"in t}async sendPackaged(t,e){let{header:r,body:s}=t,i=e?.logLevel||1;this.isLogMessage(s)?this.formatLogMessage(s,r.requestId):this.formatGenericMessage(s,i,r.timestamp,r.requestId)}formatLogMessage(t,e){let{sender:r,timestamp:s,level:i,message:a,payload:u}=t,o=parseInt(i)||1,f=R.LOG_COLORS[o];console.groupCollapsed(`%c[${o}] ${new Date(s).toISOString()}`,f),r&&console.log(`Sender: ${r}`),console.log(`Message: ${a}`),console.log(`RequestID: ${e}`),u&&console.log("Payload:",u),console.groupEnd()}formatGenericMessage(t,e,r,s){let i=R.LOG_COLORS[e];console.groupCollapsed(`%c[${e}] ${new Date(r).toISOString()}`,i),console.log(`RequestID: ${s}`),typeof t=="object"&&t!==null?console.log("Message:",t):console.log(`Message: ${t}`),console.groupEnd()}async log(t,e=1){await this.send(t,{logLevel:e})}async info(t,e){await this.log({message:t,data:e},1)}async warn(t,e){await this.log({message:t,data:e},2)}async error(t,e){await this.log({message:t,data:e},3)}async debug(t,e){await this.log({message:t,data:e},0)}};R.LOG_COLORS={1:"color: blue",2:"color: orange",3:"color: red",0:"color: green"};var h=R;var G=(s=>(s[s.CONNECTING=0]="CONNECTING",s[s.OPEN=1]="OPEN",s[s.CLOSING=2]="CLOSING",s[s.CLOSED=3]="CLOSED",s))(G||{}),w=class extends m{constructor(e,r=!1,s=5,i=5e3,a=1e4){super();this.reconnectAttempts=0;this.state=3;this.logger=new h,this.url=e,this.secure=r,this.maxReconnectAttempts=s,this.reconnectInterval=i,this.connectionTimeout=a,this.connect()}connect(){this.state=0;let e=this.getSecureUrl(this.url,this.secure);this.logger.info(`Attempting to connect to ${e}`),this.ws=new WebSocket(e),this.setHooks(),this.setConnectionTimeout()}getSecureUrl(e,r){return r?e.replace(/^ws:/,"wss:"):e}setHooks(){this.ws.onopen=()=>{this.clearConnectionTimeout(),this.state=1,this.reconnectAttempts=0,this.logger.info(`WebSocket opened. ReadyState: ${this.ws.readyState}`),this.emit("open")},this.ws.onclose=e=>{this.clearConnectionTimeout(),this.state=3,this.logger.info(`WebSocket closed. ReadyState: ${this.ws.readyState}. Code: ${e.code}, Reason: ${e.reason}`),this.emit("close",e),this.handleReconnection()},this.ws.onerror=e=>{this.logger.error(e),this.emit("error",e)},this.ws.onmessage=e=>{let r=this.parseMessage(e.data);this.emit("message",r)}}handleReconnection(){if(this.reconnectAttempts<this.maxReconnectAttempts){this.reconnectAttempts++;let r=Math.max(1e3,this.reconnectInterval*Math.pow(2,this.reconnectAttempts-1));this.logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${r}ms...`),setTimeout(()=>this.connect(),r)}else this.logger.error("Max reconnection attempts reached. Please reconnect manually."),this.emit("maxReconnectAttemptsReached")}setConnectionTimeout(){this.connectionTimer=window.setTimeout(()=>{this.state===0&&(this.logger.error("Connection attempt timed out"),this.ws.close())},this.connectionTimeout)}clearConnectionTimeout(){this.connectionTimer&&window.clearTimeout(this.connectionTimer)}parseMessage(e){try{return JSON.parse(e)}catch{return e}}send(e){if(this.state===1){let r=typeof e=="string"?e:JSON.stringify(e);this.ws.send(r)}else{let r=new Error("WebSocket is not open");this.emit("error",r)}}close(){this.state=2,this.ws.close()}reconnect(){this.logger.debug("Manual reconnection initiated."),this.reconnectAttempts=0,this.close(),this.connect()}getState(){return this.state}getReadyState(){return this.ws.readyState}};var k=class extends m{constructor(e){super();this.pendingRequests=new Map;this.logger=new h,this.requestTimeout=e.requestTimeout||3e4,this.webSocketManager=e.webSocketManager,this.webSocketManager.on("message",this.handleMessage.bind(this))}async request(e,r,s){return new Promise((i,a)=>{let u=this.createRequest(e,r,s),o=setTimeout(()=>{this.pendingRequests.delete(u.header.requestId),a(new Error("Request timeout"))},this.requestTimeout),f=d=>{clearTimeout(o),this.pendingRequests.delete(u.header.requestId),d.body.success?i(d.body):a(d.body.error||d.body.data)};this.pendingRequests.set(u.header.requestId,f),this.webSocketManager.send(JSON.stringify(u))})}createRequest(e,r,s){return{header:{timestamp:Date.now(),requestId:`RM-${b()}`,requesterAddress:"RequestManager",recipientAddress:s,requestType:e,authToken:this.authToken},body:r}}handleMessage(e){try{e.header&&e.header.requestType?this.handleIncomingRequest(e):e.requestHeader?this.handleResponse(e):this.logger.warn("Received message with unknown structure:",e)}catch(r){this.logger.error("Error parsing message:",r)}}handleIncomingRequest(e){let{requestType:r}=e.header;r&&this.listenerCount(r)>0?this.emit(r,e.body,s=>{let i={requestHeader:e.header,responseHeader:{responderAddress:"RequestManager",timestamp:Date.now()},body:{data:s,success:!0,error:null}};this.webSocketManager.send(JSON.stringify(i))}):this.logger.warn(`No handlers registered for requestType: ${r}`)}handleResponse(e){let r=this.pendingRequests.get(e.requestHeader.requestId);r&&(r(e),this.pendingRequests.delete(e.requestHeader.requestId))}setAuthToken(e){this.authToken=e}clearAuthToken(){this.authToken=void 0}};var O=class extends m{constructor(e){super();this.logger=new h;this.validateConfig(e);try{this.webSocketManager=new w(e.url,e.secure,e.maxReconnectAttempts,e.reconnectInterval),this.requestManager=new k({webSocketManager:this.webSocketManager,requestTimeout:e.requestTimeout}),this.setupWebSocketHooks()}catch(r){throw this.logger.error("Error initializing CommunicationsManager",{error:r}),new Error("Failed to initialize CommunicationsManager")}}setupWebSocketHooks(){this.webSocketManager.on("maxReconnectAttemptsReached",this.handleMaxReconnectAttemptsReached.bind(this))}onOpen(e){this.logger.info("onOpen callback registered"),this.webSocketManager.on("open",e)}onClose(e){this.logger.info("onClose callback registered"),this.webSocketManager.on("close",e)}onError(e){this.logger.info("onError callback registered"),this.webSocketManager.on("error",e)}onMessage(e){this.logger.info("onMessage callback registered"),this.webSocketManager.on("message",e)}handleMaxReconnectAttemptsReached(){this.logger.error("Maximum reconnection attempts reached. To try again, please refresh the page.")}validateConfig(e){if(!e.url)throw new Error("URL is required in the configuration")}async request(e,r,s){try{return this.requestManager.request(e,r,s)}catch(i){throw this.logger.error("Error making request",{requestType:e,error:i}),i}}registerMessageHandler(e,r){this.requestManager.on(e,r)}};return J(te);})();
//# sourceMappingURL=bundle.js.map
