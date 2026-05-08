# MeetingBot-MVP: End-to-End Walkthrough

This guide explains exactly how the system works and how to operate it — from scheduling a meeting to reading the transcript out of the database.

---

## How the Bot Gets Created (The Full Flow)

```
You call POST /meetings/schedule
        ↓
API writes a "SCHEDULED" row to PostgreSQL
        ↓
API creates a Cloud Task with a future trigger time (joinAt)
        ↓
At joinAt, Google Cloud Tasks sends POST /run to the Worker
        ↓
Worker validates the request, checks the meeting is still SCHEDULED
        ↓
Worker responds 200 immediately (so Cloud Tasks marks job delivered)
        ↓
Worker launches a background session:
  → Chromium opens Google Meet via Playwright
  → Camera and mic are disabled
  → Bot clicks Join
  → PulseAudio captures the meeting audio
  → FFmpeg converts audio to Linear16 PCM stream
  → Deepgram WebSocket receives the stream and returns transcripts
  → Each transcript chunk is written to PostgreSQL
        ↓
When the meeting ends (detected by Playwright polling),
the session cleans up and the container shuts down
```

---

## Prerequisites

### Local Development

- Node.js 22+
- pnpm (`npm i -g pnpm`)
- Docker Desktop (for PostgreSQL and local container testing)
- A Google account dedicated to the bot (e.g. `meetingbot@yourdomain.com`)
- A Deepgram account with an API key ([deepgram.com](https://deepgram.com))

### Production (Google Cloud)

- GCP project with billing enabled
- Cloud Run API, Cloud Tasks API, Cloud SQL API, Secret Manager API enabled
- `gcloud` CLI authenticated
- A Cloud SQL PostgreSQL 15 instance

---

## Step 1: Clone and Install

```bash
git clone https://github.com/fullstackarthur/voiscribe-bs.git
cd voiscribe-bs
pnpm install
```

---

## Step 2: Set Up the Database (Local)

Start PostgreSQL via Docker Compose:

```bash
docker compose -f infra/docker/docker-compose.yml up postgres -d
```

Run the Prisma migration to create the `meetings` and `transcript_chunks` tables:

```powershell
$env:DATABASE_URL = "postgresql://meetingbot:secret@localhost:5432/meetingbot"
pnpm db:migrate:dev --name init
```

---

## Step 3: Capture Google Auth State (One-Time Setup)

The bot logs into Google Meet using a saved browser session. You capture this once:

```bash
pnpm setup:google-auth
```

This opens a Chromium window. Log into the dedicated bot Google account, then navigate to `https://meet.google.com`. The script detects the URL change, saves the session cookies to `google-auth-state.json`, and exits.

> **Important:** `google-auth-state.json` is gitignored. Never commit it.

For production, upload it to Secret Manager:

```bash
gcloud secrets create meetingbot-google-auth-state \
  --project=YOUR_PROJECT_ID \
  --data-file=google-auth-state.json
```

---

## Step 4: Configure Environment Variables

### API service (`apps/api/.env`)

```env
DATABASE_URL=postgresql://meetingbot:secret@localhost:5432/meetingbot
CLOUD_TASKS_PROJECT=your-gcp-project-id
CLOUD_TASKS_LOCATION=us-central1
CLOUD_TASKS_QUEUE=meeting-jobs
WORKER_BASE_URL=http://localhost:3001
SERVICE_ACCOUNT_EMAIL=meetingbot-worker@your-project.iam.gserviceaccount.com
PORT=3000
```

### Worker service (`apps/worker/.env`)

```env
DATABASE_URL=postgresql://meetingbot:secret@localhost:5432/meetingbot
DEEPGRAM_API_KEY=your_deepgram_key_here
GOOGLE_AUTH_STATE=<contents of google-auth-state.json as a single-line string>
PULSE_SINK_NAME=virtual_sink
WORKER_ID=worker-local-1
PORT=3001
```

---

## Step 5: Run Locally

### Start everything with Docker Compose

```bash
docker compose -f infra/docker/docker-compose.yml up --build
```

This starts:
- `postgres` on port 5432
- `api` (Fastify scheduler) on port 3000
- `worker` (Playwright + FFmpeg + Deepgram) on port 3001

The worker container includes Xvfb (virtual display), PulseAudio (virtual audio sink), FFmpeg, and Chromium — everything needed to run a headless meeting session.

---

## Step 6: Schedule a Meeting

Send a POST request to the API:

```bash
curl -X POST http://localhost:3000/meetings/schedule \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/abc-defg-hij",
    "joinAt": "2026-05-08T15:00:00Z"
  }'
```

Response:

```json
{ "meetingId": "550e8400-e29b-41d4-a716-446655440000" }
```

At `joinAt`, Cloud Tasks fires a `POST /run` request to the worker with the `meetingId`. The worker bot joins the meeting automatically.

---

## Step 7: Watch the Bot Join

The worker logs every lifecycle event as structured JSON. You can stream them:

```bash
docker logs -f voiscribe-bs-worker-1 | pnpm dlx pino-pretty
```

You will see events like:

```
MEETING_JOINING → BROWSER_LAUNCHED → MEETING_JOINED → AUDIO_STARTED
→ DEEPGRAM_CONNECTED → TRANSCRIPT_CHUNK → ... → MEETING_ENDED
```

---

## Step 8: Read the Transcript

```sql
SELECT text, speaker, timestamp_ms, is_final
FROM transcript_chunks
WHERE meeting_id = '550e8400-e29b-41d4-a716-446655440000'
  AND is_final = true
ORDER BY timestamp_ms;
```

Each row is one utterance captured from the meeting audio, with millisecond timestamps.

---

## Production Deployment (Google Cloud)

### 1. Build and push Docker images

```bash
# API
docker build -t us-central1-docker.pkg.dev/PROJECT_ID/meetingbot/api:latest -f apps/api/Dockerfile .
docker push us-central1-docker.pkg.dev/PROJECT_ID/meetingbot/api:latest

# Worker
docker build -t us-central1-docker.pkg.dev/PROJECT_ID/meetingbot/worker:latest -f apps/worker/Dockerfile .
docker push us-central1-docker.pkg.dev/PROJECT_ID/meetingbot/worker:latest
```

### 2. Create Cloud Tasks queue

```bash
gcloud tasks queues create meeting-jobs \
  --location=us-central1 \
  --project=PROJECT_ID
```

### 3. Upload remaining secrets to Secret Manager

```bash
# Database URL (from Cloud SQL)
echo -n "postgresql://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE" | \
  gcloud secrets create meetingbot-database-url --data-file=- --project=PROJECT_ID

# Deepgram API key
echo -n "your_deepgram_key" | \
  gcloud secrets create meetingbot-deepgram-key --data-file=- --project=PROJECT_ID
```

### 4. Run Prisma migrations against Cloud SQL

```bash
DATABASE_URL="postgresql://..." pnpm db:migrate
```

### 5. Deploy services to Cloud Run

```bash
# Deploy API
gcloud run services replace infra/cloudrun/api.yaml \
  --region=us-central1 --project=PROJECT_ID

# Deploy Worker
gcloud run services replace infra/cloudrun/worker.yaml \
  --region=us-central1 --project=PROJECT_ID
```

The worker is configured with:
- `containerConcurrency: 1` — one container handles exactly one meeting
- `timeoutSeconds: 1740` — safely within Cloud Tasks' 30-minute dispatch deadline
- `maxInstances: 100` — up to 100 simultaneous meetings
- Gen2 execution environment — required for Chromium + Xvfb

### 6. Grant Cloud Tasks permission to invoke the worker

```bash
gcloud run services add-iam-policy-binding meetingbot-worker \
  --region=us-central1 \
  --member=serviceAccount:meetingbot-worker@PROJECT_ID.iam.gserviceaccount.com \
  --role=roles/run.invoker \
  --project=PROJECT_ID
```

---

## How Automatic Scaling Works

Each Cloud Tasks trigger spawns a fresh Cloud Run container. Because `containerConcurrency: 1`, Cloud Run never routes two tasks to the same container. So:

- **10 meetings scheduled at 3pm** → 10 Cloud Tasks enqueued → 10 Cloud Run containers spin up → 10 independent Chromium sessions run in parallel
- Each container lives only for the duration of its meeting, then shuts down
- You pay only for compute time used

No servers to manage, no pools to maintain.

---

## Architecture Diagram

```
Caller
  │
  ▼
POST /meetings/schedule
  │  (Fastify API — Cloud Run)
  │
  ├── INSERT meeting (SCHEDULED) → PostgreSQL
  │
  └── Cloud Tasks enqueue (scheduled at joinAt)
            │
            │  [at joinAt time]
            ▼
        POST /run → Worker (Cloud Run, concurrency=1)
            │
            ├── UPDATE meeting → JOINING
            ├── Playwright → Chromium → Google Meet
            ├── UPDATE meeting → ACTIVE
            ├── FFmpeg ← PulseAudio null sink ← browser audio
            ├── Deepgram WebSocket ← PCM stream
            ├── INSERT transcript_chunks (every utterance)
            └── [meeting ends]
                ├── UPDATE meeting → ENDED
                └── Container shuts down
```

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Bot joins but says "Waiting to be let in" | Not admitted by host | Host must admit the bot or it must be on the allowlist |
| No transcript chunks appearing | Deepgram key invalid or audio not flowing | Check `DEEPGRAM_API_KEY`, check FFmpeg logs |
| Worker crashes immediately | Missing env var | Check all required env vars are set |
| Meeting status stays JOINING | Playwright couldn't find join button | Google Meet UI may have changed; update selectors in `meetJoiner.ts` |
| Cloud Tasks not triggering worker | OIDC auth misconfigured | Verify service account has `roles/run.invoker` |

---

## Updating Google Auth State

The bot's Google session expires periodically. To refresh:

```bash
pnpm setup:google-auth
```

Re-upload to Secret Manager:

```bash
gcloud secrets versions add meetingbot-google-auth-state \
  --data-file=google-auth-state.json \
  --project=PROJECT_ID
```

New worker containers will pick up the new version automatically.
