import dotenv from 'dotenv';

dotenv.config();

const requiredEnv = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'MAPBOX_TOKEN', 'GRAPHHOPPER_URL', 'PORT'];

const defaultsForTest: Record<string, string> = {
  OPENAI_API_KEY: 'test',
  ANTHROPIC_API_KEY: 'test',
  MAPBOX_TOKEN: 'test',
  GRAPHHOPPER_URL: 'http://localhost:8989',
  PORT: '3000',
};

if (process.env.NODE_ENV === 'test') {
  Object.entries(defaultsForTest).forEach(([k, v]) => {
    if (!process.env[k]) process.env[k] = v;
  });
}

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
