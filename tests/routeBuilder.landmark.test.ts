import { describe, expect, it, vi } from 'vitest';

const { geocodeMock, perimeterMock, routeMock } = vi.hoisted(() => ({
  geocodeMock: vi.fn(),
  perimeterMock: vi.fn(),
  routeMock: vi.fn(),
}));

vi.mock('../src/clients/mapboxClient', () => ({
  geocode: geocodeMock,
  bboxFromProximity: () => [-122.7, 47.3, -122.0, 48.0],
}));

vi.mock('../src/clients/nominatimClient', () => ({
  nominatimGeocode: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/perimeter', () => ({
  perimeterWaypoints: perimeterMock,
  fallbackPerimeter: vi.fn(() => []),
}));

vi.mock('../src/clients/graphhopperClient', () => ({
  route: routeMock,
}));

import { buildRoute } from '../src/services/routeBuilder';

describe('landmark route distance optimization', () => {
  it('inserts intermediate waypoints when landmark route is too short', async () => {
    geocodeMock.mockResolvedValue([{ coordinates: [-122.34, 47.68] }]);
    perimeterMock.mockResolvedValue({ waypoints: [], featureType: 'other' });
    routeMock.mockImplementation(async (points: [number, number][]) => {
      const distance = points.length === 2 ? 1000 : 2600;
      const last = points[points.length - 1];
      return {
        distance,
        time: distance * 2,
        ascend: 40,
        points: points.map((p) => [p[0], p[1], 0]),
        endpoint: last,
      };
    });

    const res = await buildRoute({
      params: {
        distance: { value: 5, unit: 'miles', precision: 'exact', originalText: '5 miles' },
        location: {
          startPoint: null,
          endPoint: null,
          landmarks: ['Kerry Park'],
          neighborhood: null,
          region: null,
        },
        shape: { type: 'loop', preference: 'circular', avoidDoubleBack: true },
        terrain: {
          surfaces: [{ type: 'mixed', preference: 'acceptable' }],
          elevation: { profile: 'any', maxGain: null, preference: 'neutral' },
        },
        preferences: {
          difficulty: null,
          scenery: null,
          safetyPriority: 'normal',
          crowdedness: 'any',
          waterFountains: false,
          restrooms: false,
        },
        confidence: { overall: 1, needsClarification: [], assumptions: [] },
      },
      start: [-122.33, 47.67],
      targetMeters: 5000,
      profile: 'foot',
    });

    expect(routeMock.mock.calls.length).toBeGreaterThan(2);
    expect(res.distance).toBeGreaterThan(2000);
  });
});
