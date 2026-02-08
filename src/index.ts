import cors from 'cors';
import express from 'express';

import { env } from './config/env';
import routeRouter from './routes/route';
import healthRouter from './routes/health';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api', routeRouter);
app.use('/', healthRouter);

app.listen(env.port, () => {
  console.log(`Server running on port ${env.port}`);
});
