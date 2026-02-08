import { geocode } from '../clients/mapboxClient';
import { Profile, route } from '../clients/graphhopperClient';
import { RouteParametersParsed } from '../utils/jsonSchema';
import { generateLoop } from './loopGenerator';
import { perimeterWaypoints } from './perimeter';

interface BuildContext {
  params: RouteParametersParsed;
  start: [number, number];
  targetMeters: number;
  profile: Profile;
}

export async function buildRoute(ctx: BuildContext): Promise<{
  coordinates: [number, number, number?][];
  distance: number;
}> {
  const hasLandmark = ctx.params.location.landmarks.length > 0;

  if (hasLandmark) {
    return await landmarkRoute(ctx);
  }

  return await loopRoute(ctx);
}

async function loopRoute(ctx: BuildContext) {
  const circuit = await generateLoop(ctx.start, ctx.targetMeters, ctx.profile);
  return { coordinates: [...circuit.path1, ...circuit.path2], distance: circuit.totalDistance };
}

async function landmarkRoute(ctx: BuildContext) {
  const landmark = ctx.params.location.landmarks[0];
  const [geo] = await geocode(landmark, ctx.start);
  const waypoint = geo ? geo.coordinates : ctx.start;

  const legs: [number, number][] = [ctx.start, waypoint, ctx.start];
  const pathCoords: [number, number, number?][] = [];
  let total = 0;
  for (let i = 0; i < legs.length - 1; i++) {
    const leg = await route([legs[i], legs[i + 1]], ctx.profile, { alternative: true });
    pathCoords.push(...leg.points);
    total += leg.distance;
  }

  if (total < ctx.targetMeters * 0.95) {
    const extend = await route([ctx.start, projectOut(ctx.start, 0.1 * ctx.targetMeters), ctx.start], ctx.profile);
    pathCoords.push(...extend.points);
    total += extend.distance;
  }

  return { coordinates: pathCoords, distance: total };
}

function projectOut(start: [number, number], distance: number): [number, number] {
  // simple northward offset by meters
  const dLat = (distance / 6371e3) * (180 / Math.PI);
  return [start[0], start[1] + dLat];
}
