import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openAiMock, anthropicMock } = vi.hoisted(() => ({
  openAiMock: vi.fn(),
  anthropicMock: vi.fn(),
}));

vi.mock('../src/clients/openaiClient', () => ({
  extractParametersWithOpenAI: openAiMock,
}));

vi.mock('../src/clients/anthropicClient', () => ({
  extractParametersWithAnthropic: anthropicMock,
}));

import { extractRouteParameters } from '../src/services/nlp';

const baseParams = {
  distance: { value: 5, unit: 'miles', precision: 'exact', originalText: '5 mile' },
  location: { startPoint: null, endPoint: null, landmarks: [], neighborhood: null, region: null },
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
  confidence: { overall: 0.9, needsClarification: [], assumptions: [] },
} as const;

describe('extractRouteParameters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retries OpenAI once before falling back', async () => {
    openAiMock.mockRejectedValueOnce(new Error('first failure')).mockResolvedValueOnce(baseParams);

    const out = await extractRouteParameters('5 mile loop around Green Lake');

    expect(out.distance.value).toBe(5);
    expect(openAiMock).toHaveBeenCalledTimes(2);
    expect(anthropicMock).not.toHaveBeenCalled();
  });

  it('falls back to Anthropic after two OpenAI failures', async () => {
    openAiMock.mockRejectedValue(new Error('openai down'));
    anthropicMock.mockResolvedValue(baseParams);

    const out = await extractRouteParameters('5 mile loop around Green Lake');

    expect(out.shape.type).toBe('loop');
    expect(openAiMock).toHaveBeenCalledTimes(2);
    expect(anthropicMock).toHaveBeenCalledTimes(1);
  });

  it('uses heuristic parser as final fallback', async () => {
    openAiMock.mockRejectedValue(new Error('openai down'));
    anthropicMock.mockRejectedValue(new Error('anthropic down'));

    const out = await extractRouteParameters(
      'create a 10k trail run from my current location ending at Golden Gardens'
    );

    expect(out.distance.value).toBe(10);
    expect(out.distance.unit).toBe('kilometers');
    expect(out.location.endPoint?.toLowerCase()).toContain('golden gardens');
    expect(out.terrain.surfaces[0].type).toBe('trail');
  });
});
