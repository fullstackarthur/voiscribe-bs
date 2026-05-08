"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.meetingsPlugin = void 0;
const meeting_1 = require("../schemas/meeting");
const scheduler_1 = require("../services/scheduler");
const meetingsPlugin = async (fastify) => {
    fastify.post("/meetings/schedule", async (request, reply) => {
        const parseResult = meeting_1.ScheduleMeetingSchema.safeParse(request.body);
        if (!parseResult.success) {
            return reply.status(400).send({
                error: "Validation failed",
                details: parseResult.error.flatten().fieldErrors,
            });
        }
        const meeting = await (0, scheduler_1.scheduleMeeting)(parseResult.data);
        return reply.status(201).send({ meetingId: meeting.id });
    });
};
exports.meetingsPlugin = meetingsPlugin;
//# sourceMappingURL=meetings.js.map