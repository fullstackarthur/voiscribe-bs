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
    expect(config.deepgramModel).toBe("nova-3");
    expect(config.deepgramLanguage).toBe("multi");
    expect(config.transcriptEmailTo).toBe("arjhnpr@gmail.com");
    expect(config.pulseSinkName).toBe("virtual_sink");
  });

  it("parses transcript email settings", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
    process.env["GOOGLE_AUTH_STATE"] = JSON.stringify({ cookies: [] });
    process.env["TRANSCRIPT_EMAIL_TO"] = "recipient@example.com";
    process.env["GMAIL_CLIENT_ID"] = "client-id";
    process.env["GMAIL_CLIENT_SECRET"] = "client-secret";
    process.env["GMAIL_REFRESH_TOKEN"] = "refresh-token";
    process.env["GMAIL_SENDER_EMAIL"] = "bot@example.com";
    process.env["CHROME_USER_DATA_DIR"] = "/data/chrome-profile";

    const { parseWorkerConfig } = await import("./index");
    const config = parseWorkerConfig();

    expect(config.transcriptEmailTo).toBe("recipient@example.com");
    expect(config.gmailClientId).toBe("client-id");
    expect(config.gmailClientSecret).toBe("client-secret");
    expect(config.gmailRefreshToken).toBe("refresh-token");
    expect(config.gmailSenderEmail).toBe("bot@example.com");
    expect(config.chromeUserDataDir).toBe("/data/chrome-profile");
  });

  it("allows Deepgram model and language overrides", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
    process.env["DEEPGRAM_MODEL"] = "nova-2";
    process.env["DEEPGRAM_LANGUAGE"] = "hi";
    process.env["GOOGLE_AUTH_STATE"] = JSON.stringify({ cookies: [] });

    const { parseWorkerConfig } = await import("./index");
    const config = parseWorkerConfig();

    expect(config.deepgramModel).toBe("nova-2");
    expect(config.deepgramLanguage).toBe("hi");
  });

  it("allows a Chrome profile instead of GOOGLE_AUTH_STATE", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
    process.env["CHROME_USER_DATA_DIR"] = "/data/chrome-profile";
    delete process.env["GOOGLE_AUTH_STATE"];

    const { parseWorkerConfig } = await import("./index");
    const config = parseWorkerConfig();

    expect(config.googleAuthState).toBeUndefined();
    expect(config.chromeUserDataDir).toBe("/data/chrome-profile");
  });

  it("throws when both GOOGLE_AUTH_STATE and CHROME_USER_DATA_DIR are missing", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
    delete process.env["GOOGLE_AUTH_STATE"];
    delete process.env["CHROME_USER_DATA_DIR"];

    const { parseWorkerConfig } = await import("./index");
    expect(() => parseWorkerConfig()).toThrow();
  });

  it("throws when DEEPGRAM_API_KEY is missing", async () => {
    process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
    process.env["GOOGLE_AUTH_STATE"] = "{}";
    delete process.env["DEEPGRAM_API_KEY"];

    const { parseWorkerConfig } = await import("./index");
    expect(() => parseWorkerConfig()).toThrow();
  });
});
