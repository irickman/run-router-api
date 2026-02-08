import OpenAI from 'openai';

import { env } from '../config/env';
import { RouteParametersParsed, RouteParametersSchema } from '../utils/jsonSchema';

const client = new OpenAI({ apiKey: env.openaiKey });

export async function extractParametersWithOpenAI(query: string): Promise<RouteParametersParsed> {
  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: 'Parse running route requests into RouteParameters JSON schema.' },
      { role: 'user', content: query },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'RouteParameters',
        strict: true,
        schema: RouteParametersSchema.toJSON(),
      },
    },
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error('OpenAI returned empty content');
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return RouteParametersSchema.parse(parsed);
}
