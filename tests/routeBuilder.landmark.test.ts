import { afterEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../src/clients/overpassRouteRelations', () => ({
  fetchTrailNetworkWaypoints: vi.fn().mockResolvedValue([]),
}));

import { buildRoute } from '../src/services/routeBuilder';
import { RouteConstraintError } from '../src/utils/httpErrors';

describe('landmark route distance optimization', () => {
  afterEach(() => {
    geocodeMock.mockReset();
    perimeterMock.mockReset();
    routeMock.mockReset();
  });

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

  it('uses deployed encoded-value heuristics for crowdedness preferences', async () => {
    geocodeMock.mockResolvedValue([{ coordinates: [-122.34, 47.68] }]);
    perimeterMock.mockResolvedValue({ waypoints: [], featureType: 'other' });
    routeMock.mockResolvedValue({
      distance: 2500,
      time: 5000,
      ascend: 20,
      points: [[-122.33, 47.67, 0], [-122.34, 47.68, 0]],
    });

    await buildRoute({
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
          crowdedness: 'busy',
          waterFountains: false,
          restrooms: false,
        },
        confidence: { overall: 1, needsClarification: [], assumptions: [] },
      },
      start: [-122.33, 47.67],
      targetMeters: 5000,
      profile: 'foot',
    });

    const customModel = routeMock.mock.calls[0][2]?.customModel;
    expect(JSON.stringify(customModel)).not.toContain('popularity');
    expect(JSON.stringify(customModel)).toContain('road_class');
  });

  it('uses the nearest geocoder candidate for landmark feasibility', async () => {
    geocodeMock.mockResolvedValue([
      { name: 'Wrong Far Trail', coordinates: [-122.4, 47.6] },
      { name: 'Nearby Trail', coordinates: [-122.3305, 47.6705] },
    ]);
    perimeterMock.mockResolvedValue({ waypoints: [], featureType: 'other' });
    routeMock.mockResolvedValue({
      distance: 5000,
      time: 10000,
      ascend: 20,
      points: [[-122.33, 47.67, 0], [-122.3305, 47.6705, 0]],
    });

    const result = await buildRoute({
      params: {
        distance: { value: 3, unit: 'miles', precision: 'exact', originalText: '3 miles' },
        location: {
          startPoint: null,
          endPoint: null,
          landmarks: ['Ambiguous Trail'],
          neighborhood: null,
          region: null,
        },
        shape: { type: 'loop', preference: 'circular', avoidDoubleBack: true },
        terrain: {
          surfaces: [{ type: 'trail', preference: 'required' }],
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
      targetMeters: 4828,
      profile: 'trail',
    });

    expect(result.distance).toBeGreaterThan(0);
    expect(routeMock.mock.calls[0][0]).toEqual([
      [-122.33, 47.67],
      [-122.3305, 47.6705],
    ]);
  });

  it('treats far outdoor trail landmarks as soft routing guidance', async () => {
    geocodeMock.mockResolvedValue([{ coordinates: [-122.5, 47.8] }]);
    routeMock.mockImplementation(async (points: [number, number][]) => ({
      distance: 1250,
      time: 2500,
      ascend: 20,
      points: points.map((p) => [p[0], p[1], 0]),
    }));

    await expect(
      buildRoute({
        params: {
          distance: { value: 3, unit: 'miles', precision: 'exact', originalText: '3 miles' },
          location: {
            startPoint: null,
            endPoint: null,
            landmarks: ['Kraft Mountain'],
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
        targetMeters: 4828,
        profile: 'foot',
      })
    ).resolves.toMatchObject({ distance: expect.any(Number) });
  });

  it('keeps ordinary far landmarks as hard constraints', async () => {
    geocodeMock.mockResolvedValue([{ coordinates: [-122.5, 47.8] }]);

    await expect(
      buildRoute({
        params: {
          distance: { value: 3, unit: 'miles', precision: 'exact', originalText: '3 miles' },
          location: {
            startPoint: null,
            endPoint: null,
            landmarks: ['Space Needle'],
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
        targetMeters: 4828,
        profile: 'foot',
      })
    ).rejects.toMatchObject({
      code: 'ROUTE_CONSTRAINT',
      reason: 'LANDMARK_TOO_FAR',
    } satisfies Partial<RouteConstraintError>);
  });

  it('maps GraphHopper point-not-found failures to route constraints', async () => {
    const graphhopperError = new Error('Request failed with status code 400') as Error & {
      response: { data: { message: string; hints: Array<{ details: string; message: string }> } };
    };
    graphhopperError.response = {
      data: {
        message: 'Cannot find point 1: 48.45,-123.01',
        hints: [
          {
            details: 'com.graphhopper.util.exceptions.PointNotFoundException',
            message: 'Cannot find point 1: 48.45,-123.01',
          },
        ],
      },
    };
    routeMock.mockRejectedValue(graphhopperError);

    await expect(
      buildRoute({
        params: {
          distance: { value: 5, unit: 'miles', precision: 'exact', originalText: '5 miles' },
          location: {
            startPoint: null,
            endPoint: null,
            landmarks: [],
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
        start: [-123.02, 48.46],
        targetMeters: 5000,
        profile: 'foot',
      })
    ).rejects.toMatchObject({
      code: 'ROUTE_CONSTRAINT',
      reason: 'NO_ROUTE_FOUND',
    } satisfies Partial<RouteConstraintError>);
  });
});
