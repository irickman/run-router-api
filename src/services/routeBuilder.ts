/* eslint-disable import/order */
import { Profile, route } from '../clients/graphhopperClient';
import { geocode } from '../clients/mapboxClient';
import { RouteParametersParsed } from '../utils/jsonSchema';
import { bboxFromPoint } from '../utils/bbox';
import { fallbackPerimeter, perimeterWaypoints } from './perimeter';
import { generateLoop } from './loopGenerator';
import { edgeKeys, penalizedRoute, sharedEdgeRatioSets, EdgeSet } from '../utils/sharedEdges';
import { elevationGainFromCoords, haversineDistance } from '../utils/geometry';
import { smoothRoute } from '../utils/routeSmoothing';

interface BuildContext {
  params: RouteParametersParsed;
  start: [number, number];
  targetMeters: number;
  profile: Profile;
}

export interface BuiltRoute {
  coordinates: [number, number, number?][];
  distance: number;
  time: number;
  ascend: number;
}

export async function buildRoute(ctx: BuildContext): Promise<BuiltRoute> {
  const shape = ctx.params.shape.type;
  const hasLandmark = ctx.params.location.landmarks.length > 0;
  const baseRoutingModel = buildElevationModel(ctx.params.terrain.elevation);
  const blockArea = await resolveAvoidBlockArea(ctx.start, ctx.params.location.avoidStreets);

  let best = await buildRouteForShape(
    ctx,
    shape,
    // Point-to-point requests should route directly to endPoint first, even if landmarks were extracted.
    shape === 'point-to-point' ? false : hasLandmark,
    baseRoutingModel,
    blockArea
  );
  const maxGain = ctx.params.terrain.elevation.maxGain;
  if (maxGain !== null && best.ascend > maxGain + 30.48) {
    const constrainedModel = buildElevationModel({
      ...ctx.params.terrain.elevation,
      profile: 'flat',
      preference: 'minimize',
    });
    const constrained = await buildRouteForShape(ctx, shape, hasLandmark, constrainedModel, blockArea);
    if (constrained.ascend < best.ascend) best = constrained;
  }

  const smoothed = smoothRoute(best.coordinates);
  if (smoothed.distanceRemoved > 0) {
    best = {
      ...best,
      coordinates: smoothed.coords,
      distance: best.distance - smoothed.distanceRemoved,
    };
  }

  return best;
}

async function buildRouteForShape(
  ctx: BuildContext,
  shape: string,
  hasLandmark: boolean,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  if (hasLandmark) return await landmarkRoute(ctx, shape, routingModel, blockArea);
  if (shape === 'point-to-point') return await pointToPoint(ctx, routingModel, blockArea);
  if (shape === 'out-and-back') return await outAndBack(ctx, routingModel, blockArea);

  return await loopRoute(ctx, routingModel, blockArea);
}

async function loopRoute(
  ctx: BuildContext,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  const circuit = await generateLoop(ctx.start, ctx.targetMeters, ctx.profile, routingModel, blockArea);
  return {
    coordinates: circuit.coordinates,
    distance: circuit.totalDistance,
    time: circuit.totalTime,
    ascend: circuit.totalAscend,
  };
}

