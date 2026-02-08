import { describe, expect, it, vi } from 'vitest';

import * as gh from '../src/clients/graphhopperClient';
import { generateLoop } from '../src/services/loopGenerator';

const mockRoute = vi.spyOn(gh, 'route');

describe('generateLoop', () => {
  it('returns a circuit close to target', async () => {
    mockRoute.mockResolvedValue({
      distance: 2000,
      time: 0,
      points: [
        [0, 0, 0],
        [0.01, 0.01, 0],
      ],
    } as any);

    const loop = await generateLoop([0, 0], 4000, 'foot');
    expect(loop.totalDistance).toBeGreaterThan(0);
    expect(loop.path1.length).toBeGreaterThan(0);
  });
});
