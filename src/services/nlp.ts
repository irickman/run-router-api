import { extractParametersWithOpenAI } from '../clients/openaiClient';
import { extractParametersWithAnthropic } from '../clients/anthropicClient';
import { RouteParametersParsed } from '../utils/jsonSchema';

export async function extractRouteParameters(query: string): Promise<RouteParametersParsed> {
  try {
    return await extractParametersWithOpenAI(query);
  } catch {
    // fallback
    return await extractParametersWithAnthropic(query);
  }
}
