import { route, Profile } from '../clients/graphhopperClient';

import { hasHairpin } from './routeSmoothing';

export type EdgeSet = Set<string>;

export function edgeKeys(coords: [number, number, number?][]): EdgeSet {
  const toKey = (p: [number, number, number?]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const set = new Set<string>();
  for (let i = 0; i < coords.length - 1; i++) {
    const k1 = `${toKey(coords[i])}-${toKey(coords[i + 1])}`;
    const k2 = `${toKey(coords[i + 1])}-${toKey(coords[i])}`;
    set.add(k1);
    set.add(k2);
  }
  return set;
}

export function sharedEdgeRatioSets(a: EdgeSet, b: EdgeSet): number {
  let shared = 0;
  b.forEach((e) => {
    if (a.has(e)) shared++;
  });
  return a.size ? shared / a.size : 0;
}

export async function penalizedRoute(
  points: [number, number][],
  profile: Profile,
  avoidedEdges: EdgeSet,
  customModel?: unknown,
  blockArea?: string
) {
  // Primary link-penalty path: GraphHopper alternatives.
  let alt;
  try {
    alt = await route(points, profile, {
      alternative: true,
      customModel,
      blockArea,
    });
  } catch {
    alt = await route(points, profile, { customModel, blockArea });
  }
  const altOverlap = sharedEdgeRatioSets(avoidedEdges, edgeKeys(alt.points));
  if (altOverlap <= 0.05 || points.length !== 2) return alt;

  // Fallback link-penalty path: insert a detour waypoint to pull the leg off previously used edges.
  const [start, end] = points;
  const detours = buildAvoidanceWaypoints(start, end, alt.distance * 0.25);

  const maxDistance = alt.distance * 1.2;
  let best = alt;
  let bestOverlap = altOverlap;
  for (const detour of detours) {
    try {
      const candidate = await route([start, detour, end], profile, { customModel, blockArea });
      if (candidate.distance > maxDistance) continue;
      if (hasHairpin(candidate.points)) continue;
      const overlap = sharedEdgeRatioSets(avoidedEdges, edgeKeys(candidate.points));
      if (
        overlap < bestOverlap ||
        (Math.abs(overlap - bestOverlap) < 0.001 && candidate.distance < best.distance)
      ) {
        best = candidate;
        bestOverlap = overlap;
      }
    } catch {
      // Try the next detour candidate.
    }
  }
  return best;
}

function buildAvoidanceWaypoints(
  start: [number, number],
  end: [number, number],
  offsetMeters: number
): [number, number][] {
  const midLng = (start[0] + end[0]) / 2;
  const midLat = (start[1] + end[1]) / 2;

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;

  const latMeters = 111320;
  const lngMeters = Math.max(1, latMeters * Math.cos((midLat * Math.PI) / 180));
  const offsetLat = (offsetMeters * perpY) / latMeters;
  const offsetLng = (offsetMeters * perpX) / lngMeters;

  return [
    [midLng + offsetLng, midLat + offsetLat],
    [midLng - offsetLng, midLat - offsetLat],
    [midLng + offsetLng * 1.5, midLat + offsetLat * 1.5],
    [midLng - offsetLng * 1.5, midLat - offsetLat * 1.5],
  ];
}
