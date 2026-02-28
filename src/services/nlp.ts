import { extractParametersWithOpenAI } from '../clients/openaiClient';
import { extractParametersWithAnthropic, refineParametersWithAnthropic } from '../clients/anthropicClient';
import { env } from '../config/env';
import { RouteParametersParsed } from '../utils/jsonSchema';
import { logInfo, logWarn } from '../utils/logger';

export async function extractRouteParameters(query: string): Promise<RouteParametersParsed> {
  const timeoutMs = env.parameterExtractionTimeoutMs;

  let firstOpenAiError: unknown;
  try {
    const result = await withTimeout(extractParametersWithOpenAI(query), timeoutMs, 'OpenAI timed out');
    logInfo('nlp extraction success', { provider: 'openai', attempt: 1, query, output: result });
    return result;
  } catch (err) {
    firstOpenAiError = err;
    logWarn('nlp extraction failed', {
      provider: 'openai',
      attempt: 1,
      query,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    const result = await withTimeout(extractParametersWithOpenAI(query), timeoutMs, 'OpenAI timed out');
    logInfo('nlp extraction success', { provider: 'openai', attempt: 2, query, output: result });
    return result;
  } catch (secondOpenAiError) {
    logWarn('nlp extraction failed', {
      provider: 'openai',
      attempt: 2,
      query,
      error: secondOpenAiError instanceof Error ? secondOpenAiError.message : String(secondOpenAiError),
      firstAttemptError:
        firstOpenAiError instanceof Error ? firstOpenAiError.message : String(firstOpenAiError),
    });

    try {
      const result = await withTimeout(
        extractParametersWithAnthropic(query),
        timeoutMs,
        'Anthropic timed out'
      );
      logInfo('nlp extraction success', { provider: 'anthropic', query, output: result });
      return result;
    } catch (anthropicError) {
      logWarn('nlp extraction fell back to heuristic', {
        provider: 'anthropic',
        query,
        error: anthropicError instanceof Error ? anthropicError.message : String(anthropicError),
      });
      const result = heuristicParse(query);
      logInfo('nlp extraction success', { provider: 'heuristic', query, output: result });
      return result;
    }
  }
}

export async function refineRouteParameters(
  originalParams: RouteParametersParsed,
  instruction: string
): Promise<RouteParametersParsed> {
  const timeoutMs = env.parameterExtractionTimeoutMs;

  try {
    const result = await withTimeout(
      refineParametersWithAnthropic(originalParams, instruction),
      timeoutMs,
      'Anthropic refinement timed out'
    );
    logInfo('nlp refinement success', { provider: 'anthropic', instruction, output: result });
    return result;
  } catch (err) {
    logWarn('nlp refinement fell back to heuristic', {
      provider: 'anthropic',
      instruction,
      error: err instanceof Error ? err.message : String(err),
    });
    return heuristicRefine(originalParams, instruction);
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function heuristicParse(query: string): RouteParametersParsed {
  const normalized = query.trim();
  const distMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(mile|miles|mi|k|km|kilometer|kilometers)/i
  );

  let value = 5;
  let unit: 'miles' | 'kilometers' | 'meters' = 'miles';

  if (/half marathon/i.test(normalized)) {
    value = 13.1;
    unit = 'miles';
  } else if (/marathon/i.test(normalized)) {
    value = 26.2;
    unit = 'miles';
  } else if (/\b10k\b/i.test(normalized)) {
    value = 10;
    unit = 'kilometers';
  } else if (/\b5k\b/i.test(normalized)) {
    value = 5;
    unit = 'kilometers';
  } else if (/long run/i.test(normalized)) {
    value = 10;
    unit = 'miles';
  } else if (/short run/i.test(normalized)) {
    value = 3;
    unit = 'miles';
  } else if (/easy run/i.test(normalized)) {
    value = 4;
    unit = 'miles';
  } else if (distMatch) {
    value = parseFloat(distMatch[1]);
    const u = distMatch[2].toLowerCase();
    if (u.startsWith('k')) unit = 'kilometers';
  }

  const startPoint = extractIntentTarget(normalized, /(?:from|starting at)\s+([^,.;]+)/i);
  const endPoint = extractIntentTarget(normalized, /(?:to|ending at|toward)\s+([^,.;]+)/i);
  const traversalPatterns: { pattern: RegExp; mode: 'around' | 'through' | 'along' }[] = [
    { pattern: /(?:around|loop around|circle)\s+([^,.;]+)/i, mode: 'around' },
    { pattern: /(?:through|across)\s+([^,.;]+)/i, mode: 'through' },
    { pattern: /(?:along|following)\s+([^,.;]+)/i, mode: 'along' },
    { pattern: /(?:via|past)\s+([^,.;]+)/i, mode: 'through' },
  ];
  const landmarkCandidates: string[] = [];
  const traversalModes: ('around' | 'through' | 'along')[] = [];
  for (const { pattern, mode } of traversalPatterns) {
    const target = extractIntentTarget(normalized, pattern);
    if (target && !landmarkCandidates.includes(target)) {
      landmarkCandidates.push(target);
      traversalModes.push(mode);
    }
  }

  const shape: RouteParametersParsed['shape'] =
    /point-to-point|point to point/i.test(normalized)
      ? { type: 'point-to-point', preference: null, avoidDoubleBack: false }
      : /out and back|out-and-back/i.test(normalized)
        ? { type: 'out-and-back', preference: null, avoidDoubleBack: true }
        : { type: 'loop', preference: 'circular', avoidDoubleBack: true };

  return {
    distance: { value, unit, precision: 'exact', originalText: distMatch?.[0] || `${value} ${unit}` },
    location: {
      startPoint: startPoint || null,
      endPoint: endPoint || null,
      landmarks: landmarkCandidates,
      landmarkTraversalModes: traversalModes.length ? traversalModes : undefined,
      avoidStreets: extractAvoidStreets(normalized),
      neighborhood: null,
      region: null,
    },
    shape,
    terrain: {
      surfaces: [{ type: /trail/i.test(normalized) ? 'trail' : 'mixed', preference: 'acceptable' }],
      elevation: {
        profile: /flat/i.test(normalized)
          ? 'flat'
          : /rolling/i.test(normalized)
            ? 'rolling'
            : /hilly/i.test(normalized)
              ? 'hilly'
              : /mountain/i.test(normalized)
                ? 'mountainous'
                : 'any',
        maxGain: extractMaxGain(normalized),
        preference: /minimize elevation|flat|no more than/i.test(normalized)
          ? 'minimize'
          : /maximize elevation|hilly|mountain/i.test(normalized)
            ? 'maximize'
            : 'neutral',
      },
    },
    preferences: {
      difficulty: null,
      scenery: null,
      safetyPriority: 'normal',
      crowdedness: 'any',
      waterFountains: false,
      restrooms: false,
    },
    confidence: { overall: 0.5, needsClarification: [], assumptions: ['heuristic fallback parser'] },
  };
}

function extractIntentTarget(input: string, pattern: RegExp): string | null {
  const match = input.match(pattern);
  if (!match?.[1]) return null;
  return match[1].trim();
}

function extractMaxGain(input: string): number | null {
  const feetMatch = input.match(/(?:no more than|max(?:imum)?|under)\s+(\d+)\s*(?:ft|feet)/i);
  if (feetMatch) return Number(feetMatch[1]) * 0.3048;

  const metersMatch = input.match(/(?:no more than|max(?:imum)?|under)\s+(\d+)\s*(?:m|meters)/i);
  if (metersMatch) return Number(metersMatch[1]);
  return null;
}

function extractAvoidStreets(input: string): string[] {
  const matches = [...input.matchAll(/avoid\s+([^,.;]+)/gi)];
  return Array.from(
    new Set(
      matches
        .map((m) => m[1]?.trim())
        .filter((v): v is string => Boolean(v))
        .map((street) => street.replace(/^(the|a|an)\s+/i, '').trim())
    )
  );
}

function heuristicRefine(
  originalParams: RouteParametersParsed,
  instruction: string
): RouteParametersParsed {
  const refined: RouteParametersParsed = JSON.parse(JSON.stringify(originalParams));
  const text = instruction.trim();
  const lower = text.toLowerCase();

  const extendMatch = lower.match(
    /(extend|longer|add)\s+(?:it\s+)?(?:by\s+)?(\d+(?:\.\d+)?)\s*(mile|miles|mi|kilometer|kilometers|km|meter|meters|m)\b/
  );
  if (extendMatch) {
    const deltaMeters = convertToMeters(Number(extendMatch[2]), extendMatch[3]);
    const currentMeters = convertDistanceToMeters(refined.distance.value, refined.distance.unit);
    const nextMeters = currentMeters + deltaMeters;
    refined.distance.value = metersToDistanceUnit(nextMeters, refined.distance.unit);
  }

  const shortenMatch = lower.match(
    /(shorter|reduce|decrease|subtract)\s+(?:it\s+)?(?:by\s+)?(\d+(?:\.\d+)?)\s*(mile|miles|mi|kilometer|kilometers|km|meter|meters|m)\b/
  );
  if (shortenMatch) {
    const deltaMeters = convertToMeters(Number(shortenMatch[2]), shortenMatch[3]);
    const currentMeters = convertDistanceToMeters(refined.distance.value, refined.distance.unit);
    const nextMeters = Math.max(800, currentMeters - deltaMeters);
    refined.distance.value = metersToDistanceUnit(nextMeters, refined.distance.unit);
  }

  if (/flatter|less hill|minimize elevation|less elevation|easier hills/.test(lower)) {
    refined.terrain.elevation.preference = 'minimize';
    refined.terrain.elevation.profile = 'flat';
  }

  if (/hillier|more hill|maximize elevation|more elevation/.test(lower)) {
    refined.terrain.elevation.preference = 'maximize';
    if (refined.terrain.elevation.profile === 'any' || refined.terrain.elevation.profile === 'flat') {
      refined.terrain.elevation.profile = 'hilly';
    }
  }

  const avoidMatches = [...text.matchAll(/avoid\s+([^,.;]+)/gi)];
  if (avoidMatches.length) {
    const nextAvoid = new Set(refined.location.avoidStreets ?? []);
    for (const match of avoidMatches) {
      const street = match[1]?.trim();
      if (!street) continue;
      nextAvoid.add(street.replace(/^(the|a|an)\s+/i, '').trim());
    }
    refined.location.avoidStreets = Array.from(nextAvoid);
  }

  const addLandmarkMatch = text.match(
    /(?:add|include|through|via|go through)\s+([A-Za-z0-9][A-Za-z0-9 '&.-]{1,80})/i
  );
  if (addLandmarkMatch?.[1]) {
    const landmark = addLandmarkMatch[1].trim();
    if (!refined.location.landmarks.includes(landmark)) {
      refined.location.landmarks = [...refined.location.landmarks, landmark];
    }
  }

  refined.confidence.assumptions = Array.from(
    new Set([...refined.confidence.assumptions, `refinement instruction: ${instruction}`])
  );
  return refined;
}

function convertToMeters(value: number, unit: string): number {
  if (/^mi|mile/.test(unit)) return value * 1609.344;
  if (/^km|kilometer/.test(unit)) return value * 1000;
  return value;
}

function convertDistanceToMeters(value: number, unit: RouteParametersParsed['distance']['unit']): number {
  if (unit === 'miles') return value * 1609.344;
  if (unit === 'kilometers') return value * 1000;
  return value;
}

function metersToDistanceUnit(valueMeters: number, unit: RouteParametersParsed['distance']['unit']): number {
  if (unit === 'miles') return roundDistance(valueMeters / 1609.344);
  if (unit === 'kilometers') return roundDistance(valueMeters / 1000);
  return Math.round(valueMeters);
}

function roundDistance(value: number): number {
  return Math.round(value * 100) / 100;
}
