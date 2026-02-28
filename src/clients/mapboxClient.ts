import { LRUCache } from 'lru-cache';

import { env } from '../config/env';
import { axios } from '../utils/http';
import { logExternalError } from '../utils/logger';

const cache = new LRUCache<string, GeocodeResult[]>({ max: 500, ttl: 1000 * 60 * 60 * 24 });

export interface GeocodeResult {
  name: string;
  coordinates: [number, number];
  bbox?: [number, number, number, number];
  context?: string;
}

const MILES_25_METERS = 40_234;

export function bboxFromProximity(center: [number, number], radiusMeters = MILES_25_METERS): [number, number, number, number] {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  return [
    center[0] - lngDelta,
    center[1] - latDelta,
    center[0] + lngDelta,
    center[1] + latDelta,
  ];
}

export async function geocode(
  query: string,
  proximity?: [number, number],
  bbox?: [number, number, number, number]
): Promise<GeocodeResult[]> {
  const key = `${query}-${proximity?.join(',') || ''}-${bbox?.join(',') || ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`;
  const params: Record<string, string> = {
    access_token: env.mapboxToken,
    limit: '3',
    types: 'poi,place,neighborhood,locality,address',
  };
  if (proximity) params.proximity = `${proximity[0]},${proximity[1]}`;
  if (bbox) params.bbox = bbox.join(',');

  try {
    const res = await axios.get(url, { params, timeout: 10000 });
    type Feature = {
      place_name: string;
      center: [number, number];
      bbox?: [number, number, number, number];
      context?: { text: string }[];
    };

    const results: GeocodeResult[] = (res.data.features as Feature[]).map((f) => ({
      name: f.place_name,
      coordinates: [f.center[0], f.center[1]],
      bbox: f.bbox,
      context: f.context?.map((c) => c.text).join(', '),
    }));

    // Fallback: if bbox-constrained search returns nothing, retry without bbox
    if (results.length === 0 && bbox && proximity) {
      cache.set(key, results);
      return geocode(query, proximity);
    }

    cache.set(key, results);
    return results;
  } catch (err) {
    logExternalError('mapbox', err, { query, proximity, bbox });
    throw err;
  }
}
