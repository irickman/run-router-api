#!/bin/bash
set -euo pipefail

PROJECT="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID in .env}"
ZONE="us-west1-b"
INSTANCE="gh-builder"
MACHINE_TYPE="n2-highmem-16"  # 16 CPUs, 128GB RAM (~$1.10/hr)
DISK_SIZE="200"               # GB, enough for PBF + graph-cache + SRTM
BUCKET="gs://${PROJECT}-gh-graph"

echo "=== GraphHopper Graph Builder (GCP) ==="
echo "Project:  $PROJECT"
echo "Machine:  $MACHINE_TYPE (16 CPUs, 128GB RAM)"
echo "Zone:     $ZONE"
echo ""

gcloud config set project "$PROJECT" 2>/dev/null

# --- Step 1: Create GCS bucket for transferring the graph ---
echo "[1/6] Creating GCS bucket (if needed)..."
gsutil ls "$BUCKET" 2>/dev/null || gsutil mb -l us-west1 "$BUCKET"

# --- Step 2: Create VM ---
echo "[2/6] Creating VM '$INSTANCE'..."
gcloud compute instances create "$INSTANCE" \
  --project="$PROJECT" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --boot-disk-size="${DISK_SIZE}GB" \
  --boot-disk-type=pd-ssd \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --scopes=storage-rw \
  --metadata=startup-script='#!/bin/bash
    apt-get update -qq
    apt-get install -y -qq docker.io
    systemctl start docker
    touch /tmp/docker-ready
  '

echo "Waiting for VM to be ready..."
sleep 30

# Wait for Docker to be installed
for i in $(seq 1 20); do
  if gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="test -f /tmp/docker-ready" 2>/dev/null; then
    echo "VM ready with Docker."
    break
  fi
  echo "  waiting... ($i)"
  sleep 15
done

# --- Step 3: Copy GraphHopper config to VM ---
echo "[3/6] Uploading GraphHopper files to VM..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

gcloud compute scp --zone="$ZONE" --recurse \
  "$SCRIPT_DIR/Dockerfile" \
  "$SCRIPT_DIR/config.yml" \
  "$SCRIPT_DIR/start.sh" \
  "$SCRIPT_DIR/custom-models" \
  "$INSTANCE":~/graphhopper/

# --- Step 4: Build and run on VM ---
echo "[4/6] Building Docker image and starting import on VM..."
echo "       This will take 1-3 hours. You can monitor with:"
echo "       gcloud compute ssh $INSTANCE --zone=$ZONE --command='docker logs -f gh-builder'"
echo ""

gcloud compute ssh "$INSTANCE" --zone="$ZONE" --command="
  cd ~/graphhopper
  sudo docker build -t gh-build .
  sudo docker run -d --name gh-builder \
    -v /tmp/gh-data:/data \
    -e JAVA_OPTS='-Xmx100g -Xms4g' \
    gh-build
  echo 'Import started. Container running as gh-builder.'
"

echo ""
echo "=== Import is running on GCP VM ==="
echo ""
echo "Monitor progress:"
echo "  gcloud compute ssh $INSTANCE --zone=$ZONE --command='sudo docker logs --tail 30 gh-builder'"
echo ""
echo "When import finishes (you'll see 'Started' in logs), run:"
echo "  bash graphhopper/upload-graph-gcp.sh"
echo ""
echo "To check if it's done:"
echo "  gcloud compute ssh $INSTANCE --zone=$ZONE --command='sudo docker logs --tail 5 gh-builder 2>&1 | grep -i started'"
