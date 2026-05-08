#!/bin/bash
# =============================================================================
# MeetingBot-MVP — Full GCP Setup Script
#
# Run this from Google Cloud Shell (recommended) or any machine with:
#   gcloud, docker, node 22+, pnpm, git, openssl
#
# Usage:
#   chmod +x scripts/setup-gcp.sh
#   ./scripts/setup-gcp.sh
#
# What this does:
#   1. Enables required GCP APIs
#   2. Creates Artifact Registry repo for Docker images
#   3. Creates service accounts + IAM bindings
#   4. Creates Cloud SQL PostgreSQL 15 instance
#   5. Creates Cloud Tasks queue
#   6. Creates Secret Manager secrets
#   7. Builds and pushes Docker images
#   8. Runs Prisma migrations via Cloud SQL Auth Proxy
#   9. Deploys API and Worker to Cloud Run
#  10. Wires the Worker URL back into the API config
# =============================================================================

set -euo pipefail

# ─── Colours ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ─── Required tools check ────────────────────────────────────────────────────
for cmd in gcloud docker node pnpm git openssl curl; do
  command -v "$cmd" &>/dev/null || error "Required tool not found: $cmd. Install it first."
done

echo ""
echo "============================================================"
echo "   MeetingBot-MVP — GCP Infrastructure Setup"
echo "============================================================"
echo ""

# ─── Configuration (edit these or they will be prompted) ─────────────────────
PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-us-central1}"
DEEPGRAM_API_KEY="${DEEPGRAM_API_KEY:-}"

# ─── Prompt for required values if not set ───────────────────────────────────
if [[ -z "$PROJECT_ID" ]]; then
  read -rp "GCP Project ID: " PROJECT_ID
fi
if [[ -z "$DEEPGRAM_API_KEY" ]]; then
  read -rp "Deepgram API Key: " DEEPGRAM_API_KEY
fi

# Derived names (do not change unless you want custom resource names)
DB_INSTANCE="meetingbot-postgres"
DB_NAME="meetingbot"
DB_USER="meetingbot"
REPO_NAME="meetingbot"
TASKS_QUEUE="meeting-jobs"
API_SA="meetingbot-api"
WORKER_SA="meetingbot-worker"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
CLOUD_SQL_CONN="${PROJECT_ID}:${REGION}:${DB_INSTANCE}"

echo ""
info "Project:  $PROJECT_ID"
info "Region:   $REGION"
info "Registry: $REGISTRY"
echo ""

# ─── Step 1: Set active project ──────────────────────────────────────────────
info "Setting active GCP project..."
gcloud config set project "$PROJECT_ID" --quiet
success "Project set"

# ─── Step 2: Enable APIs ─────────────────────────────────────────────────────
info "Enabling GCP APIs (this takes ~2 minutes on first run)..."
gcloud services enable \
  run.googleapis.com \
  cloudtasks.googleapis.com \
  sqladmin.googleapis.com \
  sql-component.googleapis.com \
  secretmanager.googleapis.com \
  artifactregistry.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  --quiet
success "APIs enabled"

# ─── Step 3: Artifact Registry ───────────────────────────────────────────────
info "Creating Artifact Registry repository..."
if gcloud artifacts repositories describe "$REPO_NAME" \
    --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  warn "Artifact Registry '$REPO_NAME' already exists, skipping"
else
  gcloud artifacts repositories create "$REPO_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="MeetingBot Docker images" \
    --quiet
  success "Artifact Registry created"
fi

# Configure Docker auth
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
success "Docker auth configured"

# ─── Step 4: Service Accounts ────────────────────────────────────────────────
info "Creating service accounts..."

create_sa() {
  local name=$1 display=$2
  if gcloud iam service-accounts describe "${name}@${PROJECT_ID}.iam.gserviceaccount.com" \
      --project="$PROJECT_ID" &>/dev/null; then
    warn "Service account '$name' already exists, skipping"
  else
    gcloud iam service-accounts create "$name" \
      --display-name="$display" \
      --project="$PROJECT_ID" \
      --quiet
    success "Created service account: $name"
  fi
}

