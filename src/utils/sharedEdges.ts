import { route, Profile } from '../clients/graphhopperClient';

export type EdgeSet = Set<string>;

export function edgeKeys(coords: [number, number, number?][]): EdgeSet {
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

export function sharedEdgeRatioSets(a: EdgeSet, b: EdgeSet): number {
  let shared = 0;
  b.forEach((e) => {
    if (a.has(e)) shared++;
  });
  return a.size ? shared / a.size : 0;
}

export async function penalizedRoute(
  points: [number, number][],
  profile: Profile,
  _avoidedEdges: EdgeSet
) {
  // Approximate link-penalty by leveraging alternative_route and re-checking overlap downstream.
  // GraphHopper custom area penalty would require geometry; here we rely on overlap check after the call.
  const res = await route(points, profile, {
    alternative: true,
  });
  return res;
}
