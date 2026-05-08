# MeetingBot-MVP: What Was Built

## Summary

A fully autonomous backend system that joins Google Meet calls on a schedule, captures the meeting audio, transcribes it in real time using Deepgram, and persists the transcript to PostgreSQL — with zero human interaction required once a meeting is scheduled.

---

## The Problem Solved

Recording and transcribing a Google Meet call normally requires someone to be present, manually hit record, or use a paid third-party service. This system automates the entire process:

1. You schedule a meeting via a single API call
2. At the scheduled time, a bot joins the meeting automatically
3. Everything said in the meeting is transcribed and stored in your database
4. When the meeting ends, the bot cleans up and the container shuts down

---

## What Was Built

### Two Services

**Scheduler API** (`apps/api/`)
- A Fastify HTTP server that accepts `POST /meetings/schedule`
- Validates the Google Meet URL and that the join time is in the future
- Writes the meeting to PostgreSQL with status `SCHEDULED`
- Enqueues a Google Cloud Task to fire at exactly the scheduled time
- Stateless — can run multiple instances behind a load balancer

**Meeting Worker** (`apps/worker/`)
- A Fastify HTTP server that receives `POST /run` from Cloud Tasks
- Responds 200 immediately so the queue doesn't time out
- Launches a full meeting session in the background:
  - Opens Chromium via Playwright with the bot's saved Google session
  - Navigates to the Google Meet URL, disables camera and mic, clicks Join
  - Waits to be admitted, then detects the connected state
  - Starts FFmpeg reading from a PulseAudio virtual audio sink
  - Pipes raw PCM audio to Deepgram's real-time WebSocket API
  - Persists each transcript chunk (interim + final) to PostgreSQL
  - Detects when the meeting ends and gracefully shuts everything down
- Stateless and disposable — one container per meeting, no shared state

### Four Shared Packages

| Package | What it does |
|---------|-------------|
| `packages/logger` | Pino-based structured logger with per-meeting/per-worker context binding |
| `packages/config` | Zod-validated environment variable parsing for both services |
| `packages/db` | Prisma client singleton with lazy initialization |
| (prisma schema) | `meetings` + `transcript_chunks` tables with proper indexes |

### Infrastructure

| File | What it does |
|------|-------------|
| `apps/api/Dockerfile` | Node 22 slim image for the API |
| `apps/worker/Dockerfile` | Node 22 + Xvfb + PulseAudio + FFmpeg + Chromium for the worker |
| `apps/worker/start.sh` | Container entrypoint: starts virtual display and audio sink before Node |
| `infra/docker/docker-compose.yml` | Local dev environment: postgres + api + worker |
| `infra/cloudrun/api.yaml` | Cloud Run service spec for the API (public ingress, auto-scales 0→10) |
| `infra/cloudrun/worker.yaml` | Cloud Run service spec for the worker (internal, concurrency=1, 4GB, gen2) |
| `scripts/setup-google-auth.ts` | One-time script to capture bot Google account session for Secret Manager |

---

## Key Technical Decisions and Why

### Playwright over Selenium
Playwright has first-class TypeScript support, better async APIs, and persistent context (which lets us restore a saved Google session without re-logging in every time).

### PulseAudio null sink
The worker runs in a headless Linux container with no real audio hardware. PulseAudio creates a virtual audio device; Chrome routes meeting audio to it; FFmpeg reads it back. This is the only reliable way to capture browser audio without a physical sound card.

### `setImmediate` response pattern
Cloud Tasks has a strict delivery timeout. If the worker took 30 minutes to respond, Cloud Tasks would retry the job. Instead, the worker responds `200 OK` immediately and launches the meeting session in a `setImmediate` callback — fully decoupled from the HTTP response.

### `containerConcurrency: 1`
Cloud Run is configured to send at most one request per container instance. Combined with one Cloud Task per meeting, this means each container handles exactly one Chromium session. No shared state, no browser session conflicts, no resource contention.

### Idempotency guard
Before launching a session, the worker checks that `meeting.status === "SCHEDULED"`. If Cloud Tasks accidentally delivers the same task twice (or a retry fires while the first container is still running), the second container skips the session without launching a second browser.

### Gen2 execution environment
Cloud Run's Gen2 environment supports the Linux kernel capabilities that Chromium requires (e.g. `clone()` syscall for process sandboxing). Gen1 would require `--no-sandbox` alone, which reduces Chromium's security model.

### Deepgram `nova-2` model
Nova-2 has the best accuracy-to-latency tradeoff for real-time meeting transcription. Interim results (`interim_results: true`) give low-latency feedback; `endpointing: 300` means Deepgram waits 300ms of silence before committing a final transcript.

---

## What the Database Looks Like After a Meeting

**`meetings` table — one row per scheduled meeting:**

```
id          | 550e8400-e29b-41d4-a716-446655440000
meeting_url | https://meet.google.com/abc-defg-hij
status      | ENDED
join_at     | 2026-05-08 15:00:00 UTC
started_at  | 2026-05-08 15:00:43 UTC
ended_at    | 2026-05-08 15:47:12 UTC
created_at  | 2026-05-08 14:55:10 UTC
```

**`transcript_chunks` table — one row per utterance:**

```
id           | uuid
meeting_id   | 550e8400-...
text         | "Let's finalize the deployment plan for tomorrow."
speaker      | unknown
timestamp_ms | 914000
is_final     | true
created_at   | 2026-05-08 15:15:14 UTC
```

Query for a clean final transcript:

```sql
SELECT text, timestamp_ms
FROM transcript_chunks
WHERE meeting_id = 'your-meeting-id'
  AND is_final = true
ORDER BY timestamp_ms;
```

---

## Test Coverage

| Package | Tests | What's covered |
|---------|-------|---------------|
| `@meetingbot/logger` | 3 | createLogger with/without context, child bindings |
| `@meetingbot/config` | 4 | API config parsing, Worker config parsing, missing var errors |
| `@meetingbot/api` | 4 | Valid schedule request, invalid URL, past joinAt, missing fields |
| `@meetingbot/worker` | 4 | Valid run request, invalid UUID, unknown meeting, duplicate delivery |
| **Total** | **15** | All passing |

---

## What This Enables (and What It Doesn't)

### Enables
- Fully automated meeting recording without manual intervention
- Horizontal scaling to 100 simultaneous meetings with zero config changes
- Transcript data in your own database for any downstream use
- Per-meeting cost isolation (you pay only for the compute time of each meeting)

### Not included in this MVP (intentional)
- Speaker diarization (all speakers labeled "unknown")
- AI summaries or action items
- Frontend or dashboard
- Multi-platform support (Zoom, Teams)
- Custom STT models
- Meeting detection via Google Calendar API
- Authentication UI or multi-user management

These are the right next steps once the core reliability of "bot joins and transcribes" is proven in production.

---

## Repository Structure

```
voiscribe-bs/
├── apps/
│   ├── api/              ← Scheduler API (Fastify)
│   └── worker/           ← Meeting worker (Playwright + FFmpeg + Deepgram)
├── packages/
│   ├── logger/           ← Pino factory
│   ├── config/           ← Zod env parsing
│   └── db/               ← Prisma singleton
├── prisma/
│   └── schema.prisma     ← meetings + transcript_chunks
├── infra/
│   ├── docker/           ← docker-compose for local dev
│   └── cloudrun/         ← Cloud Run YAML specs
├── scripts/
│   └── setup-google-auth.ts  ← One-time auth capture
└── docs/
    ├── WALKTHROUGH.md    ← How to run and deploy
    └── WHAT_WAS_BUILT.md ← This file
```
