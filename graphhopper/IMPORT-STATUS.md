# GraphHopper US import – where we are

**App:** `route-runner-graphhopper` (Fly.io, SJC)  
**Data:** US full (`us-latest.osm.pbf`), 89M nodes, 113M edges  
**Profiles:** `foot`, `trail`  
**Last updated:** 2026-02-21 (from logs and SSH checks)

---

## Pipeline overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Download OSM PBF          ✅ DONE (before this run)                     │
│  2. Download SRTM elevation   ✅ DONE                                        │
│  3. Read OSM (pass1 + pass2)  ✅ DONE   ~70 min                              │
│  4. Graph build               ✅ DONE   ~58 min (sort + subnetworks)         │
│  5. Location index            ✅ DONE   ~4 min                               │
│  6. LM preparation            🔄 IN PROGRESS   trail started 01:55 UTC      │
│     → trail landmarks         🔄 running (no progress logs)                │
│     → foot landmarks          ⏳ pending                                     │
│  7. Write graph to disk       ⏳ PENDING                                      │
│  8. Start HTTP server         ⏳ PENDING                                      │
│  9. /health OK                 ⏳ PENDING (fails until server is up)          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase details (from logs)

| Phase | Status | When | Duration (from logs) |
|-------|--------|------|----------------------|
| **1. OSM PBF** | ✅ Done | Before run | File present `us-latest.osm.pbf` (~11 GB) |
| **2. SRTM** | ✅ Done | Before run | `srtm-cache/North_America` populated |
| **3. Read OSM** | ✅ Done | 00:48:47 UTC | pass1: 443s, pass2: 3768s → **~70 min** |
| **4. Graph build** | ✅ Done | 00:49–01:51 UTC | Bridge/tunnel/ferry, sort edges (54 min), sort nodes (3 min), subnetworks (~4.5 min) |
| **5. Location index** | ✅ Done | 01:55:59 UTC | **~4 min** (240.6s) |
| **6. LM preparation** | 🔄 **Current** | Started 01:55:59 UTC | **Trail:** “Start calculating 16 landmarks” – no completion log yet. Then **foot** will run. |
| **7. Write graph** | ⏳ Pending | After LM | Writes to `/data/graph-cache` |
| **8. Start server** | ⏳ Pending | After write | Listens on 8989, Fly routes /health |
| **9. Health** | ⏳ Pending | After server | `GET /health` returns 200 |

---

## Current state (as of last check)

- **Process:** Java still running (PID 697), CPU time increasing → **LM step is still running**.
- **Logs:** Last GraphHopper app log is still **01:55:59** – “Start calculating 16 landmarks” for **trail**. No “Finished” or “foot” yet.
- **Elapsed in LM:** ~3+ hours wall time in landmark phase so far (trail only).
- **Health:** Fails (timeout) because the app does not listen on HTTP until import is fully done.

---

## What “LM preparation” is doing

- **Landmarks** are used for fast route calculation (ALT algorithm).
- GraphHopper precomputes **16 landmarks** per profile by doing many shortest-path sweeps over the graph (89M nodes, 113M edges).
- It does **not** log progress during this – you only get a log line when **trail** finishes, then when **foot** starts and finishes.
- After both profiles, it writes the graph to disk and starts the server.

---

## How to check progress yourself

```bash
# Recent logs (look for new "INFO" lines after 01:55:59)
fly logs -a route-runner-graphhopper --no-tail | tail -40

# Is Java still running and using CPU?
fly ssh console -a route-runner-graphhopper -C "sh -c 'ps | grep java'"

# Health (will work only after server is up)
curl -s -m 15 https://route-runner-graphhopper.fly.dev/health
```

---

## If it fails now, do we start from scratch?

**Short answer: yes – the import would run again from the beginning** (re-read OSM, rebuild graph, location index, LM). You do **not** re-download the PBF or SRTM; those stay on the volume.

**Why:**

- GraphHopper writes the **full graph** (including landmark data) to disk only **after** LM preparation finishes. Until then, the graph is built in memory and any files under `graph-cache` are intermediate.
- If the process dies during LM (OOM, crash, VM stop), the graph on disk is **incomplete** (e.g. no LM files). On the next start, GraphHopper will not load that state – it will start a **new import** from the OSM file.
- Your `start.sh` only deletes `graph-cache` when `location_index` is **missing**. Right now `location_index` exists (from the location-index phase). So if it fails during LM, the next run might see an incomplete `graph-cache`; GraphHopper will typically detect that and re-import from OSM anyway. If it ever gets stuck trying to load a broken graph, you can manually remove `graph-cache` and restart to force a clean import.

**What is preserved on the volume:**

| On volume        | Re-used after failure? |
|------------------|-------------------------|
| `us-latest.osm.pbf` | Yes – no re-download   |
| `srtm-cache/`       | Yes – no re-download   |
| `graph-cache/`      | No – incomplete; re-import runs |

So a failure now costs **all the time again** (OSM read ~70 min, sort ~58 min, location index ~4 min, LM several hours), but **not** the PBF/SRTM download time.

---

## Summary

We are **past** OSM read, graph build, and location index. We are **in** landmark preparation for the **trail** profile; when that finishes, **foot** will run, then the graph is written and the server starts. No ETA for “done” – LM on this graph size can take several hours per profile.
