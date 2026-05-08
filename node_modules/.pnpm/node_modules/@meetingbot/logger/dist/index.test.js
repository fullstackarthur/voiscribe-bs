"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("./index");
(0, vitest_1.describe)("createLogger", () => {
    (0, vitest_1.it)("returns a logger with info/error/warn methods", () => {
        const logger = (0, index_1.createLogger)({ meetingId: "test-123", workerId: "w-1" });
        (0, vitest_1.expect)(typeof logger.info).toBe("function");
        (0, vitest_1.expect)(typeof logger.error).toBe("function");
        (0, vitest_1.expect)(typeof logger.warn).toBe("function");
    });
    (0, vitest_1.it)("accepts empty context without throwing", () => {
        const logger = (0, index_1.createLogger)({});
        (0, vitest_1.expect)(typeof logger.info).toBe("function");
    });
    (0, vitest_1.it)("accepts partial context (meetingId only)", () => {
        const logger = (0, index_1.createLogger)({ meetingId: "meeting-abc" });
        (0, vitest_1.expect)(typeof logger.info).toBe("function");
    });
});
//# sourceMappingURL=index.test.js.map