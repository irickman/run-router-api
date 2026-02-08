import { fetchPerimeterAndTrails } from '../clients/overpassClient';
import { circularWaypoints } from '../utils/bbox';

export function samplePerimeter(points: [number, number][], targetCount = 16): [number, number][] {
  if (points.length === 0) return [];
  const total = points.length;
  const step = Math.max(1, Math.floor(total / targetCount));
  const sampled: [number, number][] = [];
  for (let i = 0; i < total; i += step) {
    sampled.push(points[i]);
  }
  return sampled;
}

export async function perimeterWaypoints(
  landmark: string,
  bbox: [number, number, number, number]
): Promise<[number, number][]> {
  const res = await fetchPerimeterAndTrails(landmark, bbox);
  if (!res) return [];
  const perimeter = samplePerimeter(res.polygon, 24);
  return perimeter;
}

export function fallbackPerimeter(start: [number, number], targetMeters: number): [number, number][] {
  const radius = targetMeters / (2 * Math.PI); // circle circumference ~ target
  return circularWaypoints(start, radius, 16);
}
