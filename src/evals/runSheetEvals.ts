import { execFileSync, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import axios from 'axios';
import { JWT } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const spreadsheetId = requireEnv('EVAL_SPREADSHEET_ID');
const authFile = process.env.EVAL_GOOGLE_AUTH_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || 'google-auth.json';
const sheetsAuth = (process.env.EVAL_SHEETS_AUTH || '').trim().toLowerCase();
const gogAccount = process.env.EVAL_GOG_ACCOUNT || process.env.GOG_ACCOUNT || '';
const routeApiBaseUrl = (process.env.EVAL_ROUTE_API_BASE_URL || 'https://route-runner-api.fly.dev').replace(/\/$/, '');
const routeArtifactDir = process.env.EVAL_ROUTE_ARTIFACT_DIR || 'eval-artifacts/routes';
const referenceGpxDir = process.env.EVAL_REFERENCE_GPX_DIR || 'eval-artifacts/reference-gpx';
const caseFilter = {
  ids: csvEnv('EVAL_CASE_IDS'),
  tag: process.env.EVAL_CASE_TAG?.trim() || '',
  scenario: process.env.EVAL_SCENARIO?.trim() || '',
  limit: Number(process.env.EVAL_CASE_LIMIT || 0),
  excludeInternational: isTruthyEnv('EVAL_EXCLUDE_INTERNATIONAL'),
};
const runnerVersion = 'sheet-evals-v1';

const tracesHeaders = [
  'trace_id',
  'timestamp',
  'trigger',
  'user_message',
  'tool_sequence',
  'tool_call_count',
  'notification_sent',
  'final_response',
  'total_tokens',
  'success',
  'error',
  'duration_ms',
];

const evalCasesHeaders = [
  'case_id',
  'enabled',
  'created_at',
  'updated_at',
  'tags',
  'scenario',
  'input_query',
  'input_location_json',
  'expected_params_json',
  'assertions_json',
  'notes',
  'reference_gpx_file',
  'reference_route_name',
  'reference_strava_url',
];

const evalRunsHeaders = [
  'eval_run_id',
  'started_at',
  'finished_at',
  'git_sha',
  'environment',
  'runner_version',
  'case_filter',
  'notes',
];

const evalResultsHeaders = [
  'eval_run_id',
  'case_id',
  'trace_id',
  'pass',
  'score',
  'failed_assertions_json',
  'duration_ms',
  'total_tokens',
  'error',
  'output_params_json',
  'output_summary_json',
];

type Row = Record<string, string>;

type SheetClient = {
  ensureSheetsStructure(): Promise<void>;
  getRows(sheet: string): Promise<Row[]>;
  appendRows(sheet: string, rows: unknown[][]): Promise<void>;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var is required`);
  return value;
}

function csvEnv(name: string): string[] {
  return (process.env[name] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isTruthyEnv(name: string): boolean {
  const value = (process.env[name] || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'y'].includes(value);
}

type Assertions = {
  required_paths?: string[];
  equals?: Record<string, unknown>;
  one_of?: Record<string, unknown[]>;
  includes?: Record<string, unknown[]>;
  number_between?: Record<string, { min?: number; max?: number }>;
};

type RouteApiResponse = {
  sessionId: string;
  routeId: string;
  name: string;
  geometry: {
    type: 'LineString';
    coordinates: [number, number, number?][];
  };
  stats: {
    distance_miles?: number;
    distance_meters?: number;
    elevation_gain_feet?: number;
    duration_minutes?: number;
  };
  parameters: unknown;
  metadata?: unknown;
  originalQuery?: string;
  gpxUrl?: string;
};

async function main() {
  const sheets = await createSheetClient(authFile);
  await sheets.ensureSheetsStructure();

  const now = new Date().toISOString();
  const evalRunId = uuidv4();
  const gitSha = getGitSha();
  const allRows = await sheets.getRows('eval_cases');
  const cases = applyCaseFilter(allRows.filter((row) => isEnabled(row.enabled)));

  const { extractRouteParameters } = await import('../services/nlp');
  const { buildRoute } = await import('../services/routeBuilder');

  const resultRows: unknown[][] = [];
  const traceRows: unknown[][] = [];
  let passCount = 0;
  let failCount = 0;

  for (const row of cases) {
    const caseId = row.case_id?.trim() || uuidv4();
    const scenario = (row.scenario || 'extract_route_parameters').trim();
    const query = row.input_query?.trim() || '';
    const traceId = `${evalRunId}:${caseId}`;
    const started = Date.now();

    let output: unknown = null;
    let pass = false;
    let score = 0;
    let error = '';
    let failedAssertions: string[] = [];

    try {
      if (!query) {
        throw new Error('input_query is required');
      }
      if (scenario === 'extract_route_parameters') {
        output = await extractRouteParameters(query);
      } else if (scenario === 'generate_route') {
        const params = await extractRouteParameters(query);
        const location = parseLocation(row.input_location_json);
        const start: [number, number] = [location.lng, location.lat];
        const targetMeters = evalTargetMeters(params);
        const profile = evalProfile(params);
        const result = await buildRoute({ params, start, targetMeters, profile });
        output = {
          ...params,
          route: {
            distance_meters: result.distance,
            distance_miles: result.distance / 1609.344,
            elevation_gain_feet: result.ascend * 3.28084,
            duration_minutes: result.time / 60000,
            coordinate_count: result.coordinates.length,
          },
          target_meters: targetMeters,
          distance_accuracy: Math.abs(result.distance - targetMeters) / targetMeters,
        };
      } else if (scenario === 'generate_route_api') {
        const location = parseLocation(row.input_location_json);
        output = await generateRouteViaApi({
          query,
          location,
          evalRunId,
          caseId,
          referenceGpxFile: row.reference_gpx_file,
          referenceRouteName: row.reference_route_name,
          referenceStravaUrl: row.reference_strava_url,
        });
      } else {
        throw new Error(`unsupported scenario: ${scenario}`);
      }
      const evaluated = evaluateCase(output, row.expected_params_json, row.assertions_json);
      pass = evaluated.pass;
      score = evaluated.score;
      failedAssertions = evaluated.failedAssertions;
    } catch (err) {
      error = formatError(err);
      pass = false;
      score = 0;
      failedAssertions = [`runtime_error:${error}`];
    }

    const durationMs = Date.now() - started;
    if (pass) passCount += 1;
    else failCount += 1;

    resultRows.push([
      evalRunId,
      caseId,
      traceId,
      pass,
      score,
      JSON.stringify(failedAssertions),
      durationMs,
      '',
      error,
      safeJson(output),
      safeJson(buildSummary(output)),
    ]);

    traceRows.push([
      traceId,
      new Date().toISOString(),
      'eval_case',
      query,
      scenario,
      1,
      false,
      truncate(safeJson(output), 1500),
      '',
      pass,
      error,
      durationMs,
    ]);
  }

  const finishedAt = new Date().toISOString();
  await sheets.appendRows('eval_runs', [
    [evalRunId, now, finishedAt, gitSha, process.env.NODE_ENV || '', runnerVersion, caseFilterSummary(), ''],
  ]);

  if (resultRows.length) {
    await sheets.appendRows('eval_results', resultRows);
    await sheets.appendRows('traces', traceRows);
  }

  console.log(
    JSON.stringify({
      evalRunId,
      totalCases: cases.length,
      passed: passCount,
      failed: failCount,
      spreadsheetId,
      caseFilter: caseFilterSummary(),
    })
  );
}

function applyCaseFilter(rows: Row[]): Row[] {
  let filtered = rows;
  if (caseFilter.ids.length) {
    const ids = new Set(caseFilter.ids);
    filtered = filtered.filter((row) => ids.has(row.case_id));
  }
  if (caseFilter.tag) {
    filtered = filtered.filter((row) =>
      (row.tags || '')
        .split(',')
        .map((tag) => tag.trim())
        .includes(caseFilter.tag)
    );
  }
  if (caseFilter.scenario) {
    filtered = filtered.filter((row) => (row.scenario || '').trim() === caseFilter.scenario);
  }
  if (caseFilter.excludeInternational) {
    filtered = filtered.filter((row) => !isInternationalCase(row));
  }
  if (Number.isFinite(caseFilter.limit) && caseFilter.limit > 0) {
    filtered = filtered.slice(0, caseFilter.limit);
  }
  return filtered;
}

function caseFilterSummary(): string {
  const parts = ['enabled=true'];
  if (caseFilter.ids.length) parts.push(`ids=${caseFilter.ids.join(',')}`);
  if (caseFilter.tag) parts.push(`tag=${caseFilter.tag}`);
  if (caseFilter.scenario) parts.push(`scenario=${caseFilter.scenario}`);
  if (caseFilter.excludeInternational) parts.push('exclude_international=true');
  if (Number.isFinite(caseFilter.limit) && caseFilter.limit > 0) parts.push(`limit=${caseFilter.limit}`);
  return parts.join(';');
}

function isInternationalCase(row: Row): boolean {
  const rawLocation = row.input_location_json;
  if (!rawLocation?.trim()) return false;
  const parsed = parseJson(rawLocation);
  const location = asRecord(parsed);
  if (
    typeof location?.lat !== 'number' ||
    !Number.isFinite(location.lat) ||
    typeof location.lng !== 'number' ||
    !Number.isFinite(location.lng)
  ) {
    return false;
  }

  return !isUsCoordinate(location.lat, location.lng);
}

function isUsCoordinate(lat: number, lng: number): boolean {
  const mainland = lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66;
  const alaska = lat >= 51 && lat <= 72 && lng >= -170 && lng <= -129;
  const hawaii = lat >= 18 && lat <= 23 && lng >= -161 && lng <= -154;
  return mainland || alaska || hawaii;
}

function evaluateCase(
  output: unknown,
  expectedParamsRaw: string | undefined,
  assertionsRaw: string | undefined
): { pass: boolean; score: number; failedAssertions: string[] } {
  const failedAssertions: string[] = [];
  let totalChecks = 0;

  const expectedParams = parseJsonObject(expectedParamsRaw);
  if (expectedParams) {
    totalChecks += countLeafChecks(expectedParams);
    collectSubsetMismatches(expectedParams, output, '', failedAssertions);
  }

  const assertions = parseAssertions(assertionsRaw);
  if (assertions.required_paths) {
    for (const path of assertions.required_paths) {
      totalChecks += 1;
      const value = getPath(output, path);
      if (value === undefined || value === null) failedAssertions.push(`required_paths:${path}`);
    }
  }

  if (assertions.equals) {
    for (const [path, expected] of Object.entries(assertions.equals)) {
      totalChecks += 1;
      const actual = getPath(output, path);
      if (!isDeepEqual(expected, actual)) {
        failedAssertions.push(`equals:${path}:expected=${safeJson(expected)}:actual=${safeJson(actual)}`);
      }
    }
  }

  if (assertions.one_of) {
    for (const [path, allowed] of Object.entries(assertions.one_of)) {
      totalChecks += 1;
      const actual = getPath(output, path);
      if (!allowed.some((item) => isDeepEqual(item, actual))) {
        failedAssertions.push(`one_of:${path}:actual=${safeJson(actual)}`);
      }
    }
  }

  if (assertions.includes) {
    for (const [path, mustInclude] of Object.entries(assertions.includes)) {
      totalChecks += 1;
      const actual = getPath(output, path);
      if (!Array.isArray(actual)) {
        failedAssertions.push(`includes:${path}:actual_not_array`);
        continue;
      }
      for (const item of mustInclude) {
        if (!actual.some((value) => isDeepEqual(value, item))) {
          failedAssertions.push(`includes:${path}:missing=${safeJson(item)}`);
        }
      }
    }
  }

  if (assertions.number_between) {
    for (const [path, range] of Object.entries(assertions.number_between)) {
      totalChecks += 1;
      const actual = getPath(output, path);
      if (typeof actual !== 'number') {
        failedAssertions.push(`number_between:${path}:actual_not_number`);
        continue;
      }
      if (typeof range.min === 'number' && actual < range.min) {
        failedAssertions.push(`number_between:${path}:actual=${actual}:min=${range.min}`);
      }
      if (typeof range.max === 'number' && actual > range.max) {
        failedAssertions.push(`number_between:${path}:actual=${actual}:max=${range.max}`);
      }
    }
  }

  const pass = failedAssertions.length === 0;
  const score = totalChecks === 0 ? (pass ? 1 : 0) : Math.max(0, (totalChecks - failedAssertions.length) / totalChecks);
  return { pass, score, failedAssertions };
}

function parseAssertions(raw: string | undefined): Assertions {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed as Assertions;
}

function parseJsonObject(raw: string | undefined): Record<string, unknown> | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function parseJson(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return null;
  return JSON.parse(raw);
}

function countLeafChecks(value: unknown): number {
  if (!value || typeof value !== 'object') return 1;
  if (Array.isArray(value)) {
    if (value.length === 0) return 1;
    return value.map((item) => countLeafChecks(item)).reduce((acc, next) => acc + next, 0);
  }
  return Object.values(value).map((item) => countLeafChecks(item)).reduce((acc, next) => acc + next, 0);
}

function collectSubsetMismatches(
  expected: unknown,
  actual: unknown,
  path: string,
  failedAssertions: string[]
) {
  const key = path || '$';
  if (
    expected === null ||
    actual === null ||
    typeof expected !== 'object' ||
    typeof actual !== 'object' ||
    Array.isArray(expected) !== Array.isArray(actual)
  ) {
    if (!isDeepEqual(expected, actual)) {
      failedAssertions.push(`expected_params:${key}:expected=${safeJson(expected)}:actual=${safeJson(actual)}`);
    }
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      failedAssertions.push(`expected_params:${key}:expected_length=${expected.length}:actual_length=${actual.length}`);
      return;
    }
    for (let i = 0; i < expected.length; i += 1) {
      collectSubsetMismatches(expected[i], actual[i], `${key}[${i}]`, failedAssertions);
    }
    return;
  }

  const expectedObject = expected as Record<string, unknown>;
  const actualObject = actual as Record<string, unknown>;
  for (const [childKey, expectedValue] of Object.entries(expectedObject)) {
    const childPath = key === '$' ? childKey : `${key}.${childKey}`;
    collectSubsetMismatches(expectedValue, actualObject[childKey], childPath, failedAssertions);
  }
}

function buildSummary(output: unknown): Record<string, unknown> {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return {};
  const obj = output as Record<string, unknown>;
  const location = asRecord(obj.location);
  const route = asRecord(obj.route);
  const summary: Record<string, unknown> = {
    distance: obj.distance,
    shape: obj.shape,
    landmarks: location?.landmarks || [],
  };
  if (route) {
    summary.route = route;
    summary.distance_accuracy = obj.distance_accuracy;
  }
  const referenceComparison = asRecord(obj.reference_comparison);
  if (referenceComparison) {
    summary.reference_comparison = referenceComparison;
  }
  return summary;
}

function parseLocation(raw: string | undefined): { lat: number; lng: number } {
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      const location = asRecord(parsed);
      if (
        typeof location?.lat === 'number' &&
        Number.isFinite(location.lat) &&
        typeof location.lng === 'number' &&
        Number.isFinite(location.lng)
      ) {
        return { lat: location.lat, lng: location.lng };
      }
    } catch {
      // Ignore invalid JSON.
    }
  }
  return { lat: 47.6062, lng: -122.3321 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function evalTargetMeters(params: { distance: { value: number; unit: string } }): number {
  if (params.distance.unit === 'miles') return params.distance.value * 1609.344;
  if (params.distance.unit === 'kilometers') return params.distance.value * 1000;
  return params.distance.value;
}

function evalProfile(params: { terrain: { surfaces: { type: string }[] } }): 'trail' | 'foot' {
  return params.terrain.surfaces.some((s) => s.type === 'trail') ? 'trail' : 'foot';
}

async function generateRouteViaApi(input: {
  query: string;
  location: { lat: number; lng: number };
  evalRunId: string;
  caseId: string;
  referenceGpxFile?: string;
  referenceRouteName?: string;
  referenceStravaUrl?: string;
}): Promise<Record<string, unknown>> {
  const response = await axios.post<RouteApiResponse>(
    `${routeApiBaseUrl}/api/route`,
    {
      query: input.query,
      location: input.location,
    },
    { timeout: Number(process.env.EVAL_ROUTE_API_TIMEOUT_MS || 120_000) }
  );
  const route = response.data;
  const artifactBase = persistRouteArtifacts(input.evalRunId, input.caseId, route);
  const targetMeters = targetMetersFromOutput(route.parameters);
  const distanceMeters = route.stats.distance_meters;
  const referenceComparison = compareToReferenceGpx({
    generated: route.geometry.coordinates,
    generatedDistanceMeters: distanceMeters,
    referenceGpxFile: input.referenceGpxFile,
  });

  return {
    api_base_url: routeApiBaseUrl,
    session_id: route.sessionId,
    route_id: route.routeId,
    name: route.name,
    location: input.location,
    parameters: route.parameters,
    metadata: route.metadata,
    original_query: route.originalQuery,
    reference: {
      gpx_file: input.referenceGpxFile || '',
      route_name: input.referenceRouteName || '',
      strava_url: input.referenceStravaUrl || '',
    },
    route: {
      distance_meters: distanceMeters,
      distance_miles: route.stats.distance_miles,
      elevation_gain_feet: route.stats.elevation_gain_feet,
      duration_minutes: route.stats.duration_minutes,
      coordinate_count: route.geometry.coordinates.length,
      bbox: bbox(route.geometry.coordinates),
    },
    target_meters: targetMeters,
    distance_accuracy:
      typeof distanceMeters === 'number' && typeof targetMeters === 'number'
        ? Math.abs(distanceMeters - targetMeters) / targetMeters
        : null,
    artifacts: {
      json: `${artifactBase}.json`,
      geojson: `${artifactBase}.geojson`,
      gpx: `${artifactBase}.gpx`,
    },
    reference_comparison: referenceComparison,
  };
}

function compareToReferenceGpx(input: {
  generated: [number, number, number?][];
  generatedDistanceMeters?: number;
  referenceGpxFile?: string;
}): Record<string, unknown> {
  const referenceFile = input.referenceGpxFile?.trim();
  if (!referenceFile) {
    return { status: 'not_configured' };
  }

  const referencePath = safeResolve(referenceGpxDir, referenceFile);
  if (!existsSync(referencePath)) {
    return {
      status: 'missing_reference_gpx',
      reference_gpx: referencePath,
    };
  }

  const reference = parseGpxCoordinates(readFileSync(referencePath, 'utf8'));
  const generated = input.generated.map(([lng, lat]) => [lng, lat] as [number, number]);
  if (reference.length < 2 || generated.length < 2) {
    return {
      status: 'insufficient_geometry',
      reference_gpx: referencePath,
      reference_point_count: reference.length,
      generated_point_count: generated.length,
    };
  }

  const referenceDistance = lineDistanceMeters(reference);
  const generatedDistance = input.generatedDistanceMeters || lineDistanceMeters(generated);
  const generatedSample = resampleLine(generated, 200);
  const referenceSample = resampleLine(reference, 200);
  const generatedNearest = nearestDistances(generatedSample, referenceSample);
  const referenceNearest = nearestDistances(referenceSample, generatedSample);
  const startDelta = haversineMeters(generated[0], reference[0]);
  const endDelta = haversineMeters(generated[generated.length - 1], reference[reference.length - 1]);
  const frechet = discreteFrechetMeters(generatedSample, referenceSample);

  return {
    status: 'compared',
    reference_gpx: referencePath,
    reference_point_count: reference.length,
    generated_point_count: generated.length,
    reference_distance_meters: Math.round(referenceDistance),
    generated_distance_meters: Math.round(generatedDistance),
    distance_delta_meters: Math.round(generatedDistance - referenceDistance),
    distance_delta_pct: roundMetric((generatedDistance - referenceDistance) / referenceDistance),
    start_delta_meters: Math.round(startDelta),
    end_delta_meters: Math.round(endDelta),
    mean_generated_to_reference_meters: Math.round(mean(generatedNearest)),
    p95_generated_to_reference_meters: Math.round(percentile(generatedNearest, 0.95)),
    max_generated_to_reference_meters: Math.round(Math.max(...generatedNearest)),
    reference_coverage_within_50m: roundMetric(
      referenceNearest.filter((distance) => distance <= 50).length / referenceNearest.length
    ),
    reference_coverage_within_100m: roundMetric(
      referenceNearest.filter((distance) => distance <= 100).length / referenceNearest.length
    ),
    discrete_frechet_meters: Math.round(frechet),
  };
}

function parseGpxCoordinates(xml: string): [number, number][] {
  const coordinates: [number, number][] = [];
  const trkptPattern = /<trkpt\b[^>]*\blat=["']([^"']+)["'][^>]*\blon=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = trkptPattern.exec(xml))) {
    const lat = Number(match[1]);
    const lng = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      coordinates.push([lng, lat]);
    }
  }
  return coordinates;
}

function nearestDistances(from: [number, number][], to: [number, number][]): number[] {
  return from.map((point) => {
    let best = Infinity;
    for (const candidate of to) {
      best = Math.min(best, haversineMeters(point, candidate));
    }
    return best;
  });
}

function discreteFrechetMeters(a: [number, number][], b: [number, number][]): number {
  const previous = new Array<number>(b.length).fill(Infinity);
  const current = new Array<number>(b.length).fill(Infinity);

  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      const distance = haversineMeters(a[i], b[j]);
      if (i === 0 && j === 0) {
        current[j] = distance;
      } else if (i === 0) {
        current[j] = Math.max(current[j - 1], distance);
      } else if (j === 0) {
        current[j] = Math.max(previous[j], distance);
      } else {
        current[j] = Math.max(Math.min(previous[j], previous[j - 1], current[j - 1]), distance);
      }
    }
    for (let j = 0; j < b.length; j += 1) {
      previous[j] = current[j];
      current[j] = Infinity;
    }
  }

  return previous[b.length - 1];
}

function resampleLine(points: [number, number][], count: number): [number, number][] {
  if (points.length <= count) return points;
  const distances = [0];
  for (let i = 1; i < points.length; i += 1) {
    distances.push(distances[i - 1] + haversineMeters(points[i - 1], points[i]));
  }
  const total = distances[distances.length - 1];
  if (total === 0) return points.slice(0, 1);

  const sampled: [number, number][] = [];
  let segmentIndex = 1;
  for (let i = 0; i < count; i += 1) {
    const target = (total * i) / (count - 1);
    while (segmentIndex < distances.length - 1 && distances[segmentIndex] < target) {
      segmentIndex += 1;
    }
    const beforeDistance = distances[segmentIndex - 1];
    const afterDistance = distances[segmentIndex];
    const ratio = afterDistance === beforeDistance ? 0 : (target - beforeDistance) / (afterDistance - beforeDistance);
    const before = points[segmentIndex - 1];
    const after = points[segmentIndex];
    sampled.push([before[0] + (after[0] - before[0]) * ratio, before[1] + (after[1] - before[1]) * ratio]);
  }
  return sampled;
}

function lineDistanceMeters(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1], points[i]);
  }
  return total;
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const radius = 6_371_000;
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = toRadians(b[1] - a[1]);
  const dLng = toRadians(b[0] - a[0]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * radius * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function roundMetric(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function formatError(err: unknown): string {
  const response = asRecord(asRecord(err)?.response);
  const status = response?.status;
  const data = response?.data;
  if (typeof status === 'number') {
    return `HTTP ${status}: ${truncate(safeJson(data), 1000)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function persistRouteArtifacts(evalRunId: string, caseId: string, route: RouteApiResponse): string {
  const dir = path.resolve(routeArtifactDir, evalRunId);
  mkdirSync(dir, { recursive: true });
  const base = path.join(dir, safeFilePart(caseId));
  writeFileSync(`${base}.json`, `${JSON.stringify(route, null, 2)}\n`);
  writeFileSync(
    `${base}.geojson`,
    `${JSON.stringify(
      {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {
              sessionId: route.sessionId,
              routeId: route.routeId,
              name: route.name,
              stats: route.stats,
              parameters: route.parameters,
            },
            geometry: route.geometry,
          },
        ],
      },
      null,
      2
    )}\n`
  );
  writeFileSync(`${base}.gpx`, routeToGpx(route));
  return base;
}

function routeToGpx(route: RouteApiResponse): string {
  const lines = route.geometry.coordinates
    .map(([lng, lat, ele]) => {
      const eleTag = ele !== undefined ? `<ele>${escapeXml(String(ele))}</ele>` : '';
      return `<trkpt lon="${escapeXml(String(lng))}" lat="${escapeXml(String(lat))}">${eleTag}</trkpt>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Route Runner Evals" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escapeXml(route.name)}</name><desc>${escapeXml(route.originalQuery || '')}</desc></metadata>
  <trk>
    <name>${escapeXml(route.name)}</name>
    <trkseg>
      ${lines}
    </trkseg>
  </trk>
</gpx>`;
}

function targetMetersFromOutput(params: unknown): number | null {
  const obj = asRecord(params);
  const distance = asRecord(obj?.distance);
  const value = distance?.value;
  const unit = distance?.unit;
  if (typeof value !== 'number' || typeof unit !== 'string') return null;
  if (unit === 'miles') return value * 1609.344;
  if (unit === 'kilometers') return value * 1000;
  return value;
}

function bbox(coordinates: [number, number, number?][]): number[] | null {
  if (!coordinates.length) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coordinates) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  return [minLng, minLat, maxLng, maxLat];
}

function safeFilePart(value: string): string {
  return value.trim().replace(/[^a-z0-9._-]+/gi, '_').replace(/^_+|_+$/g, '') || 'case';
}

function safeResolve(baseDir: string, value: string): string {
  const base = path.resolve(baseDir);
  const resolved = path.resolve(base, path.normalize(value));
  const relative = path.relative(base, resolved);
  if (path.isAbsolute(value) || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`unsafe reference_gpx_file: ${value}`);
  }
  return resolved;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getPath(value: unknown, path: string): unknown {
  if (!path.trim()) return value;
  const parts = path.split('.');
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(part)) {
      current = current[Number(part)];
      continue;
    }
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isEnabled(raw: string | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function getGitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

async function getAccessToken(keyFile: string): Promise<string> {
  const client = new JWT({
    keyFile,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const token = await client.authorize();
  if (!token.access_token) throw new Error('Failed to fetch Google access token');
  return token.access_token;
}

async function createSheetClient(keyFile: string): Promise<SheetClient> {
  if (sheetsAuth === 'gog' || (!sheetsAuth && !existsSync(keyFile))) {
    return new GogSheetClient();
  }

  const accessToken = await getAccessToken(keyFile);
  return new GoogleApiSheetClient(accessToken);
}

class GoogleApiSheetClient implements SheetClient {
  constructor(private readonly accessToken: string) {}

  async ensureSheetsStructure() {
    await ensureSheetsStructure(this.accessToken);
  }

  async getRows(sheet: string): Promise<Row[]> {
    return getRows(this.accessToken, sheet);
  }

  async appendRows(sheet: string, rows: unknown[][]) {
    await appendRows(this.accessToken, sheet, rows);
  }
}

class GogSheetClient implements SheetClient {
  async ensureSheetsStructure() {
    const existingSheets = await this.getSheetNames();
    const desired = ['eval_cases', 'eval_runs', 'eval_results', 'traces'];
    for (const sheet of desired) {
      if (!existingSheets.includes(sheet)) {
        runGog(['sheets', 'add-tab', spreadsheetId, sheet]);
      }
    }

    await this.setHeaderRow('eval_cases', evalCasesHeaders);
    await this.setHeaderRow('eval_runs', evalRunsHeaders);
    await this.setHeaderRow('eval_results', evalResultsHeaders);
    await this.setHeaderRow('traces', tracesHeaders);
  }

  async getRows(sheet: string): Promise<Row[]> {
    const response = runGogJson<{ values?: string[][] }>(['sheets', 'get', spreadsheetId, `${sheet}!A:Z`]);
    return rowsFromValues(response.values || []);
  }

  async appendRows(sheet: string, rows: unknown[][]) {
    if (!rows.length) return;
    runGog([
      'sheets',
      'append',
      spreadsheetId,
      `${sheet}!A:Z`,
      '--input',
      'RAW',
      '--insert',
      'INSERT_ROWS',
      '--values-json',
      JSON.stringify(rows),
    ]);
  }

  private async getSheetNames(): Promise<string[]> {
    const response = runGogJson<{ sheets?: Array<{ properties?: { title?: string } }> }>([
      'sheets',
      'metadata',
      spreadsheetId,
    ]);
    return (response.sheets || [])
      .map((sheet) => sheet.properties?.title || '')
      .filter((title): title is string => Boolean(title));
  }

  private async setHeaderRow(sheet: string, headers: string[]) {
    runGog([
      'sheets',
      'update',
      spreadsheetId,
      `${sheet}!A1`,
      '--input',
      'RAW',
      '--values-json',
      JSON.stringify([headers]),
    ]);
  }
}

async function ensureSheetsStructure(accessToken: string) {
  const existingSheets = await getSheetNames(accessToken);
  const desired = ['eval_cases', 'eval_runs', 'eval_results', 'traces'];
  const requests = desired
    .filter((name) => !existingSheets.includes(name))
    .map((title) => ({ addSheet: { properties: { title } } }));

  if (requests.length) {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests },
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
  }

  await setHeaderRow(accessToken, 'eval_cases', evalCasesHeaders);
  await setHeaderRow(accessToken, 'eval_runs', evalRunsHeaders);
  await setHeaderRow(accessToken, 'eval_results', evalResultsHeaders);
  await setHeaderRow(accessToken, 'traces', tracesHeaders);
}

async function getSheetNames(accessToken: string): Promise<string[]> {
  const response = await axios.get(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sheets = response.data.sheets as Array<{ properties?: { title?: string } }>;
  return sheets.map((sheet) => sheet.properties?.title || '').filter(Boolean);
}

async function setHeaderRow(accessToken: string, sheet: string, headers: string[]) {
  const range = encodeURIComponent(`${sheet}!A1`);
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    { values: [headers] },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
}

async function getRows(accessToken: string, sheet: string): Promise<Row[]> {
  const range = encodeURIComponent(`${sheet}!A:Z`);
  const response = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  const values = (response.data.values as string[][] | undefined) || [];
  return rowsFromValues(values);
}

async function appendRows(accessToken: string, sheet: string, rows: unknown[][]) {
  if (!rows.length) return;
  const range = encodeURIComponent(`${sheet}!A:Z`);
  await axios.post(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { values: rows },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
}

function rowsFromValues(values: string[][]): Row[] {
  if (values.length <= 1) return [];
  const headers = values[0];
  return values.slice(1).map((cells) => {
    const row: Row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || '';
    });
    return row;
  });
}

function runGog(args: string[]): string {
  const accountArgs = gogAccount ? ['--account', gogAccount] : [];
  try {
    return execFileSync('gog', [...accountArgs, ...args, '--json', '--no-input'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'stderr' in err) {
      const stderr = String((err as { stderr?: unknown }).stderr || '').trim();
      if (stderr) throw new Error(stderr);
    }
    throw err;
  }
}

function runGogJson<T>(args: string[]): T {
  const output = runGog(args);
  return JSON.parse(output) as T;
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
});
