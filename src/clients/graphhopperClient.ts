import { env } from '../config/env';
import { axios } from '../utils/http';
import { logExternalError } from '../utils/logger';

export type Profile = 'foot' | 'trail';

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
};

export async function route(
  points: [number, number][],
  profile: Profile,
  opts: { algorithm?: string; alternative?: boolean; customModel?: unknown } = {}
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
    logExternalError('graphhopper', err, { points, profile, alternative: Boolean(opts.alternative) });
    throw err;
  }
}
