import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const ApiConfigSchema = z.object({
  databaseUrl: z.string().url(),
  cloudTasksProject: z.string().min(1),
  cloudTasksLocation: z.string().min(1),
  cloudTasksQueue: z.string().min(1),
  workerBaseUrl: z.string().url(),
  serviceAccountEmail: z.string().email(),
  port: z.coerce.number().default(3000),
});

const WorkerConfigSchema = z.object({
  databaseUrl: z.string().url(),
  deepgramApiKey: z.string().min(1),
  googleAuthState: z.string().min(1),
  pulseSinkName: z.string().default("virtual_sink"),
  port: z.coerce.number().default(3001),
  workerId: z.string().default(() => `worker-${Date.now()}`),
});

export type ApiConfig = z.infer<typeof ApiConfigSchema>;
export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function parseApiConfig(): ApiConfig {
  return ApiConfigSchema.parse({
    databaseUrl: process.env["DATABASE_URL"],
    cloudTasksProject: process.env["CLOUD_TASKS_PROJECT"],
    cloudTasksLocation: process.env["CLOUD_TASKS_LOCATION"],
    cloudTasksQueue: process.env["CLOUD_TASKS_QUEUE"],
    workerBaseUrl: process.env["WORKER_BASE_URL"],
    serviceAccountEmail: process.env["SERVICE_ACCOUNT_EMAIL"],
    port: process.env["PORT"],
  });
}

export function parseWorkerConfig(): WorkerConfig {
  return WorkerConfigSchema.parse({
    databaseUrl: process.env["DATABASE_URL"],
    deepgramApiKey: process.env["DEEPGRAM_API_KEY"],
    googleAuthState: process.env["GOOGLE_AUTH_STATE"],
    pulseSinkName: process.env["PULSE_SINK_NAME"],
    port: process.env["PORT"],
    workerId: process.env["WORKER_ID"],
  });
}
