import { describe, expect, it } from 'vitest';

import {
  scoreSurface,
  scoreRoadType,
  scoreSidewalk,
  scoreLighting,
  scoreWay,
  aggregateScore,
  sampleRoutePoints,
  nearestWay,
  computeScoreFromWays,
} from '../src/services/runnabilityScoring';
import type { OsmWay } from '../src/clients/overpassClient';

describe('scoreSurface', () => {
  it('scores asphalt as 10', () => {
    expect(scoreSurface({ surface: 'asphalt' })).toBe(10);
  });

  it('scores dirt as 4', () => {
    expect(scoreSurface({ surface: 'dirt' })).toBe(4);
  });

  it('returns 5 for unknown surface', () => {
    expect(scoreSurface({})).toBe(5);
    expect(scoreSurface({ surface: 'exotic_material' })).toBe(5);
  });
});

describe('scoreRoadType', () => {
  it('scores footway as 10', () => {
    expect(scoreRoadType({ highway: 'footway' })).toBe(10);
  });

  it('scores residential as 6', () => {
    expect(scoreRoadType({ highway: 'residential' })).toBe(6);
  });

  it('scores primary as 1', () => {
    expect(scoreRoadType({ highway: 'primary' })).toBe(1);
  });
});

describe('scoreSidewalk', () => {
  it('gives 10 for dedicated running paths', () => {
    expect(scoreSidewalk({ highway: 'footway' })).toBe(10);
    expect(scoreSidewalk({ highway: 'path' })).toBe(10);
  });

  it('gives 10 for sidewalk:both on a road', () => {
    expect(scoreSidewalk({ highway: 'residential', sidewalk: 'both' })).toBe(10);
  });

  it('gives 3 for no sidewalk on a road', () => {
    expect(scoreSidewalk({ highway: 'residential', sidewalk: 'no' })).toBe(3);
  });

  it('gives 6 for unknown sidewalk status', () => {
    expect(scoreSidewalk({ highway: 'residential' })).toBe(6);
  });
});

describe('scoreLighting', () => {
  it('scores lit=yes as 10', () => {
    expect(scoreLighting({ lit: 'yes' })).toBe(10);
  });

  it('scores lit=no as 4', () => {
    expect(scoreLighting({ lit: 'no' })).toBe(4);
  });

  it('returns 6 for unknown', () => {
    expect(scoreLighting({})).toBe(6);
  });
});

describe('aggregateScore', () => {
  it('computes weighted average', () => {
    const score = aggregateScore({ surface: 10, road_type: 10, sidewalk: 10, lighting: 10 });
    expect(score).toBe(10);
  });

  it('computes mixed score correctly', () => {
    const score = aggregateScore({ surface: 10, road_type: 6, sidewalk: 3, lighting: 4 });
    // 10*0.35 + 6*0.35 + 3*0.15 + 4*0.15 = 3.5 + 2.1 + 0.45 + 0.6 = 6.65
    expect(score).toBeCloseTo(6.7, 1);
  });
});

describe('sampleRoutePoints', () => {
  it('returns all points if fewer than count', () => {
    const coords: [number, number][] = [[-122, 47], [-122.01, 47.01]];
    expect(sampleRoutePoints(coords, 20)).toHaveLength(2);
  });

  it('samples evenly', () => {
    const coords: [number, number][] = Array.from({ length: 100 }, (_, i) => [-122 + i * 0.001, 47]);
    const sampled = sampleRoutePoints(coords, 10);
    expect(sampled).toHaveLength(10);
    expect(sampled[0]).toEqual([-122, 47]);
    expect(sampled[9]).toEqual(coords[99]);
  });
});

describe('nearestWay', () => {
  const ways: OsmWay[] = [
    {
      tags: { highway: 'footway', surface: 'asphalt' },
      geometry: [[-122.33, 47.67], [-122.331, 47.671]],
    },
    {
      tags: { highway: 'primary', surface: 'asphalt' },
      geometry: [[-122.35, 47.69], [-122.351, 47.691]],
    },
  ];

  it('returns nearest way within 50m', () => {
    const result = nearestWay([-122.33, 47.67], ways);
    expect(result?.tags.highway).toBe('footway');
  });

  it('returns null if no way within 50m', () => {
    const result = nearestWay([-123.0, 48.0], ways);
    expect(result).toBeNull();
  });
});

describe('computeScoreFromWays', () => {
  it('scores a route on perfect footpaths', () => {
    const coords: [number, number][] = Array.from({ length: 5 }, (_, i) => [-122.33 + i * 0.0001, 47.67]);
    const ways: OsmWay[] = [{
      tags: { highway: 'footway', surface: 'asphalt', lit: 'yes' },
      geometry: coords,
    }];

    const result = computeScoreFromWays(coords, ways);
    expect(result.overall).toBe(10);
    expect(result.breakdown.surface).toBe(10);
    expect(result.breakdown.road_type).toBe(10);
    expect(result.segmentCount).toBe(5);
  });

  it('returns fallback when no ways match', () => {
    const coords: [number, number][] = [[-123, 48], [-123.01, 48.01]];
    const result = computeScoreFromWays(coords, []);
    expect(result.segmentCount).toBe(0);
    expect(result.overall).toBeGreaterThan(0);
  });
});
