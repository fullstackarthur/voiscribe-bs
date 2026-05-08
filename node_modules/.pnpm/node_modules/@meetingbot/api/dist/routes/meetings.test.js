"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fastify_1 = __importDefault(require("fastify"));
const meetings_1 = require("./meetings");
vitest_1.vi.mock("../services/scheduler", () => ({
    scheduleMeeting: vitest_1.vi.fn().mockResolvedValue({ id: "uuid-123" }),
}));
(0, vitest_1.describe)("POST /meetings/schedule", () => {
    let app;
    (0, vitest_1.beforeEach)(async () => {
        app = (0, fastify_1.default)({ logger: false });
        await app.register(meetings_1.meetingsPlugin);
    });
    (0, vitest_1.it)("returns 201 with meetingId for a valid request", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/meetings/schedule",
            payload: {
                meetingUrl: "https://meet.google.com/abc-defg-hij",
                joinAt: new Date(Date.now() + 60_000).toISOString(),
            },
        });
        (0, vitest_1.expect)(response.statusCode).toBe(201);
        const body = JSON.parse(response.body);
        (0, vitest_1.expect)(body.meetingId).toBe("uuid-123");
    });
    (0, vitest_1.it)("returns 400 for a non-Meet URL", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/meetings/schedule",
            payload: {
                meetingUrl: "https://zoom.us/j/123456789",
                joinAt: new Date(Date.now() + 60_000).toISOString(),
            },
        });
        (0, vitest_1.expect)(response.statusCode).toBe(400);
    });
    (0, vitest_1.it)("returns 400 when joinAt is in the past", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/meetings/schedule",
            payload: {
                meetingUrl: "https://meet.google.com/abc-defg-hij",
                joinAt: new Date(Date.now() - 60_000).toISOString(),
            },
        });
        (0, vitest_1.expect)(response.statusCode).toBe(400);
    });
    (0, vitest_1.it)("returns 400 when body is empty", async () => {
        const response = await app.inject({
            method: "POST",
            url: "/meetings/schedule",
            payload: {},
        });
        (0, vitest_1.expect)(response.statusCode).toBe(400);
    });
});
//# sourceMappingURL=meetings.test.js.map