create_sa "$API_SA"    "MeetingBot API"
create_sa "$WORKER_SA" "MeetingBot Worker"

# ─── Step 5: IAM Bindings ────────────────────────────────────────────────────
info "Granting IAM roles..."

bind_role() {
  local member=$1 role=$2
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="$member" --role="$role" --quiet &>/dev/null
}

API_MEMBER="serviceAccount:${API_SA}@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_MEMBER="serviceAccount:${WORKER_SA}@${PROJECT_ID}.iam.gserviceaccount.com"

# API: enqueue tasks, read secrets, connect to Cloud SQL
bind_role "$API_MEMBER" "roles/cloudtasks.enqueuer"
bind_role "$API_MEMBER" "roles/secretmanager.secretAccessor"
bind_role "$API_MEMBER" "roles/cloudsql.client"

# Worker: read secrets, connect to Cloud SQL
bind_role "$WORKER_MEMBER" "roles/secretmanager.secretAccessor"
bind_role "$WORKER_MEMBER" "roles/cloudsql.client"

# Allow API service account to impersonate worker SA (for OIDC token on Cloud Tasks)
gcloud iam service-accounts add-iam-policy-binding \
  "${WORKER_SA}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --member="$API_MEMBER" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project="$PROJECT_ID" \
  --quiet &>/dev/null

success "IAM bindings set"

# ─── Step 6: Cloud SQL ───────────────────────────────────────────────────────
info "Creating Cloud SQL PostgreSQL 15 instance (takes 5-8 minutes)..."

if gcloud sql instances describe "$DB_INSTANCE" --project="$PROJECT_ID" &>/dev/null; then
  warn "Cloud SQL instance '$DB_INSTANCE' already exists, skipping creation"
else
  gcloud sql instances create "$DB_INSTANCE" \
    --database-version=POSTGRES_15 \
    --tier=db-g1-small \
    --region="$REGION" \
    --storage-size=10GB \
    --storage-type=SSD \
    --no-backup \
    --project="$PROJECT_ID" \
    --quiet
  success "Cloud SQL instance created"
fi

# Create database
if ! gcloud sql databases describe "$DB_NAME" \
    --instance="$DB_INSTANCE" --project="$PROJECT_ID" &>/dev/null; then
  gcloud sql databases create "$DB_NAME" \
    --instance="$DB_INSTANCE" \
    --project="$PROJECT_ID" \
    --quiet
  success "Database '$DB_NAME' created"
fi

# Create user with random password
DB_PASSWORD=$(openssl rand -base64 24 | tr -d '=/+' | head -c 24)
gcloud sql users create "$DB_USER" \
  --instance="$DB_INSTANCE" \
  --password="$DB_PASSWORD" \
  --project="$PROJECT_ID" \
  --quiet 2>/dev/null || \
gcloud sql users set-password "$DB_USER" \
  --instance="$DB_INSTANCE" \
  --password="$DB_PASSWORD" \
  --project="$PROJECT_ID" \
  --quiet
success "Database user '$DB_USER' configured"

DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@/${DB_NAME}?host=/cloudsql/${CLOUD_SQL_CONN}"

# ─── Step 7: Cloud Tasks Queue ───────────────────────────────────────────────
info "Creating Cloud Tasks queue..."
if gcloud tasks queues describe "$TASKS_QUEUE" \
    --location="$REGION" --project="$PROJECT_ID" &>/dev/null; then
  warn "Queue '$TASKS_QUEUE' already exists, skipping"
else
  gcloud tasks queues create "$TASKS_QUEUE" \
    --location="$REGION" \
    --max-attempts=1 \
    --project="$PROJECT_ID" \
    --quiet
  success "Queue '$TASKS_QUEUE' created (max-attempts=1 — no retries, meeting already responded 200)"
fi

# ─── Step 8: Secret Manager ──────────────────────────────────────────────────
info "Creating secrets in Secret Manager..."

create_secret() {
  local name=$1 value=$2
  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    # Add new version
    echo -n "$value" | gcloud secrets versions add "$name" \
      --data-file=- --project="$PROJECT_ID" --quiet
    warn "Secret '$name' already exists — added new version"
  else
    echo -n "$value" | gcloud secrets create "$name" \
      --data-file=- --project="$PROJECT_ID" --quiet
    success "Secret '$name' created"
  fi
}

