import { z } from "zod";
import * as dotenv from "dotenv";

dotenv.config();

const ApiConfigSchema = z.object({
  databaseUrl: z.string().min(1),
  cloudTasksProject: z.string().min(1),
  cloudTasksLocation: z.string().min(1),
  cloudTasksQueue: z.string().min(1),
  workerBaseUrl: z.string().url(),
  serviceAccountEmail: z.string().email(),
  port: z.coerce.number().default(3000),
});

const WorkerConfigSchema = z
  .object({
    databaseUrl: z.string().min(1),
    deepgramApiKey: z.string().min(1),
    deepgramModel: z.string().min(1).default("nova-3"),
    deepgramLanguage: z.string().min(1).default("multi"),
    googleAuthState: z.string().min(1).optional(),
    transcriptEmailTo: z.string().email().default("arjhnpr@gmail.com"),
    gmailClientId: z.string().min(1).optional(),
    gmailClientSecret: z.string().min(1).optional(),
    gmailRefreshToken: z.string().min(1).optional(),
    gmailSenderEmail: z.string().email().optional(),
    chromeUserDataDir: z.string().min(1).optional(),
    pulseSinkName: z.string().default("virtual_sink"),
    port: z.coerce.number().default(3001),
    workerId: z.string().default(() => `worker-${Date.now()}`),
  })
  .superRefine((value, ctx) => {
    if (!value.googleAuthState && !value.chromeUserDataDir) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["googleAuthState"],
        message: "GOOGLE_AUTH_STATE is required when CHROME_USER_DATA_DIR is not set",
      });
    }
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
    deepgramModel: process.env["DEEPGRAM_MODEL"],
    deepgramLanguage: process.env["DEEPGRAM_LANGUAGE"],
    googleAuthState: process.env["GOOGLE_AUTH_STATE"],
    transcriptEmailTo: process.env["TRANSCRIPT_EMAIL_TO"],
    gmailClientId: process.env["GMAIL_CLIENT_ID"],
    gmailClientSecret: process.env["GMAIL_CLIENT_SECRET"],
    gmailRefreshToken: process.env["GMAIL_REFRESH_TOKEN"],
    gmailSenderEmail: process.env["GMAIL_SENDER_EMAIL"],
    chromeUserDataDir: process.env["CHROME_USER_DATA_DIR"],
    pulseSinkName: process.env["PULSE_SINK_NAME"],
    port: process.env["PORT"],
    workerId: process.env["WORKER_ID"],
  });
}
