/* eslint-disable import/order */
import { Profile, route } from '../clients/graphhopperClient';
import { geocode, bboxFromProximity, GeocodeResult } from '../clients/mapboxClient';
import { nominatimGeocode } from '../clients/nominatimClient';
import { RouteParametersParsed } from '../utils/jsonSchema';
import { bboxFromPoint } from '../utils/bbox';
import { fallbackPerimeter, perimeterWaypoints } from './perimeter';
import { generateLoop } from './loopGenerator';
import { edgeKeys, penalizedRoute, sharedEdgeRatioSets, EdgeSet } from '../utils/sharedEdges';
import { elevationGainFromCoords, haversineDistance, metersToMiles } from '../utils/geometry';
import { smoothRoute } from '../utils/routeSmoothing';
import { RouteConstraintError } from '../utils/httpErrors';
import { fetchTrailNetworkWaypoints } from '../clients/overpassRouteRelations';
import { logInfo } from '../utils/logger';

interface BuildContext {
  params: RouteParametersParsed;
  start: [number, number];
  targetMeters: number;
  profile: Profile;
  geocodedLandmarks?: Map<string, [number, number]>;
  routableLandmarks?: string[];
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
  const hasLongMultiLandmarkSketch =
    ctx.targetMeters > 30_000 && ctx.params.location.landmarks.length >= 2 && isOutdoorDistanceSketch(ctx);
  let useLandmark = shape !== 'point-to-point' && hasLandmark && !hasLongMultiLandmarkSketch;

  if (useLandmark) {
    await checkLandmarkFeasibility(ctx);
    if (ctx.routableLandmarks && ctx.routableLandmarks.length === 0) {
      useLandmark = false;
    }
  }

  const elevationModel = buildElevationModel(ctx.params.terrain.elevation);
  const popularityModel = buildPopularityModel(ctx.params.preferences.crowdedness);
  const baseRoutingModel = mergeCustomModels(elevationModel, popularityModel);
  let blockArea = await resolveAvoidBlockArea(ctx.start, ctx.params.location.avoidStreets);

  // Phase B: enhance busy/quiet with trail network data
  const crowdedness = ctx.params.preferences.crowdedness;
  let trailWaypoints: [number, number][] = [];
  if (crowdedness === 'busy' || crowdedness === 'quiet') {
    try {
      const trails = await fetchTrailNetworkWaypoints(ctx.start, ctx.targetMeters);
      if (crowdedness === 'quiet' && trails.length > 0) {
        const trailCircles = trails.map((t) => `${t.coordinates[1]},${t.coordinates[0]},80`);
        blockArea = blockArea ? `${blockArea};${trailCircles.join(';')}` : trailCircles.join(';');
      } else if (crowdedness === 'busy') {
        trailWaypoints = trails.map((t) => t.coordinates);
      }
    } catch { /* Overpass failure is non-blocking; Phase A heuristic still applies */ }
  }

  let best: BuiltRoute;
  try {
    best = await buildRouteAttempt(ctx, shape, useLandmark, trailWaypoints, baseRoutingModel, blockArea);
  } catch (err) {
    if (err instanceof RouteConstraintError) throw err;
    if (isRoutingFailure(err)) {
      if (!useLandmark && hasLandmark && hasLongMultiLandmarkSketch) {
        try {
          best = await buildRouteAttempt(ctx, shape, true, trailWaypoints, baseRoutingModel, blockArea);
        } catch {
          if (ctx.profile !== 'foot') {
            try {
              best = await buildRouteAttempt(
                { ...ctx, profile: 'foot' },
                shape,
                true,
                trailWaypoints,
                baseRoutingModel,
                blockArea
              );
            } catch {
              throw noRouteFound();
            }
          } else {
            throw noRouteFound();
          }
        }
      } else if (ctx.profile !== 'foot') {
        try {
          best = await buildRouteAttempt(
            { ...ctx, profile: 'foot' },
            shape,
            useLandmark,
            trailWaypoints,
            baseRoutingModel,
            blockArea
          );
        } catch {
          throw noRouteFound();
        }
      } else {
        throw noRouteFound();
      }
    } else {
      throw err;
    }
  }

