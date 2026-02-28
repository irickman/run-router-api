#!/bin/bash
set -euo pipefail
PBF_FILE="/data/us-latest.osm.pbf"
GRAPH_DIR="/data/graph-cache"
SRTM_CACHE="/data/srtm-cache/North_America"

if [ ! -f "$PBF_FILE" ]; then
  echo "Downloading US OSM PBF data (~11 GB, this will take a while)..."
  wget -O "$PBF_FILE" https://download.geofabrik.de/north-america/us-latest.osm.pbf
fi

VERSION_FILE="$GRAPH_DIR/.graph_version"
GCS_GRAPH_URL="${GCS_GRAPH_URL:-https://storage.googleapis.com/${GCP_PROJECT_ID}-gh-graph/graph-cache.tar.gz}"

if [ -d "$GRAPH_DIR" ] && [ -f "$GRAPH_DIR/location_index" ] && [ -f "$GRAPH_DIR/nodes" ] && ls "$GRAPH_DIR"/landmarks_* 1>/dev/null 2>&1; then
  echo "Complete graph cache found — skipping import, loading directly."
  echo "$GRAPH_VERSION" > "$VERSION_FILE"
else
  echo "Graph cache missing or incomplete. Downloading pre-built graph from GCS..."
  rm -rf "$GRAPH_DIR"
  wget -O /data/graph-cache.tar.gz "$GCS_GRAPH_URL"
  echo "Download complete. Extracting..."
  tar xzf /data/graph-cache.tar.gz -C /data/
  rm /data/graph-cache.tar.gz
  echo "$GRAPH_VERSION" > "$GRAPH_DIR/.graph_version"
  echo "Graph cache restored from GCS."
fi

if [ ! -d "$SRTM_CACHE" ] || [ "$(ls "$SRTM_CACHE"/*.hgt.zip 2>/dev/null | wc -l)" -lt 1000 ]; then
  mkdir -p "$SRTM_CACHE"
  echo "Downloading SRTM elevation tiles for the US (~1.5 GB)..."
  for lat in $(seq 24 49); do
    for lon in $(seq 66 125); do
      echo "https://srtm.kurviger.de/SRTM3/North_America/N${lat}W$(printf '%03d' $lon).hgt.zip"
    done
  done | xargs -P 10 -I {} wget -q -nc -P "$SRTM_CACHE" {} || true
  echo "SRTM download complete."
fi

java $JAVA_OPTS \
  -Ddw.graphhopper.datareader.file="$PBF_FILE" \
  -Ddw.graphhopper.graph.location="$GRAPH_DIR" \
  -Ddw.server.application_connectors[0].port=8989 \
  -jar /graphhopper/graphhopper-web-11.0-SNAPSHOT.jar server /graphhopper/config.yml
