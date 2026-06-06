import { afterEach, describe, expect, it, vi } from 'vitest';

import * as gh from '../src/clients/graphhopperClient';
import { generateLoop } from '../src/services/loopGenerator';

const mockRoute = vi.spyOn(gh, 'route');

describe('generateLoop', () => {
  afterEach(() => {
    mockRoute.mockReset();
  });

  it('returns a circuit close to target', async () => {
    mockRoute.mockImplementation((points: [number, number][]) => {
      const coords = points.map((p, i) => [p[0], p[1], i * 4] as [number, number, number]);
      if (coords.length === 2) {
        const [start, end] = coords;
        coords.splice(1, 0, [
          (start[0] + end[0]) / 2 + 0.0007,
          (start[1] + end[1]) / 2 + 0.0007,
          2,
        ]);
      }
      return Promise.resolve({
        distance: 1000,
        time: 0,
        ascend: 6,
        points: coords,
      } as any);
    });

    const loop = await generateLoop([0, 0], 4000, 'foot');
    expect(loop.totalDistance).toBeGreaterThan(0);
    expect(loop.overlapRatio).toBeLessThanOrEqual(0.05);
  });

  it('bounds routing calls for long loops once a good circuit is found', async () => {
    mockRoute.mockImplementation((points: [number, number][]) => {
      const coords = points.map((p, i) => [p[0], p[1], i * 4] as [number, number, number]);
      if (coords.length === 2) {
        const [start, end] = coords;
        coords.splice(1, 0, [
          (start[0] + end[0]) / 2 + 0.0007,
          (start[1] + end[1]) / 2 + 0.0007,
          2,
        ]);
      }
      return Promise.resolve({
        distance: 4023,
        time: 0,
        ascend: 6,
        points: coords,
      } as any);
    });

    const targetMeters = 12.5 * 1609.344;
    const loop = await generateLoop([-122.3321, 47.6062], targetMeters, 'foot');

    expect(Math.abs(loop.totalDistance - targetMeters) / targetMeters).toBeLessThanOrEqual(0.12);
    expect(mockRoute.mock.calls.length).toBeLessThanOrEqual(22);
  });
});