  const maxGain = ctx.params.terrain.elevation.maxGain;
  if (maxGain !== null && best.ascend > maxGain + 30.48) {
    const constrainedModel = buildElevationModel({
      ...ctx.params.terrain.elevation,
      profile: 'flat',
      preference: 'minimize',
    });
    try {
      const constrained = await buildRouteForShape(ctx, shape, useLandmark, constrainedModel, blockArea);
      if (constrained.ascend < best.ascend) best = constrained;
    } catch { /* keep existing best */ }
  }

  best = await improveBadDistanceFallback(ctx, best, shape, baseRoutingModel, blockArea);

  const smoothed = smoothRoute(best.coordinates);
  if (smoothed.distanceRemoved > 0) {
    best = {
      ...best,
      coordinates: smoothed.coords,
      distance: best.distance - smoothed.distanceRemoved,
    };
  }
  if (smoothed.distanceRemoved / best.distance > 0.1) {
    logInfo("smoothing removed >10% distance", { removed: smoothed.distanceRemoved, original: best.distance });
  }

  return best;
}

async function buildRouteAttempt(
  ctx: BuildContext,
  shape: string,
  useLandmark: boolean,
  trailWaypoints: [number, number][],
  routingModel?: unknown,
  blockArea?: string,
): Promise<BuiltRoute> {
  const maxCorrectionIterations = ctx.targetMeters >= 25_000 ? 3 : 5;
  const correctionTolerancePct = ctx.targetMeters >= 25_000 ? 0.18 : 0.10;

  if (useLandmark) {
    return correctDistance(
      (scaled) => buildRouteForShape(
        { ...ctx, targetMeters: scaled }, shape, true, routingModel, blockArea
      ),
      ctx.targetMeters,
      maxCorrectionIterations,
      correctionTolerancePct,
    );
  }

  if (trailWaypoints.length > 0 && shape !== 'point-to-point') {
    return correctDistance(
      () => buildLandmarkLegs(ctx.start, trailWaypoints, shape, ctx.profile, routingModel, blockArea),
      ctx.targetMeters,
      maxCorrectionIterations,
      correctionTolerancePct,
    );
  }

  return correctDistance(
    (scaled) => buildRouteForShape(
      { ...ctx, targetMeters: scaled }, shape, false, routingModel, blockArea
    ),
    ctx.targetMeters,
    maxCorrectionIterations,
    correctionTolerancePct,
  );
}

function noRouteFound(): RouteConstraintError {
  return new RouteConstraintError({
    reason: 'NO_ROUTE_FOUND',
    explanation: 'Could not find a routable path for this request. Try a different starting point, adjust your distance, or try a different route shape.',
  });
}

