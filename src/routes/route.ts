import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { geocode } from '../clients/mapboxClient';
import { generateLoop } from '../services/loopGenerator';
import { extractRouteParameters } from '../services/nlp';
import { getRoute, saveRoute } from '../services/storage';
import { metersToMiles } from '../utils/geometry';
import { toGPX } from '../utils/gpx';

const router = Router();

router.post('/route', async (req, res) => {
  try {
    const { query, location } = req.body;
    if (!query || !location) return res.status(400).json({ error: 'Missing query or location' });

    const params = await extractRouteParameters(query);
    const start = [location.lng, location.lat] as [number, number];

    // simple geocode bias
    await geocode(params.location.startPoint || '', start);

    const targetMeters =
      params.distance.unit === 'miles'
        ? params.distance.value * 1609.344
        : params.distance.unit === 'kilometers'
          ? params.distance.value * 1000
          : params.distance.value;

    const profile = params.terrain.surfaces.some((s) => s.type === 'trail') ? 'trail' : 'foot';

    const circuit = await generateLoop(start, targetMeters, profile);

    const distanceMeters = circuit.totalDistance;
    const routeId = uuidv4();
    const sessionId = uuidv4();

    const routeData = {
      sessionId,
      routeId,
      geometry: { type: 'LineString', coordinates: [...circuit.path1, ...circuit.path2] },
      stats: {
        distance_miles: metersToMiles(distanceMeters),
        distance_meters: distanceMeters,
        elevation_gain_feet: 0,
        duration_minutes: (distanceMeters / (9 * 60)) / 60, // placeholder pace 9 min/mi
      },
      parameters: params,
      metadata: { shape: params.shape.type, landmarks: params.location.landmarks },
      originalQuery: query,
      name: `${params.distance.value} ${params.distance.unit} ${params.shape.type}`,
      createdAt: new Date().toISOString(),
    };

    saveRoute(routeData);
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
    const message = err instanceof Error ? err.message : 'Internal error';
    res.status(500).json({ error: message });
  }
});

router.get('/route/:sessionId/:routeId', (req, res) => {
  const route = getRoute(req.params.sessionId, req.params.routeId);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  res.json(route);
});

router.get('/route/:sessionId/:routeId/gpx', (req, res) => {
  const route = getRoute(req.params.sessionId, req.params.routeId);
  if (!route) return res.status(404).json({ error: 'Route not found' });
  const gpx = toGPX(route);
  res.setHeader('Content-Type', 'application/gpx+xml');
  res.setHeader('Content-Disposition', `attachment; filename="route-${route.routeId}.gpx"`);
  res.send(gpx);
});

export default router;
