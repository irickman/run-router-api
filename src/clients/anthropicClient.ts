import Anthropic, { MessageCreateParams } from '@anthropic-ai/sdk';

import { env } from '../config/env';
import { RouteParametersParsed, RouteParametersSchema } from '../utils/jsonSchema';

const SYSTEM_PROMPT = `
You are a running-route parameter extractor.
- Follow RouteParameters JSON schema strictly.
- Defaults: region Seattle, WA (47.6062, -122.3321) when unspecified; shape loop when unspecified.
- Distance keywords: 5k=5 km, 10k=10 km, half marathon=13.1 miles, marathon=26.2 miles, long run=8-12 miles, short run=2-4 miles, easy run=3-5 miles.
- Terrain/elevation cues: "trail" => surface trail, "flat" => elevation profile flat, "hilly" => hilly.
- Extract all mentioned landmarks.
- Confidence overall 0-1; list needsClarification and assumptions.
Return only the schema object.`;

const client = new Anthropic({ apiKey: env.anthropicKey });

export async function extractParametersWithAnthropic(query: string): Promise<RouteParametersParsed> {
  const response = await client.messages.create({
    model: 'claude-3-haiku-20240307',
    max_tokens: 1024,
    tools: [
      {
        name: 'extract_route_parameters',
        description: 'Extract structured route parameters from user query',
        input_schema: RouteParametersSchema.toJSON(),
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_route_parameters' },
    messages: [{ role: 'user', content: query }],
    system: SYSTEM_PROMPT,
  });

  const toolUse = response.content.find(
    (c): c is MessageCreateParams.ToolUseBlock => c.type === 'tool_use'
  );
  const parsed = toolUse?.input ?? null;
  if (!parsed) throw new Error('Anthropic returned no tool output');
  return RouteParametersSchema.parse(parsed);
}
