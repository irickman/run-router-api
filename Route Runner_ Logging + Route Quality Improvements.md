# Route Runner: Logging + Route Quality Improvements
## 1. Request Logging to Google Sheets
**Goal:** Log every `POST /api/route` and `POST /api/route/.../refine` request to a Google Sheet.
**Auth:** `google-auth.json` service account (already in project, used by evals).
**Sheet ID:** Set via `EVAL_SPREADSHEET_ID` env var (same spreadsheet as evals, different tab).
### Changes
* **New file `src/services/requestLogger.ts`** — Reusable Sheets append client. Buffers rows in memory and flushes every N seconds (or N rows) to avoid one API call per request. Uses `google-auth-library` JWT (already a dependency). Columns: `timestamp`, `request_id`, `endpoint`, `query`, `location_lat`, `location_lng`, `shape`, `distance_value`, `distance_unit`, `landmarks`, `route_id`, `distance_meters_actual`, `elevation_gain_ft`, `duration_ms`, `error`, `provider` (which NLP succeeded).
* **`src/routes/route.ts`** — After successful response (or on error), call `requestLogger.log(...)` fire-and-forget. No `await` — logging failures must not affect the API response.
* **`src/config/env.ts`** — Add optional `REQUEST_LOG_SPREADSHEET_ID` and `REQUEST_LOG_SHEET_NAME` (default `"request_log"`).
## 2. Toll Road Avoidance
**Current state:** `graphhopper/config.yml` has `import.osm.ignored_highways: motorway,trunk`, so motorways and trunks are completely excluded from the graph. Most US toll roads are motorway/trunk class.
**Remaining risk:** Toll bridges and toll segments on `primary`/`secondary` roads are still in the graph. The `toll` encoded value is not in `graph.encoded_values`, so custom models can't filter on it.
### Changes
* **`graphhopper/config.yml`** — Add `toll` to `graph.encoded_values`. This requires a full graph rebuild (~6+ hours for US data).
* **`graphhopper/custom-models/foot_cm.json`** — Add `{ "if": "toll != NO", "multiply_by": "0" }` to the `priority` array.
* **`graphhopper/custom-models/trail_runner_cm.json`** — Same toll rule.
* Batch this with the `distance_influence` change (item 5) to avoid two rebuilds.
## 3. Distance Overshoot
**Root causes identified:**
### 3a. Landmark routes have no shrink logic
`routeBuilder.ts` `landmarkRoute` (line 117-146): When the initial route is *longer* than target, the optimization loop immediately breaks at line 121 (`if (best.distance > ctx.targetMeters) break`). It only has logic to *extend* short routes by inserting intermediate waypoints. There is zero mechanism to reduce an over-long route.
### 3b. Perimeter waypoints add uncontrolled distance
`routeBuilder.ts` line 103: `waypointSet.push(...perimeter)` blindly adds up to 24 Overpass perimeter waypoints to the geocoded landmarks. Routing through all of them often far exceeds the target distance.
### 3c. Shared-edge avoidance inflates distance unchecked
`penalizedRoute` in `sharedEdges.ts` selects alternative legs purely to minimize overlap. It has no distance constraint — the alternative can be arbitrarily longer than the primary.
### 3d. Loop generator accepts wide candidate range
`loopGenerator.ts` line 119: `findFarPointCandidates` accepts legs between 55%-170% of ideal distance. Candidates at the high end produce circuits well over target.
### 3e. Out-and-back uses naive projection
`routeBuilder.ts` `projectOut` goes straight north by latitude delta. In areas with winding roads, the actual routed distance to that point can be 1.5-2x the straight-line distance, making the total route way over target.
### Changes
* **`routeBuilder.ts` `landmarkRoute`** — Add over-target reduction logic: when `best.distance > ctx.targetMeters * 1.05`, progressively remove the farthest perimeter waypoints (keep geocoded landmarks) and re-route until within tolerance. As a second pass, scale down intermediate waypoint offsets.
* **`routeBuilder.ts` `landmarkRoute`** — Cap the number of perimeter waypoints proportionally to target distance (e.g., `Math.min(perimeter.length, Math.ceil(targetMeters / 500))`) instead of blindly appending all 24.
* **`sharedEdges.ts` `penalizedRoute`** — Add a distance guard: reject alternatives that are >20% longer than the primary leg's distance.
* **`loopGenerator.ts` `findFarPointCandidates`** — Tighten the acceptance range from 55%-170% to 70%-140%.
* **`routeBuilder.ts` `outAndBack`** — After routing, if total distance exceeds target by >10%, scale the projection distance down by `(targetMeters / actualDistance)` and re-route once.
## 4. Spurious Small Out-and-Backs
**Root causes identified:**
### 4a. Detour waypoints land on dead-end streets
`insertIntermediateWaypoint` (routeBuilder.ts line 206) creates perpendicular offsets with `Math.max(100, ...)`. `buildAvoidanceWaypoints` (sharedEdges.ts line 65) does the same at 25% of leg distance. When these waypoints land on cul-de-sacs or past road endpoints, GraphHopper routes to the nearest snappable point and back, creating visible spurs of ~200-400m.
### 4b. Projected far-point candidates can land past dead ends
`findFarPointCandidates` projects to arbitrary coordinates. GH snaps these to the nearest road, which might be a dead-end spur.
### Changes
* **New utility `src/utils/routeSmoothing.ts`** — Post-processing pass that detects and removes small out-and-backs. Algorithm: scan the coordinate array for "hairpin" patterns where the route doubles back within a threshold distance (~300m). When detected, splice out the spur and re-route the two neighboring waypoints directly.
* **`sharedEdges.ts` `penalizedRoute`** — After selecting the best candidate, run the hairpin detector on the result and reject candidates with spurs (fall back to the primary route).
* **`routeBuilder.ts` `buildRoute`** — Run the post-processing smoothing pass on the final result before returning.
## 5. Staircase / Zigzag Pattern
**Root causes identified:**
### 5a. `foot_cm.json` has no road hierarchy preference
The foot custom model treats all foot-accessible roads equally. In a grid street neighborhood, the shortest path can zigzag through many short blocks (alternating N/S and E/W) rather than using two longer segments with one turn.
### 5b. No `distance_influence` in foot model
Without `distance_influence`, the router doesn't strongly prefer shorter/more direct paths. The trail model has `distance_influence: 15` which actually makes it *less* direct (it prioritizes trail preferences over distance). The foot model inherits the GH default which is also relatively low.
### 5c. No turn cost
Neither profile enables turn costs, so there's zero penalty for making many turns.
### Changes
* **`graphhopper/custom-models/foot_cm.json`** — Add `"distance_influence": 90` to strongly prefer direct routes. Add road class priority hierarchy: boost `RESIDENTIAL` and `TERTIARY` (typical through-streets) and lightly penalize `FOOTWAY`/`PATH` in urban routing to keep the route on longer connected segments.
* **`graphhopper/config.yml`** — Add `turn_costs: true` to both profiles and add `max_turn_costs` to encoded values. This requires a graph rebuild (batch with toll change).
* **`src/utils/routeSmoothing.ts`** — Add a zigzag detection pass: identify sequences of short segments (<80m) with alternating direction changes >60 degrees. When detected, replace the start/end of the zigzag sequence with a direct route request between those two points.
## Phase 1 — Implement Now (no graph rebuild)
1. Request logging to Google Sheets
2. Distance overshoot fixes in routeBuilder/loopGenerator/sharedEdges (sections 3a-3e)
3. Route smoothing post-processor — hairpin/out-and-back detection + zigzag smoothing
4. Integrate post-processor into buildRoute and penalizedRoute
5. Distance guard on penalizedRoute
## Phase 2 — After GraphHopper Rebuild
1. Add `toll` and `max_turn_costs` to `graph.encoded_values` in config.yml
2. Add `turn_costs: true` to both profiles in config.yml
3. Add toll blocking rule to foot_cm.json and trail_runner_cm.json
4. Add `distance_influence: 90` and road class hierarchy to foot_cm.json
5. Trigger full graph rebuild (~6+ hours for US data)
