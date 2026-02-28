import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import routeRouter from './routes/route';
import healthRouter from './routes/health';
import { ensureSheetTabs } from './services/requestLogger';

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: env.rateLimitPerHour });

export const app = express();
app.set('trust proxy', 1);
app.use(
  cors({
    origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',').map((v) => v.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json());

app.use('/api', limiter, routeRouter);
app.use('/', healthRouter);

export function start() {
  ensureSheetTabs().catch(() => {});
  const server = app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
  return server;
}
