import dotenv from 'dotenv';

dotenv.config();

const requiredEnv = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MAPBOX_TOKEN', 'GRAPHHOPPER_URL', 'PORT'];

const missing = requiredEnv.filter((key) => !process.env[key]);
if (missing.length) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}

export const env = {
  openaiKey: process.env.OPENAI_API_KEY!,
  anthropicKey: process.env.ANTHROPIC_API_KEY!,
  mapboxToken: process.env.MAPBOX_TOKEN!,
  graphhopperUrl: process.env.GRAPHHOPPER_URL!,
  port: Number(process.env.PORT || 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
};
