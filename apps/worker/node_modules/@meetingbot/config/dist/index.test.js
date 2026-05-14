"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ORIGINAL_ENV = { ...process.env };
(0, vitest_1.beforeEach)(() => {
    process.env = { ...ORIGINAL_ENV };
    vitest_1.vi.resetModules();
});
(0, vitest_1.afterEach)(() => {
    process.env = ORIGINAL_ENV;
});
(0, vitest_1.describe)("parseApiConfig", () => {
    (0, vitest_1.it)("parses valid api env vars", async () => {
        process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
        process.env["CLOUD_TASKS_PROJECT"] = "my-project";
        process.env["CLOUD_TASKS_LOCATION"] = "us-central1";
        process.env["CLOUD_TASKS_QUEUE"] = "meeting-jobs";
        process.env["WORKER_BASE_URL"] = "https://worker.run.app";
        process.env["SERVICE_ACCOUNT_EMAIL"] = "sa@project.iam.gserviceaccount.com";
        const { parseApiConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        const config = parseApiConfig();
        (0, vitest_1.expect)(config.databaseUrl).toBe("postgresql://user:pass@localhost:5432/db");
        (0, vitest_1.expect)(config.cloudTasksProject).toBe("my-project");
        (0, vitest_1.expect)(config.workerBaseUrl).toBe("https://worker.run.app");
        (0, vitest_1.expect)(config.port).toBe(3000);
    });
    (0, vitest_1.it)("throws ZodError when DATABASE_URL is missing", async () => {
        delete process.env["DATABASE_URL"];
        const { parseApiConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        (0, vitest_1.expect)(() => parseApiConfig()).toThrow();
    });
});
(0, vitest_1.describe)("parseWorkerConfig", () => {
    (0, vitest_1.it)("parses valid worker env vars", async () => {
        process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
        process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
        process.env["GOOGLE_AUTH_STATE"] = JSON.stringify({ cookies: [] });
        const { parseWorkerConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        const config = parseWorkerConfig();
        (0, vitest_1.expect)(config.deepgramApiKey).toBe("dg-key-123");
        (0, vitest_1.expect)(config.deepgramModel).toBe("nova-3");
        (0, vitest_1.expect)(config.deepgramLanguage).toBe("multi");
        (0, vitest_1.expect)(config.transcriptEmailTo).toBe("arjhnpr@gmail.com");
        (0, vitest_1.expect)(config.pulseSinkName).toBe("virtual_sink");
    });
    (0, vitest_1.it)("parses transcript email settings", async () => {
        process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
        process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
        process.env["GOOGLE_AUTH_STATE"] = JSON.stringify({ cookies: [] });
        process.env["TRANSCRIPT_EMAIL_TO"] = "recipient@example.com";
        process.env["GMAIL_CLIENT_ID"] = "client-id";
        process.env["GMAIL_CLIENT_SECRET"] = "client-secret";
        process.env["GMAIL_REFRESH_TOKEN"] = "refresh-token";
        process.env["GMAIL_SENDER_EMAIL"] = "bot@example.com";
        process.env["CHROME_USER_DATA_DIR"] = "/data/chrome-profile";
        const { parseWorkerConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        const config = parseWorkerConfig();
        (0, vitest_1.expect)(config.transcriptEmailTo).toBe("recipient@example.com");
        (0, vitest_1.expect)(config.gmailClientId).toBe("client-id");
        (0, vitest_1.expect)(config.gmailClientSecret).toBe("client-secret");
        (0, vitest_1.expect)(config.gmailRefreshToken).toBe("refresh-token");
        (0, vitest_1.expect)(config.gmailSenderEmail).toBe("bot@example.com");
        (0, vitest_1.expect)(config.chromeUserDataDir).toBe("/data/chrome-profile");
    });
    (0, vitest_1.it)("allows Deepgram model and language overrides", async () => {
        process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
        process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
        process.env["DEEPGRAM_MODEL"] = "nova-2";
        process.env["DEEPGRAM_LANGUAGE"] = "hi";
        process.env["GOOGLE_AUTH_STATE"] = JSON.stringify({ cookies: [] });
        const { parseWorkerConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        const config = parseWorkerConfig();
        (0, vitest_1.expect)(config.deepgramModel).toBe("nova-2");
        (0, vitest_1.expect)(config.deepgramLanguage).toBe("hi");
    });
    (0, vitest_1.it)("allows a Chrome profile instead of GOOGLE_AUTH_STATE", async () => {
        process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
        process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
        process.env["CHROME_USER_DATA_DIR"] = "/data/chrome-profile";
        delete process.env["GOOGLE_AUTH_STATE"];
        const { parseWorkerConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        const config = parseWorkerConfig();
        (0, vitest_1.expect)(config.googleAuthState).toBeUndefined();
        (0, vitest_1.expect)(config.chromeUserDataDir).toBe("/data/chrome-profile");
    });
    (0, vitest_1.it)("throws when both GOOGLE_AUTH_STATE and CHROME_USER_DATA_DIR are missing", async () => {
        process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
        process.env["DEEPGRAM_API_KEY"] = "dg-key-123";
        delete process.env["GOOGLE_AUTH_STATE"];
        delete process.env["CHROME_USER_DATA_DIR"];
        const { parseWorkerConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        (0, vitest_1.expect)(() => parseWorkerConfig()).toThrow();
    });
    (0, vitest_1.it)("throws when DEEPGRAM_API_KEY is missing", async () => {
        process.env["DATABASE_URL"] = "postgresql://user:pass@localhost:5432/db";
        process.env["GOOGLE_AUTH_STATE"] = "{}";
        delete process.env["DEEPGRAM_API_KEY"];
        const { parseWorkerConfig } = await Promise.resolve().then(() => __importStar(require("./index")));
        (0, vitest_1.expect)(() => parseWorkerConfig()).toThrow();
    });
});
//# sourceMappingURL=index.test.js.map