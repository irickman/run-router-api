export function metersToMiles(meters: number): number {
  return meters / 1609.344;
}

export function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

export function haversineDistance(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371e3; // meters
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const h = sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function elevationGainFromCoords(coords: [number, number, number?][]): number {
  const MIN_SAMPLE_SPACING_METERS = 20;
  const MAX_ABS_GRADE = 0.25;
  const MIN_CLIMB_SEGMENT_METERS = 4;
  const SMOOTHING_WINDOW_RADIUS = 2;

  const elevated = coords.filter((p): p is [number, number, number] => typeof p[2] === 'number');
  if (elevated.length < 2) return 0;

  const sampled: [number, number, number][] = [elevated[0]];
  for (let i = 1; i < elevated.length; i++) {
    const last = sampled[sampled.length - 1];
    const next = elevated[i];
    if (haversineDistance([last[0], last[1]], [next[0], next[1]]) >= MIN_SAMPLE_SPACING_METERS) {
      sampled.push(next);
    }
  }
  const lastElevated = elevated[elevated.length - 1];
  const lastSampled = sampled[sampled.length - 1];
  if (lastSampled[0] !== lastElevated[0] || lastSampled[1] !== lastElevated[1]) {
    sampled.push(lastElevated);
  }
  if (sampled.length < 2) return 0;

  const smoothed = sampled.map((point, idx) => {
    let total = 0;
    let count = 0;
    const start = Math.max(0, idx - SMOOTHING_WINDOW_RADIUS);
    const end = Math.min(sampled.length - 1, idx + SMOOTHING_WINDOW_RADIUS);
    for (let i = start; i <= end; i++) {
      total += sampled[i][2];
      count += 1;
    }
    return [point[0], point[1], total / count] as [number, number, number];
  });

  let gain = 0;
  let pendingAscent = 0;

  for (let i = 0; i < smoothed.length - 1; i++) {
    const current = smoothed[i];
    const next = smoothed[i + 1];
    const horizontalMeters = haversineDistance([current[0], current[1]], [next[0], next[1]]);
    if (horizontalMeters < 1) continue;

    const rawDelta = next[2] - current[2];
    const cappedDelta = Math.max(
      -horizontalMeters * MAX_ABS_GRADE,
      Math.min(rawDelta, horizontalMeters * MAX_ABS_GRADE)
    );

    if (cappedDelta > 0) {
      pendingAscent += cappedDelta;
    } else if (pendingAscent > 0) {
      if (pendingAscent >= MIN_CLIMB_SEGMENT_METERS) gain += pendingAscent;
      pendingAscent = 0;
    }
  }

  if (pendingAscent >= MIN_CLIMB_SEGMENT_METERS) gain += pendingAscent;
  return gain;
}
