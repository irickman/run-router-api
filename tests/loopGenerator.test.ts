import { describe, expect, it, vi } from 'vitest';

import * as gh from '../src/clients/graphhopperClient';
import { generateLoop } from '../src/services/loopGenerator';

const mockRoute = vi.spyOn(gh, 'route');

describe('generateLoop', () => {
  it('returns a circuit close to target', async () => {
    let call = 0;
    mockRoute.mockImplementation(() => {
      call += 1;
      if (call % 2 === 0) {
        return Promise.resolve({
          distance: 2000,
          time: 0,
          ascend: 5,
          points: [
            [0.05, 0.0, 0],
            [0.06, 0.01, 0],
            [0.07, 0.02, 0],
          ],
        } as any);
      }
      return Promise.resolve({
        distance: 2000,
        time: 0,
        ascend: 5,
        points: [
          [0, 0, 0],
          [0.01, 0.01, 0],
          [0.02, 0.02, 0],
        ],
      } as any);
    });

    const loop = await generateLoop([0, 0], 4000, 'foot');
    expect(loop.totalDistance).toBeGreaterThan(0);
    expect(loop.overlapRatio).toBeLessThanOrEqual(0.05);
  });
});
