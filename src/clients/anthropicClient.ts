import Anthropic from '@anthropic-ai/sdk';

import { env } from '../config/env';
import { RouteParametersParsed, RouteParametersSchema } from '../utils/jsonSchema';
import { logExternalError } from '../utils/logger';
import { RouteParametersJsonSchema } from '../utils/routeParametersSchemaJson';

const SYSTEM_PROMPT = `
You are a running-route parameter extractor.
- Follow RouteParameters JSON schema strictly.
- Defaults: region Seattle, WA (47.6062, -122.3321) when unspecified; shape loop when unspecified.
- Distance keywords: 5k=5 km, 10k=10 km, half marathon=13.1 miles, marathon=26.2 miles, long run=8-12 miles, short run=2-4 miles, easy run=3-5 miles.
- Terrain/elevation cues: "trail" => surface trail, "flat" => elevation profile flat, "hilly" => hilly.
- Extract all mentioned landmarks.
- Confidence overall 0-1; list needsClarification and assumptions.
Examples:
User: "5 mile loop around Green Lake"
Return: distance 5 miles exact; shape loop; location.landmarks ["Green Lake"]

User: "10k out and back from Space Needle to Kerry Park"
Return: distance 10 kilometers exact; shape out-and-back; startPoint Space Needle; landmarks ["Space Needle","Kerry Park"]

User: "long trail run in Discovery Park, keep it hilly"
Return: distance 8-12 miles approximate; surface trail; elevation profile hilly; landmarks ["Discovery Park"]

Return only the schema object.`;

const client = new Anthropic({ apiKey: env.anthropicKey });
const schemaJson = RouteParametersJsonSchema;

export async function extractParametersWithAnthropic(query: string): Promise<RouteParametersParsed> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [
      {
        name: 'extract_route_parameters',
        description: 'Extract structured route parameters from user query',
        input_schema: schemaJson as any,
      },
      ],
      tool_choice: { type: 'tool', name: 'extract_route_parameters' },
      messages: [{ role: 'user', content: query }],
      system: SYSTEM_PROMPT,
    });

    const toolUse = response.content.find((c: any) => c.type === 'tool_use') as
      | { input?: unknown }
      | undefined;
    const parsed = toolUse?.input ?? null;
    if (!parsed) throw new Error('Anthropic returned no tool output');
    return RouteParametersSchema.parse(parsed);
  } catch (err) {
    logExternalError('anthropic', err, { stage: 'parameter-extraction' });
    throw err;
  }
}
