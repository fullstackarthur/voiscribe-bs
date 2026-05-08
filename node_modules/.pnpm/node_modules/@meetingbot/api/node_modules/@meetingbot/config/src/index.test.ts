import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("parseApiConfig", () => {
  it("parses valid api env vars", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["CLOUD_TASKS_PROJECT"] = "my-project";
    process.env["CLOUD_TASKS_LOCATION"] = "us-central1";
    process.env["CLOUD_TASKS_QUEUE"] = "meeting-jobs";
    process.env["WORKER_BASE_URL"] = "https://worker.run.app";
    process.env["SERVICE_ACCOUNT_EMAIL"] = "sa@project.iam.gserviceaccount.com";

    const { parseApiConfig } = await import("./index");
    const config = parseApiConfig();

    expect(config.databaseUrl).toBe("postgresql://user:pass@localhost:5432/db");
    expect(config.cloudTasksProject).toBe("my-project");
    expect(config.workerBaseUrl).toBe("https://worker.run.app");
    expect(config.port).toBe(3000);
  });

  it("throws ZodError when DATABASE_URL is missing", async () => {
    delete process.env["DATABASE_URL"];
    const { parseApiConfig } = await import("./index");
    expect(() => parseApiConfig()).toThrow();
  });
});

describe("parseWorkerConfig", () => {
  it("parses valid worker env vars", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
    process.env["GOOGLE_AUTH_STATE"] = JSON.stringify({ cookies: [] });

    const { parseWorkerConfig } = await import("./index");
    const config = parseWorkerConfig();

    expect(config.deepgramApiKey).toBe("dg-key-123");
    expect(config.pulseSinkName).toBe("virtual_sink");
  });

  it("throws when DEEPGRAM_API_KEY is missing", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["GOOGLE_AUTH_STATE"] = "{}";
    delete process.env["DEEPGRAM_API_KEY"];

    const { parseWorkerConfig } = await import("./index");
    expect(() => parseWorkerConfig()).toThrow();
  });
});
