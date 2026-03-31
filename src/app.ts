import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import routeRouter from './routes/route';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import userRouter from './routes/user';
import { ensureSheetTabs } from './services/requestLogger';
import { initializeSchema } from './db';
import { optionalAuth } from './middleware/auth';

const limiter = rateLimit({ windowMs: 60 * 60 * 1000, max: env.rateLimitPerHour });

export const app = express();
app.set('trust proxy', 1);
app.use(
  cors({
    origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',').map((v) => v.trim()),
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use(express.json());
app.use(optionalAuth);

app.use('/api', limiter, routeRouter);
app.use('/api/auth', authRouter);
app.use('/api/user', userRouter);
app.use('/', healthRouter);

export function start() {
  initializeSchema();
  ensureSheetTabs().catch(() => {});
  const server = app.listen(env.port, () => {
    console.log(`Server running on port ${env.port}`);
  });
  return server;
}
