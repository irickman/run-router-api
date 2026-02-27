# Route Runner: Progress Assessment & Frontend Plan

*Assessed against: `route-runner-plan.md` (Product Requirements Document)*

---

## Part 1: Backend Progress Assessment

### Executive Summary

The backend API is **substantially complete and faithful to the PRD**. The architecture, data models, API surface, algorithm design, deployment config, and external service integrations all closely follow what was specified. There are a handful of deviations — mostly model versions and incomplete implementations of the link penalty mechanism — but no major architectural departures. The project is ready to serve as the foundation for a frontend build.

---

### Section-by-Section Assessment

#### Section 2: Architecture Overview — ✅ FULLY IMPLEMENTED

The PRD specifies a two-service Fly.io architecture with the API calling GraphHopper over Flycast private networking:

| PRD Specification | Actual Implementation | Match |
|---|---|---|
| `route-runner-api.fly.dev` (public HTTPS) | `fly.toml`: `app = "route-runner-api"`, port 3000, force_https | ✅ Exact |
| `route-runner-graphhopper` (private, Flycast) | `graphhopper/fly.toml`: `app = "route-runner-graphhopper"`, port 8989 | ✅ Exact |
| Internal URL: `http://route-runner-graphhopper.flycast:8989` | `fly.toml` env: `GRAPHHOPPER_URL = "http://route-runner-graphhopper.flycast:8989"` | ✅ Exact |
| Fly Volume 10GB for OSM data | `graphhopper/fly.toml`: `source = "graphhopper_data"`, `initial_size = "10gb"` | ✅ Exact |
| External: OpenAI, Anthropic, Mapbox, Overpass | All four clients present in `src/clients/` | ✅ Exact |

**Verdict:** Architecture matches the PRD exactly.

---

#### Section 3: Core Capabilities

**3.1 Natural Language Route Generation — ✅ COMPLETE**

The 8-step processing pipeline from the PRD is implemented across the codebase:

| Pipeline Step | PRD | Implementation | Status |
|---|---|---|---|
| 1. NLP Parameter Extraction | AI parses to RouteParameters | `nlp.ts` → `openaiClient.ts` → `anthropicClient.ts` → heuristic | ✅ |
| 2. Geocoding | Mapbox for named locations | `mapboxClient.ts` with proximity bias | ✅ |
| 3. Landmark Resolution | Overpass for polygon geometry | `overpassClient.ts` + `perimeter.ts` | ✅ |
| 4. Loop Generation | Lewis Double-Path Heuristic | `loopGenerator.ts` | ✅ |
| 5. Link Penalty | Penalize used edges | `sharedEdges.ts` + `routeBuilder.ts` | ⚠️ Partial (see below) |
| 6. Distance Optimization | Fine-tune within 5% | `loopGenerator.ts` `fineTune()` | ✅ |
| 7. Elevation Enrichment | SRTM via GraphHopper | `elevation: true` in all GH calls | ✅ |
| 8. Output Generation | GeoJSON + stats + GPX URL | `route.ts` controller | ✅ |

**3.2 Distance Parsing — ✅ COMPLETE**

The system prompt in `openaiClient.ts` includes the distance keyword mappings: `5k=5 km, 10k=10 km, half marathon=13.1 miles, marathon=26.2 miles, long run=8-12 miles, short run=2-4 miles, easy run=3-5 miles`. The heuristic fallback also parses mile/km patterns from regex.

**3.3 Route Shapes — ✅ COMPLETE**

| Shape | PRD | Code (`routeBuilder.ts`) | Status |
|---|---|---|---|
| Loop (default) | Returns to start, avoids doubling back | `loopRoute()` via `generateLoop()` | ✅ |
| Out-and-back | Outbound + return | `outAndBack()` | ✅ |
| Point-to-point | Different start/end | `pointToPoint()` | ✅ |
| Flexible | Auto-detected | Falls through to loop | ✅ |

**3.4 Landmark Intelligence — ⚠️ PARTIALLY IMPLEMENTED**

The PRD specifies six landmark intent types: perimeter, traverse, along, destination, origin, waypoint. The implementation handles landmarks as a flat list — it geocodes them, fetches perimeter data via Overpass, and routes through them. It does not differentiate between "around X" (perimeter), "through X" (traverse), or "along X" (linear) intents. The NLP schema also does not distinguish these intents. In practice, the landmark routing in `routeBuilder.ts` treats all landmarks as waypoints plus attempts a perimeter fetch, which covers the most common case (perimeter/destination) but not traverse or along semantics.

