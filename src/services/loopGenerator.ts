import { route, Profile } from '../clients/graphhopperClient';
import { elevationGainFromCoords } from '../utils/geometry';
import { edgeKeys, penalizedRoute, sharedEdgeRatioSets, EdgeSet } from '../utils/sharedEdges';

interface Candidate {
  coords: [number, number];
  shortestDistance: number;
  bearing: number;
}

interface Circuit {
  coordinates: [number, number, number?][];
  totalDistance: number;
  totalTime: number;
  totalAscend: number;
  overlapRatio: number;
}

function normalizeBearing(bearingDeg: number): number {
  const normalized = bearingDeg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function generateBearings(count: number, offsetDeg = 0): number[] {
  const bearings: number[] = [];
  const baseStep = 360 / count;
  for (let i = 0; i < count; i++) {
    const jitter = (Math.random() - 0.5) * 8;
    bearings.push(normalizeBearing(i * baseStep + offsetDeg + jitter));
  }
  return bearings;
}

function project(start: [number, number], bearingDeg: number, distanceMeters: number): [number, number] {
  const R = 6371e3;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (start[1] * Math.PI) / 180;
  const lon1 = (start[0] * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
      Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distanceMeters / R) * Math.cos(lat1),
      Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

function bearingBetween(from: [number, number], to: [number, number]): number {
  const avgLatRad = ((from[1] + to[1]) / 2) * (Math.PI / 180);
  const x = (to[0] - from[0]) * Math.cos(avgLatRad);
  const y = to[1] - from[1];
  return normalizeBearing((Math.atan2(x, y) * 180) / Math.PI);
}

function circularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 360 - diff);
}

function appendCoordinates(
  target: [number, number, number?][],
  points: [number, number, number?][]
) {
  if (!points.length) return;
  if (!target.length) {
    target.push(...points);
    return;
  }

  const [lastLng, lastLat] = target[target.length - 1];
  const [firstLng, firstLat] = points[0];
  const startIdx = lastLng === firstLng && lastLat === firstLat ? 1 : 0;
  target.push(...points.slice(startIdx));
}

function edgeKeyUndirected(a: [number, number, number?], b: [number, number, number?]): string {
  const p1 = `${a[0].toFixed(5)},${a[1].toFixed(5)}`;
  const p2 = `${b[0].toFixed(5)},${b[1].toFixed(5)}`;
  return p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
}

function selfOverlapRatio(coords: [number, number, number?][]): number {
  if (coords.length < 2) return 0;
  const seen = new Map<string, number>();
  let totalEdges = 0;
  let repeatedEdges = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const key = edgeKeyUndirected(coords[i], coords[i + 1]);
    const count = seen.get(key) ?? 0;
    if (count > 0) repeatedEdges += 1;
    seen.set(key, count + 1);
    totalEdges += 1;
  }

  return totalEdges ? repeatedEdges / totalEdges : 0;
}

async function findFarPointCandidates(
  start: [number, number],
  waypointDistanceMeters: number,
  profile: Profile,
  customModel?: unknown,
  blockArea?: string
): Promise<Candidate[]> {
  const ideal = Math.max(250, waypointDistanceMeters);
  const bearings = [...generateBearings(12), ...generateBearings(12, 15)];
  const candidates: Candidate[] = [];

  for (const bearing of bearings) {
    const projected = project(start, bearing, ideal);
    const res = await route([start, projected], profile, { customModel, blockArea });
    const endPoint = res.points.at(-1);
    if (!endPoint) continue;
    if (res.distance < ideal * 0.7 || res.distance > ideal * 1.4) continue;

    const coords: [number, number] = [endPoint[0], endPoint[1]];
    candidates.push({
      coords,
      shortestDistance: res.distance,
      bearing: bearingBetween(start, coords),
    });
  }

  return candidates;
}

function selectEvenlySpacedCandidates(
  candidates: Candidate[],
  count: number,
  targetLegDistance: number,
  centerOffset: number
): Candidate[] {
  const used = new Set<number>();
  const selected: Candidate[] = [];
  const sector = 360 / count;

  for (let i = 0; i < count; i++) {
    const center = normalizeBearing(centerOffset + i * sector);
    let bestIdx = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let idx = 0; idx < candidates.length; idx++) {
      if (used.has(idx)) continue;
      const c = candidates[idx];
      const anglePenalty = circularDistance(c.bearing, center);
      const distancePenalty =
        (Math.abs(c.shortestDistance - targetLegDistance) / Math.max(targetLegDistance, 1)) * 30;
      const score = anglePenalty + distancePenalty;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    }

    if (bestIdx < 0) return [];
    used.add(bestIdx);
    selected.push(candidates[bestIdx]);
  }

  return selected.sort((a, b) => a.bearing - b.bearing);
}

function toWaypointSetKey(points: [number, number][]): string {
  return points.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join('|');
}

