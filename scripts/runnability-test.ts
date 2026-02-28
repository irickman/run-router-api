/**
 * Runnability A/B test: queries GraphHopper directly for 5 Seattle routes,
 * reports road_class breakdown (% good vs bad road types).
 *
 * Usage: npx tsx scripts/runnability-test.ts "BEFORE (no runnability scoring)"
 */

const GH_URL = process.env.GRAPHHOPPER_URL || "https://route-runner-graphhopper-v2.fly.dev";
const label = process.argv[2] || "unlabeled";

interface TestRoute {
  name: string;
  points: [number, number][];
}

const GOOD_CLASSES = new Set([
  "footway", "path", "pedestrian", "cycleway", "living_street", "track", "steps",
]);
const BAD_CLASSES = new Set(["primary", "trunk", "primary_link", "trunk_link"]);

const TEST_ROUTES: TestRoute[] = [
  {
    name: "Downtown → Waterfront",
    points: [[47.6062, -122.3321], [47.6068, -122.3405]],
  },
  {
    name: "Ballard → Canal Trail",
    points: [[47.6688, -122.3844], [47.6553, -122.3490]],
  },
  {
    name: "Green Lake loop segment",
    points: [[47.6812, -122.3400], [47.6780, -122.3290]],
  },
  {
    name: "Capitol Hill → Vol. Park",
    points: [[47.6250, -122.3210], [47.6175, -122.3140]],
  },
  {
    name: "Discovery Park",
    points: [[47.6616, -122.4050], [47.6570, -122.4190]],
  },
];

interface RoadDetail {
  value: string;
  distance: number;
}

async function queryRoute(route: TestRoute): Promise<{ good: number; bad: number; total: number } | null> {
  const pointParams = route.points.map((p) => `point=${p[0]},${p[1]}`).join("&");
  const url = `${GH_URL}/route?${pointParams}&profile=foot&details=road_class&type=json`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  ${route.name}: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const path = data.paths?.[0];
    if (!path) {
      console.error(`  ${route.name}: no path returned`);
      return null;
    }

    const details: [number, number, string][] = path.details?.road_class ?? [];
    let goodDist = 0;
    let badDist = 0;
    let totalDist = 0;

    for (const [_from, _to, roadClass] of details) {
      // Details give index ranges; approximate distance from total
      const segFrac = (_to - _from) / (path.points?.coordinates?.length || 1);
      const segDist = segFrac * path.distance;
      totalDist += segDist;
      if (GOOD_CLASSES.has(roadClass)) goodDist += segDist;
      if (BAD_CLASSES.has(roadClass)) badDist += segDist;
    }

    return { good: goodDist, bad: badDist, total: totalDist || path.distance };
  } catch (err) {
    console.error(`  ${route.name}: ${err}`);
    return null;
  }
}

async function main() {
  console.log(`\n=== Runnability Test: ${label} ===\n`);

  let totalGood = 0;
  let totalBad = 0;
  let totalDist = 0;
  let count = 0;

  for (const route of TEST_ROUTES) {
    const result = await queryRoute(route);
    if (!result) continue;

    const goodPct = ((result.good / result.total) * 100).toFixed(1);
    const badPct = ((result.bad / result.total) * 100).toFixed(1);
    const pad = route.name.padEnd(26);
    console.log(`${pad} ${goodPct}% good, ${badPct}% bad`);

    totalGood += result.good;
    totalBad += result.bad;
    totalDist += result.total;
    count++;
  }

  if (count > 0) {
    const avgGood = ((totalGood / totalDist) * 100).toFixed(1);
    const avgBad = ((totalBad / totalDist) * 100).toFixed(1);
    console.log(
      `\nSUMMARY: Avg good ${avgGood}%, Avg bad ${avgBad}%, Total distance ${Math.round(totalDist)}m`
    );
  }
}

main().catch(console.error);