async function landmarkRoute(
  ctx: BuildContext,
  shape: string,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  const geocoded: [number, number][] = [];
  for (const name of ctx.params.location.landmarks) {
    try {
      const [geo] = await geocode(name, ctx.start);
      if (geo && haversineDistance(ctx.start, geo.coordinates) < 100_000) geocoded.push(geo.coordinates);
    } catch {
      // Landmark geocoding failures are non-blocking; perimeter fallback handles route continuity.
    }
  }

  let waypointSet: [number, number][] = geocoded;
  if (!waypointSet.length) {
    waypointSet = fallbackPerimeter(ctx.start, ctx.targetMeters);
  } else {
    const bbox = bboxFromPoint(ctx.start);
    const perimeter = await perimeterWaypoints(ctx.params.location.landmarks[0], bbox);
    if (perimeter.length) {
      const maxPerimeter = Math.max(2, Math.ceil(ctx.targetMeters / 500));
      const capped = perimeter.slice(0, Math.min(perimeter.length, maxPerimeter));
      waypointSet.push(...capped);
    }
  }

  const geocodedCount = geocoded.length;
  let best = await buildLandmarkLegs(
    ctx.start,
    waypointSet,
    shape,
    ctx.profile,
    routingModel,
    blockArea
  );

  let optimizedWaypoints = [...waypointSet];
  const isCircuit = shape === 'loop' || shape === 'flexible' || shape === 'out-and-back';
  if (isCircuit) {
    // Shrink: if over target, progressively remove farthest non-landmark waypoints.
    for (let iteration = 0; iteration < 5; iteration++) {
      if (best.distance <= ctx.targetMeters * 1.05) break;
      if (optimizedWaypoints.length <= geocodedCount) break;
      const farthestIdx = farthestWaypointIndex(ctx.start, optimizedWaypoints, geocodedCount);
      if (farthestIdx < 0) break;
      optimizedWaypoints.splice(farthestIdx, 1);
      const candidate = await buildLandmarkLegs(
        ctx.start,
        optimizedWaypoints,
        shape,
        ctx.profile,
        routingModel,
        blockArea
      );
      if (Math.abs(candidate.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
        best = candidate;
      } else {
        break;
      }
    }

    // Extend: if under target, insert intermediate waypoints.
    for (let iteration = 0; iteration < 3; iteration++) {
      const ratio = Math.abs(best.distance - ctx.targetMeters) / ctx.targetMeters;
      if (ratio <= 0.05) break;
      if (best.distance > ctx.targetMeters) break;

      const deficit = ctx.targetMeters - best.distance;
      optimizedWaypoints = insertIntermediateWaypoint(
        ctx.start,
        optimizedWaypoints,
        deficit,
        shape,
        0.6
      );

      const candidate = await buildLandmarkLegs(
        ctx.start,
        optimizedWaypoints,
        shape,
        ctx.profile,
        routingModel,
        blockArea
      );
      if (Math.abs(candidate.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
        best = candidate;
      } else {
        break;
      }
    }
  }

  return best;
}

function farthestWaypointIndex(
  start: [number, number],
  waypoints: [number, number][],
  protectedCount: number
): number {
  let farthestIdx = -1;
  let farthestDist = -1;
  for (let i = protectedCount; i < waypoints.length; i++) {
    const dist = euclideanMeters(start, waypoints[i]);
    if (dist > farthestDist) {
      farthestDist = dist;
      farthestIdx = i;
    }
  }
  return farthestIdx;
}

async function buildLandmarkLegs(
  start: [number, number],
  waypointSet: [number, number][],
  shape: string,
  profile: Profile,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  const legs: [number, number][] = [start, ...waypointSet];
  if (shape === 'loop' || shape === 'flexible' || shape === 'out-and-back') legs.push(start);

  const pathCoords: [number, number, number?][] = [];
  let distance = 0;
  let time = 0;
  let usedEdges: EdgeSet = new Set<string>();
  for (let i = 0; i < legs.length - 1; i++) {
    const leg = await route([legs[i], legs[i + 1]], profile, {
      alternative: true,
      customModel: routingModel,
      blockArea,
    });
    const edges = edgeKeys(leg.points);
    const overlap = sharedEdgeRatioSets(usedEdges, edges);
    let chosen = leg;
    let chosenEdges = edges;

    if (overlap > 0.05) {
      const alt = await penalizedRoute(
        [legs[i], legs[i + 1]],
        profile,
        usedEdges,
        routingModel,
        blockArea
      );
      const altEdges = edgeKeys(alt.points);
      const altOverlap = sharedEdgeRatioSets(usedEdges, altEdges);
      if (altOverlap <= overlap) {
        chosen = alt;
        chosenEdges = altEdges;
      }
    }

    usedEdges = new Set([...usedEdges, ...chosenEdges]);
    pathCoords.push(...chosen.points);
    distance += chosen.distance;
    time += chosen.time;
  }
  return {
    coordinates: pathCoords,
    distance,
    time,
    ascend: elevationGainFromCoords(pathCoords),
  };
}

function insertIntermediateWaypoint(
  start: [number, number],
  waypoints: [number, number][],
  deficitMeters: number,
  shape: string,
  damping: number
): [number, number][] {
  const circuitLegs: [number, number][] = [start, ...waypoints];
  if (shape === 'loop' || shape === 'flexible' || shape === 'out-and-back') circuitLegs.push(start);
  if (circuitLegs.length < 2) return waypoints;

  let longestLegIdx = 0;
  let longestLegDist = -1;
  for (let i = 0; i < circuitLegs.length - 1; i++) {
    const dist = euclideanMeters(circuitLegs[i], circuitLegs[i + 1]);
    if (dist > longestLegDist) {
      longestLegDist = dist;
      longestLegIdx = i;
    }
  }

  const from = circuitLegs[longestLegIdx];
  const to = circuitLegs[longestLegIdx + 1];
  const detour = detourWaypoint(from, to, Math.max(100, deficitMeters * damping * 0.5));

  const insertionIndex = Math.max(0, Math.min(waypoints.length, longestLegIdx));
  return [...waypoints.slice(0, insertionIndex), detour, ...waypoints.slice(insertionIndex)];
}

function detourWaypoint(
  from: [number, number],
  to: [number, number],
  offsetMeters: number
): [number, number] {
  const midLng = (from[0] + to[0]) / 2;
  const midLat = (from[1] + to[1]) / 2;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  const perpX = -dy / length;
  const perpY = dx / length;

  const latMeters = 111320;
  const lngMeters = Math.max(1, latMeters * Math.cos((midLat * Math.PI) / 180));
  const offsetLng = (offsetMeters * perpX) / lngMeters;
  const offsetLat = (offsetMeters * perpY) / latMeters;
  return [midLng + offsetLng, midLat + offsetLat];
}

function euclideanMeters(a: [number, number], b: [number, number]): number {
  const avgLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const lngScale = 111320 * Math.cos(avgLat);
  const dx = (b[0] - a[0]) * lngScale;
  const dy = (b[1] - a[1]) * 111320;
  return Math.hypot(dx, dy);
}

async function outAndBack(
  ctx: BuildContext,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  let projectionDistance = ctx.targetMeters / 2;

  for (let attempt = 0; attempt < 2; attempt++) {
    const far = projectOut(ctx.start, projectionDistance);
    const outLeg = await route([ctx.start, far], ctx.profile, {
      alternative: true,
      customModel: routingModel,
      blockArea,
    });
    const backLeg = await route([far, ctx.start], ctx.profile, {
      alternative: true,
      customModel: routingModel,
      blockArea,
    });
    const totalDistance = outLeg.distance + backLeg.distance;

    if (attempt === 0 && totalDistance > ctx.targetMeters * 1.1) {
      projectionDistance *= ctx.targetMeters / totalDistance;
      continue;
    }

    return {
      coordinates: [...outLeg.points, ...backLeg.points],
      distance: totalDistance,
      time: outLeg.time + backLeg.time,
      ascend: (outLeg.ascend ?? 0) + (backLeg.ascend ?? 0),
    };
  }

  // Unreachable, but satisfies return type.
  throw new Error('out-and-back routing failed');
}

async function pointToPoint(
  ctx: BuildContext,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  const end = await resolveEnd(ctx);
  if (!end) {
    // Preserve a usable route when destination geocoding fails.
    return await outAndBack(ctx, routingModel, blockArea);
  }
  const leg = await route([ctx.start, end], ctx.profile, {
    customModel: routingModel,
    blockArea,
  });
  return { coordinates: leg.points, distance: leg.distance, time: leg.time, ascend: leg.ascend ?? 0 };
}

async function resolveEnd(ctx: BuildContext): Promise<[number, number] | null> {
  const name = ctx.params.location.endPoint || ctx.params.location.landmarks[0];
  if (name) {
    try {
      const [geo] = await geocode(name, ctx.start);
      if (geo && haversineDistance(ctx.start, geo.coordinates) < 100_000) return geo.coordinates;
    } catch {
      // Start location fallback is intentional for point-to-point geocoding misses.
    }
  }
  return null;
}

function projectOut(start: [number, number], distanceMeters: number): [number, number] {
  const dLat = (distanceMeters / 6371e3) * (180 / Math.PI);
  return [start[0], start[1] + dLat];
}

async function resolveAvoidBlockArea(
  start: [number, number],
  avoidStreets: string[] | undefined
): Promise<string | undefined> {
  const avoid = (avoidStreets ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (!avoid.length) return undefined;

  const circles: string[] = [];
  for (const street of avoid) {
    try {
      const [geo] = await geocode(street, start);
      if (!geo) continue;
      if (haversineDistance(start, geo.coordinates) > 100_000) continue;
      const [lng, lat] = geo.coordinates;
      circles.push(`${lat},${lng},120`);
    } catch {
      // Ignore unresolved avoid-street constraints.
    }
  }

  return circles.length ? circles.join(';') : undefined;
}

function buildElevationModel(elevation: BuildContext['params']['terrain']['elevation']): unknown {
  const wantMinimize =
    elevation.preference === 'minimize' || elevation.profile === 'flat' || elevation.maxGain !== null;
  const wantMaximize =
    elevation.preference === 'maximize' ||
    elevation.profile === 'hilly' ||
    elevation.profile === 'mountainous';

  if (!wantMinimize && !wantMaximize && elevation.profile !== 'rolling') return undefined;

  if (wantMinimize) {
    return {
      speed: [
        { if: 'average_slope >= 10', limit_to: '1.8' },
        { else_if: 'average_slope >= 6', limit_to: '2.3' },
        { else_if: 'average_slope >= 3', limit_to: '2.8' },
      ],
    };
  }

  if (wantMaximize) {
    return {
      priority: [
        { if: 'average_slope >= 4', multiply_by: '1.15' },
        { if: 'average_slope >= 8', multiply_by: '1.3' },
      ],
    };
  }

  return {
    priority: [{ if: 'average_slope >= 3', multiply_by: '1.08' }],
  };
}
