import { fetchPerimeterAndTrails, FeatureType } from '../clients/overpassClient';
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

export function sampleTrails(trails: [number, number][][], targetCount = 12): [number, number][] {
  if (!trails.length) return [];
  const allPoints = trails.flatMap((t) => t);
  return samplePerimeter(allPoints, targetCount);
}

export interface PerimeterResult {
  waypoints: [number, number][];
  featureType: FeatureType;
}

export async function perimeterWaypoints(
  landmark: string,
  bbox: [number, number, number, number]
): Promise<PerimeterResult> {
  const res = await fetchPerimeterAndTrails(landmark, bbox);
  if (!res) return { waypoints: [], featureType: 'other' };

  // For parks: prefer internal trail waypoints so routes go THROUGH the park
  if (res.featureType === 'park' && res.trails.length > 0) {
    const trailWaypoints = sampleTrails(res.trails, 16);
    if (trailWaypoints.length >= 3) {
      return { waypoints: trailWaypoints, featureType: res.featureType };
    }
  }

  // For water features or parks without trails: use perimeter
  const perimeter = samplePerimeter(res.polygon, 24);
  return { waypoints: perimeter, featureType: res.featureType };
}

export function fallbackPerimeter(start: [number, number], targetMeters: number): [number, number][] {
  const radius = targetMeters / (2 * Math.PI); // circle circumference ~ target
  return circularWaypoints(start, radius, 16);
}
