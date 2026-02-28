import { LRUCache } from 'lru-cache';

import { axios } from '../utils/http';
import { logExternalError, logWarn } from '../utils/logger';

const cache = new LRUCache<string, OverpassPolygonResult>({ max: 200, ttl: 1000 * 60 * 60 * 24 });

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export type FeatureType = 'water' | 'park' | 'other';

export interface OverpassPolygonResult {
  polygon: [number, number][]; // [lng, lat]
  trails: [number, number][][];
  name: string;
  featureType: FeatureType;
}

export async function fetchPerimeterAndTrails(
  name: string,
  bbox: [number, number, number, number]
): Promise<OverpassPolygonResult | null> {
  const key = `${name}-${bbox.join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const bboxStr = `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`;
  const safeName = escapeOverpassString(name);
  const query = `
  [out:json][timeout:30];
  (
    way["name"="${safeName}"]["natural"="water"](${bboxStr});
    relation["name"="${safeName}"]["natural"="water"](${bboxStr});
    way["name"="${safeName}"]["leisure"~"^(park|garden|nature_reserve)$"](${bboxStr});
    relation["name"="${safeName}"]["leisure"~"^(park|garden|nature_reserve)$"](${bboxStr});
    way["name"="${safeName}"]["boundary"="national_park"](${bboxStr});
    relation["name"="${safeName}"]["boundary"="national_park"](${bboxStr});
    way["name"="${safeName}"]["landuse"="recreation_ground"](${bboxStr});
    relation["name"="${safeName}"]["landuse"="recreation_ground"](${bboxStr});
  )->.feature;
  way(around.feature:50)["highway"~"^(footway|path|cycleway|track)$"]->.trails;
  .feature out body geom;
  .trails out body geom;
  `;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await axios.post(endpoint, `data=${encodeURIComponent(query)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
      });
      const parsed = parseOverpass(res.data as { elements?: OverpassElement[] }, name);
      if (parsed) cache.set(key, parsed);
      return parsed;
    } catch (err) {
      logExternalError('overpass', err, { endpoint, name, bbox });
    }
  }
  logWarn('overpass exhausted all endpoints', { name, bbox });
  return null;
}

function escapeOverpassString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type OverpassElement = {
  type: 'way' | 'relation' | string;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
  members?: { role: string; geometry?: { lat: number; lon: number }[] }[];
};

function detectFeatureType(el: OverpassElement): FeatureType | null {
  const tags = el.tags ?? {};
  if (tags.natural === 'water') return 'water';
  if (tags.leisure === 'park' || tags.leisure === 'garden' || tags.leisure === 'nature_reserve') return 'park';
  if (tags.boundary === 'national_park') return 'park';
  if (tags.landuse === 'recreation_ground') return 'park';
  return null;
}

function parseOverpass(data: { elements?: OverpassElement[] }, featureName: string):
  | OverpassPolygonResult
  | null {
  if (!data?.elements) return null;
  const polygons: { coords: [number, number][]; type: FeatureType }[] = [];
  const trails: [number, number][][] = [];

  for (const el of data.elements) {
    if (el.type === 'way' && el.geometry) {
      const coords = el.geometry.map((g) => [g.lon, g.lat] as [number, number]);
      const ft = detectFeatureType(el);
      if (ft) polygons.push({ coords, type: ft });
      if (el.tags?.highway) trails.push(coords);
    }
    if (el.type === 'relation' && el.members) {
      const outer = el.members
        .filter((m) => m.role === 'outer' && m.geometry)
        .flatMap((m) => m.geometry!.map((g) => [g.lon, g.lat] as [number, number]));
      if (outer.length) {
        const ft = detectFeatureType(el);
        polygons.push({ coords: outer, type: ft ?? 'other' });
      }
    }
  }

  if (!polygons.length) return null;
  return {
    polygon: polygons[0].coords,
    trails,
    name: featureName,
    featureType: polygons[0].type,
  };
}
