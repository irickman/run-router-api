#!/bin/bash
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID in .env}"
BUCKET="gs://${PROJECT}-gh-graph"
FLY_APP="route-runner-graphhopper"

echo "=== Download graph-cache from GCS to Fly volume ==="

# Generate a signed URL so the Fly VM can download without gcloud
echo "[1/3] Generating signed download URL..."
SIGNED_URL=$(gsutil signurl -d 2h -u "$BUCKET/graph-cache.tar.gz" 2>&1 | grep -oP 'https://[^\s]+' | head -1)

if [ -z "$SIGNED_URL" ]; then
  echo "Signed URL failed. Trying public URL approach..."
  gsutil acl ch -u AllUsers:R "$BUCKET/graph-cache.tar.gz"
  SIGNED_URL="https://storage.googleapis.com/${PROJECT}-gh-graph/graph-cache.tar.gz"
  echo "Using public URL (remember to revoke after): $SIGNED_URL"
fi

# Download and extract on Fly VM
echo "[2/3] Downloading graph-cache to Fly VM..."
fly ssh console -a "$FLY_APP" -C "sh -c '
  cd /data
  rm -rf graph-cache
  echo \"Downloading graph-cache...\"
  wget -q -O /tmp/graph-cache.tar.gz \"$SIGNED_URL\"
  echo \"Extracting...\"
  tar xzf /tmp/graph-cache.tar.gz
  rm /tmp/graph-cache.tar.gz
  echo \"Done. Contents:\"
  ls -lh /data/graph-cache/
'"

echo "[3/3] Graph loaded on Fly volume."
echo ""
echo "Now restart the Fly app to load the pre-built graph:"
echo "  fly machine restart -a $FLY_APP"
echo ""
echo "Cleanup:"
echo "  gcloud compute instances delete gh-builder --zone=us-west1-b --project=$PROJECT"
echo "  gsutil rm -r $BUCKET"
