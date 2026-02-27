import { generateRouteNameWithAnthropic } from '../clients/anthropicClient';
import { env } from '../config/env';
import { RouteParametersParsed } from '../utils/jsonSchema';

const NAME_TIMEOUT_MS = 500;

export function defaultRouteName(params: RouteParametersParsed): string {
  return `${params.distance.value} ${params.distance.unit} ${params.shape.type}`;
}

export async function generateRouteName(input: {
  query: string;
  params: RouteParametersParsed;
  elevationGainFeet: number;
}): Promise<string> {
  const fallback = defaultRouteName(input.params);
  if (env.nodeEnv === 'test') return fallback;

  try {
    const generated = await withTimeout(
      generateRouteNameWithAnthropic({
        query: input.query,
        landmarks: input.params.location.landmarks,
        distanceValue: input.params.distance.value,
        distanceUnit: input.params.distance.unit,
        shape: input.params.shape.type,
        elevationProfile: input.params.terrain.elevation.profile,
        elevationGainFeet: input.elevationGainFeet,
      }),
      NAME_TIMEOUT_MS,
      'Route naming timed out'
    );
    const cleaned = generated.replace(/\s+/g, ' ').trim();
    return isPlausibleName(cleaned) ? cleaned : fallback;
  } catch {
    return fallback;
  }
}

function isPlausibleName(name: string): boolean {
  const words = name.split(/\s+/).filter(Boolean);
  return words.length >= 3 && words.length <= 6;
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
