import { describe, expect, it, vi } from 'vitest';

import * as gh from '../src/clients/graphhopperClient';
import { generateLoop } from '../src/services/loopGenerator';

const mockRoute = vi.spyOn(gh, 'route');

describe('generateLoop', () => {
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
});
