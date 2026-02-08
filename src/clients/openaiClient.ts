import OpenAI from 'openai';

import { env } from '../config/env';
import { RouteParametersParsed, RouteParametersSchema } from '../utils/jsonSchema';

const SYSTEM_PROMPT = `
You are a running-route parameter extractor.
- Output MUST follow the RouteParameters JSON schema.
- Defaults: region Seattle, WA (47.6062, -122.3321) when unspecified; shape loop when unspecified.
- Distance keywords: 5k=5 km, 10k=10 km, half marathon=13.1 miles, marathon=26.2 miles, long run=8-12 miles, short run=2-4 miles, easy run=3-5 miles.
- Terrain/elevation cues: "trail" => surface trail, "flat" => elevation profile flat, "hilly" => hilly.
- Extract landmarks mentioned (use array).
- Confidence overall 0-1; list needsClarification and assumptions.
Examples:
User: "5 mile loop around Green Lake"
Return: distance 5 miles exact; shape loop; location.landmarks ["Green Lake"]

User: "10k out and back from Space Needle to Kerry Park"
Return: distance 10 kilometers exact; shape out-and-back; startPoint Space Needle; landmarks ["Space Needle","Kerry Park"]

User: "long trail run in Discovery Park, keep it hilly"
Return: distance 8-12 miles approximate; surface trail; elevation profile hilly; landmarks ["Discovery Park"]

Return only the JSON schema object.`;

const client = new OpenAI({ apiKey: env.openaiKey });

export async function extractParametersWithOpenAI(query: string): Promise<RouteParametersParsed> {
  const response = await client.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
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
