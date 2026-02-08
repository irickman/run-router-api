import { describe, expect, it } from 'vitest';

import { toGPX } from '../src/utils/gpx';
import { RouteData } from '../src/models/routeParameters';

describe('GPX generator', () => {
  it('produces GPX with trackpoints', () => {
    const route: RouteData = {
      sessionId: 's',
      routeId: 'r',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-122.33, 47.62, 10],
          [-122.34, 47.63, 12],
        ],
      },
      stats: { distance_miles: 1, distance_meters: 1609, elevation_gain_feet: 50, duration_minutes: 9 },
      parameters: {} as any,
      metadata: { shape: 'loop', landmarks: [] },
      originalQuery: 'test',
      name: 'test route',
      createdAt: new Date().toISOString(),
    };

    const xml = toGPX(route);
    expect(xml).toContain('<gpx');
    expect(xml).toContain('<trkpt lon="-122.33" lat="47.62"><ele>10</ele></trkpt>');
    expect(xml).toContain('test route');
  });
});
