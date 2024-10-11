"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __reExport = (target, mod, secondTarget) => (__copyProps(target, mod, "default"), secondTarget && __copyProps(secondTarget, mod, "default"));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var src_exports = {};
module.exports = __toCommonJS(src_exports);
__reExport(src_exports, require("./MicroserviceFramework"), module.exports);
__reExport(src_exports, require("./ServerRunner"), module.exports);
__reExport(src_exports, require("./browser"), module.exports);
__reExport(src_exports, require("./core"), module.exports);
__reExport(src_exports, require("./interfaces"), module.exports);
__reExport(src_exports, require("./logging"), module.exports);
__reExport(src_exports, require("./services"), module.exports);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ...require("./MicroserviceFramework"),
  ...require("./ServerRunner"),
  ...require("./browser"),
  ...require("./core"),
  ...require("./interfaces"),
  ...require("./logging"),
  ...require("./services")
});
//# sourceMappingURL=index.js.map