async function improveBadDistanceFallback(
  ctx: BuildContext,
  best: BuiltRoute,
  shape: string,
  routingModel?: unknown,
  blockArea?: string,
): Promise<BuiltRoute> {
  if (!['loop', 'flexible', 'lollipop', 'out-and-back'].includes(shape)) return best;
  const currentError = Math.abs(best.distance - ctx.targetMeters) / ctx.targetMeters;
  if (currentError <= 0.25) return best;

  if (best.distance > ctx.targetMeters * 1.25) {
    const shortened = await shortenCircuitToTarget(ctx, best, routingModel, blockArea);
    if (shortened && Math.abs(shortened.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
      best = shortened;
    }
  }

  const candidates: BuiltRoute[] = [];
  for (const profile of [ctx.profile, 'foot'] as Profile[]) {
    try {
      candidates.push(await outAndBack({ ...ctx, profile }, routingModel, blockArea));
    } catch {
      // Keep the original route when the distance-first fallback cannot route.
    }
  }

  for (const candidate of candidates) {
    if (Math.abs(candidate.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
      best = candidate;
    }
  }
  return best;
}

async function shortenCircuitToTarget(
  ctx: BuildContext,
  routeToShorten: BuiltRoute,
  routingModel?: unknown,
  blockArea?: string,
): Promise<BuiltRoute | null> {
  const coords = routeToShorten.coordinates;
  if (coords.length < 20) return null;

  let cumulative = 0;
  const distances: number[] = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative += haversineDistance(
      [coords[i - 1][0], coords[i - 1][1]],
      [coords[i][0], coords[i][1]]
    );
    distances[i] = cumulative;
  }

  let best: BuiltRoute | null = null;
  const step = Math.max(10, Math.floor(coords.length / 24));
  for (let i = step; i < coords.length - step; i += step) {
    const prefixDistance = distances[i];
    if (prefixDistance < ctx.targetMeters * 0.45 || prefixDistance > ctx.targetMeters * 1.05) continue;
    const cut: [number, number] = [coords[i][0], coords[i][1]];
    try {
      const returnLeg = await route([cut, ctx.start], ctx.profile, {
        customModel: routingModel,
        blockArea,
      });
      const candidateCoords = [...coords.slice(0, i + 1), ...returnLeg.points.slice(1)];
      const candidate: BuiltRoute = {
        coordinates: candidateCoords,
        distance: prefixDistance + returnLeg.distance,
        time: routeToShorten.time * (prefixDistance / routeToShorten.distance) + returnLeg.time,
        ascend: elevationGainFromCoords(candidateCoords),
      };
      if (!best || Math.abs(candidate.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
        best = candidate;
      }
    } catch {
      // Some cut points are not routable on the deployed graph.
    }
  }

  return best;
}

async function correctDistance(
  buildFn: (scaledTarget: number) => Promise<BuiltRoute>,
  targetMeters: number,
  maxIterations = 5,
  tolerancePct = 0.10,
): Promise<BuiltRoute> {
  let best: BuiltRoute | null = null;
  let scaledTarget = targetMeters;

  for (let i = 0; i < maxIterations; i++) {
    let result: BuiltRoute;
    try {
      result = await buildFn(scaledTarget);
    } catch (err) {
      if (!best) throw err;
      break;
    }
    if (!best || Math.abs(result.distance - targetMeters) < Math.abs(best.distance - targetMeters)) {
      best = result;
    }
    const errorPct = Math.abs(best.distance - targetMeters) / targetMeters;
    if (errorPct <= tolerancePct) break;
    if (result.distance <= 0) break;
    scaledTarget = scaledTarget * (targetMeters / result.distance);
  }

  return best!;
}

function searchRadius(targetMeters: number): number {
  return Math.max(8_047, targetMeters * 2);
}

async function geocodeWithFallback(
  query: string,
  proximity: [number, number],
  bbox?: [number, number, number, number],
): Promise<GeocodeResult[]> {
  try {
    const results = await geocode(query, proximity, bbox);
    const nearbyResults = sortNearbyGeocodeResults(results, proximity);
    if (nearbyResults.length > 0) {
      return nearbyResults;
    }
    const nomResults = await nominatimGeocode(query, proximity);
    const nearbyNomResults = sortNearbyGeocodeResults(nomResults, proximity);
    if (nearbyNomResults.length > 0) return nearbyNomResults;
    return results;
  } catch {
    try {
      return sortNearbyGeocodeResults(await nominatimGeocode(query, proximity), proximity);
    } catch {
      return [];
    }
  }
}

function sortNearbyGeocodeResults(
  results: GeocodeResult[],
  proximity: [number, number],
  maxDistanceMeters = 40_234,
): GeocodeResult[] {
  return results
    .map((result) => ({
      result,
      distance: haversineDistance(proximity, result.coordinates),
    }))
    .filter(({ distance }) => distance < maxDistanceMeters)
    .sort((a, b) => a.distance - b.distance)
    .map(({ result }) => result);
}

function minDistanceForShape(shape: string, distMeters: number): number {
  switch (shape) {
    case 'out-and-back': return distMeters * 2.4;
    case 'point-to-point': return distMeters * 1.3;
    case 'lollipop': return distMeters * 2.3;
    case 'loop':
    case 'flexible': return distMeters * 1.3;
    default: return distMeters * 2.6;
  }
}

async function checkLandmarkFeasibility(ctx: BuildContext) {
  const bbox = bboxFromProximity(ctx.start, searchRadius(ctx.targetMeters));
  const shape = ctx.params.shape.type;
  if (!ctx.geocodedLandmarks) ctx.geocodedLandmarks = new Map();
  ctx.routableLandmarks = [];
  for (const name of ctx.params.location.landmarks) {
    try {
      const [geo] = await geocodeWithFallback(name, ctx.start, bbox);
      if (!geo) continue;
      const dist = haversineDistance(ctx.start, geo.coordinates);
      const minFeasible = minDistanceForShape(shape, dist);
      if (minFeasible > ctx.targetMeters * 1.2) {
        if (isTrailGuidanceRequest(ctx)) continue;
        const distMiles = Math.round(metersToMiles(dist) * 10) / 10;
        const suggestedMiles = Math.ceil(metersToMiles(minFeasible));

        const ALL_SHAPES = ['loop', 'out-and-back', 'point-to-point', 'lollipop', 'flexible'];
        const suggestedShapes = ALL_SHAPES
          .filter((s) => s !== shape)
          .map((s) => ({ shape: s, minDistanceMiles: Math.ceil(metersToMiles(minDistanceForShape(s, dist))) }))
          .filter((s) => s.minDistanceMiles <= 100)
          .filter((s) => s.minDistanceMiles < suggestedMiles)
          .sort((a, b) => a.minDistanceMiles - b.minDistanceMiles);

        throw new RouteConstraintError({
          reason: 'LANDMARK_TOO_FAR',
          explanation: `${name} is about ${distMiles} miles from your starting point. A ${shape} can't reach it at your target distance.`,
          suggestedDistanceMiles: suggestedMiles,
          suggestedShapes: suggestedShapes.length > 0 ? suggestedShapes : undefined,
        });
      }
      ctx.geocodedLandmarks.set(name, geo.coordinates);
      ctx.routableLandmarks.push(name);
    } catch (err) {
      if (err instanceof RouteConstraintError) throw err;
    }
  }
}

function isTrailGuidanceRequest(ctx: BuildContext): boolean {
  return (
    ctx.profile === 'trail' ||
    ctx.profile === 'hike' ||
    ctx.params.terrain.surfaces.some((surface) => (
      surface.type === 'trail' && surface.preference !== 'avoid'
    )) ||
    ctx.params.location.landmarks.some((name) => (
      /\b(mountain|hill|trail|trails|ridge|peak|lake|canyon|creek|park|wonderland)\b/i.test(name)
    ))
  );
}

function isOutdoorDistanceSketch(ctx: BuildContext): boolean {
  return (
    ctx.profile === 'trail' ||
    ctx.profile === 'hike' ||
    ctx.params.terrain.surfaces.some((surface) => (
      surface.type === 'trail' && surface.preference !== 'avoid'
    )) ||
    ctx.params.location.landmarks.some((name) => (
      /\b(mountain|trail|trails|peak|canyon|creek|wonderland)\b/i.test(name)
    ))
  );
}

async function buildRouteForShape(
  ctx: BuildContext,
  shape: string,
  hasLandmark: boolean,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  if (hasLandmark) {
    if (shape === 'lollipop') {
      return await lollipopRoute(ctx, routingModel, blockArea);
    }
    if ((shape === 'loop' || shape === 'flexible') && shouldAutoLollipop(ctx)) {
      return await lollipopRoute(ctx, routingModel, blockArea);
    }
    return await landmarkRoute(ctx, shape, routingModel, blockArea);
  }
  if (shape === 'point-to-point') return await pointToPoint(ctx, routingModel, blockArea);
  if (shape === 'out-and-back') return await outAndBack(ctx, routingModel, blockArea);

  return await loopRoute(ctx, routingModel, blockArea);
}

function shouldAutoLollipop(ctx: BuildContext): boolean {
  if (!ctx.geocodedLandmarks?.size) return false;
  const firstLandmark = ctx.params.location.landmarks[0];
  const coords = ctx.geocodedLandmarks.get(firstLandmark);
  if (!coords) return false;
  const dist = haversineDistance(ctx.start, coords);
  return dist > ctx.targetMeters * 0.3;
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
  const bbox = bboxFromProximity(ctx.start, searchRadius(ctx.targetMeters));
  const geocoded: [number, number][] = [];
  const landmarkNames = ctx.routableLandmarks ?? ctx.params.location.landmarks;
  for (const name of landmarkNames) {
    try {
      const cached = ctx.geocodedLandmarks?.get(name);
      const geo = cached ? { coordinates: cached } : (await geocodeWithFallback(name, ctx.start, bbox))[0];
      if (geo && haversineDistance(ctx.start, geo.coordinates) < searchRadius(ctx.targetMeters)) geocoded.push(geo.coordinates);
    } catch {
      // Landmark geocoding failures are non-blocking; perimeter fallback handles route continuity.
    }
  }

  let waypointSet: [number, number][] = geocoded;
  if (!waypointSet.length) {
    waypointSet = fallbackPerimeter(ctx.start, ctx.targetMeters);
  } else {
    const perimeterBbox = bboxFromPoint(ctx.start);
    const traversalMode = ctx.params.location.landmarkTraversalModes?.[0];
    const perimeterResult = await perimeterWaypoints(landmarkNames[0], perimeterBbox, traversalMode);
    if (perimeterResult.waypoints.length) {
      const maxPerimeter = Math.max(2, Math.ceil(ctx.targetMeters / 500));
      const capped = perimeterResult.waypoints.slice(0, Math.min(perimeterResult.waypoints.length, maxPerimeter));
      waypointSet.push(...capped);
    }
  }

  const geocodedCount = geocoded.length;
  let best: BuiltRoute;
  try {
    best = await buildLandmarkLegs(
      ctx.start,
      waypointSet,
      shape,
      ctx.profile,
      routingModel,
      blockArea
    );
  } catch (err) {
    if (!isRoutingFailure(err)) throw err;
    try {
      return await loopRoute(ctx, routingModel, blockArea);
    } catch {
      return await outAndBack(ctx, routingModel, blockArea);
    }
  }

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

  if (isCircuit && best.distance < ctx.targetMeters * 0.65) {
    try {
      const loopFallback = await loopRoute(ctx, routingModel, blockArea);
      if (Math.abs(loopFallback.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
        best = loopFallback;
      }
    } catch {
      // Keep the landmark path if the loop fallback cannot be built.
    }
    if (best.distance < ctx.targetMeters * 0.65 && ctx.profile !== 'foot') {
      try {
        const footFallback = await loopRoute({ ...ctx, profile: 'foot' }, routingModel, blockArea);
        if (Math.abs(footFallback.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
          best = footFallback;
        }
      } catch {
        // Keep the current best if the foot-profile fallback cannot be built.
      }
    }
    if (best.distance < ctx.targetMeters * 0.65) {
      try {
        const outBackFallback = await outAndBack({ ...ctx, profile: 'foot' }, undefined, blockArea);
        if (Math.abs(outBackFallback.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
          best = outBackFallback;
        }
      } catch {
        // Keep the current best if the distance fallback cannot be built.
      }
    }
  }

  return best;
}

async function lollipopRoute(
  ctx: BuildContext,
  routingModel?: unknown,
  blockArea?: string
): Promise<BuiltRoute> {
  const bbox = bboxFromProximity(ctx.start, searchRadius(ctx.targetMeters));
  let landmarkCoord: [number, number] | undefined;

  // Reuse cached geocode result if available
  const landmarkName = ctx.params.location.landmarks[0];
  if (ctx.geocodedLandmarks?.has(landmarkName)) {
    landmarkCoord = ctx.geocodedLandmarks.get(landmarkName);
  } else {
    try {
      const [geo] = await geocodeWithFallback(landmarkName, ctx.start, bbox);
      if (geo && haversineDistance(ctx.start, geo.coordinates) < searchRadius(ctx.targetMeters)) {
        landmarkCoord = geo.coordinates;
      }
    } catch { /* fall through to fallback */ }
  }

  if (!landmarkCoord) {
    return await outAndBack(ctx, routingModel, blockArea);
  }

  // Step 1: Route start -> landmark (stem out)
  const stemOut = await route([ctx.start, landmarkCoord], ctx.profile, {
    customModel: routingModel,
    blockArea,
  });
  const stemDistance = stemOut.distance;

  // Step 2: Compute loop budget
  const loopBudget = ctx.targetMeters - (2 * stemDistance);
  if (loopBudget < Math.max(400, ctx.targetMeters * 0.15)) {
    return await outAndBack(ctx, routingModel, blockArea);
  }

  // Step 3: Generate loop at landmark
  let loop;
  try {
    loop = await generateLoop(landmarkCoord, loopBudget, ctx.profile, routingModel, blockArea);
  } catch {
    return await outAndBack(ctx, routingModel, blockArea);
  }

  // Step 4: Route landmark -> start with edge avoidance
  const avoidedEdges = edgeKeys(stemOut.points);
  const stemBack = await penalizedRoute(
    [landmarkCoord, ctx.start],
    ctx.profile,
    avoidedEdges,
    routingModel,
    blockArea
  );

  // Step 5: Concatenate stem-out + loop + stem-back, removing duplicate junction points
  const coordinates: [number, number, number?][] = [...stemOut.points];

  // Append loop coordinates, skip first point if it matches end of stem-out
  const loopCoords = loop.coordinates;
  if (loopCoords.length > 0) {
    const lastStem = coordinates[coordinates.length - 1];
    const firstLoop = loopCoords[0];
    const startIdx = (lastStem[0] === firstLoop[0] && lastStem[1] === firstLoop[1]) ? 1 : 0;
    coordinates.push(...loopCoords.slice(startIdx));
  }

  // Append stem-back coordinates, skip first point if it matches end of loop
  if (stemBack.points.length > 0) {
    const lastCoord = coordinates[coordinates.length - 1];
    const firstBack = stemBack.points[0];
    const startIdx = (lastCoord[0] === firstBack[0] && lastCoord[1] === firstBack[1]) ? 1 : 0;
    coordinates.push(...stemBack.points.slice(startIdx));
  }

  return {
    coordinates,
    distance: stemOut.distance + loop.totalDistance + stemBack.distance,
    time: stemOut.time + loop.totalTime + stemBack.time,
    ascend: (stemOut.ascend ?? 0) + loop.totalAscend + (stemBack.ascend ?? 0),
  };
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
    let leg;
    try {
      leg = await route([legs[i], legs[i + 1]], profile, {
        alternative: true,
        customModel: routingModel,
        blockArea,
      });
    } catch {
      leg = await route([legs[i], legs[i + 1]], profile, {
        customModel: routingModel,
        blockArea,
      });
    }
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
  const halfTarget = ctx.targetMeters / 2;
  const bearings = [0, 90, 180, 270];

  let bestBearing = 0;
  let bestDiff = Infinity;
  for (const bearing of bearings) {
    const far = projectBearing(ctx.start, bearing, halfTarget);
    try {
      const leg = await route([ctx.start, far], ctx.profile, { customModel: routingModel, blockArea });
      const diff = Math.abs(leg.distance - halfTarget);
      if (diff < bestDiff) { bestDiff = diff; bestBearing = bearing; }
    } catch { /* skip unreachable bearings */ }
  }

  let projDist = halfTarget;
  let best: BuiltRoute | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const far = projectBearing(ctx.start, bestBearing, projDist);
    const outLeg = await route([ctx.start, far], ctx.profile, {
      alternative: true, customModel: routingModel, blockArea,
    });
    const backLeg = await route([far, ctx.start], ctx.profile, {
      alternative: true, customModel: routingModel, blockArea,
    });
    const total = outLeg.distance + backLeg.distance;

    const candidate: BuiltRoute = {
      coordinates: [...outLeg.points, ...backLeg.points],
      distance: total,
      time: outLeg.time + backLeg.time,
      ascend: (outLeg.ascend ?? 0) + (backLeg.ascend ?? 0),
    };

    if (!best || Math.abs(candidate.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
      best = candidate;
    }
    const errorPct = Math.abs(best.distance - ctx.targetMeters) / ctx.targetMeters;
    if (errorPct <= 0.10) break;
    if (total <= 0) break;
    projDist = projDist * (ctx.targetMeters / total);
  }

  if (!best) throw new Error('out-and-back routing failed');
  return best;
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
  let best: BuiltRoute = { coordinates: leg.points, distance: leg.distance, time: leg.time, ascend: leg.ascend ?? 0 };

  if (best.distance > ctx.targetMeters * 1.25 && isTrailGuidanceRequest(ctx)) {
    try {
      const fallback = await outAndBack(ctx, routingModel, blockArea);
      if (Math.abs(fallback.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
        best = fallback;
      }
    } catch {
      // Keep the endpoint route if distance-first fallback cannot route.
    }
  }

  let waypoints: [number, number][] = [end];

  for (let iteration = 0; iteration < 3; iteration++) {
    if (best.distance >= ctx.targetMeters * 0.9) break;
    const deficit = ctx.targetMeters - best.distance;
    waypoints = insertIntermediateWaypoint(ctx.start, waypoints, deficit, 'point-to-point', 0.8);
    try {
      const candidate = await buildLandmarkLegs(
        ctx.start,
        waypoints,
        'point-to-point',
        ctx.profile,
        routingModel,
        blockArea
      );
      if (Math.abs(candidate.distance - ctx.targetMeters) < Math.abs(best.distance - ctx.targetMeters)) {
        best = candidate;
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  return best;
}

async function resolveEnd(ctx: BuildContext): Promise<[number, number] | null> {
  const name = ctx.params.location.endPoint || ctx.params.location.landmarks[0];
  if (name) {
    try {
      const bbox = bboxFromProximity(ctx.start, searchRadius(ctx.targetMeters));
      const [geo] = await geocodeWithFallback(name, ctx.start, bbox);
      if (geo && haversineDistance(ctx.start, geo.coordinates) < searchRadius(ctx.targetMeters)) return geo.coordinates;
    } catch {
      // Start location fallback is intentional for point-to-point geocoding misses.
    }
  }
  return null;
}

function projectBearing(start: [number, number], bearingDeg: number, distanceMeters: number): [number, number] {
  const R = 6371e3;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (start[1] * Math.PI) / 180;
  const lon1 = (start[0] * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
    Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(brng)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(brng) * Math.sin(distanceMeters / R) * Math.cos(lat1),
    Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
  );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

async function resolveAvoidBlockArea(
  start: [number, number],
  avoidStreets: string[] | undefined
): Promise<string | undefined> {
  const avoid = (avoidStreets ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4);
  if (!avoid.length) return undefined;

  const bbox = bboxFromProximity(start);
  const circles: string[] = [];
  for (const street of avoid) {
    try {
      const [geo] = await geocode(street, start, bbox);
      if (!geo) continue;
      if (haversineDistance(start, geo.coordinates) > 40_234) continue;
      const [lng, lat] = geo.coordinates;
      circles.push(`${lat},${lng},120`);
    } catch {
      // Ignore unresolved avoid-street constraints.
    }
  }

  return circles.length ? circles.join(';') : undefined;
}

function closestCoordIndex(
  coords: [number, number, number?][],
  target: [number, number]
): number {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const dx = coords[i][0] - target[0];
    const dy = coords[i][1] - target[1];
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

export interface SegmentRefineResult {
  coordinates: [number, number, number?][];
  distance: number;
  time: number;
  ascend: number;
  segmentStartIdx: number;
  segmentEndIdx: number;
}

export async function refineSegment(
  originalCoords: [number, number, number?][],
  segmentStart: [number, number],
  segmentEnd: [number, number],
  profile: Profile,
  instruction: string,
  originalTime: number,
  originalDistance: number,
): Promise<SegmentRefineResult> {
  const startIdx = closestCoordIndex(originalCoords, segmentStart);
  let endIdx = closestCoordIndex(originalCoords, segmentEnd);
  if (endIdx <= startIdx) endIdx = Math.min(startIdx + 10, originalCoords.length - 1);

  const segStart: [number, number] = [originalCoords[startIdx][0], originalCoords[startIdx][1]];
  const segEnd: [number, number] = [originalCoords[endIdx][0], originalCoords[endIdx][1]];

  // Try to use the instruction to geocode a waypoint near the segment.
  // If found, route through it so the instruction actually influences the reroute.
  const routePoints: [number, number][] = [segStart];
  const midpoint: [number, number] = [
    (segStart[0] + segEnd[0]) / 2,
    (segStart[1] + segEnd[1]) / 2,
  ];
  try {
    const bbox = bboxFromProximity(midpoint);
    const [geo] = await geocode(instruction, midpoint, bbox);
    if (geo && haversineDistance(midpoint, geo.coordinates) < 40_234) {
      routePoints.push(geo.coordinates);
    }
  } catch {
    // Instruction didn't resolve to a location — fall back to direct reroute.
  }
  routePoints.push(segEnd);

  const newLeg = await route(routePoints, profile, { alternative: true });

  const before = originalCoords.slice(0, startIdx);
  const after = originalCoords.slice(endIdx + 1);
  const merged: [number, number, number?][] = [...before, ...newLeg.points, ...after];

  // Compute distance of the replaced segment from the original geometry so we
  // can pro-rate the preserved portions' time from the original route.
  let replacedDist = 0;
  for (let i = startIdx; i < endIdx; i++) {
    replacedDist += haversineDistance(
      [originalCoords[i][0], originalCoords[i][1]],
      [originalCoords[i + 1][0], originalCoords[i + 1][1]]
    );
  }
  const preservedFraction = originalDistance > 0
    ? Math.max(0, 1 - replacedDist / originalDistance)
    : 0;
  const preservedTime = originalTime * preservedFraction;

  let totalDist = 0;
  for (let i = 0; i < merged.length - 1; i++) {
    totalDist += haversineDistance(
      [merged[i][0], merged[i][1]],
      [merged[i + 1][0], merged[i + 1][1]]
    );
  }
  const totalTime = preservedTime + newLeg.time;

  return {
    coordinates: merged,
    distance: totalDist,
    time: totalTime,
    ascend: elevationGainFromCoords(merged),
    segmentStartIdx: startIdx,
    segmentEndIdx: startIdx + newLeg.points.length - 1,
  };
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
        { if: 'average_slope < 2', multiply_by: '0.75' },
        { else_if: 'average_slope < 4', multiply_by: '0.9' },
      ],
    };
  }

  return {
    priority: [{ if: 'average_slope < 3', multiply_by: '0.92' }],
  };
}

function buildPopularityModel(
  crowdedness: 'busy' | 'quiet' | 'any'
): Record<string, unknown[]> | undefined {
  if (crowdedness === 'busy') {
    return {
      priority: [
        { if: 'road_class == TRACK', multiply_by: '0.8' },
        { if: 'surface == DIRT || surface == GROUND', multiply_by: '0.8' },
        { if: 'road_class == PRIMARY || road_class == SECONDARY', multiply_by: '0.75' },
        { if: 'road_environment == FERRY', multiply_by: '0' },
      ],
    };
  }
  if (crowdedness === 'quiet') {
    return {
      priority: [
        { if: 'road_class == FOOTWAY || road_class == PEDESTRIAN', multiply_by: '0.7' },
        { if: 'road_class == CYCLEWAY', multiply_by: '0.75' },
        { if: 'surface == ASPHALT || surface == CONCRETE', multiply_by: '0.85' },
        { if: 'road_class == PRIMARY || road_class == SECONDARY', multiply_by: '0.60' },
        { if: 'road_environment == FERRY', multiply_by: '0' },
      ],
    };
  }
  return undefined;
}

function mergeCustomModels(
  ...models: (Record<string, unknown> | unknown | undefined)[]
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {};
  for (const model of models) {
    if (!model || typeof model !== 'object') continue;
    for (const [key, value] of Object.entries(model as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        if (!merged[key]) merged[key] = [];
        (merged[key] as unknown[]).push(...value);
      } else {
        merged[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function isRoutingFailure(err: unknown): boolean {
  const message = [
    err instanceof Error ? err.message : '',
    responseMessage(err),
  ].join(' ').toLowerCase();

  return (
    message.includes('no circuit') ||
    message.includes('tolerance') ||
    message.includes('no path') ||
    message.includes('routing failed') ||
    message.includes('cannot find point') ||
    message.includes('pointnotfoundexception') ||
    message.includes('connection between locations not found') ||
    message.includes('connectionnotfoundexception')
  );
}

function responseMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return '';
  const response = 'response' in err ? (err as { response?: unknown }).response : null;
  if (!response || typeof response !== 'object') return '';
  const data = 'data' in response ? (response as { data?: unknown }).data : null;
  if (!data || typeof data !== 'object') return '';
  const message = 'message' in data ? (data as { message?: unknown }).message : '';
  const hints = 'hints' in data ? (data as { hints?: unknown }).hints : null;
  const hintText = Array.isArray(hints)
    ? hints
        .map((hint) => {
          if (!hint || typeof hint !== 'object') return '';
          const hintMessage = 'message' in hint ? (hint as { message?: unknown }).message : '';
          const details = 'details' in hint ? (hint as { details?: unknown }).details : '';
          return `${String(hintMessage || '')} ${String(details || '')}`;
        })
        .join(' ')
    : '';
  return `${String(message || '')} ${hintText}`;
}
