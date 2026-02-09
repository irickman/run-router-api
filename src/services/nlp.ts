import { extractParametersWithOpenAI } from '../clients/openaiClient';
import { extractParametersWithAnthropic } from '../clients/anthropicClient';
import { RouteParametersParsed } from '../utils/jsonSchema';

export async function extractRouteParameters(query: string): Promise<RouteParametersParsed> {
  try {
    return await extractParametersWithOpenAI(query);
  } catch {
    try {
      return await extractParametersWithAnthropic(query);
    } catch {
      return heuristicParse(query);
    }
  }
}

function heuristicParse(query: string): RouteParametersParsed {
  const distMatch = query.match(/(\\d+(?:\\.\\d+)?)\\s*(mile|miles|mi|k|km|kilometer|kilometers)/i);
  let value = 5;
  let unit: 'miles' | 'kilometers' | 'meters' = 'miles';
  if (distMatch) {
    value = parseFloat(distMatch[1]);
    const u = distMatch[2].toLowerCase();
    if (u.startsWith('k')) unit = 'kilometers';
  }
  const shape: RouteParametersParsed['shape'] =
    /point-to-point|point to point/i.test(query)
      ? { type: 'point-to-point', preference: null, avoidDoubleBack: false }
      : /out and back|out-and-back/i.test(query)
        ? { type: 'out-and-back', preference: null, avoidDoubleBack: true }
        : { type: 'loop', preference: 'circular', avoidDoubleBack: true };

  return {
    distance: { value, unit, precision: 'exact', originalText: distMatch?.[0] || `${value} ${unit}` },
    location: { startPoint: null, endPoint: null, landmarks: [], neighborhood: null, region: null },
    shape,
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
    confidence: { overall: 0.5, needsClarification: [], assumptions: ['heuristic fallback'] },
  };
}
