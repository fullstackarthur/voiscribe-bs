import { FastifyPluginAsync } from "fastify";
import { ScheduleMeetingSchema } from "../schemas/meeting";
import { scheduleMeeting } from "../services/scheduler";

export const meetingsPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/meetings/schedule", async (request, reply) => {
    const parseResult = ScheduleMeetingSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const meeting = await scheduleMeeting(parseResult.data);
    return reply.status(201).send({ meetingId: meeting.id });
  });
};
