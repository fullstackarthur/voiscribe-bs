import Fastify, { FastifyPluginAsync } from "fastify";
import sensible from "@fastify/sensible";
import { getDb } from "@meetingbot/db";
import { createLogger } from "@meetingbot/logger";
import { parseWorkerConfig } from "@meetingbot/config";
import { WorkerTriggerSchema } from "./schemas/worker";
import { runMeetingSession } from "./services/meetingSession";

const logger = createLogger({});

export const workerPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.post("/run", async (request, reply) => {
    const parseResult = WorkerTriggerSchema.safeParse(request.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        error: "Validation failed",
        details: parseResult.error.flatten().fieldErrors,
      });
    }

    const { meetingId } = parseResult.data;
    const db = getDb();
    const meeting = await db.meeting.findUnique({ where: { id: meetingId } });

    if (!meeting) {
      return reply.status(404).send({ error: "Meeting not found" });
    }

    const log = logger.child({ meetingId });
    log.info({ event: "WORKER_TRIGGERED" }, "Worker triggered for meeting");

    // Respond immediately so Cloud Tasks doesn't retry on timeout.
    // Session runs in background until meeting ends.
    setImmediate(() => {
      runMeetingSession(meeting).catch((err) => {
        log.error({ event: "SESSION_FAILED", err }, "Meeting session failed");
      });
    });

    return reply.status(200).send({ status: "started", meetingId });
  });

  fastify.get("/health", async () => ({ status: "ok" }));
};

async function main() {
  const config = parseWorkerConfig();

  const app = Fastify({
    logger: { level: process.env["LOG_LEVEL"] ?? "info" },
  });

  await app.register(sensible);
  await app.register(workerPlugin);

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info(
      { event: "WORKER_SERVER_STARTED", port: config.port },
      "Worker server started"
    );
  } catch (err) {
    logger.error({ event: "WORKER_SERVER_FAILED", err }, "Failed to start worker server");
    process.exit(1);
  }
}

main();
