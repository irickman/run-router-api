import { Request, Response, NextFunction } from 'express';
import { SignJWT, jwtVerify } from 'jose';

import { env } from '../config/env';

export interface JwtPayload {
  userId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function getSecret(): Uint8Array {
  return new TextEncoder().encode(env.jwtSecret);
}

export async function signJwt(payload: JwtPayload): Promise<string> {
  return new SignJWT({ userId: payload.userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('7d')
    .sign(getSecret());
}

export async function verifyJwt(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.userId !== 'string') return null;
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyJwt(token);
    if (payload) req.user = payload;
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  }
  const token = authHeader.slice(7);
  const payload = await verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token', code: 'INVALID_TOKEN' });
  }
  req.user = payload;
  next();
}
