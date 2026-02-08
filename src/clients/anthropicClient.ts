import Anthropic, { MessageCreateParams } from '@anthropic-ai/sdk';

import { env } from '../config/env';
import { RouteParametersParsed, RouteParametersSchema } from '../utils/jsonSchema';

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
    system: 'Parse running route requests into RouteParameters JSON schema.',
  });

  const toolUse = response.content.find(
    (c): c is MessageCreateParams.ToolUseBlock => c.type === 'tool_use'
  );
  const parsed = toolUse?.input ?? null;
  if (!parsed) throw new Error('Anthropic returned no tool output');
  return RouteParametersSchema.parse(parsed);
}
