# Deploy LegaLens API to Google Cloud Run

## One-time setup

1. **Create a GCP project** (or use an existing one) and set it:
   ```bash
   export PROJECT_ID=your-gcp-project-id
   gcloud config set project $PROJECT_ID
   ```

2. **Enable APIs**:
   ```bash
   gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
   ```

3. **Create an Artifact Registry repository** (for Docker images):
   ```bash
   gcloud artifacts repositories create legalens \
     --repository-format=docker \
     --location=us-central1 \
     --description="LegaLens API images"
   ```

4. **Grant Cloud Build permission to deploy to Cloud Run**:
   ```bash
   PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
     --role="roles/run.admin"
   gcloud iam service-accounts add-iam-policy-binding \
     ${PROJECT_NUMBER}-compute@developer.gserviceaccount.com \
     --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
     --role="roles/iam.serviceAccountUser" \
     --project=$PROJECT_ID
   ```

5. **Connect your GitHub repo** (if not already):
   - In [Cloud Build → Triggers](https://console.cloud.google.com/cloud-build/triggers), click **Connect repository**.
   - Pick **GitHub (1st gen)** or **GitHub (2nd gen)** and complete the connection for the repo that contains this backend.

## Deploy (manual)

From the **backend** directory (override defaults so Dockerfile and context are local):

```bash
cd backend
gcloud builds submit --config=cloudbuild.yaml . --substitutions="_DOCKERFILE=Dockerfile,_CONTEXT=."
```

After the build finishes, Cloud Run will show the service URL (e.g. `https://legalens-api-xxxxx-uc.a.run.app`).

## Deploy on every push (trigger)

Create a trigger so that every push to `main` builds and deploys the backend.

**Option A – Script (from repo root):**

```bash
export REPO_OWNER=your-github-username   # e.g. derekwork36
export REPO_NAME=legalens                # your repo name
./backend/scripts/create-trigger.sh
```

**Option B – Console:**

1. Go to [Cloud Build → Triggers](https://console.cloud.google.com/cloud-build/triggers) → **Create trigger**.
2. **Name**: e.g. `legalens-api-deploy`.
3. **Event**: Push to a branch.
4. **Source**: your connected GitHub repo; **Branch**: `^main$`.
5. **Configuration**: **Cloud Build configuration file (yaml or json)** → **Repository**.
6. **Cloud Build configuration file location**: `backend/cloudbuild.yaml`.
7. **Substitution variables** (click **Add variable**):
   - `_TAG` = `SHORT_SHA`
   - `_DOCKERFILE` = `backend/Dockerfile`
   - `_CONTEXT` = `backend`
8. Create and save. Future pushes to `main` will run the build and deploy.

**Option C – gcloud (1st-gen GitHub):**

```bash
gcloud builds triggers create github \
  --name=legalens-api-deploy \
  --repo-owner=YOUR_GITHUB_USERNAME \
  --repo-name=legalens \
  --branch-pattern="^main$" \
  --build-config=backend/cloudbuild.yaml \
  --substitutions="_TAG=\$SHORT_SHA,_DOCKERFILE=backend/Dockerfile,_CONTEXT=backend"
```

Replace `YOUR_GITHUB_USERNAME` with your GitHub org or username.

## Environment variables on Cloud Run

In **Cloud Run → your service → Edit & deploy new revision → Variables & secrets**, add every variable from `backend/.env-example` (use your real secrets). In particular:

- **CORS_ORIGINS**: Your frontend origin(s), e.g. `https://your-app.web.app` or `https://your-domain.com`
- **VOICE_TTS_URL**, **VOICE_TURN_URL**, **LEGALENS_QA_BASE_URL**: Your Cloud Run service URL + path, e.g. `https://legalens-api-xxxxx-uc.a.run.app/api/...`

## Frontend

Point the frontend at your API by setting **VITE_API_URL** to the Cloud Run URL with `/api`, e.g.:

`https://legalens-api-xxxxx-uc.a.run.app/api`

(In the frontend project: `.env` or build env; see `frontend/.env-example`.)
