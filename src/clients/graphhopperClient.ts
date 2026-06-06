import { env } from '../config/env';
import { axios } from '../utils/http';
import { logExternalError } from '../utils/logger';

export type Profile = 'foot' | 'trail' | 'hike';

export interface RouteResponse {
  distance: number; // meters
  time: number; // ms
  points: [number, number, number?][];
  ascend?: number; // meters
}

type RouteRequest = {
  points: [number, number][];
  profile: Profile;
  elevation: boolean;
  points_encoded: boolean;
  'ch.disable': boolean;
  algorithm?: string;
  alternative_route?: { max_paths: number; max_weight_factor: number; max_share_factor: number };
  custom_model?: unknown;
  block_area?: string;
};

export async function route(
  points: [number, number][],
  profile: Profile,
  opts: {
    algorithm?: string;
    alternative?: boolean;
    customModel?: unknown;
    blockArea?: string;
    allowMapboxFallback?: boolean;
  } = {}
): Promise<RouteResponse> {
  try {
    const body: RouteRequest = {
      points,
      profile,
      elevation: true,
      points_encoded: false,
      'ch.disable': true,
    };
    if (opts.algorithm) body.algorithm = opts.algorithm;
    if (opts.alternative) {
      body.alternative_route = {
        max_paths: 3,
        max_weight_factor: 2.0,
        max_share_factor: 0.3,
      };
    }
    if (opts.customModel) body.custom_model = opts.customModel;
    if (opts.blockArea) body.block_area = opts.blockArea;

    const res = await axios.post(`${env.graphhopperUrl}/route`, body, { timeout: 15000 });
    type Path = {
      distance: number;
      time: number;
      points: { coordinates: [number, number, number?][] };
      ascend?: number;
    };
    const paths: Path[] | undefined = res.data.paths;
    const path = paths?.[opts.alternative ? 1 : 0] ?? paths?.[0];
    if (!path) throw new Error('GraphHopper returned no path');
    const coords = path.points.coordinates.map(
      (c) => [c[0], c[1], c[2]] as [number, number, number?]
    );
    return { distance: path.distance, time: path.time, points: coords, ascend: path.ascend };
  } catch (err) {
    logExternalError('graphhopper', err, {
      points,
      profile,
      alternative: Boolean(opts.alternative),
      hasBlockArea: Boolean(opts.blockArea),
    });
    const fallback = opts.allowMapboxFallback === false ? null : await routeWithMapboxWalking(points, err);
    if (fallback) return fallback;
    throw err;
  }
}

async function routeWithMapboxWalking(
  points: [number, number][],
  originalError: unknown
): Promise<RouteResponse | null> {
  if (points.length < 2 || points.length > 25 || !isGraphCoverageFailure(originalError)) return null;

  try {
    const coordinates = points.map((point) => point.join(',')).join(';');
    const res = await axios.get(
      `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}`,
      {
        params: {
          access_token: env.mapboxToken,
          geometries: 'geojson',
          overview: 'full',
          steps: false,
        },
        timeout: 15000,
      }
    );
    const routeData = res.data.routes?.[0];
    const coords = routeData?.geometry?.coordinates;
    if (!routeData || !Array.isArray(coords) || coords.length < 2) return null;
    return {
      distance: routeData.distance,
      time: routeData.duration * 1000,
      points: coords.map((coord: [number, number]) => [coord[0], coord[1]] as [number, number]),
      ascend: 0,
    };
  } catch (err) {
    logExternalError('mapbox-directions', err, { points });
    return null;
  }
}

function isGraphCoverageFailure(err: unknown): boolean {
  const message = [
    err instanceof Error ? err.message : '',
    responseMessage(err),
  ].join(' ').toLowerCase();

  return (
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
