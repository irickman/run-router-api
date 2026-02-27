import { describe, expect, it } from 'vitest';

import { elevationGainFromCoords } from '../src/utils/geometry';

function pointAtMeters(
  start: [number, number],
  northMeters: number,
  elevationMeters: number
): [number, number, number] {
  const dLat = northMeters / 111320;
  return [start[0], start[1] + dLat, elevationMeters];
}

describe('elevationGainFromCoords', () => {
  it('suppresses noisy elevation jitter on mostly flat routes', () => {
    const start: [number, number] = [-122.33, 47.67];
    const coords: [number, number, number][] = [];
    for (let i = 0; i < 60; i++) {
      const noise = (i % 2 === 0 ? 0.6 : -0.6) + (i % 5) * 0.05;
      coords.push(pointAtMeters(start, i * 8, 100 + noise));
    }

    const gain = elevationGainFromCoords(coords);
    expect(gain).toBeLessThan(15);
  });

  it('keeps meaningful climb when ascent is sustained', () => {
    const start: [number, number] = [-122.33, 47.67];
    const coords: [number, number, number][] = [];
    for (let i = 0; i < 40; i++) {
      coords.push(pointAtMeters(start, i * 12, 100 + i * 0.55));
    }

    const gain = elevationGainFromCoords(coords);
    expect(gain).toBeGreaterThan(12);
  });
});
