#!/bin/bash
set -euo pipefail
PBF_FILE="/data/washington-latest.osm.pbf"
GRAPH_DIR="/data/graph-cache"

if [ ! -f "$PBF_FILE" ]; then
  echo "Downloading OSM PBF data..."
  wget -O "$PBF_FILE" https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf
fi

java $JAVA_OPTS \
  -Ddw.graphhopper.datareader.file="$PBF_FILE" \
  -Ddw.graphhopper.graph.location="$GRAPH_DIR" \
  -jar /graphhopper/*.jar server /graphhopper/config.yml
