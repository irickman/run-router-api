import nock from 'nock';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { app } from '../src/app';
import * as nlp from '../src/services/nlp';

const server = request(app);

describe('POST /api/route', () => {
  beforeAll(() => {
    process.env.MAPBOX_TOKEN = 'test';
    process.env.GRAPHHOPPER_URL = 'http://localhost:8989';
    vi.spyOn(nlp, 'extractRouteParameters').mockResolvedValue({
      distance: { value: 5, unit: 'miles', precision: 'exact', originalText: '5 mile loop around park' },
      location: { startPoint: null, endPoint: null, landmarks: ['Green Lake'], neighborhood: null, region: null },
      shape: { type: 'loop', preference: 'circular', avoidDoubleBack: true },
      terrain: { surfaces: [{ type: 'mixed', preference: 'acceptable' }], elevation: { profile: 'any', maxGain: null, preference: 'neutral' } },
      preferences: { difficulty: null, scenery: 'high', safetyPriority: 'normal', crowdedness: 'any', waterFountains: false, restrooms: false },
      confidence: { overall: 0.9, needsClarification: [], assumptions: [] },
    } as any);
    vi.spyOn(nlp, 'refineRouteParameters').mockImplementation(async (params) => ({
      ...params,
      distance: { ...params.distance, value: params.distance.value + 1 },
    }));

    // Mapbox geocode mock
    nock('https://api.mapbox.com')
      .persist()
      .get(/geocoding\/v5\/mapbox\.places/)
      .query(true)
      .reply(200, {
        features: [
          {
            place_name: 'Green Lake',
            center: [-122.34, 47.68],
            bbox: [-122.35, 47.67, -122.33, 47.69],
          },
        ],
      });

    // Overpass fallback (empty) to force bbox circle
    nock('https://overpass-api.de').persist().post('/api/interpreter').reply(200, { elements: [] });
    nock('https://overpass.kumi.systems').persist().post('/api/interpreter').reply(200, { elements: [] });
    nock('https://overpass.private.coffee').persist().post('/api/interpreter').reply(200, { elements: [] });

    // GraphHopper route mocks
    const gh = nock('http://localhost:8989')
      .persist()
      .post('/route')
      .reply(200, {
        paths: [
          {
            distance: 2000,
            time: 1000,
            ascend: 50,
            points: { coordinates: [[-122.33, 47.67, 10], [-122.34, 47.68, 12]] },
          },
          {
            distance: 2000,
            time: 1000,
            ascend: 40,
            points: { coordinates: [[-122.34, 47.68, 12], [-122.33, 47.67, 10]] },
          },
        ],
      });
  });

  afterAll(() => {
    nock.cleanAll();
    vi.restoreAllMocks();
  });

  it('returns a route with geometry and stats', async () => {
    const res = await server
      .post('/api/route')
      .send({ query: '5 mile loop around Green Lake', location: { lat: 47.67, lng: -122.33 } })
      .expect(200);

    expect(res.body.geometry.coordinates.length).toBeGreaterThan(0);
    expect(res.body.stats.distance_miles).toBeGreaterThan(0);
    expect(res.body.gpxUrl).toContain('/gpx');
  });

  it('refines an existing route and links parent route metadata', async () => {
    const created = await server
      .post('/api/route')
      .send({ query: '5 mile loop around Green Lake', location: { lat: 47.67, lng: -122.33 } })
      .expect(200);

    const refined = await server
      .post(`/api/route/${created.body.sessionId}/${created.body.routeId}/refine`)
      .send({ instruction: 'extend by 1 mile' })
      .expect(200);

    expect(refined.body.sessionId).toBe(created.body.sessionId);
    expect(refined.body.routeId).not.toBe(created.body.routeId);
    expect(refined.body.metadata.parentRouteId).toBe(created.body.routeId);
    expect(refined.body.gpxUrl).toContain('/gpx');
  });
});
