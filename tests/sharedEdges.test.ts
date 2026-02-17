import { beforeEach, describe, expect, it, vi } from 'vitest';

const { routeMock } = vi.hoisted(() => ({
  routeMock: vi.fn(),
}));

vi.mock('../src/clients/graphhopperClient', () => ({
  route: routeMock,
}));

import { edgeKeys, penalizedRoute } from '../src/utils/sharedEdges';

describe('penalizedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses waypoint detour fallback when alternative path overlaps used edges', async () => {
    const used = edgeKeys([
      [-122.33, 47.67, 0],
      [-122.34, 47.68, 0],
      [-122.35, 47.69, 0],
    ]);

    routeMock
      .mockResolvedValueOnce({
        distance: 1600,
        time: 600000,
        ascend: 10,
        points: [
          [-122.33, 47.67, 0],
          [-122.34, 47.68, 0],
          [-122.35, 47.69, 0],
        ],
      })
      .mockResolvedValueOnce({
        distance: 1700,
        time: 620000,
        ascend: 12,
        points: [
          [-122.33, 47.67, 0],
          [-122.325, 47.685, 0],
          [-122.35, 47.69, 0],
        ],
      });

    const res = await penalizedRoute(
      [
        [-122.33, 47.67],
        [-122.35, 47.69],
      ],
      'foot',
      used
    );

    expect(routeMock.mock.calls.length).toBeGreaterThan(1);
    expect(routeMock.mock.calls[1][0].length).toBe(3);
    expect(res.distance).toBe(1700);
  });
});
