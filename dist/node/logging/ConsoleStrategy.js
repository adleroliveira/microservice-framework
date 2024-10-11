"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConsoleStrategy = void 0;
const LogStrategy_1 = require("./LogStrategy");
const chalk_1 = __importDefault(require("chalk"));
var LogLevel;
(function (LogLevel) {
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
    LogLevel["DEBUG"] = "DEBUG";
})(LogLevel || (LogLevel = {}));
class ConsoleStrategy extends LogStrategy_1.LogStrategy {
    constructor(maxStringLength = 5000, maxDepth = 10) {
        super();
        this.MAX_STRING_LENGTH = maxStringLength;
        this.MAX_DEPTH = maxDepth;
    }
    isLogMessage(body) {
        return (typeof body === "object" &&
            body !== null &&
            "timestamp" in body &&
            "level" in body &&
            "message" in body);
    }
    async sendPackaged(packagedMessage, options) {
        const { header, body } = packagedMessage;
        const logLevel = options?.logLevel || LogLevel.INFO;
        const formattedMessage = this.isLogMessage(body)
            ? this.formatLogMessage(body, header.requestId)
            : this.formatGenericMessage(body, logLevel, header.timestamp, header.requestId);
        console.log(formattedMessage);
    }
    formatLogMessage(logMessage, requestId) {
        const { sender, timestamp, level, message, payload } = logMessage;
        const logLevel = level.toUpperCase();
        const color = ConsoleStrategy.LOG_COLORS[logLevel] || chalk_1.default.white;
        let formattedMessage = color(`[${logLevel}] ${new Date(timestamp).toISOString()}` // - RequestID: ${requestId}`
        );
        if (sender) {
            formattedMessage += color(` [${sender}]`);
        }
        formattedMessage += color(` - ${message}`);
        if (payload) {
            formattedMessage += "\n" + this.formatPayload(payload, "  ");
        }
        return formattedMessage;
    }
    formatGenericMessage(message, logLevel, timestamp, requestId) {
        const color = ConsoleStrategy.LOG_COLORS[logLevel];
        let formattedMessage = color(`[${logLevel}] ${new Date(timestamp).toISOString()} - RequestID: ${requestId} - `);
        if (typeof message === "object" && message !== null) {
            formattedMessage += "\n" + this.formatPayload(message, "  ");
        }
        else {
            formattedMessage += message;
        }
        return formattedMessage;
    }
    formatPayload(payload, indent = "") {
        if (typeof payload !== "object" || payload === null) {
            return `${indent}${payload}`;
        }
        return Object.entries(payload)
            .map(([key, value]) => {
            if (typeof value === "object" && value !== null) {
                return `${indent}${key}:\n${this.formatPayload(value, indent + "  ")}`;
            }
            return `${indent}${key}: ${value}`;
        })
            .join("\n");
    }
    async log(message, logLevel = LogLevel.INFO) {
        await this.send(message, { logLevel });
    }
    async info(message) {
        await this.log(message, LogLevel.INFO);
    }
    async warn(message) {
        await this.log(message, LogLevel.WARN);
    }
    async error(message) {
        await this.log(message, LogLevel.ERROR);
    }
    async debug(message) {
        await this.log(message, LogLevel.DEBUG);
    }
}
exports.ConsoleStrategy = ConsoleStrategy;
ConsoleStrategy.LOG_COLORS = {
    [LogLevel.INFO]: chalk_1.default.blue,
    [LogLevel.WARN]: chalk_1.default.yellow,
    [LogLevel.ERROR]: chalk_1.default.red,
    [LogLevel.DEBUG]: chalk_1.default.green,
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiQ29uc29sZVN0cmF0ZWd5LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2xvZ2dpbmcvQ29uc29sZVN0cmF0ZWd5LnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7OztBQUFBLCtDQUE0QztBQUU1QyxrREFBMEI7QUFFMUIsSUFBSyxRQUtKO0FBTEQsV0FBSyxRQUFRO0lBQ1gseUJBQWEsQ0FBQTtJQUNiLHlCQUFhLENBQUE7SUFDYiwyQkFBZSxDQUFBO0lBQ2YsMkJBQWUsQ0FBQTtBQUNqQixDQUFDLEVBTEksUUFBUSxLQUFSLFFBQVEsUUFLWjtBQWNELE1BQWEsZUFBZ0IsU0FBUSx5QkFBVztJQVE5QyxZQUFZLGVBQWUsR0FBRyxJQUFJLEVBQUUsUUFBUSxHQUFHLEVBQUU7UUFDL0MsS0FBSyxFQUFFLENBQUM7UUFDUixJQUFJLENBQUMsaUJBQWlCLEdBQUcsZUFBZSxDQUFDO1FBQ3pDLElBQUksQ0FBQyxTQUFTLEdBQUcsUUFBUSxDQUFDO0lBQzVCLENBQUM7SUFFTyxZQUFZLENBQUMsSUFBUztRQUM1QixPQUFPLENBQ0wsT0FBTyxJQUFJLEtBQUssUUFBUTtZQUN4QixJQUFJLEtBQUssSUFBSTtZQUNiLFdBQVcsSUFBSSxJQUFJO1lBQ25CLE9BQU8sSUFBSSxJQUFJO1lBQ2YsU0FBUyxJQUFJLElBQUksQ0FDbEIsQ0FBQztJQUNKLENBQUM7SUFFUyxLQUFLLENBQUMsWUFBWSxDQUMxQixlQUE4QixFQUM5QixPQUE2QjtRQUU3QixNQUFNLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxHQUFHLGVBQWUsQ0FBQztRQUN6QyxNQUFNLFFBQVEsR0FBSSxPQUFPLEVBQUUsUUFBcUIsSUFBSSxRQUFRLENBQUMsSUFBSSxDQUFDO1FBRWxFLE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUM7WUFDOUMsQ0FBQyxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFD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QUFHLENBQUMsT0FBWSxFQUFFLFdBQXFCLFFBQVEsQ0FBQyxJQUFJO1FBQ3hELE1BQU0sSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLEVBQUUsRUFBRSxRQUFRLEVBQUUsQ0FBQyxDQUFDO0lBQ3pDLENBQUM7SUFFRCxLQUFLLENBQUMsSUFBSSxDQUFDLE9BQVk7UUFDckIsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDekMsQ0FBQztJQUVELEtBQUssQ0FBQyxJQUFJLENBQUMsT0FBWTtRQUNyQixNQUFNLElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN6QyxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQUssQ0FBQyxPQUFZO1FBQ3RCLE1BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDO0lBQzFDLENBQUM7SUFFRCxLQUFLLENBQUMsS0FBSyxDQUFDLE9BQVk7UUFDdEIsTUFBTSxJQUFJLENBQUMsR0FBRyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUM7SUFDMUMsQ0FBQzs7QUEzSEgsMENBNEhDO0FBM0h5QiwwQkFBVSxHQUFHO0lBQ25DLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLGVBQUssQ0FBQyxJQUFJO0lBQzNCLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLGVBQUssQ0FBQyxNQUFNO0lBQzdCLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLGVBQUssQ0FBQyxHQUFHO0lBQzNCLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxFQUFFLGVBQUssQ0FBQyxLQUFLO0NBQzlCLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBMb2dTdHJhdGVneSB9IGZyb20gXCIuL0xvZ1N0cmF0ZWd5XCI7XG5pbXBvcnQgeyBJUmVxdWVzdCB9IGZyb20gXCIuLi9pbnRlcmZhY2VzXCI7XG5pbXBvcnQgY2hhbGsgZnJvbSBcImNoYWxrXCI7XG5cbmVudW0gTG9nTGV2ZWwge1xuICBJTkZPID0gXCJJTkZPXCIsXG4gIFdBUk4gPSBcIldBUk5cIixcbiAgRVJST1IgPSBcIkVSUk9SXCIsXG4gIERFQlVHID0gXCJERUJVR1wiLFxufVxuXG5pbnRlcmZhY2UgTG9nTWVzc2FnZSB7XG4gIHNlbmRlcj86IHN0cmluZztcbiAgdGltZXN0YW1wOiBzdHJpbmc7XG4gIGxldmVsOiBzdHJpbmc7XG4gIG1lc3NhZ2U6IHN0cmluZztcbiAgcGF5bG9hZD86IGFueTtcbn1cblxuaW50ZXJmYWNlIExvZ1BheWxvYWQge1xuICBba2V5OiBzdHJpbmddOiBhbnk7XG59XG5cbmV4cG9ydCBjbGFzcyBDb25zb2xlU3RyYXRlZ3kgZXh0ZW5kcyBMb2dTdHJhdGVneSB7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IExPR19DT0xPUlMgPSB7XG4gICAgW0xvZ0xldmVsLklORk9dOiBjaGFsay5ibHVlLFxuICAgIFtMb2dMZXZlbC5XQVJOXTogY2hhbGsueWVsbG93LFxuICAgIFtMb2dMZXZlbC5FUlJPUl06IGNoYWxrLnJlZCxcbiAgICBbTG9nTGV2ZWwuREVCVUddOiBjaGFsay5ncmVlbixcbiAgfTtcblxuICBjb25zdHJ1Y3RvcihtYXhTdHJpbmdMZW5ndGggPSA1MDAwLCBtYXhEZXB0aCA9IDEwKSB7XG4gICAgc3VwZXIoKTtcbiAgICB0aGlzLk1BWF9TVFJJTkdfTEVOR1RIID0gbWF4U3RyaW5nTGVuZ3RoO1xuICAgIHRoaXMuTUFYX0RFUFRIID0gbWF4RGVwdGg7XG4gIH1cblxuICBwcml2YXRlIGlzTG9nTWVzc2FnZShib2R5OiBhbnkpOiBib2R5IGlzIExvZ01lc3NhZ2Uge1xuICAgIHJldHVybiAoXG4gICAgICB0eXBlb2YgYm9keSA9PT0gXCJvYmplY3RcIiAmJlxuICAgICAgYm9keSAhPT0gbnVsbCAmJlxuICAgICAgXCJ0aW1lc3RhbXBcIiBpbiBib2R5ICYmXG4gICAgICBcImxldmVsXCIgaW4gYm9keSAmJlxuICAgICAgXCJtZXNzYWdlXCIgaW4gYm9keVxuICAgICk7XG4gIH1cblxuICBwcm90ZWN0ZWQgYXN5bmMgc2VuZFBhY2thZ2VkKFxuICAgIHBhY2thZ2VkTWVzc2FnZTogSVJlcXVlc3Q8YW55PixcbiAgICBvcHRpb25zPzogUmVjb3JkPHN0cmluZywgYW55PlxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IGhlYWRlciwgYm9keSB9ID0gcGFja2FnZWRNZXNzYWdlO1xuICAgIGNvbnN0IGxvZ0xldmVsID0gKG9wdGlvbnM/LmxvZ0xldmVsIGFzIExvZ0xldmVsKSB8fCBMb2dMZXZlbC5JTkZPO1xuXG4gICAgY29uc3QgZm9ybWF0dGVkTWVzc2FnZSA9IHRoaXMuaXNMb2dNZXNzYWdlKGJvZHkpXG4gICAgICA/IHRoaXMuZm9ybWF0TG9nTWVzc2FnZShib2R5LCBoZWFkZXIucmVxdWVzdElkKVxuICAgICAgOiB0aGlzLmZvcm1hdEdlbmVyaWNNZXNzYWdlKFxuICAgICAgICAgIGJvZHksXG4gICAgICAgICAgbG9nTGV2ZWwsXG4gICAgICAgICAgaGVhZGVyLnRpbWVzdGFtcCxcbiAgICAgICAgICBoZWFkZXIucmVxdWVzdElkXG4gICAgICAgICk7XG5cbiAgICBjb25zb2xlLmxvZyhmb3JtYXR0ZWRNZXNzYWdlKTtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0TG9nTWVzc2FnZShsb2dNZXNzYWdlOiBMb2dNZXNzYWdlLCByZXF1ZXN0SWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3QgeyBzZW5kZXIsIHRpbWVzdGFtcCwgbGV2ZWwsIG1lc3NhZ2UsIHBheWxvYWQgfSA9IGxvZ01lc3NhZ2U7XG4gICAgY29uc3QgbG9nTGV2ZWwgPSBsZXZlbC50b1VwcGVyQ2FzZSgpIGFzIExvZ0xldmVsO1xuICAgIGNvbnN0IGNvbG9yID0gQ29uc29sZVN0cmF0ZWd5LkxPR19DT0xPUlNbbG9nTGV2ZWxdIHx8IGNoYWxrLndoaXRlO1xuXG4gICAgbGV0IGZvcm1hdHRlZE1lc3NhZ2UgPSBjb2xvcihcbiAgICAgIGBbJHtsb2dMZXZlbH1dICR7bmV3IERhdGUodGltZXN0YW1wKS50b0lTT1N0cmluZygpfWAgLy8gLSBSZXF1ZXN0SUQ6ICR7cmVxdWVzdElkfWBcbiAgICApO1xuXG4gICAgaWYgKHNlbmRlcikge1xuICAgICAgZm9ybWF0dGVkTWVzc2FnZSArPSBjb2xvcihgIFske3NlbmRlcn1dYCk7XG4gICAgfVxuXG4gICAgZm9ybWF0dGVkTWVzc2FnZSArPSBjb2xvcihgIC0gJHttZXNzYWdlfWApO1xuXG4gICAgaWYgKHBheWxvYWQpIHtcbiAgICAgIGZvcm1hdHRlZE1lc3NhZ2UgKz0gXCJcXG5cIiArIHRoaXMuZm9ybWF0UGF5bG9hZChwYXlsb2FkLCBcIiAgXCIpO1xuICAgIH1cblxuICAgIHJldHVybiBmb3JtYXR0ZWRNZXNzYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBmb3JtYXRHZW5lcmljTWVzc2FnZShcbiAgICBtZXNzYWdlOiBhbnksXG4gICAgbG9nTGV2ZWw6IExvZ0xldmVsLFxuICAgIHRpbWVzdGFtcDogbnVtYmVyLFxuICAgIHJlcXVlc3RJZDogc3RyaW5nXG4gICk6IHN0cmluZyB7XG4gICAgY29uc3QgY29sb3IgPSBDb25zb2xlU3RyYXRlZ3kuTE9HX0NPTE9SU1tsb2dMZXZlbF07XG4gICAgbGV0IGZvcm1hdHRlZE1lc3NhZ2UgPSBjb2xvcihcbiAgICAgIGBbJHtsb2dMZXZlbH1dICR7bmV3IERhdGUoXG4gICAgICAgIHRpbWVzdGFtcFxuICAgICAgKS50b0lTT1N0cmluZygpfSAtIFJlcXVlc3RJRDogJHtyZXF1ZXN0SWR9IC0gYFxuICAgICk7XG5cbiAgICBpZiAodHlwZW9mIG1lc3NhZ2UgPT09IFwib2JqZWN0XCIgJiYgbWVzc2FnZSAhPT0gbnVsbCkge1xuICAgICAgZm9ybWF0dGVkTWVzc2FnZSArPSBcIlxcblwiICsgdGhpcy5mb3JtYXRQYXlsb2FkKG1lc3NhZ2UsIFwiICBcIik7XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvcm1hdHRlZE1lc3NhZ2UgKz0gbWVzc2FnZTtcbiAgICB9XG5cbiAgICByZXR1cm4gZm9ybWF0dGVkTWVzc2FnZTtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0UGF5bG9hZChwYXlsb2FkOiBhbnksIGluZGVudDogc3RyaW5nID0gXCJcIik6IHN0cmluZyB7XG4gICAgaWYgKHR5cGVvZiBwYXlsb2FkICE9PSBcIm9iamVjdFwiIHx8IHBheWxvYWQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBgJHtpbmRlbnR9JHtwYXlsb2FkfWA7XG4gICAgfVxuXG4gICAgcmV0dXJuIE9iamVjdC5lbnRyaWVzKHBheWxvYWQpXG4gICAgICAubWFwKChba2V5LCB2YWx1ZV0pID0+IHtcbiAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gXCJvYmplY3RcIiAmJiB2YWx1ZSAhPT0gbnVsbCkge1xuICAgICAgICAgIHJldHVybiBgJHtpbmRlbnR9JHtrZXl9OlxcbiR7dGhpcy5mb3JtYXRQYXlsb2FkKFxuICAgICAgICAgICAgdmFsdWUsXG4gICAgICAgICAgICBpbmRlbnQgKyBcIiAgXCJcbiAgICAgICAgICApfWA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGAke2luZGVudH0ke2tleX06ICR7dmFsdWV9YDtcbiAgICAgIH0pXG4gICAgICAuam9pbihcIlxcblwiKTtcbiAgfVxuXG4gIGFzeW5jIGxvZyhtZXNzYWdlOiBhbnksIGxvZ0xldmVsOiBMb2dMZXZlbCA9IExvZ0xldmVsLklORk8pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNlbmQobWVzc2FnZSwgeyBsb2dMZXZlbCB9KTtcbiAgfVxuXG4gIGFzeW5jIGluZm8obWVzc2FnZTogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2cobWVzc2FnZSwgTG9nTGV2ZWwuSU5GTyk7XG4gIH1cblxuICBhc3luYyB3YXJuKG1lc3NhZ2U6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMubG9nKG1lc3NhZ2UsIExvZ0xldmVsLldBUk4pO1xuICB9XG5cbiAgYXN5bmMgZXJyb3IobWVzc2FnZTogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2cobWVzc2FnZSwgTG9nTGV2ZWwuRVJST1IpO1xuICB9XG5cbiAgYXN5bmMgZGVidWcobWVzc2FnZTogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5sb2cobWVzc2FnZSwgTG9nTGV2ZWwuREVCVUcpO1xuICB9XG59XG4iXX0=