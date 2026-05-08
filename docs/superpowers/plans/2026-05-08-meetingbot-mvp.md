# MeetingBot-MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend system that autonomously joins Google Meet calls, captures audio via PulseAudio/FFmpeg, streams to Deepgram for live transcription, and persists transcript chunks to PostgreSQL.

**Architecture:** A Fastify scheduler API accepts `POST /meetings/schedule` requests and enqueues delayed Cloud Tasks. Each task triggers a stateless Cloud Run worker (concurrency=1) that launches Chromium via Playwright in a virtual display, routes audio through a PulseAudio null sink into FFmpeg, streams Linear16 PCM to Deepgram's live WebSocket API, and writes chunks to PostgreSQL via Prisma. One container = one meeting.

**Tech Stack:** Node.js 22, TypeScript 5 (strict, CommonJS), pnpm workspaces, Fastify 4, Playwright 1.44, PulseAudio, FFmpeg, @deepgram/sdk 3, @google-cloud/tasks 5, PostgreSQL 15, Prisma 5, Pino 9, Zod 3, Vitest 1, Docker, Google Cloud Run

---

## File Map

| Path | Responsibility |
|------|---------------|
| `pnpm-workspace.yaml` | Declares workspace packages |
| `tsconfig.base.json` | Shared TS settings (strict, CJS, ES2022) |
| `vitest.workspace.ts` | Vitest workspace pointing to all packages |
| `packages/logger/src/index.ts` | Pino factory: `createLogger(context)` returns child-bound logger |
| `packages/config/src/index.ts` | Zod env parsing: `parseApiConfig()` and `parseWorkerConfig()` |
| `packages/db/src/index.ts` | Prisma client singleton `getDb()` |
| `prisma/schema.prisma` | `Meeting` + `TranscriptChunk` models |
| `apps/api/src/schemas/meeting.ts` | Zod: `ScheduleMeetingSchema` with Meet URL + future joinAt validation |
| `apps/api/src/services/scheduler.ts` | `scheduleMeeting()`: DB insert + Cloud Tasks enqueue |
| `apps/api/src/routes/meetings.ts` | Fastify plugin: `POST /meetings/schedule` |
| `apps/api/src/index.ts` | Fastify server build + listen |
| `apps/worker/src/schemas/worker.ts` | Zod: `WorkerTriggerSchema` — meetingId UUID |
| `apps/worker/src/browser/meetJoiner.ts` | Playwright: launch Chromium, authenticate, join Meet, detect end |
| `apps/worker/src/audio/audioPipeline.ts` | Spawn FFmpeg reading PulseAudio monitor → Readable PCM stream |
| `apps/worker/src/transcription/deepgram.ts` | Deepgram live WS: connect, stream chunks, emit transcript events |
| `apps/worker/src/services/meetingSession.ts` | Orchestrates browser + audio + transcription + DB writes for one meeting |
| `apps/worker/src/index.ts` | Fastify plugin + server: `POST /run` handler |
| `apps/worker/start.sh` | Container entrypoint: start Xvfb + PulseAudio null sink, then Node |
| `apps/api/Dockerfile` | Node 22 slim API image |
| `apps/worker/Dockerfile` | Node 22 + Xvfb + PulseAudio + FFmpeg + Chromium worker image |
| `infra/docker/docker-compose.yml` | Local dev: postgres + api + worker |
| `infra/cloudrun/api.yaml` | Cloud Run service spec for API (internal + Secret Manager) |
| `infra/cloudrun/worker.yaml` | Cloud Run service spec for Worker (concurrency=1, 4GB, gen2) |
| `scripts/setup-google-auth.ts` | One-time script: opens browser for manual login, exports auth state JSON |

---

