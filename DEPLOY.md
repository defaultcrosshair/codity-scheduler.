# Live Deployment Guide: Firebase Hosting + Google Cloud Run

This guide outlines the steps to deploy the Distributed Job Scheduler live to Google Cloud. The static frontend will be served by **Firebase Hosting**, and the Express/WebSocket backend will run as a container on **Google Cloud Run** connected to a hosted **PostgreSQL** database.

---

## 1. Prerequisites & Credentials

Before starting, ensure you have:
1. **Google Cloud Account** & **Firebase Project** created in the console.
2. **Firebase CLI** installed:
   ```bash
   npm install -g firebase-tools
   ```
3. **Google Cloud SDK (gcloud CLI)** installed on your machine (needed to compile Docker containers via Cloud Build).
4. **Billing Enabled**: Make sure billing is enabled on your Firebase/GCP project (Cloud Run requires it, though it fits entirely inside the free tier).

---

## 2. Step 1: Create a Hosted PostgreSQL Database

Since Cloud Run containers are stateless and recycle periodically, we must use a cloud database instead of a local SQLite file.

1. Create a free PostgreSQL instance on **[Neon.tech](https://neon.tech)** or **[Supabase.com](https://supabase.com)**.
2. Copy the Connection String. It should look like this:
   `postgresql://[USER]:[PASSWORD]@[HOST]/neondb?sslmode=require`
3. Save this connection string as your `DATABASE_URL` environment variable.

---

## 3. Step 2: Authenticate CLIs

Log in to Firebase and Google Cloud on your machine:
```bash
# Log in to Firebase CLI
firebase login

# Log in to Google Cloud SDK
gcloud auth login
gcloud auth configure-docker
```

Link your command line shell to your project ID (replace `antigravity-scheduler` with your actual Firebase Project ID):
```bash
# Target Firebase project
firebase use default --add antigravity-scheduler

# Set Google Cloud active project
gcloud config set project antigravity-scheduler
```

---

## 4. Step 3: Deploy Backend to Google Cloud Run

We use Google Cloud Build to compile our Docker container in the cloud (no local Docker engine required!) and deploy it.

1. **Submit the Docker Container**:
   Run this command in the root workspace directory to build the image:
   ```bash
   gcloud builds submit --tag gcr.io/antigravity-scheduler/backend
   ```

2. **Deploy to Cloud Run**:
   Deploy the compiled container to a managed Cloud Run instance. Ensure to pass your Postgres connection string under the `DATABASE_URL` environment variable flag:
   ```bash
   gcloud run deploy antigravity-scheduler \
     --image gcr.io/antigravity-scheduler/backend \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars="DATABASE_URL=postgresql://[USER]:[PASSWORD]@[HOST]/neondb?sslmode=require,NODE_ENV=production"
   ```
3. Copy the **Service URL** generated at the end of the deployment (e.g. `https://antigravity-scheduler-xxxxxx.a.run.app`).

---

## 5. Step 4: Deploy Frontend to Firebase Hosting

Now, compile the React dashboard and publish the assets.

1. **Compile static assets locally**:
   ```bash
   cd frontend
   npm run build
   ```

2. **Deploy Firebase Hosting**:
   Deploy the assets from the root workspace directory:
   ```bash
   cd ..
   firebase deploy --only hosting
   ```

3. Open the **Hosting URL** returned by Firebase (e.g., `https://antigravity-scheduler.web.app`) to access your live distributed job scheduler!

---

## 6. Real-time WebSocket Notes

Firebase Hosting integrates natively with Cloud Run via the rewrites configuration in our `firebase.json` file. Because Cloud Run supports WebSocket connections, your dashboard’s real-time worker metrics and execution logs will connect automatically without requiring CORS setup!
