import { extractParametersWithOpenAI } from '../clients/openaiClient';
import { extractParametersWithAnthropic } from '../clients/anthropicClient';
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
  const landmarkCandidates = [
    extractIntentTarget(normalized, /(?:around|loop around|circle)\s+([^,.;]+)/i),
    extractIntentTarget(normalized, /(?:through|across)\s+([^,.;]+)/i),
    extractIntentTarget(normalized, /(?:along|following)\s+([^,.;]+)/i),
    extractIntentTarget(normalized, /(?:via|past)\s+([^,.;]+)/i),
  ].filter((v): v is string => Boolean(v));

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
      landmarks: Array.from(new Set(landmarkCandidates)),
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
