import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc } from 'drizzle-orm';

import { db } from '../db';
import { routes, feedback, user_preferences } from '../db/schema';
import { requireAuth } from '../middleware/auth';
import { RouteData } from '../models/routeParameters';

const router = Router();

router.get('/routes', requireAuth, async (req, res) => {
  const rows = await db
    .select({
      id: routes.id,
      route_id: routes.route_id,
      session_id: routes.session_id,
      name: routes.name,
      query: routes.query,
      is_favorite: routes.is_favorite,
      score: routes.score,
      created_at: routes.created_at,
      route_data: routes.route_data,
    })
    .from(routes)
    .where(eq(routes.user_id, req.user!.userId))
    .orderBy(desc(routes.created_at))
    .limit(50);

  const result = rows.map((r) => {
    const data = JSON.parse(r.route_data) as RouteData;
    return {
      id: r.id,
      routeId: r.route_id,
      sessionId: r.session_id,
      name: r.name,
      query: r.query,
      isFavorite: r.is_favorite,
      score: r.score,
      createdAt: r.created_at,
      stats: data.stats,
      metadata: data.metadata,
    };
  });

  res.json(result);
});

router.post('/routes/:id/favorite', requireAuth, async (req, res) => {
  const row = await db
    .select({ id: routes.id, is_favorite: routes.is_favorite, user_id: routes.user_id })
    .from(routes)
    .where(eq(routes.id, req.params.id))
    .limit(1);

  if (!row.length) {
    return res.status(404).json({ error: 'Route not found', code: 'NOT_FOUND' });
  }
  if (row[0].user_id !== req.user!.userId) {
    return res.status(403).json({ error: 'Forbidden', code: 'FORBIDDEN' });
  }

  const newFavorite = !row[0].is_favorite;
  await db.update(routes).set({ is_favorite: newFavorite }).where(eq(routes.id, req.params.id));
  res.json({ isFavorite: newFavorite });
});

router.post('/feedback', requireAuth, async (req, res) => {
  const { routeId, rating, likedAspects, changeSuggestions, comment } = req.body ?? {};

  if (!routeId || typeof routeId !== 'string') {
    return res.status(400).json({ error: 'Missing required field: routeId', code: 'MISSING_FIELD' });
  }

  const id = uuidv4();
  await db.insert(feedback).values({
    id,
    route_id: routeId,
    user_id: req.user!.userId,
    rating: typeof rating === 'number' ? rating : null,
    liked_aspects: likedAspects ? JSON.stringify(likedAspects) : null,
    change_suggestions: changeSuggestions ? JSON.stringify(changeSuggestions) : null,
    comment: typeof comment === 'string' ? comment : null,
    created_at: new Date().toISOString(),
  });

  res.status(201).json({ id });
});

router.get('/preferences', requireAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(user_preferences)
    .where(eq(user_preferences.user_id, req.user!.userId))
    .limit(1);

  if (!rows.length) {
    return res.json(null);
  }

  const p = rows[0];
  res.json({
    typicalDistance: p.typical_distance,
    preferredSurfaces: p.preferred_surfaces ? JSON.parse(p.preferred_surfaces) : null,
    elevationPreference: p.elevation_preference,
    safetySensitivity: p.safety_sensitivity,
    defaultLocation:
      p.default_location_lat != null && p.default_location_lng != null
        ? { lat: p.default_location_lat, lng: p.default_location_lng }
        : null,
  });
});

router.put('/preferences', requireAuth, async (req, res) => {
  const { typicalDistance, preferredSurfaces, elevationPreference, safetySensitivity, defaultLocation } =
    req.body ?? {};

  const now = new Date().toISOString();
  const userId = req.user!.userId;

  const existing = await db
    .select({ id: user_preferences.id })
    .from(user_preferences)
    .where(eq(user_preferences.user_id, userId))
    .limit(1);

  const values = {
    user_id: userId,
    typical_distance: typeof typicalDistance === 'number' ? typicalDistance : null,
    preferred_surfaces: preferredSurfaces ? JSON.stringify(preferredSurfaces) : null,
    elevation_preference: typeof elevationPreference === 'string' ? elevationPreference : null,
    safety_sensitivity: typeof safetySensitivity === 'string' ? safetySensitivity : null,
    default_location_lat: defaultLocation?.lat ?? null,
    default_location_lng: defaultLocation?.lng ?? null,
    updated_at: now,
  };

  if (existing.length) {
    await db.update(user_preferences).set(values).where(eq(user_preferences.user_id, userId));
  } else {
    await db.insert(user_preferences).values({ id: uuidv4(), ...values });
  }

  res.json({ updated: true });
});

export default router;