### Task 1: Monorepo Bootstrap

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/worker/package.json`
- Create: `apps/worker/tsconfig.json`
- Create: `packages/logger/package.json`
- Create: `packages/logger/tsconfig.json`
- Create: `packages/config/package.json`
- Create: `packages/config/tsconfig.json`
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "meetingbot-mvp",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "test": "vitest run --workspace vitest.workspace.ts",
    "test:watch": "vitest --workspace vitest.workspace.ts",
    "db:generate": "prisma generate --schema=prisma/schema.prisma",
    "db:migrate": "prisma migrate deploy --schema=prisma/schema.prisma",
    "db:migrate:dev": "prisma migrate dev --schema=prisma/schema.prisma"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "@vitest/coverage-v8": "^1.6.0",
    "prisma": "^5.14.0",
    "@types/node": "^22.0.0",
    "ts-node": "^10.9.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Create `vitest.workspace.ts`**

```typescript
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/*/vitest.config.ts",
  "apps/*/vitest.config.ts",
]);
```

- [ ] **Step 5: Create `packages/logger/package.json`**

```json
{
  "name": "@meetingbot/logger",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "pino": "^9.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 6: Create `packages/logger/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 7: Create `packages/config/package.json`**

```json
{
  "name": "@meetingbot/config",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "zod": "^3.23.0",
    "dotenv": "^16.4.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 8: Create `packages/config/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 9: Create `packages/db/package.json`**

```json
{
  "name": "@meetingbot/db",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "@prisma/client": "^5.14.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 10: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 11: Create `apps/api/package.json`**

```json
{
  "name": "@meetingbot/api",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@meetingbot/config": "workspace:*",
    "@meetingbot/db": "workspace:*",
    "@meetingbot/logger": "workspace:*",
    "fastify": "^4.28.0",
    "@fastify/sensible": "^5.6.0",
    "@google-cloud/tasks": "^5.2.0",
    "zod": "^3.23.0",
    "pino": "^9.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 12: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 13: Create `apps/worker/package.json`**

```json
{
  "name": "@meetingbot/worker",
  "version": "0.1.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "ts-node src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@meetingbot/config": "workspace:*",
    "@meetingbot/db": "workspace:*",
    "@meetingbot/logger": "workspace:*",
    "fastify": "^4.28.0",
    "@fastify/sensible": "^5.6.0",
    "@deepgram/sdk": "^3.3.0",
    "playwright": "^1.44.0",
    "zod": "^3.23.0",
    "pino": "^9.2.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.4.0",
    "ts-node": "^10.9.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 14: Create `apps/worker/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 15: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum MeetingStatus {
  SCHEDULED
  JOINING
  ACTIVE
  ENDED
  FAILED
}

model Meeting {
  id         String          @id @default(uuid())
  meetingUrl String
  status     MeetingStatus   @default(SCHEDULED)
  joinAt     DateTime
  startedAt  DateTime?
  endedAt    DateTime?
  createdAt  DateTime        @default(now())
  chunks     TranscriptChunk[]

  @@map("meetings")
}

model TranscriptChunk {
  id          String   @id @default(uuid())
  meetingId   String
  text        String
  speaker     String   @default("unknown")
  timestampMs Int
  isFinal     Boolean
  createdAt   DateTime @default(now())
  meeting     Meeting  @relation(fields: [meetingId], references: [id])

  @@index([meetingId])
  @@map("transcript_chunks")
}
```

- [ ] **Step 16: Install dependencies and generate Prisma client**

```bash
pnpm install
pnpm db:generate
```

Expected: All packages installed, Prisma client generated in `node_modules/.pnpm/@prisma+client/`

- [ ] **Step 17: Commit**

```bash
git add .
git commit -m "feat: monorepo bootstrap with pnpm workspaces, tsconfig, prisma schema"
```

---

### Task 2: Logger Package

**Files:**
- Create: `packages/logger/src/index.ts`
- Create: `packages/logger/src/index.test.ts`
- Create: `packages/logger/vitest.config.ts`

- [ ] **Step 1: Write failing test**

Create `packages/logger/src/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { createLogger } from "./index";

describe("createLogger", () => {
  it("returns a logger with info/error/warn methods", () => {
    const logger = createLogger({ meetingId: "test-123", workerId: "w-1" });
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.warn).toBe("function");
  });

  it("accepts empty context without throwing", () => {
    const logger = createLogger({});
    expect(typeof logger.info).toBe("function");
  });

  it("accepts partial context (meetingId only)", () => {
    const logger = createLogger({ meetingId: "meeting-abc" });
    expect(typeof logger.info).toBe("function");
  });
});
```

- [ ] **Step 2: Create `packages/logger/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 3: Run test to confirm failure**

```bash
pnpm --filter @meetingbot/logger test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 4: Implement `packages/logger/src/index.ts`**

```typescript
import pino from "pino";

export type LoggerContext = {
  meetingId?: string;
  workerId?: string;
  [key: string]: string | undefined;
};

const base = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

export function createLogger(context: LoggerContext): pino.Logger {
  const bindings: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) bindings[key] = value;
  }
  return Object.keys(bindings).length > 0 ? base.child(bindings) : base;
}

export type Logger = pino.Logger;
```

- [ ] **Step 5: Run test to confirm pass**

```bash
pnpm --filter @meetingbot/logger test
```

Expected: PASS — 3 tests pass

- [ ] **Step 6: Build**

```bash
pnpm --filter @meetingbot/logger build
```

Expected: `packages/logger/dist/index.js` and `dist/index.d.ts` created

- [ ] **Step 7: Commit**

```bash
git add packages/logger/
git commit -m "feat: logger package with pino child-binding factory"
```

---

### Task 3: Config Package

**Files:**
- Create: `packages/config/src/index.ts`
- Create: `packages/config/src/index.test.ts`
- Create: `packages/config/vitest.config.ts`

- [ ] **Step 1: Write failing test**

Create `packages/config/src/index.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // Reset module cache so each test gets fresh Zod parse
  vi.resetModules();
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

import { vi } from "vitest";

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
```

- [ ] **Step 2: Create `packages/config/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 3: Run test to confirm failure**

```bash
pnpm --filter @meetingbot/config test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 4: Implement `packages/config/src/index.ts`**

```typescript
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
```

- [ ] **Step 5: Run test to confirm pass**

```bash
pnpm --filter @meetingbot/config test
```

Expected: PASS — 4 tests pass

- [ ] **Step 6: Build**

```bash
pnpm --filter @meetingbot/config build
```

- [ ] **Step 7: Commit**

```bash
git add packages/config/
git commit -m "feat: config package with zod env parsing for api and worker"
```

---

### Task 4: DB Package + Prisma Migration

**Files:**
- Create: `packages/db/src/index.ts`
- Create: `packages/db/vitest.config.ts`

- [ ] **Step 1: Create `packages/db/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 2: Implement `packages/db/src/index.ts`**

```typescript
import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

export function getDb(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: [
        { level: "error", emit: "stdout" },
        { level: "warn", emit: "stdout" },
      ],
    });
  }
  return client;
}

export type { Meeting, TranscriptChunk, MeetingStatus } from "@prisma/client";
```

- [ ] **Step 3: Build the package**

```bash
pnpm --filter @meetingbot/db build
```

Expected: `packages/db/dist/index.js` and `dist/index.d.ts` created

- [ ] **Step 4: Start local postgres and run migration**

Start postgres:
```bash
docker run -d \
  --name meetingbot-postgres \
  -e POSTGRES_USER=meetingbot \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=meetingbot \
  -p 5432:5432 \
  postgres:15-alpine
```

Run migration:
```bash
export DATABASE_URL="postgresql://meetingbot:secret@localhost:5432/meetingbot"
pnpm db:migrate:dev --name init
```

