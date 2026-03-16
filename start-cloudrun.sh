#!/bin/bash
echo "Deploying stezio-web to Google Cloud Run..."

export PROJECT_ID="stezio"
gcloud config set project $PROJECT_ID

export IMAGE_NAME="gcr.io/$PROJECT_ID/stezio-backend"

# Build phase using Google Cloud Build
gcloud builds submit --tag $IMAGE_NAME

# Deploy
gcloud run deploy stezio-websocket-server \
  --image $IMAGE_NAME \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT_ID=stezio,GCP_LOCATION=us-central1,key=YOUR_VERTEX_AI_KEY_HERE"
