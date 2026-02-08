import { describe, expect, it } from 'vitest';

import { RouteParametersSchema } from '../src/utils/jsonSchema';

describe('RouteParametersSchema', () => {
  it('parses a valid payload', () => {
    const data = {
      distance: { value: 5, unit: 'miles', precision: 'exact', originalText: '5 mile' },
      location: { startPoint: 'Green Lake', endPoint: null, landmarks: ['Green Lake'], neighborhood: null, region: null },
      shape: { type: 'loop', preference: 'circular', avoidDoubleBack: true },
      terrain: {
        surfaces: [{ type: 'mixed', preference: 'acceptable' }],
        elevation: { profile: 'any', maxGain: null, preference: 'neutral' },
      },
      preferences: {
        difficulty: null,
        scenery: 'high',
        safetyPriority: 'normal',
        crowdedness: 'any',
        waterFountains: false,
        restrooms: false,
      },
      confidence: { overall: 0.9, needsClarification: [], assumptions: [] },
    };

    const parsed = RouteParametersSchema.parse(data);
    expect(parsed.distance.value).toBe(5);
    expect(parsed.shape.type).toBe('loop');
  });

  it('rejects invalid distance', () => {
    expect(() =>
      RouteParametersSchema.parse({
        distance: { value: -1, unit: 'miles', precision: 'exact', originalText: 'oops' },
        location: { startPoint: null, endPoint: null, landmarks: [], neighborhood: null, region: null },
        shape: { type: 'loop', preference: null, avoidDoubleBack: true },
        terrain: { surfaces: [], elevation: { profile: 'any', maxGain: null, preference: 'neutral' } },
        preferences: {
          difficulty: null,
          scenery: null,
          safetyPriority: 'normal',
          crowdedness: 'any',
          waterFountains: false,
          restrooms: false,
        },
        confidence: { overall: 0.5, needsClarification: [], assumptions: [] },
      })
    ).toThrow();
  });
});
