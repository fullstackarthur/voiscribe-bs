import Fastify from "fastify";
import sensible from "@fastify/sensible";
import { parseApiConfig } from "@meetingbot/config";
import { createLogger } from "@meetingbot/logger";
import { meetingsPlugin } from "./routes/meetings";

const logger = createLogger({});

async function buildServer() {
  const app = Fastify({
    logger: { level: process.env["LOG_LEVEL"] ?? "info" },
  });

  await app.register(sensible);
  await app.register(meetingsPlugin);

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}

async function main() {
  const config = parseApiConfig();
  const app = await buildServer();

  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    logger.info(
      { event: "API_SERVER_STARTED", port: config.port },
      "API server started"
    );
  } catch (err) {
    logger.error({ event: "API_SERVER_FAILED", err }, "Failed to start API server");
    process.exit(1);
  }
}

main();
