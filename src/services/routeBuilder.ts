/* eslint-disable import/order */
import { Profile, route } from '../clients/graphhopperClient';
import { geocode } from '../clients/mapboxClient';
import { RouteParametersParsed } from '../utils/jsonSchema';
import { bboxFromPoint } from '../utils/bbox';
import { fallbackPerimeter, perimeterWaypoints } from './perimeter';
import { generateLoop } from './loopGenerator';
import { edgeKeys, penalizedRoute, sharedEdgeRatioSets, EdgeSet } from '../utils/sharedEdges';

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
  const hasLandmark = ctx.params.location.landmarks.length > 0;
  const shape = ctx.params.shape.type;

  if (hasLandmark) return await landmarkRoute(ctx, shape);
  if (shape === 'point-to-point') return await pointToPoint(ctx);
  if (shape === 'out-and-back') return await outAndBack(ctx);

  return await loopRoute(ctx);
}

async function loopRoute(ctx: BuildContext): Promise<BuiltRoute> {
  const circuit = await generateLoop(ctx.start, ctx.targetMeters, ctx.profile);
  return {
    coordinates: [...circuit.path1, ...circuit.path2],
    distance: circuit.totalDistance,
    time: circuit.totalTime,
    ascend: circuit.totalAscend,
  };
}

async function landmarkRoute(ctx: BuildContext, shape: string): Promise<BuiltRoute> {
  const geocoded: [number, number][] = [];
  for (const name of ctx.params.location.landmarks) {
    const [geo] = await geocode(name, ctx.start);
    if (geo) geocoded.push(geo.coordinates);
  }

  let waypointSet: [number, number][] = geocoded;
  if (!waypointSet.length) {
    waypointSet = fallbackPerimeter(ctx.start, ctx.targetMeters);
  } else {
    const bbox = bboxFromPoint(ctx.start);
    const perimeter = await perimeterWaypoints(ctx.params.location.landmarks[0], bbox);
    if (perimeter.length) waypointSet.push(...perimeter);
  }

  const legs: [number, number][] = [ctx.start, ...waypointSet];
  if (shape === 'loop' || shape === 'flexible' || shape === 'out-and-back') legs.push(ctx.start);

  const pathCoords: [number, number, number?][] = [];
  let distance = 0;
  let time = 0;
  let ascend = 0;
  let usedEdges: EdgeSet = new Set<string>();
  for (let i = 0; i < legs.length - 1; i++) {
    const leg = await route([legs[i], legs[i + 1]], ctx.profile, { alternative: true });
    const edges = edgeKeys(leg.points);
    const overlap = sharedEdgeRatioSets(usedEdges, edges);
    if (overlap > 0.05) {
      const alt = await penalizedRoute([legs[i], legs[i + 1]], ctx.profile, usedEdges);
      const altEdges = edgeKeys(alt.points);
      const altOverlap = sharedEdgeRatioSets(usedEdges, altEdges);
      if (altOverlap < overlap) {
        usedEdges = new Set([...usedEdges, ...altEdges]);
        pathCoords.push(...alt.points);
        distance += alt.distance;
        time += alt.time;
        ascend += alt.ascend ?? 0;
        continue;
      }
    }
    usedEdges = new Set([...usedEdges, ...edges]);
    pathCoords.push(...leg.points);
    distance += leg.distance;
    time += leg.time;
    ascend += leg.ascend ?? 0;
  }
  return { coordinates: pathCoords, distance, time, ascend };
}

async function outAndBack(ctx: BuildContext): Promise<BuiltRoute> {
  const targetOut = ctx.targetMeters / 2;
  const far = projectOut(ctx.start, targetOut);
  const outLeg = await route([ctx.start, far], ctx.profile, { alternative: true });
  const backLeg = await route([far, ctx.start], ctx.profile, { alternative: true });
  return {
    coordinates: [...outLeg.points, ...backLeg.points],
    distance: outLeg.distance + backLeg.distance,
    time: outLeg.time + backLeg.time,
    ascend: (outLeg.ascend ?? 0) + (backLeg.ascend ?? 0),
  };
}

async function pointToPoint(ctx: BuildContext): Promise<BuiltRoute> {
  const end = await resolveEnd(ctx);
  const leg = await route([ctx.start, end], ctx.profile);
  return { coordinates: leg.points, distance: leg.distance, time: leg.time, ascend: leg.ascend ?? 0 };
}

async function resolveEnd(ctx: BuildContext): Promise<[number, number]> {
  const name = ctx.params.location.endPoint || ctx.params.location.landmarks[0];
  if (name) {
    const [geo] = await geocode(name, ctx.start);
    if (geo) return geo.coordinates;
  }
  return ctx.start;
}

function projectOut(start: [number, number], distanceMeters: number): [number, number] {
  const dLat = (distanceMeters / 6371e3) * (180 / Math.PI);
  return [start[0], start[1] + dLat];
}
