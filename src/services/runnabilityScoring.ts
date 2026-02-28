import { OsmWay, OsmWayTags, fetchWayTagsAlongRoute } from '../clients/overpassClient';
import { haversineDistance } from '../utils/geometry';
import { logError, logInfo } from '../utils/logger';

export interface RunnabilityBreakdown {
  surface: number;
  road_type: number;
  sidewalk: number;
  lighting: number;
}

export interface RunnabilityScore {
  overall: number;
  breakdown: RunnabilityBreakdown;
  segmentCount: number;
}

const SAMPLE_COUNT = 20;

const SURFACE_SCORES: Record<string, number> = {
  asphalt: 10, concrete: 10, paved: 9,
  compacted: 8, fine_gravel: 7,
  gravel: 6, pebblestone: 5,
  dirt: 4, earth: 4, mud: 3, sand: 3,
  grass: 3, wood: 6,
};

const HIGHWAY_SCORES: Record<string, number> = {
  footway: 10, path: 10, pedestrian: 10,
  cycleway: 9, steps: 7,
  track: 7, living_street: 7,
  residential: 6, service: 6,
  unclassified: 5, tertiary: 5, tertiary_link: 5,
  secondary: 3, secondary_link: 3,
  primary: 1, primary_link: 1,
  trunk: 0, trunk_link: 0,
};

const WEIGHTS = { surface: 0.35, road_type: 0.35, sidewalk: 0.15, lighting: 0.15 };

export function scoreSurface(tags: OsmWayTags): number {
  if (!tags.surface) return 5;
  return SURFACE_SCORES[tags.surface] ?? 5;
}

export function scoreRoadType(tags: OsmWayTags): number {
  if (!tags.highway) return 5;
  return HIGHWAY_SCORES[tags.highway] ?? 5;
}

const DEDICATED_RUNNING = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'track', 'steps']);

export function scoreSidewalk(tags: OsmWayTags): number {
  if (DEDICATED_RUNNING.has(tags.highway ?? '')) return 10;
  const sw = tags.sidewalk ?? tags['sidewalk:both'] ?? '';
  if (sw === 'both') return 10;
  if (sw === 'left' || sw === 'right' || sw === 'yes') return 7;
  if (sw === 'no' || sw === 'none') return 3;
  return 6;
}

export function scoreLighting(tags: OsmWayTags): number {
  if (tags.lit === 'yes') return 10;
  if (tags.lit === 'no') return 4;
  return 6;
}

export function scoreWay(tags: OsmWayTags): RunnabilityBreakdown {
  return {
    surface: scoreSurface(tags),
    road_type: scoreRoadType(tags),
    sidewalk: scoreSidewalk(tags),
    lighting: scoreLighting(tags),
  };
}

export function aggregateScore(breakdown: RunnabilityBreakdown): number {
  return round1(
    breakdown.surface * WEIGHTS.surface +
    breakdown.road_type * WEIGHTS.road_type +
    breakdown.sidewalk * WEIGHTS.sidewalk +
    breakdown.lighting * WEIGHTS.lighting
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function sampleRoutePoints(
  coords: [number, number, number?][],
  count: number
): [number, number][] {
  if (coords.length <= count) return coords.map((c) => [c[0], c[1]]);
  const step = (coords.length - 1) / (count - 1);
  const points: [number, number][] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round(i * step);
    points.push([coords[idx][0], coords[idx][1]]);
  }
  return points;
}

export function nearestWay(
  point: [number, number],
  ways: OsmWay[]
): OsmWay | null {
  let best: OsmWay | null = null;
  let bestDist = Infinity;
  for (const way of ways) {
    for (const wp of way.geometry) {
      const d = haversineDistance(point, wp);
      if (d < bestDist) {
        bestDist = d;
        best = way;
      }
    }
  }
  return bestDist < 50 ? best : null;
}

export function computeScoreFromWays(
  coords: [number, number, number?][],
  ways: OsmWay[]
): RunnabilityScore {
  const samples = sampleRoutePoints(coords, SAMPLE_COUNT);
  const totals: RunnabilityBreakdown = { surface: 0, road_type: 0, sidewalk: 0, lighting: 0 };
  let matched = 0;

  for (const pt of samples) {
    const way = nearestWay(pt, ways);
    if (!way) continue;
    const s = scoreWay(way.tags);
    totals.surface += s.surface;
    totals.road_type += s.road_type;
    totals.sidewalk += s.sidewalk;
    totals.lighting += s.lighting;
    matched++;
  }

  if (matched === 0) {
    const fallback: RunnabilityBreakdown = { surface: 5, road_type: 5, sidewalk: 6, lighting: 6 };
    return { overall: aggregateScore(fallback), breakdown: fallback, segmentCount: 0 };
  }

  const breakdown: RunnabilityBreakdown = {
    surface: round1(totals.surface / matched),
    road_type: round1(totals.road_type / matched),
    sidewalk: round1(totals.sidewalk / matched),
    lighting: round1(totals.lighting / matched),
  };

  return {
    overall: aggregateScore(breakdown),
    breakdown,
    segmentCount: matched,
  };
}

export async function scoreRoute(
  coords: [number, number, number?][]
): Promise<RunnabilityScore | null> {
  try {
    const flatCoords: [number, number][] = coords.map((c) => [c[0], c[1]]);
    const ways = await fetchWayTagsAlongRoute(flatCoords);
    if (!ways.length) return null;
    const score = computeScoreFromWays(coords, ways);
    logInfo('runnability scored', { overall: score.overall, segments: score.segmentCount });
    return score;
  } catch (err) {
    logError('runnability scoring failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}
