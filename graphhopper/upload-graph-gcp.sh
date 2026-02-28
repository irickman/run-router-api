#!/bin/bash
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID in .env}"
ZONE="us-west1-b"
INSTANCE="gh-builder"
BUCKET="gs://${PROJECT}-gh-graph"

echo "=== Upload graph-cache from GCP to GCS bucket ==="

gcloud config set project "$PROJECT" 2>/dev/null

# Verify import is complete (landmarks files exist for both profiles)
echo "[1/4] Checking import completed..."
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="
  ls -lh /tmp/gh-data/graph-cache/landmarks_trail /tmp/gh-data/graph-cache/landmarks_foot 2>/dev/null || {
    echo 'ERROR: Import not complete yet — landmark files missing.'
    echo 'Current graph-cache contents:'
    ls -lh /tmp/gh-data/graph-cache/
    exit 1
  }
  echo 'Import complete. Landmark files found.'
"

# Tar up graph-cache on the VM
echo "[2/4] Compressing graph-cache on VM..."
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="
  cd /tmp/gh-data
  tar czf /tmp/graph-cache.tar.gz graph-cache/
  ls -lh /tmp/graph-cache.tar.gz
"

# Upload to GCS
echo "[3/4] Uploading to GCS bucket..."
gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="
  gsutil -m cp /tmp/graph-cache.tar.gz $BUCKET/graph-cache.tar.gz
"

echo "[4/4] Upload complete."
echo ""
echo "Graph is at: $BUCKET/graph-cache.tar.gz"
echo ""
echo "Next steps:"
echo "  1. Download to Fly:  bash graphhopper/download-graph-to-fly.sh"
echo "  2. Delete GCP VM:    gcloud compute instances delete $INSTANCE --zone=$ZONE --project=$PROJECT"
