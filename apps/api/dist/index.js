"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const sensible_1 = __importDefault(require("@fastify/sensible"));
const config_1 = require("@meetingbot/config");
const logger_1 = require("@meetingbot/logger");
const meetings_1 = require("./routes/meetings");
const logger = (0, logger_1.createLogger)({});
async function buildServer() {
    const app = (0, fastify_1.default)({
        logger: { level: process.env["LOG_LEVEL"] ?? "info" },
    });
    await app.register(sensible_1.default);
    await app.register(meetings_1.meetingsPlugin);
    app.get("/health", async () => ({ status: "ok" }));
    return app;
}
async function main() {
    const config = (0, config_1.parseApiConfig)();
    const app = await buildServer();
    try {
        await app.listen({ port: config.port, host: "0.0.0.0" });
        logger.info({ event: "API_SERVER_STARTED", port: config.port }, "API server started");
    }
    catch (err) {
        logger.error({ event: "API_SERVER_FAILED", err }, "Failed to start API server");
        process.exit(1);
    }
}
main();
//# sourceMappingURL=index.js.map