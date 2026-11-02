#!/usr/bin/env bash
# Deploy Limn RGM (agentic release) to Google Cloud as its own service, limn-rgm-v2.
# Run from the repo root, in Cloud Shell or on a Mac with the gcloud CLI signed in.
# Works with macOS's built-in bash 3.2. Safe to re-run: later runs rebuild and redeploy.
#
# Sign-in uses the same named logins as the original tester page (secret limn-rgm-users,
# managed with ./users.sh). The original service limn-rgm is not touched.
#
# What it creates, all named limn-rgm-v2:
#   - service account limn-rgm-v2, storage bucket <project>-limn-rgm-v2
#   - Cloud Run service limn-rgm-v2 (logins required) and image in the limn-rgm Artifact Registry repo
#   - Cloud Run job limn-rgm-v2-agents, started by Cloud Scheduler at 6:10 am Central on weekdays
#   - optional secret limn-rgm-anthropic-key for the Claude API
set -euo pipefail

command -v gcloud >/dev/null || { echo "gcloud is not installed. Use Cloud Shell, or install the Google Cloud CLI and run: gcloud auth login"; exit 1; }
gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q . || { echo "gcloud is not signed in. Run: gcloud auth login"; exit 1; }

PROJECT="${PROJECT:-project-41b9f044-cbc3-4d0e-bec}"
REGION="${REGION:-us-central1}"
OWNER="${OWNER:-muneet}"                  # first login, created only if the logins secret does not exist yet

NAME="limn-rgm-v2"
REPO="limn-rgm"                           # shared image repository with the original page
SA="${NAME}@${PROJECT}.iam.gserviceaccount.com"
BUCKET="${PROJECT}-${NAME}"
USERS_SECRET="limn-rgm-users"
KEY_SECRET="limn-rgm-anthropic-key"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/app:${TAG}"
JOB="${NAME}-agents"

gcloud config set project "$PROJECT" >/dev/null

echo "--- 1/7 APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com storage.googleapis.com

echo "--- 2/7 Service account and bucket"
if ! gcloud iam service-accounts describe "$SA" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$NAME" --display-name "Limn RGM v2"
  sleep 5
fi
gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access 2>/dev/null || true
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$SA" --role roles/storage.objectUser --quiet >/dev/null

echo "--- 3/7 Logins (shared with the original tester page)"
OWNER_PW=""
if ! gcloud secrets describe "$USERS_SECRET" >/dev/null 2>&1; then
  OWNER_PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-16)"
  TMPF="$(mktemp)"
  printf '%s:%s\n' "$OWNER" "$(openssl passwd -apr1 "$OWNER_PW")" > "$TMPF"
  gcloud secrets create "$USERS_SECRET" --replication-policy automatic --labels app=limn-rgm --data-file "$TMPF" >/dev/null
  rm -f "$TMPF"
fi
gcloud secrets add-iam-policy-binding "$USERS_SECRET" --member "serviceAccount:$SA" \
  --role roles/secretmanager.secretAccessor --quiet >/dev/null
echo "Using logins from secret $USERS_SECRET."

echo "--- 4/7 Claude API key (optional: without it the agents use template text and the Explainer is off)"
KEY_SPEC=""
if ! gcloud secrets describe "$KEY_SECRET" >/dev/null 2>&1; then
  printf "Paste an Anthropic API key for Limn RGM and press Enter (or just press Enter to skip): "
  stty -echo 2>/dev/null || true; read -r KEY || true; stty echo 2>/dev/null || true; echo
  if [ -n "${KEY:-}" ]; then
    gcloud secrets create "$KEY_SECRET" --replication-policy automatic --labels app=limn-rgm >/dev/null
    printf '%s' "$KEY" | gcloud secrets versions add "$KEY_SECRET" --data-file=- >/dev/null
  fi
  unset KEY
fi
if gcloud secrets versions list "$KEY_SECRET" --filter="state=enabled" --format='value(name)' 2>/dev/null | grep -q .; then
  gcloud secrets add-iam-policy-binding "$KEY_SECRET" --member "serviceAccount:$SA" \
    --role roles/secretmanager.secretAccessor --quiet >/dev/null
  KEY_SPEC="ANTHROPIC_API_KEY=${KEY_SECRET}:latest"
  echo "Using secret $KEY_SECRET."
else
  echo "No key stored; deploying in template mode. Re-run this script later to add one."
fi

echo "--- 5/7 Build image $IMAGE"
gcloud artifacts repositories create "$REPO" --repository-format docker --location "$REGION" 2>/dev/null || true
gcloud builds submit --tag "$IMAGE" .

ENV="BUCKET=$BUCKET,TZ=America/Chicago"

echo "--- 6/7 Web service $NAME (named logins required)"
SECRETS="/etc/limn-users/htpasswd=${USERS_SECRET}:latest"
if [ -n "$KEY_SPEC" ]; then SECRETS="${SECRETS},${KEY_SPEC}"; fi
gcloud run deploy "$NAME" \
  --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --allow-unauthenticated \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 3 --timeout 300 \
  --set-env-vars "$ENV,AUTH_FILE=/etc/limn-users/htpasswd" \
  --set-secrets "$SECRETS" \
  --labels app=limn-rgm,stage=agentic-release

echo "--- 7/7 Scheduled agent job: 6:10 am Central, weekdays"
gcloud run jobs deploy "$JOB" \
  --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --command node --args src/job.js \
  --task-timeout 15m --max-retries 0 --memory 1Gi --cpu 1 \
  --set-env-vars "$ENV,RUN_TRIGGER=scheduled" ${KEY_SPEC:+--set-secrets "$KEY_SPEC"} \
  --labels app=limn-rgm,stage=agentic-release
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" \
  --member "serviceAccount:$SA" --role roles/run.invoker --quiet >/dev/null
gcloud scheduler jobs create http "${JOB}-trigger" \
  --location "$REGION" --schedule "10 6 * * 1-5" --time-zone "America/Chicago" \
  --uri "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run" \
  --http-method POST --oauth-service-account-email "$SA" 2>/dev/null \
  || echo "Scheduler trigger already exists, leaving it"

echo "First agent run..."
gcloud run jobs execute "$JOB" --region "$REGION" --wait

URL=$(gcloud run services describe "$NAME" --region "$REGION" --format 'value(status.url)')
echo
echo "Limn RGM (agentic release): $URL"
echo "Sign in with the same username and password as the original tester page."
if [ -n "$OWNER_PW" ]; then
  printf 'New login created (password shown only once):\n  Username: %s\n  Password: %s\n' "$OWNER" "$OWNER_PW"
fi
echo "Manage access for both pages with ./users.sh (list, add, off, on, reset, remove)."
