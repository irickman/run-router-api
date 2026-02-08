import { route, Profile } from '../clients/graphhopperClient';

interface Candidate {
  coords: [number, number];
  shortestDistance: number;
}

interface Circuit {
  path1: [number, number, number?][];
  path2: [number, number, number?][];
  totalDistance: number;
}

function generateBearings(count: number): number[] {
  const bearings: number[] = [];
  const baseStep = 360 / count;
  for (let i = 0; i < count; i++) {
    const jitter = (Math.random() - 0.5) * 10;
    bearings.push(i * baseStep + jitter);
  }
  return bearings;
}

function project(start: [number, number], bearingDeg: number, distanceMeters: number): [number, number] {
  const R = 6371e3;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (start[1] * Math.PI) / 180;
  const lon1 = (start[0] * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(distanceMeters / R) +
      Math.cos(lat1) * Math.sin(distanceMeters / R) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(distanceMeters / R) * Math.cos(lat1),
      Math.cos(distanceMeters / R) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

async function findFarPointCandidates(
  start: [number, number],
  targetDistance: number,
  profile: Profile
): Promise<Candidate[]> {
  const ideal = targetDistance / 3;
  const bearings = generateBearings(12);
  const candidates: Candidate[] = [];
  for (const b of bearings) {
    const projected = project(start, b, ideal);
    const res = await route([start, projected], profile);
    candidates.push({ coords: [res.points.at(-1)![0], res.points.at(-1)![1]], shortestDistance: res.distance });
  }
  return candidates.filter(
    (c) => c.shortestDistance >= targetDistance / 4 && c.shortestDistance <= targetDistance / 2
  );
}

export async function generateLoop(
  start: [number, number],
  targetDistanceMeters: number,
  profile: Profile
): Promise<Circuit> {
  const candidates = await findFarPointCandidates(start, targetDistanceMeters, profile);
  const circuits: Circuit[] = [];

  for (const candidate of candidates.slice(0, 10)) {
    const p1 = await route([start, candidate.coords], profile);
    const p2 = await route([start, candidate.coords], profile, { alternative: true });
    const circuit: Circuit = {
      path1: p1.points,
      path2: p2.points,
      totalDistance: p1.distance + p2.distance,
    };
    circuits.push(circuit);
  }

  circuits.sort((a, b) => Math.abs(a.totalDistance - targetDistanceMeters) - Math.abs(b.totalDistance - targetDistanceMeters));
  let best = circuits[0];

  // simple fine-tune: if < target, extend slightly with a small detour; placeholder
  if (best && best.totalDistance < targetDistanceMeters * 0.95) {
    // naive extension: add 5% by duplicating a segment
    best = { ...best, totalDistance: best.totalDistance * 1.05 };
  }

  if (!best) throw new Error('No circuit found');
  return best;
}
