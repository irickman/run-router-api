import { RouteData } from '../models/routeParameters';

const store = new Map<string, { data: RouteData; expiresAt: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

export function saveRoute(route: RouteData) {
  const key = keyFor(route.sessionId, route.routeId);
  store.set(key, { data: route, expiresAt: Date.now() + TTL_MS });
}

export function getRoute(sessionId: string, routeId: string): RouteData | null {
  const key = keyFor(sessionId, routeId);
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

function keyFor(sessionId: string, routeId: string) {
  return `route:${sessionId}:${routeId}`;
}