create_secret "meetingbot-database-url" "$DB_URL"
create_secret "meetingbot-deepgram-key" "$DEEPGRAM_API_KEY"

# Google auth state: placeholder — user must run pnpm setup:google-auth separately
if ! gcloud secrets describe "meetingbot-google-auth-state" \
    --project="$PROJECT_ID" &>/dev/null; then
  echo -n '{"cookies":[],"origins":[]}' | gcloud secrets create "meetingbot-google-auth-state" \
    --data-file=- --project="$PROJECT_ID" --quiet
  warn "Secret 'meetingbot-google-auth-state' created with EMPTY placeholder"
  warn "  → Run: pnpm setup:google-auth (then upload the JSON to replace this)"
fi

success "Secrets created"

# ─── Step 9: Build and push Docker images via Cloud Build ────────────────────
info "Building and pushing Docker images via Cloud Build (runs on GCP, no local Docker needed)..."

# Enable Cloud Build API
gcloud services enable cloudbuild.googleapis.com --quiet

# Grant Cloud Build permission to push to Artifact Registry
CLOUDBUILD_SA="$(gcloud projects describe "$PROJECT_ID" \
  --format='value(projectNumber)')@cloudbuild.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CLOUDBUILD_SA}" \
  --role="roles/artifactregistry.writer" \
  --quiet &>/dev/null

# Detect repo root (script lives in scripts/ subdir)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$REPO_ROOT"

info "  Submitting API image to Cloud Build (~2 min)..."
cat > /tmp/cloudbuild-api.yaml << EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '--platform', 'linux/amd64', '-f', 'apps/api/Dockerfile', '-t', '${REGISTRY}/api:latest', '.']
images: ['${REGISTRY}/api:latest']
EOF
gcloud builds submit . \
  --config=/tmp/cloudbuild-api.yaml \
  --project="$PROJECT_ID" \
  --quiet
success "  API image built and pushed"

info "  Submitting Worker image to Cloud Build (includes Chromium — ~8 min)..."
cat > /tmp/cloudbuild-worker.yaml << EOF
steps:
- name: 'gcr.io/cloud-builders/docker'
  args: ['build', '--platform', 'linux/amd64', '-f', 'apps/worker/Dockerfile', '-t', '${REGISTRY}/worker:latest', '.']
images: ['${REGISTRY}/worker:latest']
EOF
gcloud builds submit . \
  --config=/tmp/cloudbuild-worker.yaml \
  --project="$PROJECT_ID" \
  --quiet
success "  Worker image built and pushed"

# ─── Step 10: Prisma migration via Cloud SQL Auth Proxy ──────────────────────
info "Running Prisma database migration..."

# Install Cloud SQL Auth Proxy if not present
if ! command -v cloud-sql-proxy &>/dev/null; then
  info "  Downloading Cloud SQL Auth Proxy..."
  curl -fsSL \
    "https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.10.0/cloud-sql-proxy.linux.amd64" \
    -o /tmp/cloud-sql-proxy
  chmod +x /tmp/cloud-sql-proxy
  PROXY_BIN=/tmp/cloud-sql-proxy
else
  PROXY_BIN=cloud-sql-proxy
fi

# Start proxy in background on port 5433 (avoid conflict with local postgres)
"$PROXY_BIN" "$CLOUD_SQL_CONN" --port=5433 &
PROXY_PID=$!
sleep 3

# Run migration
MIGRATION_DB_URL="postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:5433/${DB_NAME}" \
  pnpm db:migrate

# Stop proxy
kill $PROXY_PID 2>/dev/null || true
success "Migration complete"

# ─── Step 11: Patch Cloud Run YAML files ─────────────────────────────────────
info "Patching Cloud Run YAML files with project/region values..."

# Work on copies so git working tree stays clean
API_YAML=$(mktemp /tmp/api-XXXX.yaml)
WORKER_YAML=$(mktemp /tmp/worker-XXXX.yaml)

sed \
  -e "s|PROJECT_ID|${PROJECT_ID}|g" \
  -e "s|REGION|${REGION}|g" \
  infra/cloudrun/api.yaml > "$API_YAML"

