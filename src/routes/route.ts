import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { geocode } from '../clients/mapboxClient';
import { extractRouteParameters } from '../services/nlp';
import { buildRoute } from '../services/routeBuilder';
import { getRoute, saveRoute } from '../services/storage';
import { metersToMiles } from '../utils/geometry';
import { toGPX } from '../utils/gpx';
import { errorResponse, HttpError } from '../utils/httpErrors';
import { logError, logInfo } from '../utils/logger';

const router = Router();

router.post('/route', async (req, res) => {
  const requestStarted = Date.now();
  try {
    const { query, location } = req.body;
    if (!query || typeof query !== 'string') {
      const missing = errorResponse(400, 'MISSING_FIELD', 'Missing required field: query');
      return res.status(missing.status).json(missing.body);
    }

    const fallbackLocation = { lat: 47.6062, lng: -122.3321 };
    const hasValidLocation =
      location &&
      typeof location.lat === 'number' &&
      Number.isFinite(location.lat) &&
      typeof location.lng === 'number' &&
      Number.isFinite(location.lng);
    const loc = hasValidLocation ? location : fallbackLocation;

    const parseStarted = Date.now();
    const params = await extractRouteParameters(query);
    const parseMs = Date.now() - parseStarted;
    let start = [loc.lng, loc.lat] as [number, number];

    if (params.location.startPoint) {
      try {
        const startGeo = await geocode(params.location.startPoint, start);
        if (startGeo[0]) start = startGeo[0].coordinates;
      } catch {
        // Keep incoming location as fallback if start geocoding fails.
      }
    }

    const targetMeters =
      params.distance.unit === 'miles'
        ? params.distance.value * 1609.344
        : params.distance.unit === 'kilometers'
          ? params.distance.value * 1000
          : params.distance.value;

    const profile = params.terrain.surfaces.some((s) => s.type === 'trail') ? 'trail' : 'foot';

    const routeStarted = Date.now();
    const routeResult = await buildRoute({ params, start, targetMeters, profile });
    const routeMs = Date.now() - routeStarted;

    const distanceMeters = routeResult.distance;
    const routeId = uuidv4();
    const sessionId = uuidv4();

    const routeData = {
      sessionId,
      routeId,
      geometry: { type: 'LineString' as const, coordinates: routeResult.coordinates },
      stats: {
        distance_miles: metersToMiles(distanceMeters),
        distance_meters: distanceMeters,
        elevation_gain_feet: routeResult.ascend * 3.28084,
        duration_minutes: routeResult.time / 60000,
      },
      parameters: params,
      metadata: { shape: params.shape.type, landmarks: params.location.landmarks },
      originalQuery: query,
      name: `${params.distance.value} ${params.distance.unit} ${params.shape.type}`,
      createdAt: new Date().toISOString(),
    };

    saveRoute(routeData);
    logInfo('route generated', {
      sessionId,
      routeId,
      query,
      distanceMeters,
      shape: params.shape.type,
      landmarks: params.location.landmarks,
      profile,
      timings: {
        parseMs,
        routeMs,
        totalMs: Date.now() - requestStarted,
      },
    });
    res.json({
      sessionId,
      routeId,
      name: routeData.name,
      geometry: routeData.geometry,
      stats: routeData.stats,
      parameters: params,
      metadata: routeData.metadata,
      gpxUrl: `/api/route/${sessionId}/${routeId}/gpx`,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      logError('route request failed', {
        code: err.code,
        status: err.status,
        error: err.message,
      });
      return res.status(err.status).json({ error: err.message, code: err.code });
    }

    const message = err instanceof Error ? err.message : 'Internal error';
    logError('route request failed', {
      code: 'INTERNAL_ERROR',
      status: 500,
      error: message,
    });
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
  }
});

router.get('/route/:sessionId/:routeId', (req, res) => {
  const route = getRoute(req.params.sessionId, req.params.routeId);
  if (!route) {
    const missing = errorResponse(404, 'NOT_FOUND', 'Route not found');
    return res.status(missing.status).json(missing.body);
  }
  res.json(route);
});

router.get('/route/:sessionId/:routeId/gpx', (req, res) => {
  const route = getRoute(req.params.sessionId, req.params.routeId);
  if (!route) {
    const missing = errorResponse(404, 'NOT_FOUND', 'Route not found');
    return res.status(missing.status).json(missing.body);
  }
  const gpx = toGPX(route);
  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="route-${route.routeId}.gpx"`);
  res.send(gpx);
});

export default router;
