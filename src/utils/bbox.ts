export function bboxFromPoint(point: [number, number], delta = 0.05): [number, number, number, number] {
  const [lng, lat] = point;
  return [lng - delta, lat - delta, lng + delta, lat + delta];
}

export function circularWaypoints(center: [number, number], radiusMeters: number, count = 12): [number, number][] {
  const waypoints: [number, number][] = [];
  const R = 6371e3;
  for (let i = 0; i < count; i++) {
    const bearing = (i / count) * 2 * Math.PI;
    const lat1 = (center[1] * Math.PI) / 180;
    const lon1 = (center[0] * Math.PI) / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(radiusMeters / R) +
        Math.cos(lat1) * Math.sin(radiusMeters / R) * Math.cos(bearing)
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearing) * Math.sin(radiusMeters / R) * Math.cos(lat1),
        Math.cos(radiusMeters / R) - Math.sin(lat1) * Math.sin(lat2)
      );
    waypoints.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
  }
  return waypoints;
}
