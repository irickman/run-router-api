import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import routeRouter from './routes/route';
import healthRouter from './routes/health';

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: env.rateLimitPerHour });

export const app = express();
app.use(
  cors({
    origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',').map((v) => v.trim()),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  })
);
app.use(express.json());
app.use(limiter);

app.use('/api', routeRouter);
app.use('/', healthRouter);

export function start() {
  const server = app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
  return server;
}