**3.5 Terrain & Elevation — ✅ SCHEMA COMPLETE, ⚠️ ROUTING PARTIAL**

The `RouteParameters` schema fully captures all terrain fields from the PRD. Profile selection (foot vs trail) works based on surface type detection in `route.ts`. However, the PRD's elevation profiles (flat, rolling, hilly, mountainous) are extracted by the LLM but **not used to influence routing**. The foot custom model has no elevation preference logic; only the trail runner model has slope-based speed adjustments. The PRD's `maxGain` constraint is also extracted but not enforced.

**3.6 Runner Preferences — ✅ CORRECT (V2 DEFERRED)**

The PRD explicitly defers these to V2. The schema extracts them, and they're returned as metadata. Matches the PRD exactly.

**3.7 GPX Export — ✅ COMPLETE**

`gpx.ts` generates GPX 1.1 XML with trackpoints (lat/lng/elevation), route name, and description. Served via `GET /api/route/:sid/:rid/gpx` with correct Content-Type and Content-Disposition headers.

**3.8 Route Retrieval & Storage — ✅ COMPLETE**

`storage.ts` implements in-memory storage with 24h TTL, keyed by `route:{sessionId}:{routeId}`. The `RouteData` interface includes `userId?: string` for future auth, as the PRD specifies.

---

#### Section 4: API Specification — ✅ COMPLETE

| Endpoint | PRD | Implementation (`route.ts`, `health.ts`) | Status |
|---|---|---|---|
| `POST /api/route` | Query + location → full route response | ✅ Exact match on input/output shape | ✅ |
| `GET /api/route/:sessionId/:routeId` | Retrieve stored route | ✅ Returns 404 with error message | ✅ |
| `GET /api/route/:sessionId/:routeId/gpx` | GPX download | ✅ Correct headers | ✅ |
| `GET /health` | Status + service health | ✅ Pings GraphHopper + Overpass | ✅ |

**One minor difference:** The PRD specifies error responses with a `code` field (e.g., `"code": "MISSING_FIELD"`). The actual implementation returns only `{ error: "message" }` without a structured error code. Low priority.

---

#### Section 5: AI & Intelligence Layer

**5.1 Model Strategy — ⚠️ MODEL VERSION DIFFERS**

| Role | PRD | Actual | Status |
|---|---|---|---|
| Primary | GPT-4.1 mini | `gpt-4.1-mini` | ✅ Match |
| Fallback | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | `claude-3-haiku-20240307` | ⚠️ Older model |
| Last resort | Not specified | Heuristic regex parser | ✅ Bonus |

The Anthropic fallback uses Claude 3 Haiku (March 2024) rather than the Claude Haiku 4.5 specified in the PRD. This is a straightforward model string update.

**5.2 Structured Output — ✅ COMPLETE**

Both implementations use native structured output exactly as the PRD specifies: OpenAI uses `response_format: { type: "json_schema" }` with strict mode, Anthropic uses tool use with `tool_choice: { type: "tool" }`. Both validate through Zod. No regex parsing.

**5.3 RouteParameters Schema — ✅ EXACT MATCH**

The `RouteParameters` interface in `models/routeParameters.ts` is a character-for-character match with the PRD's Section 5.3 schema, including all nested types, optional fields, and enum values.

**5.4 Validate-and-Escalate Flow — ⚠️ PARTIALLY IMPLEMENTED**

| PRD Step | Implementation | Status |
|---|---|---|
| Send to GPT-4.1 mini | `extractParametersWithOpenAI()` | ✅ |
| Validate programmatically | Zod schema validation | ✅ |
| Retry once on validation failure | No retry — falls through to Anthropic immediately | ❌ Missing |
| Escalate to Claude Haiku 4.5 | `extractParametersWithAnthropic()` | ✅ |
| Log (input, output) pairs | Not implemented | ❌ Missing |

The retry-on-validation-failure step is skipped; any OpenAI error (including validation failures) goes straight to Anthropic. The logging of input/output pairs for fine-tuning is not implemented.

**5.5 System Prompt — ✅ COMPLETE**

