import { route, Profile } from '../clients/graphhopperClient';

interface Candidate {
  coords: [number, number];
  shortestDistance: number;
}

interface Circuit {
  path1: [number, number, number?][];
  path2: [number, number, number?][];
  totalDistance: number;
  totalTime: number;
  totalAscend: number;
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
    const endPoint = res.points.at(-1);
    if (!endPoint) continue;
    candidates.push({ coords: [endPoint[0], endPoint[1]], shortestDistance: res.distance });
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
      totalTime: p1.time + p2.time,
      totalAscend: (p1.ascend ?? 0) + (p2.ascend ?? 0),
    };
    circuits.push(circuit);
  }

  circuits.sort((a, b) => {
    const distDiff = Math.abs(a.totalDistance - targetDistanceMeters) - Math.abs(b.totalDistance - targetDistanceMeters);
    if (distDiff !== 0) return distDiff;
    return attractiveness(b) - attractiveness(a);
  });
  let best = circuits[0];

  if (!best) throw new Error('No circuit found');

  if (Math.abs(best.totalDistance - targetDistanceMeters) / targetDistanceMeters > 0.05) {
    best = await fineTune(best, start, targetDistanceMeters, profile);
  }

  if (Math.abs(best.totalDistance - targetDistanceMeters) / targetDistanceMeters > 0.05) {
    throw new Error('Unable to reach target distance within tolerance');
  }

  return best;
}

function attractiveness(c: Circuit): number {
  const coords = [...c.path1, ...c.path2];
  if (coords.length < 3) return 0;
  let totalAngle = 0;
  for (let i = 1; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    const [cx, cy] = coords[i + 1];
    const v1 = [ax - bx, ay - by];
    const v2 = [cx - bx, cy - by];
    const dot = v1[0] * v2[0] + v1[1] * v2[1];
    const det = v1[0] * v2[1] - v1[1] * v2[0];
    const angle = Math.abs(Math.atan2(det, dot));
    totalAngle += angle;
  }
  const ideal = Math.PI * 2;
  return Math.max(0, 1 - Math.abs(totalAngle - ideal) / ideal);
}

async function fineTune(
  circuit: Circuit,
  start: [number, number],
  target: number,
  profile: Profile
): Promise<Circuit> {
  const deficit = target - circuit.totalDistance;
  if (Math.abs(deficit) < target * 0.02) return circuit;
  const stubLength = Math.abs(deficit);
  const detour = await route([start, project(start, 45, stubLength / 2), start], profile);
  return {
    path1: circuit.path1,
    path2: [...circuit.path2, ...detour.points],
    totalDistance: circuit.totalDistance + detour.distance,
    totalTime: circuit.totalTime + detour.time,
    totalAscend: circuit.totalAscend + (detour.ascend ?? 0),
  };
}
