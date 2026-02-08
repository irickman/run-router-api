Fixed review items:
- Stats now use GraphHopper time/ascend for elevation gain and duration.
- Shape handling honors loop/out-and-back/point-to-point with defaults and landmark-aware routing.
- Default location falls back to Seattle when missing.
- Landmark routing includes all landmarks with perimeter/bbox fallback and alt-route link penalty per leg.
- Loop distance tuning enforces tolerance and attractiveness sorting; throws if >5% off.
- LLM prompts updated with V1 defaults (Seattle, loop default, distance keywords, terrain/elevation cues).
