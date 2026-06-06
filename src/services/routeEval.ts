import Anthropic from '@anthropic-ai/sdk';
import type { TextBlock } from '@anthropic-ai/sdk/resources/messages';

import { env } from '../config/env';
import { logError } from '../utils/logger';

import { logEval } from './requestLogger';

const client = new Anthropic({ apiKey: env.anthropicKey });

const EVAL_PROMPT = `You evaluate running route quality. Given a user query and resulting route stats, assess:
1. Distance accuracy: how close actual distance is to requested
2. Shape appropriateness: does the route shape match what was requested?
3. Route quality: any obvious issues (extremely short, unreasonably long, wrong area)?

Respond with JSON only: { "pass": boolean, "score": number (0-10), "evaluation": "1-2 sentence explanation" }
- pass=true if score >= 6
- Score 8-10: excellent match. 6-7: acceptable. 4-5: mediocre. 0-3: poor.`;

interface EvalInput {
  query: string;
  routeId: string;
  shape: string;
  distanceRequested: string;
  distanceMilesActual: number;
  elevationGainFt: number;
}

interface RouteEvalResponse {
  pass: boolean;
  score: number;
  evaluation: string;
}

export function evaluateRoute(input: EvalInput) {
  if (env.nodeEnv === 'test') return;
  runEval(input).catch((err) => {
    logError('route eval failed', { error: err instanceof Error ? err.message : String(err) });
  });
}

async function runEval(input: EvalInput) {
  const requestedMiles = parseRequestedMiles(input.distanceRequested);
  const accuracyPct = requestedMiles > 0
    ? Math.round(((input.distanceMilesActual - requestedMiles) / requestedMiles) * 1000) / 10
    : 0;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    system: EVAL_PROMPT,
    messages: [{
      role: 'user',
      content: `Query: "${input.query}"
Shape: ${input.shape}
Distance requested: ${input.distanceRequested}
Distance actual: ${Math.round(input.distanceMilesActual * 100) / 100} miles
Elevation gain: ${Math.round(input.elevationGainFt)} ft
Distance accuracy: ${accuracyPct > 0 ? '+' : ''}${accuracyPct}%`,
    }],
  });

  const text = response.content
    .filter((c): c is TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('')
    .trim();

  const json = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim()) as RouteEvalResponse;

  logEval({
    timestamp: new Date().toISOString(),
    routeId: input.routeId,
    query: input.query,
    pass: json.pass,
    score: json.score,
    evaluation: json.evaluation,
    distanceRequested: input.distanceRequested,
    distanceMilesActual: input.distanceMilesActual,
    distanceAccuracyPct: accuracyPct,
  });
}

function parseRequestedMiles(requested: string): number {
  const match = requested.match(/([\d.]+)\s*(mi|km|k)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'km' || unit === 'k') return val * 0.621371;
  return val;
}