function buildWaypointSets(
  candidates: Candidate[],
  count: number,
  targetLegDistance: number
): [number, number][][] {
  const sets: [number, number][][] = [];
  const seen = new Set<string>();
  const offsets = [0, 180 / count];

  for (const offset of offsets) {
    const selection = selectEvenlySpacedCandidates(candidates, count, targetLegDistance, offset);
    if (selection.length !== count) continue;
    const waypoints = selection.map((c) => c.coords);
    const key = toWaypointSetKey(waypoints);
    if (seen.has(key)) continue;
    seen.add(key);
    sets.push(waypoints);
  }

  if (!sets.length && candidates.length >= count) {
    const fallback = [...candidates]
      .sort(
        (a, b) =>
          Math.abs(a.shortestDistance - targetLegDistance) -
          Math.abs(b.shortestDistance - targetLegDistance)
      )
      .slice(0, count)
      .sort((a, b) => a.bearing - b.bearing)
      .map((c) => c.coords);
    sets.push(fallback);
  }

  return sets;
}

async function buildCircuit(
  start: [number, number],
  waypoints: [number, number][],
  profile: Profile,
  customModel?: unknown,
  blockArea?: string
): Promise<Circuit> {
  const legs = [start, ...waypoints, start];
  const coordinates: [number, number, number?][] = [];
  let totalDistance = 0;
  let totalTime = 0;
  let usedEdges: EdgeSet = new Set<string>();

  for (let i = 0; i < legs.length - 1; i++) {
    const legPoints: [number, number][] = [legs[i], legs[i + 1]];
    const primary = await route(legPoints, profile, {
      alternative: true,
      customModel,
      blockArea,
    });
    let chosen = primary;
    let chosenEdges = edgeKeys(primary.points);
    const overlap = sharedEdgeRatioSets(usedEdges, chosenEdges);

    if (overlap > 0.05) {
      const alternative = await penalizedRoute(legPoints, profile, usedEdges, customModel, blockArea);
      const alternativeEdges = edgeKeys(alternative.points);
      const alternativeOverlap = sharedEdgeRatioSets(usedEdges, alternativeEdges);
      if (alternativeOverlap <= overlap) {
        chosen = alternative;
        chosenEdges = alternativeEdges;
      }
    }

    usedEdges = new Set([...usedEdges, ...chosenEdges]);
    appendCoordinates(coordinates, chosen.points);
    totalDistance += chosen.distance;
    totalTime += chosen.time;
  }

  return {
    coordinates,
    totalDistance,
    totalTime,
    totalAscend: elevationGainFromCoords(coordinates),
    overlapRatio: selfOverlapRatio(coordinates),
  };
}

function attractiveness(circuit: Circuit): number {
  const coords = circuit.coordinates;
  if (coords.length < 3) return 0;
  let totalAngle = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    const [cx, cy] = coords[i + 1];
    const v1 = [ax - bx, ay - by];
    const v2 = [cx - bx, cy - by];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const det = v1[0] * v2[1] - v1[1] * v2[0];
    totalAngle += Math.abs(Math.atan2(det, dot));
  }
  const ideal = Math.PI * 2;
  return Math.max(0, 1 - Math.abs(totalAngle - ideal) / ideal);
}

export async function generateLoop(
  start: [number, number],
  targetDistanceMeters: number,
  profile: Profile,
  customModel?: unknown,
  blockArea?: string
): Promise<Circuit> {
  const primaryWaypointCount = targetDistanceMeters >= 11_000 ? 4 : 3;
  const waypointCounts = [primaryWaypointCount, primaryWaypointCount === 4 ? 3 : 4];
  const distanceScales = [0.9, 1.0, 1.1];
  const circuits: Circuit[] = [];

  for (const count of waypointCounts) {
    for (const scale of distanceScales) {
      const waypointDistance = (targetDistanceMeters / (count + 1)) * scale;
      const candidates = await findFarPointCandidates(
        start,
        waypointDistance,
        profile,
        customModel,
        blockArea
      );
      if (candidates.length < count) continue;

      const waypointSets = buildWaypointSets(candidates, count, waypointDistance);
      for (const waypointSet of waypointSets) {
        circuits.push(await buildCircuit(start, waypointSet, profile, customModel, blockArea));
        circuits.push(
          await buildCircuit(start, [...waypointSet].reverse(), profile, customModel, blockArea)
        );
      }
    }
    if (circuits.length) break;
  }

  if (!circuits.length) throw new Error('No circuit found');

  circuits.sort((a, b) => {
    const distanceDelta =
      Math.abs(a.totalDistance - targetDistanceMeters) - Math.abs(b.totalDistance - targetDistanceMeters);
    if (distanceDelta !== 0) return distanceDelta;
    const overlapDelta = a.overlapRatio - b.overlapRatio;
    if (overlapDelta !== 0) return overlapDelta;
    return attractiveness(b) - attractiveness(a);
  });

  const best = circuits[0];
  if (
    Math.abs(best.totalDistance - targetDistanceMeters) / targetDistanceMeters > 0.05 ||
    best.overlapRatio > 0.05
  ) {
    throw new Error('Unable to reach target distance within tolerance');
  }

  return best;
}
