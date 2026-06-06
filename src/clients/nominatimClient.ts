import { LRUCache } from 'lru-cache';

import { axios } from '../utils/http';
import { logExternalError } from '../utils/logger';

import { GeocodeResult, bboxFromProximity } from './mapboxClient';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const cache = new LRUCache<string, GeocodeResult[]>({ max: 200, ttl: 1000 * 60 * 60 * 24 });

let lastCallTime = 0;

interface NominatimPlace {
  display_name: string;
  lon: string;
  lat: string;
  boundingbox?: [string, string, string, string];
}

async function rateLimit() {
  const now = Date.now();
  const wait = Math.max(0, 1000 - (now - lastCallTime));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallTime = Date.now();
}

export async function nominatimGeocode(
  query: string,
  proximity?: [number, number],
): Promise<GeocodeResult[]> {
  const key = `nom-${query}-${proximity?.join(',') || ''}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params: Record<string, string> = {
    q: query,
    format: 'json',
    limit: '5',
  };

  if (proximity) {
    const bbox = bboxFromProximity(proximity);
    params.viewbox = `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`;
    params.bounded = '1';
  }

  try {
    await rateLimit();
    const res = await axios.get(`${NOMINATIM_BASE}/search`, {
      params,
      headers: { 'User-Agent': 'RunRouter/1.0' },
      timeout: 10000,
    });

    let data = res.data as NominatimPlace[];

    if (proximity && data.length === 0) {
      delete params.bounded;
      await rateLimit();
      const res2 = await axios.get(`${NOMINATIM_BASE}/search`, {
        params,
        headers: { 'User-Agent': 'RunRouter/1.0' },
        timeout: 10000,
      });
      data = res2.data as NominatimPlace[];
    }

    const results: GeocodeResult[] = data.map((item) => ({
      name: item.display_name,
      coordinates: [parseFloat(item.lon), parseFloat(item.lat)] as [number, number],
      bbox: item.boundingbox
        ? [
            parseFloat(item.boundingbox[2]),
            parseFloat(item.boundingbox[0]),
            parseFloat(item.boundingbox[3]),
            parseFloat(item.boundingbox[1]),
          ] as [number, number, number, number]
        : undefined,
    }));

    cache.set(key, results);
    return results;
  } catch (err) {
    logExternalError('nominatim', err, { query, proximity });
    throw err;
  }
}
