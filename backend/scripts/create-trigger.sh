#!/usr/bin/env bash
# Create a Cloud Build trigger that deploys the backend on every push to main.
# Requires: repo connected to Cloud Build (GitHub 1st-gen or 2nd-gen).
#
# Usage (from repo root or backend/):
#   export REPO_OWNER=your-github-username
#   export REPO_NAME=legalens
#   ./backend/scripts/create-trigger.sh
#
# Or with 2nd-gen connection (see Cloud Console → Cloud Build → Repositories):
#   export USE_2ND_GEN=1
#   export REPOSITORY="projects/PROJECT_ID/locations/REGION/connections/CONNECTION/repositories/REPO"
#   ./backend/scripts/create-trigger.sh

set -e

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project)}"
REGION="${REGION:-us-central1}"
TRIGGER_NAME="${TRIGGER_NAME:-legalens-api-deploy}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "ERROR: PROJECT_ID not set. Run: gcloud config set project YOUR_PROJECT_ID"
  exit 1
fi

# Substitutions so the trigger builds from repo root (backend/ as context).
# Omit _TAG so the build uses default "latest" (avoids INVALID_ARGUMENT with some gcloud/API versions).
# To use commit SHA as image tag, add in Console: Variable _TAG, Value SHORT_SHA (or pick from built-in).
SUBSTS="_DOCKERFILE=backend/Dockerfile,_CONTEXT=backend"

if [[ -n "$USE_2ND_GEN" && -n "$REPOSITORY" ]]; then
  echo "Creating trigger (2nd-gen) $TRIGGER_NAME in $PROJECT_ID..."
  gcloud builds triggers create github \
    --name="$TRIGGER_NAME" \
    --repository="$REPOSITORY" \
    --branch-pattern="^main$" \
    --build-config=backend/cloudbuild.yaml \
    --region="$REGION" \
    --substitutions="$SUBSTS"
else
  if [[ -z "$REPO_OWNER" || -z "$REPO_NAME" ]]; then
    echo "Usage (1st-gen GitHub): REPO_OWNER=owner REPO_NAME=repo $0"
    echo "Example: REPO_OWNER=SMOO1 REPO_NAME=LegaLens $0"
    exit 1
  fi
  echo "Creating trigger (1st-gen) $TRIGGER_NAME for $REPO_OWNER/$REPO_NAME..."
  echo "Ensure the repo is connected first: Cloud Build → Triggers → Connect repository (GitHub)."
  if ! gcloud builds triggers create github \
    --name="$TRIGGER_NAME" \
    --repo-owner="$REPO_OWNER" \
    --repo-name="$REPO_NAME" \
    --branch-pattern="^main$" \
    --build-config=backend/cloudbuild.yaml \
    --region="$REGION" \
    --substitutions="$SUBSTS"; then
    echo ""
    echo "If you see INVALID_ARGUMENT: create the trigger in the Console instead:"
    echo "  1. Open https://console.cloud.google.com/cloud-build/triggers?project=$PROJECT_ID"
    echo "  2. Create trigger → Push to a branch → pick repo $REPO_OWNER/$REPO_NAME, branch ^main$"
    echo "  3. Configuration: Cloud Build config file → backend/cloudbuild.yaml"
    echo "  4. Add substitution variables: _DOCKERFILE=backend/Dockerfile, _CONTEXT=backend"
    exit 1
  fi
fi

echo "Done. Trigger will run on every push to main. View at: https://console.cloud.google.com/cloud-build/triggers?project=$PROJECT_ID"
