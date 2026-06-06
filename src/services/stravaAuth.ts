import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';

import { db } from '../db';
import { users } from '../db/schema';
import { env } from '../config/env';

export interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete: {
    id: number;
    firstname: string;
    lastname: string;
    username: string;
    profile: string;
  };
}

export function getStravaAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: env.stravaClientId,
    redirect_uri: env.stravaRedirectUri,
    response_type: 'code',
    scope: 'read,activity:read',
  });
  return `https://www.strava.com/oauth/authorize?${params.toString()}`;
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.stravaClientId,
      client_secret: env.stravaClientSecret,
      code,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava token exchange failed: ${text}`);
  }

  return response.json() as Promise<StravaTokenResponse>;
}

export async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.stravaClientId,
      client_secret: env.stravaClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Strava token refresh failed: ${text}`);
  }

  return response.json() as Promise<StravaTokenResponse>;
}

export async function upsertUserFromStrava(tokenResponse: StravaTokenResponse): Promise<string> {
  const athlete = tokenResponse.athlete;
  const now = new Date().toISOString();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.strava_id, athlete.id))
    .limit(1);

  if (existing.length > 0) {
    const userId = existing[0].id;
    await db
      .update(users)
      .set({
        name: `${athlete.firstname} ${athlete.lastname}`.trim(),
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token,
        token_expires_at: tokenResponse.expires_at,
      })
      .where(eq(users.id, userId));
    return userId;
  }

  const userId = uuidv4();
  await db.insert(users).values({
    id: userId,
    strava_id: athlete.id,
    name: `${athlete.firstname} ${athlete.lastname}`.trim(),
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    token_expires_at: tokenResponse.expires_at,
    created_at: now,
  });
  return userId;
}