Expected: `prisma/migrations/[timestamp]_init/migration.sql` created; tables `meetings` and `transcript_chunks` exist in postgres

- [ ] **Step 5: Verify tables exist**

```bash
docker exec -it meetingbot-postgres psql -U meetingbot -d meetingbot -c "\dt"
```

Expected output includes:
```
 public | meetings          | table | meetingbot
 public | transcript_chunks | table | meetingbot
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/ prisma/
git commit -m "feat: db package with prisma singleton and initial migration"
```

---

### Task 5: Scheduler API Routes

**Files:**
- Create: `apps/api/src/schemas/meeting.ts`
- Create: `apps/api/src/routes/meetings.ts`
- Create: `apps/api/src/routes/meetings.test.ts`
- Create: `apps/api/vitest.config.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/routes/meetings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { meetingsPlugin } from "./meetings";

vi.mock("../services/scheduler", () => ({
  scheduleMeeting: vi.fn().mockResolvedValue({ id: "uuid-123" }),
}));

describe("POST /meetings/schedule", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(meetingsPlugin);
  });

  it("returns 201 with meetingId for a valid request", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        joinAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.meetingId).toBe("uuid-123");
  });

  it("returns 400 for a non-Meet URL", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {
        meetingUrl: "https://zoom.us/j/123456789",
        joinAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when joinAt is in the past", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        joinAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/meetings/schedule",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Create `apps/api/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 3: Run test to confirm failure**

```bash
pnpm --filter @meetingbot/api test
```

Expected: FAIL — `Cannot find module './meetings'`

- [ ] **Step 4: Create `apps/api/src/schemas/meeting.ts`**

```typescript
import { z } from "zod";

export const ScheduleMeetingSchema = z.object({
  meetingUrl: z
    .string()
    .url()
    .refine((url) => url.startsWith("https://meet.google.com/"), {
      message: "Must be a Google Meet URL (https://meet.google.com/...)",
    }),
  joinAt: z
    .string()
    .datetime()
    .refine((dt) => new Date(dt) > new Date(), {
      message: "joinAt must be in the future",
    }),
});

export type ScheduleMeetingInput = z.infer<typeof ScheduleMeetingSchema>;
```

- [ ] **Step 5: Create `apps/api/src/routes/meetings.ts`**

```typescript
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
```

- [ ] **Step 6: Run test to confirm pass**

```bash
pnpm --filter @meetingbot/api test
```

Expected: PASS — 4 tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/schemas/ apps/api/src/routes/ apps/api/vitest.config.ts
git commit -m "feat: api schedule route with meet url and future joinAt validation"
```

---

### Task 6: Scheduler Service + API Server Entry

**Files:**
- Create: `apps/api/src/services/scheduler.ts`
- Create: `apps/api/src/index.ts`

- [ ] **Step 1: Create `apps/api/src/services/scheduler.ts`**

```typescript
import { CloudTasksClient, protos } from "@google-cloud/tasks";
import { getDb } from "@meetingbot/db";
import { createLogger } from "@meetingbot/logger";
import { parseApiConfig, ApiConfig } from "@meetingbot/config";
import { ScheduleMeetingInput } from "../schemas/meeting";

const logger = createLogger({});

export async function scheduleMeeting(
  input: ScheduleMeetingInput
): Promise<{ id: string }> {
  const config = parseApiConfig();
  const db = getDb();

  const meeting = await db.meeting.create({
    data: {
      meetingUrl: input.meetingUrl,
      joinAt: new Date(input.joinAt),
      status: "SCHEDULED",
    },
  });

  const log = logger.child({ meetingId: meeting.id });
  log.info({ event: "MEETING_CREATED", joinAt: input.joinAt }, "Meeting created in DB");

  await enqueueCloudTask(meeting.id, new Date(input.joinAt), config);

  log.info({ event: "CLOUD_TASK_ENQUEUED" }, "Cloud Task scheduled");

  return { id: meeting.id };
}

async function enqueueCloudTask(
  meetingId: string,
  joinAt: Date,
  config: ApiConfig
): Promise<void> {
  const client = new CloudTasksClient();
  const parent = client.queuePath(
    config.cloudTasksProject,
    config.cloudTasksLocation,
    config.cloudTasksQueue
  );

  const task: protos.google.cloud.tasks.v2.ITask = {
    scheduleTime: {
      seconds: Math.floor(joinAt.getTime() / 1000),
    },
    httpRequest: {
      httpMethod: "POST",
      url: `${config.workerBaseUrl}/run`,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify({ meetingId })).toString("base64"),
      oidcToken: { serviceAccountEmail: config.serviceAccountEmail },
    },
  };

  await client.createTask({ parent, task });
}
```

- [ ] **Step 2: Create `apps/api/src/index.ts`**

```typescript
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
```

- [ ] **Step 3: Build the API app**

```bash
pnpm --filter @meetingbot/logger build
pnpm --filter @meetingbot/config build
pnpm --filter @meetingbot/db build
pnpm --filter @meetingbot/api build
```

Expected: No TypeScript errors, `apps/api/dist/` created

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/ apps/api/src/index.ts
git commit -m "feat: scheduler service with db write and cloud tasks enqueue, api server entry"
```

---

### Task 7: Worker Entry Point

**Files:**
- Create: `apps/worker/src/schemas/worker.ts`
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/index.test.ts`
- Create: `apps/worker/vitest.config.ts`

- [ ] **Step 1: Write failing test**

Create `apps/worker/src/index.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import { workerPlugin } from "./index";

vi.mock("./services/meetingSession", () => ({
  runMeetingSession: vi.fn().mockResolvedValue(undefined),
}));

const mockMeeting = {
  id: "meeting-uuid",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
  status: "SCHEDULED",
  joinAt: new Date(),
  startedAt: null,
  endedAt: null,
  createdAt: new Date(),
};