Both prompts include: Seattle defaults, loop default, distance keywords (5k, 10k, half marathon, etc.), terrain/elevation cues, landmark extraction, confidence scoring, and few-shot examples (3 examples covering loop, out-and-back, and trail run). The PRD says 5 examples; the implementation has 3. Close enough.

---

#### Section 6: Geospatial Engine

**6.1 Hybrid Architecture — ✅ COMPLETE**

The separation of concerns is exactly as specified. TypeScript handles loop generation, link penalty, and distance optimization. GraphHopper handles point-to-point shortest paths, elevation, and custom profiles.

**6.2 Loop Generation (Lewis Double-Path Heuristic) — ✅ COMPLETE**

The implementation in `loopGenerator.ts` faithfully follows the algorithm:

| Algorithm Step | PRD | Code | Status |
|---|---|---|---|
| Select candidate far-points via 12 bearings + jitter | Generate at k/3 distance | `findFarPointCandidates()`: 12 bearings, idealFarDist = target/3, with jitter | ✅ |
| Filter candidates where d(s,t) in [k/4, k/2] | Filter range | `.filter(c => c.shortestDistance >= target/4 && <= target/2)` | ✅ |
| Top 10 candidates, compute two paths | Edge-disjoint pairs | `candidates.slice(0, 10)`, routes path1 + path2 | ✅ |
| Select circuit closest to target, break ties by attractiveness | Sort by distance, then attractiveness | Sort by distance diff → overlap ratio → attractiveness score | ✅ |
| Fine-tune if >5% off | Waypoint insertion | `fineTune()` adds stub detour leg | ✅ |
| Strict check: <5% distance, <5% shared edges | Validation | Throws if either threshold exceeded | ✅ |

