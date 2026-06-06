import { axios } from '../utils/http';
import { logExternalError } from '../utils/logger';

export interface TrailWaypoint {
  coordinates: [number, number]; // [lng, lat]
}

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_ROUTE_RELATIONS_TIMEOUT_MS = Number(process.env.OVERPASS_ROUTE_RELATIONS_TIMEOUT_MS || 5000);

export async function fetchTrailNetworkWaypoints(
  center: [number, number],
  radiusMeters: number
): Promise<TrailWaypoint[]> {
  const [lng, lat] = center;
  const radiusKm = Math.min(radiusMeters / 1000, 5);
  const query = `
    [out:json][timeout:10];
    (
      way(around:${radiusKm * 1000},${lat},${lng})["highway"~"path|footway|track"]["foot"!="no"];
    );
    out center 50;
  `;

  try {
    const response = await axios.post<{ elements: Array<{ center?: { lat: number; lon: number } }> }>(
      OVERPASS_URL,
      `data=${encodeURIComponent(query)}`,
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RouteRunnerEval/0.1 (route quality verification)',
        },
        timeout: OVERPASS_ROUTE_RELATIONS_TIMEOUT_MS,
      }
    );

    return response.data.elements
      .filter((el) => el.center)
      .map((el) => ({ coordinates: [el.center!.lon, el.center!.lat] as [number, number] }));
  } catch (err) {
    logExternalError('overpass-route-relations', err);
    return [];
  }
}
