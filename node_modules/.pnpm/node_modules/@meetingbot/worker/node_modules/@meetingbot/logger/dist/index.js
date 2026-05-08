"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLogger = createLogger;
const pino_1 = __importDefault(require("pino"));
const base = (0, pino_1.default)({
    level: process.env["LOG_LEVEL"] ?? "info",
    timestamp: pino_1.default.stdTimeFunctions.isoTime,
    formatters: {
        level(label) {
            return { level: label };
        },
    },
});
function createLogger(context) {
    const bindings = {};
    for (const [key, value] of Object.entries(context)) {
        if (value !== undefined)
            bindings[key] = value;
    }
    return Object.keys(bindings).length > 0 ? base.child(bindings) : base;
}
//# sourceMappingURL=index.js.map