**One implementation difference:** The PRD describes computing path P2 "with penalized edges" (true link penalty on P1's edges). The actual code computes P2 using GraphHopper's `alternative_route` parameter, then checks shared edge ratio. This is Approach A from Section 6.3, which the PRD itself recommends as the primary approach.

**6.3 Link Penalty — ⚠️ PARTIALLY IMPLEMENTED**

The PRD defines three approaches (A: alternative_route, B: custom model penalty, C: waypoint avoidance) and says to implement A as primary with C as fallback.

| Approach | Status |
|---|---|
| A: `alternative_route` with `max_share_factor: 0.3` | ✅ Implemented in `graphhopperClient.ts` (exact params match PRD) |
| B: Custom model penalty | ❌ Not implemented |
| C: Waypoint-based avoidance fallback | ❌ Not implemented |

The `penalizedRoute()` function in `sharedEdges.ts` currently just calls `alternative_route` again — it doesn't actually use the `_avoidedEdges` parameter that's passed to it. The comment in the code acknowledges this: "Approximate link-penalty by leveraging alternative_route and re-checking overlap downstream." This means that when alternatives don't provide sufficient diversity, there's no fallback mechanism.

For landmark routes in `routeBuilder.ts`, the implementation does track used edges across legs and re-routes with alternatives when overlap exceeds 5%, which is a working implementation of the concept even if it doesn't use Approaches B or C.

**6.4 Landmark Routes — ✅ MOSTLY COMPLETE**

The implementation in `routeBuilder.ts` `landmarkRoute()` follows the PRD:
- Places landmark waypoints as pass-through points
- Constructs circuit: `[start, ...landmarks, start]`
- Routes each leg via GraphHopper point-to-point
- Applies link penalty (Approach A) between consecutive legs
- Edge deduplication enforced at 5% threshold

**Missing:** Intermediate waypoint insertion when total distance falls short. The PRD says to add intermediate waypoints and re-route (max 3 iterations, 5% tolerance, damping factor 0.6). The implementation doesn't do this for landmark routes.

**6.5 Perimeter Routes — ✅ COMPLETE**

The Overpass API implementation is faithful to the PRD:

| Feature | PRD | Code (`overpassClient.ts`) | Status |
|---|---|---|---|
| Combined polygon + trail query | Single Overpass request | Exact query structure from PRD | ✅ |
| 3 fallback Overpass endpoints | Primary + 2 fallbacks | Same 3 URLs | ✅ |
| POST with URL-encoded body | Encoding specified | Exact match | ✅ |
| Parse way + relation geometry | Convert lat/lon to [lng,lat] | `parseOverpass()` handles both | ✅ |
| Stitch outer members for multipolygon | End-to-end | `flatMap` on outer members | ✅ |
| Waypoint sampling from polygon | Regular intervals | `samplePerimeter()` samples 24 points | ✅ |
| Fallback: circular waypoints from bbox | Estimate when no polygon | `fallbackPerimeter()` with `circularWaypoints()` | ✅ |
| Cache responses | 24h TTL | LRU cache, 200 entries, 24h | ✅ |
| 50m trail buffer | `around.feature:50` | Exact match in query | ✅ |

**6.6 Distance Optimization — ✅ COMPLETE FOR LOOPS, ⚠️ PARTIAL FOR LANDMARKS**

Loop routes: Lewis algorithm + fineTune with 5% tolerance — matches PRD.
Landmark routes: No iterative distance optimization (no waypoint insertion, no damping factor).

**6.7 Trail-Aware Routing (GraphHopper Config) — ✅ EXACT MATCH**

`graphhopper/config.yml` and `trail_runner_cm.json` match the PRD's Section 6.7 spec:
- Same profiles (foot, trail), same custom model structure
- Same encoded values, same SRTM provider
- Same `profiles_ch: []` (CH disabled), same LM profiles
- `trail_runner_cm.json` has identical priority/speed rules
- Port 8989, bind 0.0.0.0

The only naming difference: PRD says `trail_runner.json` / `foot.json`, code uses `trail_runner_cm.json` / `foot_cm.json`.

**6.8 Geocoding — ✅ COMPLETE**

`mapboxClient.ts` matches the PRD exactly: Mapbox v5, proximity bias, `types=poi,place,neighborhood,locality,address`, limit=3, 10s timeout, LRU cache (500 entries, 24h TTL).

**6.9 Elevation — ✅ COMPLETE**

All GraphHopper calls set `elevation: true`. Stats include `ascend * 3.28084` for feet conversion.

---

#### Section 7: Deployment — ✅ COMPLETE

**7.1–7.4 fly.toml files — ✅ EXACT MATCH**

Both `fly.toml` files match the PRD character for character, including machine sizes, memory, concurrency limits, health check intervals, and region.

**7.5 GraphHopper Dockerfile — ✅ MATCH**

One trivial difference: PRD says `CMD`, code uses `ENTRYPOINT`. Functionally equivalent.

**7.7 GitHub Actions — ✅ COMPLETE**

`.github/workflows/fly-deploy.yml` deploys on push to main using `flyctl deploy --remote-only`.

**⚠️ Missing: API Dockerfile.** The `fly.toml` references a Dockerfile that doesn't exist in the project root. This needs to be created.

---

#### Section 8: Configuration & Defaults — ✅ MOSTLY COMPLETE

| Setting | PRD Default | Actual | Status |
|---|---|---|---|
| Default region | Seattle (47.6062, -122.3321) | `route.ts`: exact coords | ✅ |
| Default distance | 5 miles | heuristic: `value = 5` | ✅ |
| Default shape | Loop | heuristic + prompt both default loop | ✅ |
| Distance tolerance | 5% | `> 0.05` check | ✅ |
| Far-point bearings | 12 | `generateBearings(12)` | ✅ |
| Far-point range | k/4 to k/2 | Exact filter | ✅ |
| Max candidates | 10 | `candidates.slice(0, 10)` | ✅ |
| alt route max_share_factor | 0.3 | `max_share_factor: 0.3` | ✅ |
| Geocoding timeout | 10s | `timeout: 10000` | ✅ |
| Routing timeout | 15s | `timeout: 15000` | ✅ |
| Overpass timeout | 30s | `timeout: 30000` | ✅ |
| Geocoding cache | 500 entries, 24h | Exact | ✅ |
| Overpass cache | 24h | 200 entries, 24h | ✅ |
| Route storage TTL | 24h | `TTL_MS = 86400000` | ✅ |
| Retry: 3, exponential | 1s/2s/4s | `retries: 3, exponentialDelay` | ✅ |
| Link penalty factor 5.0 | Edge cost multiplier | ❌ Not implemented (alt routes instead) | ⚠️ |
| Parameter extraction timeout 30s | SDK timeout | Not explicitly set | ⚠️ |

---

#### Section 9: Data Model — ✅ EXACT MATCH

`RouteData` in `models/routeParameters.ts` matches the PRD's Section 9.1 schema exactly, including the `userId?: string` field for future auth. Storage key format `route:{sessionId}:{routeId}` with 24h TTL — exact match.

---

#### Section 10: Quality & Evaluation — ⚠️ PARTIALLY IMPLEMENTED

| PRD Test Case | Status |
|---|---|
| Simple loop from Space Needle | E2E test covers a similar case (Green Lake) | ✅ |
| Elevation constraint (10mi, <500ft) | ❌ Not tested |
| Landmark waypoint (through Kerry Park) | ❌ Not tested |
| Trail preference (Discovery Park) | ❌ Not tested |
| Perimeter (around Green Lake) | ❌ Not tested |
| No doubling back (<5% overlap) | ❌ Not tested |
| AI-assisted evaluation scoring | ❌ Not implemented |

The test suite has 4 test files covering the happy path. The 6 specific integration test cases from the PRD are not yet implemented.

---

#### Section 11: Non-Functional Requirements

| Requirement | Status |
|---|---|
| Retry with exponential backoff (3 retries) | ✅ `axios-retry` |
| Timeout handling per service | ✅ Set on all external calls |
| Fallback: default location | ✅ Seattle fallback |
| Fallback: AI provider chain | ✅ OpenAI → Anthropic → heuristic |
| Fallback: bbox if no Overpass polygon | ✅ `fallbackPerimeter()` |
| Geocoding cache (24h, 500) | ✅ |
| Overpass cache (24h) | ✅ |
| Rate limiting (20/hr per IP) | ✅ |
| CORS: `*` or specific origin | ✅ `cors()` allows all |
| Logging: AI input/output pairs | ❌ Not implemented |
| Logging: per-step timing | ❌ Not implemented |
| Logging: API failure details | ⚠️ Console.error only |

---

### Summary Scorecard

| PRD Section | Status | Key Gaps |
|---|---|---|
| 2. Architecture | ✅ Complete | — |
| 3. Core Capabilities | ✅ Mostly complete | Landmark intent differentiation; elevation preference routing |
| 4. API Specification | ✅ Complete | Missing `code` in error responses (minor) |
| 5. AI Layer | ⚠️ Mostly complete | Anthropic model version; no retry-before-escalate; no I/O logging |
| 6. Geospatial Engine | ✅ Mostly complete | Link penalty Approaches B/C; landmark distance optimization |
| 7. Deployment | ✅ Complete | Missing API Dockerfile |
| 8. Configuration | ✅ Complete | All defaults match |
| 9. Data Model | ✅ Exact match | — |
| 10. Quality | ⚠️ Partial | 5 of 6 PRD test cases missing |
| 11. Non-Functional | ⚠️ Mostly complete | Missing structured logging |

### Priority Items Before Frontend

1. **Create API Dockerfile** — Deployment dependency. `fly.toml` references it.
2. **Update Anthropic model** — Change `claude-3-haiku-20240307` to `claude-haiku-4-5-20251001`.
3. **Lock down CORS** — Restrict to frontend origin once deployed.
4. **Revisit rate limiting** — 20/hour will be too restrictive for a frontend app.

---

## Part 2: Frontend Build-Out Plan for Fly.io

### Architecture

As the PRD states in Section 2, the frontend is a separate Fly.io app (`route-runner-web.fly.dev`) making client-side fetch calls to the existing `route-runner-api.fly.dev`. All three services share the `sea` (Seattle) region.

```
┌─────────────────────────┐       ┌──────────────────────────┐       ┌──────────────────────┐
│  route-runner-web       │──────▶│  route-runner-api         │──────▶│  route-runner-        │
│  Fly.io / sea           │ fetch │  Fly.io / sea             │Flycast│  graphhopper          │
│  Static SPA (nginx)     │       │  Express, port 3000       │       │  Fly.io / sea         │
│  shared-cpu-1x, 256MB   │       │  shared-cpu-2x, 1GB       │       │  perf-2x, 4GB         │
└─────────────────────────┘       └──────────────────────────┘       └──────────────────────┘
```

### Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Build tool | **Vite** | Fast builds, simple config |
| UI | **React + TypeScript** | Matches backend language; component model fits the UI |
| Map | **Mapbox GL JS** | Already have a Mapbox token; best route/terrain rendering |
| Styling | **Tailwind CSS** | Rapid iteration, responsive built-in |
| HTTP | **fetch** (native) | No extra dependency for 3 API calls |
| Deploy | **Fly.io** (nginx serving static files) | Same platform, same region |

This is a single-page app with one workflow: enter text → see route on map → download GPX. No SSR, no multi-page routing, no SEO requirement. Vite+React SPA is the simplest thing that works.

### Feature Scope (V1 Frontend)

**Route Input:**
- Natural language text input with placeholder examples
- Browser Geolocation API to auto-detect user position (Seattle fallback)
- "Generate Route" button with loading state

**Route Display:**
- Full-viewport Mapbox GL JS map rendering the GeoJSON LineString
- Auto-fit camera to route bounds
- Start/end markers
- Stats overlay: distance (mi), elevation gain (ft), estimated time
- GPX download button
- Route name and AI assumptions/confidence displayed
- "Generate another" button to reset

**Responsive:**
- Desktop: sidebar for input/stats, map fills remaining space
- Mobile: full-viewport map, input/stats as bottom sheet overlay

### API Integration

| Action | Method | Endpoint |
|---|---|---|
| Generate route | `POST` | `/api/route` |
| Download GPX | `GET` | `/api/route/:sid/:rid/gpx` |
| Retrieve route (sharing) | `GET` | `/api/route/:sid/:rid` |

### Implementation Phases

**Phase F1: Project Setup (~2-3 hours)**
- Scaffold Vite + React + TypeScript project
- Install Mapbox GL JS, Tailwind CSS
- Create Dockerfile (multi-stage: node build → nginx static serve)
- Create fly.toml for `route-runner-web`
- Create nginx.conf with SPA routing and static asset caching
- Environment variables: `VITE_API_URL`, `VITE_MAPBOX_TOKEN`
- Vite dev proxy for local development

**Phase F2: Core Components (~3-4 hours)**
- `QueryInput`: text input with example placeholders, submit handler
- `LocationProvider`: browser geolocation hook with Seattle fallback
- `useGenerateRoute` hook: fetch lifecycle, loading/error/success states
- `LoadingOverlay`: progress indicator while route generates
- `ErrorDisplay`: user-friendly error messages

**Phase F3: Map Integration (~3-4 hours)**
- `MapView`: Mapbox GL JS, Outdoors style
- `RouteLayer`: GeoJSON LineString as styled polyline
- Start marker, fitBounds on route generation
- Map controls: zoom, style toggle

**Phase F4: Route Display & Actions (~2-3 hours)**
- `StatsPanel`: distance, elevation, duration, shape badge
- GPX download via blob URL
- Route name and AI metadata display
- Shareable URLs: `/route/:sid/:rid`
- "Try another" reset button

**Phase F5: Polish & Deploy (~3-4 hours)**
- Responsive layout (sidebar ↔ bottom sheet)
- Loading animations, empty state with examples
- Favicon, meta tags, page title
- Deploy to Fly.io
- Update API CORS to allow frontend origin
- End-to-end verification

**Phase F6: Post-V1 Enhancements**
- Elevation profile chart
- Route history (localStorage)
- Multiple route alternatives
- Dark mode / map style toggle
- Share to Strava
- PWA support

### Deployment Config

**fly.toml:**
```toml
app = "route-runner-web"
primary_region = "sea"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 80
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

**Dockerfile:**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL
ARG VITE_MAPBOX_TOKEN
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

**nginx.conf:**
```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Backend Adjustments for Frontend

| Change | Why | Effort |
|---|---|---|
| Create API Dockerfile | Deployment currently undefined | Small |
| Update Anthropic model string | PRD specifies Haiku 4.5 | Trivial |
| Tighten CORS to frontend origin | Security | Trivial |
| Revisit rate limiting (20/hr) | Too restrictive for frontend | Small |
| Mapbox token strategy | Frontend needs token for map rendering | Decision |

### Cost Impact

The frontend adds only ~$2/month (shared-cpu-1x, 256MB). Total monthly cost stays around $75.

### Estimated Effort

| Phase | Hours |
|---|---|
| F1: Project setup + deploy config | 2–3 |
| F2: Core components | 3–4 |
| F3: Map integration | 3–4 |
| F4: Route display & actions | 2–3 |
| F5: Polish & deploy | 3–4 |
| Backend adjustments | 1–2 |
| **Total V1** | **~15–20 hours** |