vi.mock("@meetingbot/db", () => ({
  getDb: vi.fn().mockReturnValue({
    meeting: {
      findUnique: vi.fn().mockResolvedValue(mockMeeting),
    },
  }),
}));

describe("POST /run", () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    await app.register(workerPlugin);
  });

  it("returns 200 and starts session for valid trigger", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: { meetingId: "550e8400-e29b-41d4-a716-446655440000" },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe("started");
  });

  it("returns 400 when meetingId is not a UUID", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: { meetingId: "not-a-uuid" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 404 when meeting does not exist in DB", async () => {
    const { getDb } = await import("@meetingbot/db");
    vi.mocked(getDb).mockReturnValueOnce({
      meeting: { findUnique: vi.fn().mockResolvedValue(null) },
    } as any);

    const response = await app.inject({
      method: "POST",
      url: "/run",
      payload: { meetingId: "550e8400-e29b-41d4-a716-446655440000" },
    });

    expect(response.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Create `apps/worker/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
});
```

- [ ] **Step 3: Run test to confirm failure**

```bash
pnpm --filter @meetingbot/worker test
```

Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 4: Create `apps/worker/src/schemas/worker.ts`**

```typescript
import { z } from "zod";

export const WorkerTriggerSchema = z.object({
  meetingId: z.string().uuid(),
});

export type WorkerTriggerInput = z.infer<typeof WorkerTriggerSchema>;
```

- [ ] **Step 5: Create `apps/worker/src/index.ts`**

```typescript
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
```

- [ ] **Step 6: Run test to confirm pass**

```bash
pnpm --filter @meetingbot/worker test
```

Expected: PASS — 4 tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/schemas/ apps/worker/src/index.ts apps/worker/src/index.test.ts apps/worker/vitest.config.ts
git commit -m "feat: worker /run endpoint with uuid validation and 404 for missing meeting"
```

---

### Task 8: Google Meet Browser Joiner

**Files:**
- Create: `apps/worker/src/browser/meetJoiner.ts`

Note: Browser automation cannot be meaningfully unit tested without a live Google Meet session. TypeScript compilation is the primary verification here; end-to-end is verified in Task 11 smoke test.

- [ ] **Step 1: Create `apps/worker/src/browser/meetJoiner.ts`**

```typescript
import { chromium, BrowserContext, Page } from "playwright";
import { createLogger } from "@meetingbot/logger";
import * as fs from "fs";

export type JoinResult = {
  context: BrowserContext;
  page: Page;
};

const JOIN_TIMEOUT_MS = 120_000;
const MEETING_END_POLL_MS = 5_000;

export async function launchAndJoinMeet(
  meetingUrl: string,
  meetingId: string,
  googleAuthStateJson: string
): Promise<JoinResult> {
  const logger = createLogger({ meetingId });

  const authStatePath = `/tmp/auth-state-${meetingId}.json`;
  fs.writeFileSync(authStatePath, googleAuthStateJson);

  logger.info({ event: "BROWSER_LAUNCHING" }, "Launching Chromium");

  const context = await chromium.launchPersistentContext(
    `/tmp/browser-data-${meetingId}`,
    {
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--use-fake-ui-for-media-stream",
        "--disable-dev-shm-usage",
        "--disable-features=VizDisplayCompositor",
        `--display=${process.env["DISPLAY"] ?? ":99"}`,
      ],
      storageState: authStatePath,
      permissions: ["camera", "microphone"],
      ignoreDefaultArgs: ["--mute-audio"],
    }
  );

  fs.unlinkSync(authStatePath);

  const page = await context.newPage();

  logger.info({ event: "NAVIGATING_TO_MEET", meetingUrl }, "Navigating to Meet URL");
  await page.goto(meetingUrl, { waitUntil: "domcontentloaded" });

  await disableCameraAndMic(page, logger);
  await clickJoinButton(page, logger);

  logger.info({ event: "WAITING_FOR_ADMISSION" }, "Waiting for meeting admission");
  await waitUntilInMeeting(page, logger);

  logger.info({ event: "MEETING_JOINED" }, "Bot has joined the meeting");

  return { context, page };
}

async function disableCameraAndMic(
  page: Page,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  for (const { label, selectors } of [
    {
      label: "camera",
      selectors: ['[data-tooltip*="camera" i]', '[aria-label*="camera" i]'],
    },
    {
      label: "microphone",
      selectors: ['[data-tooltip*="microphone" i]', '[aria-label*="microphone" i]'],
    },
  ]) {
    for (const selector of selectors) {
      try {
        await page.click(selector, { timeout: 4_000 });
        logger.info({ event: `${label.toUpperCase()}_DISABLED` }, `${label} disabled`);
        break;
      } catch {
        // try next selector
      }
    }
  }
}

async function clickJoinButton(
  page: Page,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  logger.info({ event: "CLICKING_JOIN" }, "Looking for join button");

  const candidates = [
    'button:has-text("Join now")',
    'button:has-text("Ask to join")',
    'button:has-text("Join")',
    '[jsname="Qx7uuf"]',
  ];

  for (const selector of candidates) {
    try {
      await page.click(selector, { timeout: 5_000 });
      logger.info({ event: "JOIN_CLICKED", selector }, "Join button clicked");
      return;
    } catch {
      // try next
    }
  }

  throw new Error("Could not find and click a join button — selectors exhausted");
}

async function waitUntilInMeeting(
  page: Page,
  logger: ReturnType<typeof createLogger>
): Promise<void> {
  const deadline = Date.now() + JOIN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const admitted = await page
      .locator('[data-participant-id], [jsname="r4nke"], [jsname="HlFzId"]')
      .count()
      .catch(() => 0);

    if (admitted > 0) return;

    const waiting = await page
      .locator(':text("waiting to be let in"), :text("Waiting for host")')
      .count()
      .catch(() => 0);

    if (waiting > 0) {
      logger.info({ event: "WAITING_FOR_HOST" }, "Waiting to be admitted by host");
    }

    await page.waitForTimeout(2_000);
  }

  throw new Error(`Meeting did not start within ${JOIN_TIMEOUT_MS / 1000}s`);
}

export async function waitForMeetingEnd(page: Page, meetingId: string): Promise<void> {
  const logger = createLogger({ meetingId });

  return new Promise((resolve) => {
    const interval = setInterval(async () => {
      try {
        const ended = await page
          .locator(
            ':text("You left the meeting"), :text("The call has ended"), [data-call-ended]'
          )
          .count()
          .catch(() => 0);

        if (ended > 0 || page.isClosed()) {
          logger.info({ event: "MEETING_END_DETECTED" }, "Meeting end detected");
          clearInterval(interval);
          resolve();
        }
      } catch {
        clearInterval(interval);
        resolve();
      }
    }, MEETING_END_POLL_MS);
  });
}

export async function cleanupBrowser(
  context: BrowserContext,
  meetingId: string
): Promise<void> {
  const logger = createLogger({ meetingId });

  try {
    await context.close();
    logger.info({ event: "BROWSER_CLOSED" }, "Browser context closed");
  } catch (err) {
    logger.warn({ event: "BROWSER_CLOSE_FAILED", err }, "Failed to close browser gracefully");
  }

  fs.rmSync(`/tmp/browser-data-${meetingId}`, { recursive: true, force: true });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @meetingbot/worker build
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/browser/
git commit -m "feat: playwright meet joiner with camera/mic disable, join flow, end detection"
```

---

### Task 9: Audio Pipeline

**Files:**
- Create: `apps/worker/src/audio/audioPipeline.ts`

- [ ] **Step 1: Create `apps/worker/src/audio/audioPipeline.ts`**

```typescript
import { spawn, ChildProcess } from "child_process";
import { Readable } from "stream";
import { createLogger } from "@meetingbot/logger";

export type AudioPipeline = {
  stream: Readable;
  stop: () => void;
};

export function startAudioCapture(
  meetingId: string,
  pulseSinkName: string
): AudioPipeline {
  const logger = createLogger({ meetingId });
  const monitorSource = `${pulseSinkName}.monitor`;

  logger.info(
    { event: "AUDIO_PIPELINE_STARTING", monitorSource },
    "Starting FFmpeg audio capture"
  );

  const ffmpeg: ChildProcess = spawn(
    "ffmpeg",
    [
      "-f", "pulse",
      "-i", monitorSource,
      "-ac", "1",       // mono
      "-ar", "16000",   // 16 kHz
      "-f", "s16le",    // Linear16 PCM
      "pipe:1",         // write to stdout
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  ffmpeg.stderr?.on("data", (chunk: Buffer) => {
    logger.debug({ event: "FFMPEG_STDERR", msg: chunk.toString() }, "FFmpeg");
  });

  ffmpeg.on("error", (err) => {
    logger.error({ event: "FFMPEG_ERROR", err }, "FFmpeg process error");
  });

  ffmpeg.on("exit", (code, signal) => {
    logger.info({ event: "FFMPEG_EXITED", code, signal }, "FFmpeg process exited");
  });

  const stream = ffmpeg.stdout as Readable;

  const stop = (): void => {
    logger.info({ event: "AUDIO_PIPELINE_STOPPING" }, "Killing FFmpeg");
    ffmpeg.kill("SIGTERM");
  };

  return { stream, stop };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @meetingbot/worker build
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/audio/
git commit -m "feat: audio pipeline spawning ffmpeg to capture linear16 pcm from pulseaudio"
```

---

### Task 10: Deepgram Transcription Client

**Files:**
- Create: `apps/worker/src/transcription/deepgram.ts`

- [ ] **Step 1: Create `apps/worker/src/transcription/deepgram.ts`**

```typescript
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { Readable } from "stream";
import { createLogger } from "@meetingbot/logger";

export type TranscriptChunkEvent = {
  text: string;
  isFinal: boolean;
  timestampMs: number;
  speaker: string;
};

export type DeepgramSession = {
  stop: () => void;
};

const CHUNK_BYTES = 4096;

export function startDeepgramTranscription(
  meetingId: string,
  apiKey: string,
  audioStream: Readable,
  onChunk: (chunk: TranscriptChunkEvent) => Promise<void>
): DeepgramSession {
  const logger = createLogger({ meetingId });
  const deepgram = createClient(apiKey);

  const connection = deepgram.listen.live({
    model: "nova-2",
    encoding: "linear16",
    sample_rate: 16000,
    channels: 1,
    punctuate: true,
    interim_results: true,
    endpointing: 300,
    language: "en",
  });

  connection.on(LiveTranscriptionEvents.Open, () => {
    logger.info({ event: "DEEPGRAM_CONNECTED" }, "Deepgram WebSocket open");
  });

  connection.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const alternative = data?.channel?.alternatives?.[0];
    if (!alternative) return;

    const text = (alternative.transcript ?? "").trim();
    if (!text) return;

    const chunk: TranscriptChunkEvent = {
      text,
      isFinal: data.is_final ?? false,
      timestampMs: Math.round((data.start ?? 0) * 1000),
      speaker: "unknown",
    };

    logger.debug({ event: "TRANSCRIPT_CHUNK", text, isFinal: chunk.isFinal }, "Chunk received");

    onChunk(chunk).catch((err) => {
      logger.error({ event: "CHUNK_PERSIST_FAILED", err }, "Failed to persist chunk");
    });
  });

  connection.on(LiveTranscriptionEvents.Error, (err) => {
    logger.error({ event: "DEEPGRAM_ERROR", err }, "Deepgram error");
  });

  connection.on(LiveTranscriptionEvents.Close, () => {
    logger.info({ event: "DEEPGRAM_CLOSED" }, "Deepgram WebSocket closed");
  });

  // Buffer audio and send in fixed-size chunks
  let buffer = Buffer.alloc(0);

  audioStream.on("data", (incoming: Buffer) => {
    buffer = Buffer.concat([buffer, incoming]);

    while (buffer.length >= CHUNK_BYTES) {
      const slice = buffer.subarray(0, CHUNK_BYTES);
      buffer = buffer.subarray(CHUNK_BYTES);

      if (connection.getReadyState() === 1) {
        connection.send(slice);
      }
    }
  });

  audioStream.on("end", () => {
    logger.info({ event: "AUDIO_STREAM_ENDED" }, "Audio stream ended, closing Deepgram");
    connection.requestClose();
  });

  const stop = (): void => {
    audioStream.destroy();
    connection.requestClose();
    logger.info({ event: "DEEPGRAM_SESSION_STOPPED" }, "Deepgram session stopped");
  };

  return { stop };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @meetingbot/worker build
```

Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/transcription/
git commit -m "feat: deepgram live ws client streaming linear16 pcm and emitting transcript events"
```

---

### Task 11: Meeting Session Orchestrator

**Files:**
- Create: `apps/worker/src/services/meetingSession.ts`

- [ ] **Step 1: Create `apps/worker/src/services/meetingSession.ts`**

```typescript
import { Meeting, getDb } from "@meetingbot/db";
import { createLogger } from "@meetingbot/logger";
import { parseWorkerConfig } from "@meetingbot/config";
import {
  launchAndJoinMeet,
  waitForMeetingEnd,
  cleanupBrowser,
  JoinResult,
} from "../browser/meetJoiner";
import { startAudioCapture, AudioPipeline } from "../audio/audioPipeline";
import {
  startDeepgramTranscription,
  TranscriptChunkEvent,
  DeepgramSession,
} from "../transcription/deepgram";

export async function runMeetingSession(meeting: Meeting): Promise<void> {
  const config = parseWorkerConfig();
  const db = getDb();
  const logger = createLogger({ meetingId: meeting.id, workerId: config.workerId });

  logger.info(
    { event: "SESSION_STARTING", meetingUrl: meeting.meetingUrl },
    "Starting meeting session"
  );

  await db.meeting.update({
    where: { id: meeting.id },
    data: { status: "JOINING", startedAt: new Date() },
  });

  let joinResult: JoinResult | undefined;
  let audioPipeline: AudioPipeline | undefined;
  let deepgramSession: DeepgramSession | undefined;

  try {
    joinResult = await launchAndJoinMeet(
      meeting.meetingUrl,
      meeting.id,
      config.googleAuthState
    );

    await db.meeting.update({
      where: { id: meeting.id },
      data: { status: "ACTIVE" },
    });

    logger.info({ event: "SESSION_ACTIVE" }, "Meeting session is active");

    audioPipeline = startAudioCapture(meeting.id, config.pulseSinkName);

    deepgramSession = startDeepgramTranscription(
      meeting.id,
      config.deepgramApiKey,
      audioPipeline.stream,
      (chunk: TranscriptChunkEvent) => persistChunk(meeting.id, chunk, db)
    );

    logger.info({ event: "PIPELINE_RUNNING" }, "Audio and transcription pipeline running");

    await waitForMeetingEnd(joinResult.page, meeting.id);

    logger.info({ event: "MEETING_ENDED" }, "Meeting ended — beginning cleanup");
  } catch (err) {
    logger.error({ event: "SESSION_ERROR", err }, "Meeting session failed");

    await db.meeting
      .update({ where: { id: meeting.id }, data: { status: "FAILED" } })
      .catch(() => {});

    throw err;
  } finally {
    deepgramSession?.stop();
    audioPipeline?.stop();

    if (joinResult?.context) {
      await cleanupBrowser(joinResult.context, meeting.id);
    }

    await db.meeting
      .update({
        where: { id: meeting.id },
        data: { status: "ENDED", endedAt: new Date() },
      })
      .catch(() => {});

    logger.info({ event: "SESSION_CLEANUP_COMPLETE" }, "Session cleanup complete");
  }
}

async function persistChunk(
  meetingId: string,
  chunk: TranscriptChunkEvent,
  db: ReturnType<typeof getDb>
): Promise<void> {
  await db.transcriptChunk.create({
    data: {
      meetingId,
      text: chunk.text,
      speaker: chunk.speaker,
      timestampMs: chunk.timestampMs,
      isFinal: chunk.isFinal,
    },
  });
}
```

- [ ] **Step 2: Build the full worker**

```bash
pnpm --filter @meetingbot/worker build
```

Expected: No TypeScript errors, `apps/worker/dist/` fully populated

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: All 15 tests pass (logger: 3, config: 4, api routes: 4, worker entry: 4)

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/services/
git commit -m "feat: meeting session orchestrator wiring browser, audio, transcription, and db"
```

---

### Task 12: Dockerfiles + Local Dev

**Files:**
- Create: `apps/api/Dockerfile`
- Create: `apps/worker/Dockerfile`
- Create: `apps/worker/start.sh`
- Create: `infra/docker/docker-compose.yml`

- [ ] **Step 1: Create `apps/api/Dockerfile`**

```dockerfile
FROM node:22-slim AS base
RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY prisma/ ./prisma/

COPY packages/logger/package.json ./packages/logger/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

RUN pnpm --filter @meetingbot/logger build
RUN pnpm --filter @meetingbot/config build
RUN pnpm --filter @meetingbot/db build
RUN pnpm db:generate
RUN pnpm --filter @meetingbot/api build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
```

- [ ] **Step 2: Create `apps/worker/Dockerfile`**

```dockerfile
FROM node:22-slim AS base

RUN apt-get update && apt-get install -y \
    xvfb \
    pulseaudio \
    ffmpeg \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpangocairo-1.0-0 \
    libpango-1.0-0 \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY tsconfig.base.json ./
COPY prisma/ ./prisma/

COPY packages/logger/package.json ./packages/logger/
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile

# Install Playwright's Chromium binary
RUN pnpm --filter @meetingbot/worker exec playwright install chromium

COPY packages/ ./packages/
COPY apps/worker/ ./apps/worker/

RUN pnpm --filter @meetingbot/logger build
RUN pnpm --filter @meetingbot/config build
RUN pnpm --filter @meetingbot/db build
RUN pnpm db:generate
RUN pnpm --filter @meetingbot/worker build

COPY apps/worker/start.sh /start.sh
RUN chmod +x /start.sh

ENV NODE_ENV=production
ENV DISPLAY=:99
EXPOSE 3001
CMD ["/start.sh"]
```

- [ ] **Step 3: Create `apps/worker/start.sh`**

```bash
#!/bin/bash
set -e

# Virtual display — required for Chromium (not truly headless, needs Xvfb)
Xvfb :99 -screen 0 1920x1080x24 &
echo "Xvfb started on :99"

# PulseAudio daemon with infinite idle timeout
pulseaudio --start --exit-idle-time=-1 --log-target=stderr
sleep 1

# Null sink so FFmpeg has a monitor source to read from
pactl load-module module-null-sink \
  sink_name=virtual_sink \
  sink_properties=device.description="MeetingBotSink"

echo "PulseAudio null sink 'virtual_sink' created"

export PULSE_SINK=virtual_sink
export DISPLAY=:99

exec node /app/apps/worker/dist/index.js
```

- [ ] **Step 4: Create `infra/docker/docker-compose.yml`**

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_USER: meetingbot
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: meetingbot
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U meetingbot"]
      interval: 5s
      timeout: 5s
      retries: 5

  api:
    build:
      context: ../..
      dockerfile: apps/api/Dockerfile
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: "postgresql://meetingbot:secret@postgres:5432/meetingbot"
      CLOUD_TASKS_PROJECT: "${CLOUD_TASKS_PROJECT}"
      CLOUD_TASKS_LOCATION: "${CLOUD_TASKS_LOCATION}"
      CLOUD_TASKS_QUEUE: "${CLOUD_TASKS_QUEUE}"
      WORKER_BASE_URL: "${WORKER_BASE_URL}"
      SERVICE_ACCOUNT_EMAIL: "${SERVICE_ACCOUNT_EMAIL}"
      LOG_LEVEL: "debug"
    depends_on:
      postgres:
        condition: service_healthy

  worker:
    build:
      context: ../..
      dockerfile: apps/worker/Dockerfile
    ports:
      - "3001:3001"
    environment:
      DATABASE_URL: "postgresql://meetingbot:secret@postgres:5432/meetingbot"
      DEEPGRAM_API_KEY: "${DEEPGRAM_API_KEY}"
      GOOGLE_AUTH_STATE: "${GOOGLE_AUTH_STATE}"
      PULSE_SINK_NAME: "virtual_sink"
      LOG_LEVEL: "debug"
    depends_on:
      postgres:
        condition: service_healthy
    cap_add:
      - SYS_ADMIN
    shm_size: "2gb"

volumes:
  postgres_data:
```

- [ ] **Step 5: Build Docker images**

```bash
docker build -f apps/api/Dockerfile -t meetingbot-api:local .
docker build -f apps/worker/Dockerfile -t meetingbot-worker:local .
```

Expected: Both images build without errors (worker image will be ~2–3 GB with Chromium)

- [ ] **Step 6: Commit**

```bash
git add apps/api/Dockerfile apps/worker/Dockerfile apps/worker/start.sh infra/docker/
git commit -m "feat: dockerfiles for api and worker, start.sh for xvfb and pulseaudio, docker-compose"
```

---

### Task 13: Cloud Run Configs + Google Auth Setup Script

**Files:**
- Create: `infra/cloudrun/api.yaml`
- Create: `infra/cloudrun/worker.yaml`
- Create: `scripts/setup-google-auth.ts`

- [ ] **Step 1: Create `infra/cloudrun/api.yaml`**

Replace `PROJECT_ID` and `REGION` with your actual values before deploying.

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: meetingbot-api
  annotations:
    run.googleapis.com/ingress: all
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "0"
        autoscaling.knative.dev/maxScale: "10"
        run.googleapis.com/cpu-throttling: "false"
    spec:
      serviceAccountName: meetingbot-api@PROJECT_ID.iam.gserviceaccount.com
      containers:
        - image: REGION-docker.pkg.dev/PROJECT_ID/meetingbot/api:latest
          ports:
            - containerPort: 3000
          resources:
            limits:
              cpu: "1"
              memory: "512Mi"
          env:
            - name: NODE_ENV
              value: production
            - name: LOG_LEVEL
              value: info
            - name: CLOUD_TASKS_PROJECT
              value: "PROJECT_ID"
            - name: CLOUD_TASKS_LOCATION
              value: "us-central1"
            - name: CLOUD_TASKS_QUEUE
              value: "meeting-jobs"
            - name: WORKER_BASE_URL
              value: "https://meetingbot-worker-HASH-uc.a.run.app"
            - name: SERVICE_ACCOUNT_EMAIL
              value: "meetingbot-worker@PROJECT_ID.iam.gserviceaccount.com"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: meetingbot-database-url
                  key: latest
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
```

- [ ] **Step 2: Create `infra/cloudrun/worker.yaml`**

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: meetingbot-worker
  annotations:
    run.googleapis.com/ingress: internal
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "0"
        autoscaling.knative.dev/maxScale: "100"
        run.googleapis.com/cpu-throttling: "false"
        run.googleapis.com/execution-environment: gen2
    spec:
      containerConcurrency: 1
      timeoutSeconds: 3600
      serviceAccountName: meetingbot-worker@PROJECT_ID.iam.gserviceaccount.com
      containers:
        - image: REGION-docker.pkg.dev/PROJECT_ID/meetingbot/worker:latest
          ports:
            - containerPort: 3001
          resources:
            limits:
              cpu: "2"
              memory: "4Gi"
          env:
            - name: NODE_ENV
              value: production
            - name: LOG_LEVEL
              value: info
            - name: DISPLAY
              value: ":99"
            - name: PULSE_SINK_NAME
              value: "virtual_sink"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: meetingbot-database-url
                  key: latest
            - name: DEEPGRAM_API_KEY
              valueFrom:
                secretKeyRef:
                  name: meetingbot-deepgram-key
                  key: latest
            - name: GOOGLE_AUTH_STATE
              valueFrom:
                secretKeyRef:
                  name: meetingbot-google-auth-state
                  key: latest
          livenessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 30
            periodSeconds: 60
```

- [ ] **Step 3: Create `scripts/setup-google-auth.ts`**

Run this script locally once to capture auth state for the bot account.

```typescript
import { chromium } from "playwright";
import * as fs from "fs";

async function captureAuthState() {
  console.log("Opening browser. Log in to the bot Google account.");
  console.log("After logging in, navigate to https://meet.google.com");
  console.log("The script saves auth state automatically and exits.\n");

  const context = await chromium.launchPersistentContext("/tmp/auth-setup", {
    headless: false,
    args: ["--no-sandbox"],
  });

  const page = await context.newPage();
  await page.goto("https://accounts.google.com");

  await page.waitForURL("**/meet.google.com**", { timeout: 300_000 });
  console.log("Detected meet.google.com — saving auth state...");

  const storageState = await context.storageState();
  const json = JSON.stringify(storageState);

  fs.writeFileSync("google-auth-state.json", json);
  console.log("Saved to google-auth-state.json");
  console.log("\nUpload to Secret Manager:");
  console.log(
    "  gcloud secrets create meetingbot-google-auth-state \\\n" +
    "    --project=PROJECT_ID \\\n" +
    "    --data-file=google-auth-state.json"
  );

  await context.close();
}

captureAuthState().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Add the auth setup script to root `package.json`**

Add under `"scripts"` in `package.json`:

```json
"setup:google-auth": "ts-node scripts/setup-google-auth.ts"
```

- [ ] **Step 5: Commit**

```bash
git add infra/cloudrun/ scripts/ package.json
git commit -m "feat: cloud run service configs for api and worker, google auth capture script"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Receive Google Meet URL | Task 5 — `ScheduleMeetingSchema` validates `meet.google.com` URL |
| Schedule bot to join at a timestamp | Task 6 — Cloud Tasks `scheduleTime` set to `joinAt` |
| Launch browser worker | Task 7 — Cloud Tasks HTTP triggers `POST /run`, worker spawns session |
| Join Google Meet call | Task 8 — `launchAndJoinMeet()` with Playwright |
| Disable mic/camera | Task 8 — `disableCameraAndMic()` |
| Capture meeting audio | Task 9 — FFmpeg reading PulseAudio null sink monitor |
| Stream audio to Deepgram | Task 10 — `startDeepgramTranscription()` with `nova-2` model |
| Persist transcript chunks | Task 10 + 11 — `persistChunk()` writes `TranscriptChunk` rows |
| Graceful exit on meeting end | Task 11 — `waitForMeetingEnd()` + `finally` cleanup block |
| ONE WORKER = ONE MEETING | Task 13 — `containerConcurrency: 1` in worker.yaml |
| Monorepo structure | Task 1 |
| TypeScript strict mode | Task 1 — `"strict": true` in `tsconfig.base.json` |
| Zod runtime validation | Tasks 3, 5, 7 |
| Pino structured logging | Task 2 — all log calls include `event` field |
| Prisma schema + migration | Tasks 1, 4 |
| Cloud Tasks queue | Task 6 |
| PulseAudio + FFmpeg pipeline | Task 9, Task 12 (`start.sh`) |
| Dockerfiles | Task 12 |
| Cloud Run configs | Task 13 |
| GCP Secret Manager | Task 13 — secrets referenced in YAML |
| Google auth state management | Task 13 — `setup-google-auth.ts` + Secret Manager |

### Type Consistency

- `Meeting` type from `@prisma/client` flows: `workerPlugin` → `runMeetingSession(meeting: Meeting)` — consistent ✅
- `createLogger(context: LoggerContext)` returns `pino.Logger` — used identically in all files ✅
- `AudioPipeline.stream: Readable` passed to `startDeepgramTranscription(..., audioStream: Readable, ...)` — consistent ✅
- `TranscriptChunkEvent` defined in `deepgram.ts`, typed in `meetingSession.ts` callback — consistent ✅
- `DeepgramSession.stop(): void` called in `meetingSession.ts` finally block — consistent ✅
- `WorkerTriggerSchema` validates `meetingId` as UUID; `db.meeting.findUnique({ where: { id: meetingId } })` — consistent ✅
- `parseWorkerConfig().googleAuthState` is a `string` (JSON); passed directly to `launchAndJoinMeet(..., googleAuthStateJson: string)` — consistent ✅

### Placeholder Scan

No TODOs, TBDs, or stub implementations. All steps include complete code.
