#!/usr/bin/env bash
# Deploy Limn RGM to Google Cloud. Run from the repo root, in Cloud Shell or on a Mac with the
# gcloud CLI signed in (gcloud auth login). Works with macOS's built-in bash 3.2. Safe to re-run:
# the first run sets everything up; later runs rebuild and redeploy the current code.
#
# What it creates, all named limn-rgm so it stays separate from the momentum project:
#   - service account limn-rgm, storage bucket <project>-limn-rgm, secret limn-rgm-anthropic-key
#   - Artifact Registry repo limn-rgm and the app image
#   - Cloud Run service limn-rgm behind Identity-Aware Proxy (only TESTERS can open it)
#   - Cloud Run job limn-rgm-agents, started by Cloud Scheduler at 6:10 am Central on weekdays
set -euo pipefail

command -v gcloud >/dev/null || { echo "gcloud is not installed. Use Cloud Shell, or install the Google Cloud CLI and run: gcloud auth login"; exit 1; }
gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q . || { echo "gcloud is not signed in. Run: gcloud auth login"; exit 1; }
gcloud components list --filter="id=beta" --format="value(state.name)" 2>/dev/null | grep -qi installed || echo "Note: this script uses gcloud beta commands; if prompted, allow installing the beta component."

PROJECT="${PROJECT:-project-41b9f044-cbc3-4d0e-bec}"
REGION="${REGION:-us-central1}"
TESTERS="${TESTERS:-muneetb@gmail.com}"     # comma-separated Google accounts allowed in

NAME="limn-rgm"
SA="${NAME}@${PROJECT}.iam.gserviceaccount.com"
BUCKET="${PROJECT}-${NAME}"
SECRET="${NAME}-anthropic-key"
TAG="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${NAME}/app:${TAG}"
JOB="${NAME}-agents"

gcloud config set project "$PROJECT" >/dev/null
PN=$(gcloud projects describe "$PROJECT" --format='value(projectNumber)')

echo "--- 1/8 APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com secretmanager.googleapis.com iap.googleapis.com storage.googleapis.com

echo "--- 2/8 Service account and bucket"
gcloud iam service-accounts create "$NAME" --display-name "Limn RGM" 2>/dev/null || true
gcloud storage buckets create "gs://$BUCKET" --location "$REGION" --uniform-bucket-level-access 2>/dev/null || true
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$SA" --role roles/storage.objectUser --quiet >/dev/null

echo "--- 3/8 Claude API key (optional: without it the agents run with template text and the Explainer is off)"
SECRET_SPEC=""
if ! gcloud secrets describe "$SECRET" >/dev/null 2>&1; then
  read -rsp "Paste an Anthropic API key for Limn RGM and press Enter (or just press Enter to skip): " KEY; echo
  if [ -n "${KEY}" ]; then
    gcloud secrets create "$SECRET" --replication-policy automatic >/dev/null
    printf '%s' "$KEY" | gcloud secrets versions add "$SECRET" --data-file=- >/dev/null
  fi
  unset KEY
fi
if gcloud secrets versions list "$SECRET" --filter="state=enabled" --format='value(name)' 2>/dev/null | grep -q .; then
  gcloud secrets add-iam-policy-binding "$SECRET" --member "serviceAccount:$SA" \
    --role roles/secretmanager.secretAccessor --quiet >/dev/null
  SECRET_SPEC="ANTHROPIC_API_KEY=${SECRET}:latest"
  echo "Using secret $SECRET."
else
  echo "No key stored; deploying in template mode. Re-run this script later to add one."
fi

echo "--- 4/8 Build image $IMAGE"
gcloud artifacts repositories create "$NAME" --repository-format docker --location "$REGION" 2>/dev/null || true
gcloud builds submit --tag "$IMAGE" .

ENV="BUCKET=$BUCKET,TZ=America/Chicago"

echo "--- 5/8 Web service behind Identity-Aware Proxy"
gcloud beta run deploy "$NAME" \
  --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --no-allow-unauthenticated --iap \
  --memory 1Gi --cpu 1 --min-instances 0 --max-instances 3 --timeout 300 \
  --set-env-vars "$ENV" ${SECRET_SPEC:+--set-secrets "$SECRET_SPEC"}

echo "--- 6/8 Let IAP call the service, and let testers through IAP"
gcloud beta services identity create --service=iap.googleapis.com --project="$PROJECT" >/dev/null 2>&1 || true
gcloud run services add-iam-policy-binding "$NAME" --region "$REGION" \
  --member "serviceAccount:service-${PN}@gcp-sa-iap.iam.gserviceaccount.com" --role roles/run.invoker --quiet >/dev/null
IFS=',' read -ra PEOPLE <<< "$TESTERS"
for p in "${PEOPLE[@]}"; do
  gcloud beta iap web add-iam-policy-binding --resource-type=cloud-run --service="$NAME" --region="$REGION" \
    --member "user:${p// /}" --role roles/iap.httpsResourceAccessor --quiet >/dev/null
  echo "Tester allowed: ${p// /}"
done

echo "--- 7/8 Scheduled agent job: 6:10 am Central, weekdays"
gcloud run jobs deploy "$JOB" \
  --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --command node --args src/job.js \
  --task-timeout 15m --max-retries 0 --memory 1Gi --cpu 1 \
  --set-env-vars "$ENV,RUN_TRIGGER=scheduled" ${SECRET_SPEC:+--set-secrets "$SECRET_SPEC"}
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" \
  --member "serviceAccount:$SA" --role roles/run.invoker --quiet >/dev/null
gcloud scheduler jobs create http "${JOB}-trigger" \
  --location "$REGION" --schedule "10 6 * * 1-5" --time-zone "America/Chicago" \
  --uri "https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/jobs/${JOB}:run" \
  --http-method POST --oauth-service-account-email "$SA" 2>/dev/null \
  || echo "Scheduler trigger already exists, leaving it"

echo "--- 8/8 First agent run"
gcloud run jobs execute "$JOB" --region "$REGION" --wait

URL=$(gcloud run services describe "$NAME" --region "$REGION" --format 'value(status.url)')
echo
echo "Limn RGM: $URL"
echo "Sign in with a tester account. The first load after a new deploy can take a minute while IAP propagates."
echo "Add testers later with:  TESTERS=\"a@x.com,b@y.com\" ./deploy.sh"