sed \
  -e "s|PROJECT_ID|${PROJECT_ID}|g" \
  -e "s|REGION|${REGION}|g" \
  infra/cloudrun/worker.yaml > "$WORKER_YAML"

# Also patch the Cloud SQL connection into worker yaml
# (add cloud-sql-instances annotation)
sed -i "/run.googleapis.com\/execution-environment/a\\        run.googleapis.com/cloudsql-instances: ${CLOUD_SQL_CONN}" "$WORKER_YAML"
sed -i "/run.googleapis.com\/cpu-throttling.*false/a\\        run.googleapis.com/cloudsql-instances: ${CLOUD_SQL_CONN}" "$API_YAML"

# ─── Step 12: Deploy Worker first (API needs its URL) ────────────────────────
info "Deploying Worker to Cloud Run..."
gcloud run services replace "$WORKER_YAML" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --quiet
success "Worker deployed"

# Grant Cloud Tasks invocation rights on Worker
gcloud run services add-iam-policy-binding meetingbot-worker \
  --region="$REGION" \
  --member="$WORKER_MEMBER" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID" \
  --quiet &>/dev/null

# Get Worker URL
WORKER_URL=$(gcloud run services describe meetingbot-worker \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")
success "Worker URL: $WORKER_URL"

# Patch WORKER_BASE_URL into api yaml
sed -i "s|https://meetingbot-worker-HASH-uc.a.run.app|${WORKER_URL}|g" "$API_YAML"

# ─── Step 13: Deploy API ──────────────────────────────────────────────────────
info "Deploying API to Cloud Run..."
gcloud run services replace "$API_YAML" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --quiet
success "API deployed"

# Get API URL
API_URL=$(gcloud run services describe meetingbot-api \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --format="value(status.url)")
success "API URL: $API_URL"

# ─── Step 14: Allow public unauthenticated access to API (optional) ───────────
gcloud run services add-iam-policy-binding meetingbot-api \
  --region="$REGION" \
  --member="allUsers" \
  --role="roles/run.invoker" \
  --project="$PROJECT_ID" \
  --quiet &>/dev/null

# Cleanup temp files
rm -f "$API_YAML" "$WORKER_YAML"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "============================================================"
echo -e "${GREEN}   Setup Complete!${NC}"
echo "============================================================"
echo ""
echo -e "  ${BLUE}API URL:${NC}        $API_URL"
echo -e "  ${BLUE}Worker URL:${NC}     $WORKER_URL"
echo -e "  ${BLUE}Cloud SQL:${NC}      $DB_INSTANCE ($REGION)"
echo -e "  ${BLUE}Tasks Queue:${NC}    $TASKS_QUEUE ($REGION)"
echo ""
echo -e "${YELLOW}REQUIRED — Before bots can join meetings:${NC}"
echo ""
echo "  1. Capture the bot Google account session:"
echo "     pnpm setup:google-auth"
echo ""
echo "  2. Upload the captured session to Secret Manager:"
echo "     gcloud secrets versions add meetingbot-google-auth-state \\"
echo "       --data-file=google-auth-state.json \\"
echo "       --project=$PROJECT_ID"
echo ""
echo "  3. Redeploy the Worker to pick up the new secret version:"
echo "     gcloud run services update meetingbot-worker \\"
echo "       --region=$REGION --project=$PROJECT_ID \\"
echo "       --update-secrets=GOOGLE_AUTH_STATE=meetingbot-google-auth-state:latest"
echo ""
echo -e "${GREEN}Test it:${NC}"
echo ""
echo "  curl -X POST $API_URL/meetings/schedule \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"meetingUrl\":\"https://meet.google.com/xxx-xxxx-xxx\",\"joinAt\":\"2026-05-08T16:00:00Z\"}'"
echo ""
echo -e "${YELLOW}DB credentials saved to: /tmp/meetingbot-db-creds.txt${NC}"
echo "  DATABASE_URL=$DB_URL" > /tmp/meetingbot-db-creds.txt
echo "  (Keep this safe — it won't be shown again)"
echo ""
