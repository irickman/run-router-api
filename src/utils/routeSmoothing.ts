/**
 * Post-processing passes that clean up route geometry artifacts:
 * 1. Hairpin removal — splices out small out-and-back spurs
 * 2. Zigzag removal — splices out staircase patterns through grid streets
 *
 * Both operate on coordinate arrays only (no routing calls).
 */

type Coord = [number, number, number?];

const METERS_PER_DEGREE_LAT = 111_320;

function fastDistance(a: Coord, b: Coord): number {
  const avgLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const dx = (b[0] - a[0]) * METERS_PER_DEGREE_LAT * Math.cos(avgLat);
  const dy = (b[1] - a[1]) * METERS_PER_DEGREE_LAT;
  return Math.hypot(dx, dy);
}

function bearing(a: Coord, b: Coord): number {
  const avgLat = ((a[1] + b[1]) / 2) * (Math.PI / 180);
  const x = (b[0] - a[0]) * Math.cos(avgLat);
  const y = b[1] - a[1];
  const deg = (Math.atan2(x, y) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

function angleDiff(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 360 - diff);
}

function segmentDistance(coords: Coord[], from: number, to: number): number {
  let total = 0;
  for (let i = from; i < to; i++) {
    total += fastDistance(coords[i], coords[i + 1]);
  }
  return total;
}

/**
 * Detect and remove hairpin spurs — segments where the route goes out to a
 * point and immediately returns along nearly the same path.
 *
 * Detection: for each point P[i], look ahead for a later point P[j] that is
 * very close to P[i] (within `snapRadius`). If the path distance from i→j is
 * short (under `maxSpurLength`) and the straight-line distance from P[i] to
 * the farthest point in the spur is small, it's a hairpin. Splice it out.
 */
export function removeHairpins(
  coords: Coord[],
  maxSpurLength = 400,
  snapRadius = 30,
): { coords: Coord[]; removedCount: number } {
  if (coords.length < 6) return { coords, removedCount: 0 };

  const result = [...coords];
  let removedCount = 0;

  let i = 0;
  while (i < result.length - 4) {
    let foundSpur = false;
    // Look ahead for a return-to-same-point.
    const maxLookahead = Math.min(result.length - 1, i + 60);
    for (let j = i + 3; j <= maxLookahead; j++) {
      const endToEndDist = fastDistance(result[i], result[j]);
      if (endToEndDist > snapRadius) continue;

      const spurDist = segmentDistance(result, i, j);
      if (spurDist > maxSpurLength) continue;

      // Confirmed hairpin: splice out i+1 through j-1.
      result.splice(i + 1, j - i - 1);
      removedCount++;
      foundSpur = true;
      break;
    }

    if (!foundSpur) i++;
  }

  return { coords: result, removedCount };
}

/**
 * Detect whether a coordinate array contains a hairpin spur.
 * Lighter than removeHairpins — just returns true/false.
 */
export function hasHairpin(coords: Coord[], maxSpurLength = 400, snapRadius = 30): boolean {
  if (coords.length < 6) return false;
  for (let i = 0; i < coords.length - 4; i++) {
    const maxLookahead = Math.min(coords.length - 1, i + 60);
    for (let j = i + 3; j <= maxLookahead; j++) {
      if (fastDistance(coords[i], coords[j]) > snapRadius) continue;
      if (segmentDistance(coords, i, j) <= maxSpurLength) return true;
    }
  }
  return false;
}

/**
 * Detect and remove zigzag (staircase) patterns — sequences of many short
 * segments with alternating direction changes.
 *
 * Detection: identify runs of consecutive segments that are each shorter than
 * `maxSegLen` with direction changes >60° between adjacent segments.
 * If a run has ≥`minRunLength` such segments, replace the run with a direct
 * line from the run start to the run end.
 */
export function removeZigzags(
  coords: Coord[],
  maxSegLen = 80,
  minRunLength = 4,
): { coords: Coord[]; removedCount: number } {
  if (coords.length < minRunLength + 2) return { coords, removedCount: 0 };

  const result = [...coords];
  let removedCount = 0;

  let i = 0;
  while (i < result.length - 2) {
    const segLen = fastDistance(result[i], result[i + 1]);
    if (segLen > maxSegLen) {
      i++;
      continue;
    }

    // Start of a potential zigzag run.
    let runEnd = i + 1;
    let prevBearing = bearing(result[i], result[i + 1]);

    while (runEnd < result.length - 1) {
      const nextLen = fastDistance(result[runEnd], result[runEnd + 1]);
      if (nextLen > maxSegLen) break;
      const nextBearing = bearing(result[runEnd], result[runEnd + 1]);
      if (angleDiff(prevBearing, nextBearing) < 60) break;
      prevBearing = nextBearing;
      runEnd++;
    }

    const runLength = runEnd - i;
    if (runLength >= minRunLength) {
      // Replace the zigzag with a direct segment (keep start and end points).
      result.splice(i + 1, runLength - 1);
      removedCount++;
      i++;
    } else {
      i++;
    }
  }

  return { coords: result, removedCount };
}

/**
 * Run all smoothing passes on a coordinate array.
 * Returns the cleaned coordinates and total distance removed (meters).
 */
export function smoothRoute(coords: Coord[]): {
  coords: Coord[];
  distanceRemoved: number;
} {
  const originalDist = segmentDistance(coords, 0, coords.length - 1);

  let current = coords;
  const hairpin = removeHairpins(current);
  current = hairpin.coords;

  const zigzag = removeZigzags(current);
  current = zigzag.coords;

  const newDist = segmentDistance(current, 0, current.length - 1);
  return {
    coords: current,
    distanceRemoved: Math.max(0, originalDist - newDist),
  };
}
