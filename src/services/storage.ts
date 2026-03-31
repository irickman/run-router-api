import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';
import { routes } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { RouteData } from '../models/routeParameters';

export async function saveRoute(route: RouteData): Promise<void> {
  const id = uuidv4();
  await db.insert(routes).values({
    id,
    session_id: route.sessionId,
    route_id: route.routeId,
    user_id: route.userId ?? null,
    name: route.name,
    query: route.originalQuery,
    parameters: JSON.stringify(route.parameters),
    route_data: JSON.stringify(route),
    created_at: route.createdAt,
  });
}

export async function getRoute(sessionId: string, routeId: string): Promise<RouteData | null> {
  const rows = await db
    .select({ route_data: routes.route_data })
    .from(routes)
    .where(and(eq(routes.session_id, sessionId), eq(routes.route_id, routeId)))
    .limit(1);

  if (!rows.length) return null;
  return JSON.parse(rows[0].route_data) as RouteData;
}
