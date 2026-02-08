import { route, Profile } from '../clients/graphhopperClient';

export async function penalizedRoute(points: [number, number][], profile: Profile) {
  // For now, use alternative_route and rely on overlap check after
  return route(points, profile, { alternative: true });
}

export function edgeKeys(coords: [number, number, number?][]): Set<string> {
  const toKey = (p: [number, number, number?]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const set = new Set<string>();
  for (let i = 0; i < coords.length - 1; i++) {
    const k1 = `${toKey(coords[i])}-${toKey(coords[i + 1])}`;
    const k2 = `${toKey(coords[i + 1])}-${toKey(coords[i])}`;
    set.add(k1);
    set.add(k2);
  }
  return set;
}

export function sharedEdgeRatioSets(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  b.forEach((e) => {
    if (a.has(e)) shared++;
  });
  return a.size ? shared / a.size : 0;
}
