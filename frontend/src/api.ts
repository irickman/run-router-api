import type { RouteResponse } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'https://route-runner-api.fly.dev';

export interface ApiError {
  error: string;
  code?: string;
}

export async function generateRoute(
  query: string,
  location: { lat: number; lng: number }
): Promise<RouteResponse> {
  const res = await fetch(`${API_URL}/api/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, location }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ApiError = {
      error: data.error || `Request failed: ${res.status}`,
      code: data.code,
    };
    throw err;
  }
  return data;
}

export async function getRoute(
  sessionId: string,
  routeId: string
): Promise<RouteResponse> {
  const res = await fetch(`${API_URL}/api/route/${sessionId}/${routeId}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ApiError = {
      error: data.error || `Request failed: ${res.status}`,
      code: data.code,
    };
    throw err;
  }
  return data;
}

export function getGpxUrl(sessionId: string, routeId: string): string {
  return `${API_URL}/api/route/${sessionId}/${routeId}/gpx`;
}
