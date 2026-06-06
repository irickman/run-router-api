import { Router } from 'express';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { users } from '../db/schema';
import { getStravaAuthUrl, exchangeStravaCode, upsertUserFromStrava } from '../services/stravaAuth';
import { signJwt, requireAuth } from '../middleware/auth';

const router = Router();

router.get('/strava', (_req, res) => {
  res.redirect(getStravaAuthUrl());
});

router.get('/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error || !code || typeof code !== 'string') {
    return res.status(400).json({ error: 'OAuth error or missing code', code: 'OAUTH_ERROR' });
  }

  try {
    const tokenResponse = await exchangeStravaCode(code);
    const userId = await upsertUserFromStrava(tokenResponse);
    const jwt = await signJwt({ userId });
    res.json({ token: jwt, userId });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Auth failed';
    res.status(500).json({ error: message, code: 'AUTH_ERROR' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await db
    .select({
      id: users.id,
      strava_id: users.strava_id,
      email: users.email,
      name: users.name,
      created_at: users.created_at,
    })
    .from(users)
    .where(eq(users.id, req.user!.userId))
    .limit(1);

  if (!user.length) {
    return res.status(404).json({ error: 'User not found', code: 'NOT_FOUND' });
  }

  res.json(user[0]);
});

export default router;
