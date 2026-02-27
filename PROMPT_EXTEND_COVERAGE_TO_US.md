# Agent Prompt: Extend Route Runner Geographic Coverage to the Entire United States

## Context

Route Runner is a natural language route generation tool for runners. The backend uses **GraphHopper** for routing, which builds its graph from OpenStreetMap (OSM) data. Currently, the app is restricted to **Washington state** because the GraphHopper service loads only the Washington OSM extract.

**Your task:** Extend routing coverage to the entire United States.

---

## Current Implementation

### 1. Data source (Washington-only)

**File: `graphhopper/config.yml`**
- Line 2: `datareader.file: /data/washington-latest.osm.pbf`

**File: `graphhopper/start.sh`**
- Uses `washington-latest.osm.pbf` from Geofabrik
- Download URL: `https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf` (~333 MB)
- The script downloads on first run if the file doesn't exist, then starts GraphHopper (which imports the PBF and builds the routing graph)

### 2. Infrastructure

**File: `graphhopper/fly.toml`**
- Fly volume: `graphhopper_data`, `initial_size = "10gb"`
- VM: `performance-2x`, `memory = "4gb"`
- `JAVA_OPTS = "-Xmx3g -Xms1g"`

### 3. Backend behavior

The main API (`src/routes/route.ts`) sends `{ lat, lng }` to GraphHopper for routing. There are no explicit geographic checks in the API layer—the limitation is purely in the GraphHopper dataset. If a user requests a route outside Washington, GraphHopper simply has no roads/trails to route on.

---

## What You Need to Do

### Option A: Full US extract (single dataset)

- **Data source:** `https://download.geofabrik.de/north-america/us-latest.osm.pbf` (~10.9 GB compressed)
- **Considerations:**
  - The PBF is ~11 GB; the GraphHopper graph after import is typically 2–3x the PBF size (~25–35 GB)
  - Current 10 GB Fly volume is insufficient; increase to at least **50 GB** (prefer 60–80 GB to be safe)
  - Import time will be much longer (hours vs. minutes)
  - May need more memory (`JAVA_OPTS`) and a larger VM for import
  - Fly.io volumes can be expanded; see Fly docs for volume resize

**Files to modify:**
- `graphhopper/config.yml` — change `datareader.file` to `/data/us-latest.osm.pbf`
- `graphhopper/start.sh` — change `PBF_FILE` and `wget` URL to the US extract
- `graphhopper/fly.toml` — increase `initial_size` for the `graphhopper_data` volume to 50 GB or more; consider increasing VM memory and `JAVA_OPTS` for import

**Note:** If the Fly volume already exists with Washington data, you may need to:
1. Create a new volume (or destroy and recreate) with the larger size
2. Re-download and re-import—this is a one-time migration

### Option B: Multiple state extracts (modular / regional)

- **Approach:** Instead of one 11 GB US file, support multiple state-level extracts that can be added over time (e.g., Washington + Oregon + California).
- **Data source:** Geofabrik provides per-state extracts, e.g.:
  - `https://download.geofabrik.de/north-america/us/california-latest.osm.pbf` (~1.2 GB)
  - `https://download.geofabrik.de/north-america/us/oregon-latest.osm.pbf` (~234 MB)
  - etc. (see https://download.geofabrik.de/north-america/us.html)
- **Consideration:** GraphHopper typically expects a single PBF. To use multiple regions you would need to either:
  - Merge PBFs into one (e.g., with `osmium merge`) before import, or
  - Run separate GraphHopper instances per region and add routing logic to choose the right one (more complex).
- For “entire US” scope, Option A is simpler unless you have strict constraints on storage or rollout.

---

## Implementation Checklist

1. **Update `graphhopper/start.sh`:**
   - Set `PBF_FILE="/data/us-latest.osm.pbf"`
   - Set download URL to `https://download.geofabrik.de/north-america/us-latest.osm.pbf`

2. **Update `graphhopper/config.yml`:**
   - Set `datareader.file: /data/us-latest.osm.pbf`

3. **Update `graphhopper/fly.toml`:**
   - Increase `initial_size` for `graphhopper_data` to at least 50 GB (60–80 GB recommended)
   - Consider increasing `memory` and `JAVA_OPTS` if import fails or is slow (e.g., `-Xmx6g -Xms2g` for import, then possibly tune down after)

4. **Handle existing deployments:**
   - If `graphhopper_data` already exists with Washington data, document that a volume resize or recreation is needed
   - First deploy with US data will require a long import; health checks may need a longer `grace_period` (e.g., 30–60 minutes)

5. **No API or NLP changes required:** The API, NLP, and Mapbox geocoding already work for any US location. Only the GraphHopper dataset constrains coverage.

---

## Verification

After deployment:

1. **Washington (existing):** A query like “5 mile loop around Green Lake” with Seattle area coordinates should still work.
2. **Other states:** A query like “5 mile loop around Central Park” with New York coordinates, or “10k from Santa Monica Pier” with Los Angeles coordinates, should return valid routes.

Use the `POST /api/route` endpoint with `query` and `location: { lat, lng }` to test different regions.

---

## Reference: Key Files

| File | Purpose |
|------|---------|
| `graphhopper/config.yml` | GraphHopper config; `datareader.file` points to OSM PBF |
| `graphhopper/start.sh` | Downloads PBF if missing, starts GraphHopper |
| `graphhopper/fly.toml` | Fly.io app config, volume size, VM, env vars |
| `src/routes/route.ts` | API route handler; passes `location` to NLP and route builder |
| `src/clients/graphhopperClient.ts` | Calls GraphHopper HTTP API for routing |
| `src/services/routeBuilder.ts` | Orchestrates route building; uses GraphHopper for point-to-point routing |

---

## Geofabrik US Data

- Full US: https://download.geofabrik.de/north-america/us-latest.osm.pbf (~10.9 GB)
- By state: https://download.geofabrik.de/north-america/us.html
