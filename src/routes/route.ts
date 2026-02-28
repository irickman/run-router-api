import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { geocode } from '../clients/mapboxClient';
import { extractRouteParameters, refineRouteParameters } from '../services/nlp';
import { defaultRouteName, generateRouteName } from '../services/routeNaming';
import { buildRoute } from '../services/routeBuilder';
import { logRequest } from '../services/requestLogger';
import { evaluateRoute } from '../services/routeEval';
import { getRoute, saveRoute } from '../services/storage';
import { metersToMiles, haversineDistance } from '../utils/geometry';
import { toGPX } from '../utils/gpx';
import { errorResponse, HttpError } from '../utils/httpErrors';
import { logError, logInfo } from '../utils/logger';
import { RouteParametersParsed } from '../utils/jsonSchema';

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
        if (startGeo[0] && haversineDistance(start, startGeo[0].coordinates) < 100_000) start = startGeo[0].coordinates;
      } catch {
        // Keep incoming location as fallback if start geocoding fails.
      }
    }

    const targetMeters = targetMetersFromParams(params);
    const profile = profileFromParams(params);

    const routeStarted = Date.now();
    const routeResult = await buildRoute({ params, start, targetMeters, profile });
    const routeMs = Date.now() - routeStarted;

    const distanceMeters = routeResult.distance;
    const elevationGainFeet = routeResult.ascend * 3.28084;
    const name =
      (await generateRouteName({
        query,
        params,
        elevationGainFeet,
      })) || defaultRouteName(params);
    const routeId = uuidv4();
    const sessionId = uuidv4();

    const routeData = {
      sessionId,
      routeId,
      geometry: { type: 'LineString' as const, coordinates: routeResult.coordinates },
      stats: {
        distance_miles: metersToMiles(distanceMeters),
        distance_meters: distanceMeters,
        elevation_gain_feet: elevationGainFeet,
        duration_minutes: routeResult.time / 60000,
      },
      parameters: params,
      metadata: { shape: params.shape.type, landmarks: params.location.landmarks },
      originalQuery: query,
      name,
      createdAt: new Date().toISOString(),
    };

    saveRoute(routeData);
    const totalMs = Date.now() - requestStarted;
    logInfo('route generated', {
      sessionId,
      routeId,
      query,
      distanceMeters,
      shape: params.shape.type,
      landmarks: params.location.landmarks,
      profile,
      timings: { parseMs, routeMs, totalMs },
    });
    const distanceRequested = `${params.distance.value} ${params.distance.unit}`;
    const distanceMilesActual = metersToMiles(distanceMeters);
    logRequest({
      timestamp: routeData.createdAt,
      routeId,
      query,
      shape: params.shape.type,
      distanceRequested,
      distanceMilesActual,
      elevationGainFt: elevationGainFeet,
      landmarks: params.location.landmarks,
      durationMs: totalMs,
      error: '',
    });
    evaluateRoute({
      query,
      routeId,
      shape: params.shape.type,
      distanceRequested,
      distanceMilesActual,
      elevationGainFt: elevationGainFeet,
    });
    res.json({
      sessionId,
      routeId,
      name: routeData.name,
      geometry: routeData.geometry,
      stats: routeData.stats,
      parameters: params,
      metadata: routeData.metadata,
      originalQuery: routeData.originalQuery,
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
    logRequest({
      timestamp: new Date().toISOString(),
      routeId: '',
      query: req.body?.query || '',
      shape: '',
      distanceRequested: '',
      distanceMilesActual: null,
      elevationGainFt: null,
      landmarks: [],
      durationMs: Date.now() - requestStarted,
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

router.post('/route/:sessionId/:routeId/refine', async (req, res) => {
  try {
    const sourceRoute = getRoute(req.params.sessionId, req.params.routeId);
    if (!sourceRoute) {
      const missing = errorResponse(404, 'NOT_FOUND', 'Route not found');
      return res.status(missing.status).json(missing.body);
    }

    const instructionRaw = req.body?.instruction;
    if (!instructionRaw || typeof instructionRaw !== 'string' || !instructionRaw.trim()) {
      const invalid = errorResponse(400, 'MISSING_FIELD', 'Missing required field: instruction');
      return res.status(invalid.status).json(invalid.body);
    }

    const instruction = instructionRaw.trim();
    const refinedParams = await refineRouteParameters(
      sourceRoute.parameters as RouteParametersParsed,
      instruction
    );
    const firstCoord = sourceRoute.geometry.coordinates[0];
    if (!firstCoord) {
      throw new HttpError(500, 'INTERNAL_ERROR', 'Stored route is missing geometry');
    }
    const start: [number, number] = [firstCoord[0], firstCoord[1]];
    const targetMeters = targetMetersFromParams(refinedParams);
    const profile = profileFromParams(refinedParams);
    const routeResult = await buildRoute({ params: refinedParams, start, targetMeters, profile });

    const routeId = uuidv4();
    const distanceMeters = routeResult.distance;
    const elevationGainFeet = routeResult.ascend * 3.28084;
    const name =
      (await generateRouteName({
        query: `${sourceRoute.originalQuery}; ${instruction}`,
        params: refinedParams,
        elevationGainFeet,
      })) || defaultRouteName(refinedParams);

    const routeData = {
      sessionId: sourceRoute.sessionId,
      routeId,
      geometry: { type: 'LineString' as const, coordinates: routeResult.coordinates },
      stats: {
        distance_miles: metersToMiles(distanceMeters),
        distance_meters: distanceMeters,
        elevation_gain_feet: elevationGainFeet,
        duration_minutes: routeResult.time / 60000,
      },
      parameters: refinedParams,
      metadata: {
        shape: refinedParams.shape.type,
        landmarks: refinedParams.location.landmarks,
        parentRouteId: sourceRoute.routeId,
      },
      originalQuery: sourceRoute.originalQuery,
      name,
      createdAt: new Date().toISOString(),
    };

    saveRoute(routeData);
    logInfo('route refined', {
      sessionId: routeData.sessionId,
      sourceRouteId: sourceRoute.routeId,
      routeId,
      instruction,
      distanceMeters,
      shape: refinedParams.shape.type,
    });

    res.json({
      sessionId: routeData.sessionId,
      routeId: routeData.routeId,
      name: routeData.name,
      geometry: routeData.geometry,
      stats: routeData.stats,
      parameters: refinedParams,
      metadata: routeData.metadata,
      originalQuery: routeData.originalQuery,
      gpxUrl: `/api/route/${routeData.sessionId}/${routeData.routeId}/gpx`,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      logError('route refinement failed', {
        code: err.code,
        status: err.status,
        error: err.message,
      });
      return res.status(err.status).json({ error: err.message, code: err.code });
    }

    const message = err instanceof Error ? err.message : 'Internal error';
    logError('route refinement failed', {
      code: 'INTERNAL_ERROR',
      status: 500,
      error: message,
    });
    res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
  }
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

function targetMetersFromParams(params: RouteParametersParsed): number {
  if (params.distance.unit === 'miles') return params.distance.value * 1609.344;
  if (params.distance.unit === 'kilometers') return params.distance.value * 1000;
  return params.distance.value;
}

function profileFromParams(params: RouteParametersParsed): 'trail' | 'foot' {
  return params.terrain.surfaces.some((s) => s.type === 'trail') ? 'trail' : 'foot';
}
