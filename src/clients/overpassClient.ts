import { LRUCache } from 'lru-cache';

import { axios } from '../utils/http';
import { logExternalError, logWarn } from '../utils/logger';

const cache = new LRUCache<string, OverpassPolygonResult>({ max: 200, ttl: 1000 * 60 * 60 * 24 });

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export interface OsmWayTags {
  highway?: string;
  surface?: string;
  sidewalk?: string;
  lit?: string;
  [key: string]: string | undefined;
}

export interface OsmWay {
  tags: OsmWayTags;
  geometry: [number, number][]; // [lng, lat]
}

export interface OverpassPolygonResult {
  polygon: [number, number][]; // [lng, lat]
  trails: [number, number][][];
  name: string;
}

export async function fetchPerimeterAndTrails(
  name: string,
  bbox: [number, number, number, number]
): Promise<OverpassPolygonResult | null> {
  const key = `${name}-${bbox.join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const query = `
  [out:json][timeout:30];
  (
    way["name"="${name}"]["natural"="water"](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});
    relation["name"="${name}"]["natural"="water"](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});
  )->.feature;
  way(around.feature:50)["highway"~"^(footway|path|cycleway)$"]->.trails;
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

type OverpassElement = {
  type: 'way' | 'relation' | string;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
  members?: { role: string; geometry?: { lat: number; lon: number }[] }[];
};

export async function fetchWayTagsAlongRoute(
  coords: [number, number][]
): Promise<OsmWay[]> {
  if (coords.length < 2) return [];

  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const pad = 0.001;
  const bboxStr = `${minLat - pad},${minLng - pad},${maxLat + pad},${maxLng + pad}`;

  const query = `
  [out:json][timeout:15];
  way["highway"](${bboxStr});
  out tags geom;
  `;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await axios.post(endpoint, `data=${encodeURIComponent(query)}`, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      });
      const elements: OverpassElement[] = res.data?.elements ?? [];
      return elements
        .filter((el) => el.type === 'way' && el.tags?.highway && el.geometry)
        .map((el) => ({
          tags: el.tags as OsmWayTags,
          geometry: el.geometry!.map((g) => [g.lon, g.lat] as [number, number]),
        }));
    } catch (err) {
      logExternalError('overpass', err, { endpoint, purpose: 'way_tags' });
    }
  }
  return [];
}

function parseOverpass(data: { elements?: OverpassElement[] }, featureName: string):
  | OverpassPolygonResult
  | null {
  if (!data?.elements) return null;
  const polygons: [number, number][][] = [];
  const trails: [number, number][][] = [];

  for (const el of data.elements) {
    if (el.type === 'way' && el.geometry) {
      const coords = el.geometry.map((g) => [g.lon, g.lat] as [number, number]);
      if (el.tags?.natural === 'water') polygons.push(coords);
      if (el.tags?.highway) trails.push(coords);
    }
    if (el.type === 'relation' && el.members) {
      const outer = el.members
        .filter((m) => m.role === 'outer' && m.geometry)
        .flatMap((m) => m.geometry!.map((g) => [g.lon, g.lat] as [number, number]));
      if (outer.length) polygons.push(outer);
    }
  }

  if (!polygons.length) return null;
  return {
    polygon: polygons[0],
    trails,
    name: featureName,
  };
}
