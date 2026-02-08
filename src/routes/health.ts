import axios from 'axios';
import { Router } from 'express';

import { env } from '../config/env';

const router = Router();

router.get('/health', async (_req, res) => {
  const services: Record<string, string> = {};
  try {
    await axios.get(env.graphhopperUrl, { timeout: 3000 });
    services.graphhopper = 'ok';
  } catch {
    services.graphhopper = 'error';
  }
  try {
    await axios.get('https://overpass-api.de/api/status', { timeout: 3000 });
    services.overpass = 'ok';
  } catch {
    services.overpass = 'error';
  }
  res.json({ status: 'ok', timestamp: Date.now(), services });
});

export default router;
