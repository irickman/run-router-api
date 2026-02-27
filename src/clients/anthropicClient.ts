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
- If user asks to avoid a street/road, add it to location.avoidStreets.
- Confidence overall 0-1; list needsClarification and assumptions.
Examples:
User: "5 mile loop around Green Lake"
Return: distance 5 miles exact; shape loop; location.landmarks ["Green Lake"]

User: "10k out and back from Space Needle to Kerry Park"
Return: distance 10 kilometers exact; shape out-and-back; startPoint Space Needle; landmarks ["Space Needle","Kerry Park"]

User: "long trail run in Discovery Park, keep it hilly"
Return: distance 8-12 miles approximate; surface trail; elevation profile hilly; landmarks ["Discovery Park"]

Return only the schema object.`;

const REFINEMENT_PROMPT = `
You revise running-route parameters using a user refinement instruction.
- Start from the provided original parameters.
- Apply only changes implied by the instruction.
- Preserve values that are unrelated to the instruction.
- Keep output strictly valid against the RouteParameters schema.
- When instruction says to avoid a street/road, add it to location.avoidStreets.
- Return the full updated schema object via tool output.
`;

const ROUTE_NAME_PROMPT = `
Generate a short, creative running route name.
- 3 to 6 words.
- Fun and descriptive.
- Include landmarks or neighborhood references when available.
- Return only the route name text, no punctuation wrappers.
`;

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

    const parsed = toolInput(response.content);
    if (!parsed) throw new Error('Anthropic returned no tool output');
    return RouteParametersSchema.parse(parsed);
  } catch (err) {
    logExternalError('anthropic', err, { stage: 'parameter-extraction' });
    throw err;
  }
}

export async function refineParametersWithAnthropic(
  originalParams: RouteParametersParsed,
  instruction: string
): Promise<RouteParametersParsed> {
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [
        {
          name: 'refine_route_parameters',
          description: 'Refine route parameters based on user instruction',
          input_schema: schemaJson as any,
        },
      ],
      tool_choice: { type: 'tool', name: 'refine_route_parameters' },
      messages: [
        {
          role: 'user',
          content: `Original parameters:\n${JSON.stringify(
            originalParams
          )}\n\nInstruction:\n${instruction}`,
        },
      ],
      system: REFINEMENT_PROMPT,
    });

    const parsed = toolInput(response.content);
    if (!parsed) throw new Error('Anthropic returned no tool output');
    return RouteParametersSchema.parse(parsed);
  } catch (err) {
    logExternalError('anthropic', err, { stage: 'parameter-refinement' });
    throw err;
  }
}

export async function generateRouteNameWithAnthropic(input: {
  query: string;
  landmarks: string[];
  distanceValue: number;
  distanceUnit: string;
  shape: string;
  elevationProfile: string;
  elevationGainFeet: number;
}): Promise<string> {
  const landmarks = input.landmarks.length ? input.landmarks.join(', ') : 'none';

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      system: ROUTE_NAME_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Query: ${input.query}
Landmarks: ${landmarks}
Distance: ${input.distanceValue} ${input.distanceUnit}
Shape: ${input.shape}
Elevation profile: ${input.elevationProfile}
Elevation gain: ${Math.round(input.elevationGainFeet)} feet`,
        },
      ],
    });

    const text = response.content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join(' ')
      .trim();

    if (!text) throw new Error('Anthropic returned empty name');
    return text.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
  } catch (err) {
    logExternalError('anthropic', err, { stage: 'route-naming' });
    throw err;
  }
}

function toolInput(content: any[]): unknown {
  const toolUse = content.find((c: any) => c.type === 'tool_use') as { input?: unknown } | undefined;
  return toolUse?.input ?? null;
}
