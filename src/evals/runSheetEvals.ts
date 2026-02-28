import axios from 'axios';
import { JWT } from 'google-auth-library';
import { execSync } from 'node:child_process';
import { v4 as uuidv4 } from 'uuid';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const spreadsheetId = process.env.EVAL_SPREADSHEET_ID;
if (!spreadsheetId) throw new Error('EVAL_SPREADSHEET_ID env var is required');
const authFile = process.env.EVAL_GOOGLE_AUTH_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || 'google-auth.json';
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

type Assertions = {
  required_paths?: string[];
  equals?: Record<string, unknown>;
  one_of?: Record<string, unknown[]>;
  includes?: Record<string, unknown[]>;
  number_between?: Record<string, { min?: number; max?: number }>;
};

async function main() {
  const accessToken = await getAccessToken(authFile);
  await ensureSheetsStructure(accessToken);

  const now = new Date().toISOString();
  const evalRunId = uuidv4();
  const gitSha = getGitSha();
  const allRows = await getRows(accessToken, 'eval_cases');
  const cases = allRows.filter((row) => isEnabled(row.enabled));

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
      } else {
        throw new Error(`unsupported scenario: ${scenario}`);
      }
      const evaluated = evaluateCase(output, row.expected_params_json, row.assertions_json);
      pass = evaluated.pass;
      score = evaluated.score;
      failedAssertions = evaluated.failedAssertions;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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
  await appendRows(accessToken, 'eval_runs', [
    [evalRunId, now, finishedAt, gitSha, process.env.NODE_ENV || '', runnerVersion, 'enabled=true', ''],
  ]);

  if (resultRows.length) {
    await appendRows(accessToken, 'eval_results', resultRows);
    await appendRows(accessToken, 'traces', traceRows);
  }

  console.log(
    JSON.stringify({
      evalRunId,
      totalCases: cases.length,
      passed: passCount,
      failed: failCount,
      spreadsheetId,
    })
  );
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
  const obj = output as Record<string, any>;
  const summary: Record<string, unknown> = {
    distance: obj.distance,
    shape: obj.shape,
    landmarks: obj.location?.landmarks || [],
  };
  if (obj.route) {
    summary.route = obj.route;
    summary.distance_accuracy = obj.distance_accuracy;
  }
  return summary;
}

function parseLocation(raw: string | undefined): { lat: number; lng: number } {
  if (raw?.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'lat' in parsed &&
        typeof (parsed as any).lat === 'number' &&
        Number.isFinite((parsed as any).lat) &&
        'lng' in parsed &&
        typeof (parsed as any).lng === 'number' &&
        Number.isFinite((parsed as any).lng)
      ) {
        return { lat: (parsed as any).lat, lng: (parsed as any).lng };
      }
    } catch {
      // Ignore invalid JSON.
    }
  }
  return { lat: 47.6062, lng: -122.3321 };
}

function evalTargetMeters(params: { distance: { value: number; unit: string } }): number {
  if (params.distance.unit === 'miles') return params.distance.value * 1609.344;
  if (params.distance.unit === 'kilometers') return params.distance.value * 1000;
  return params.distance.value;
}

function evalProfile(params: { terrain: { surfaces: { type: string }[] } }): 'trail' | 'foot' {
  return params.terrain.surfaces.some((s) => s.type === 'trail') ? 'trail' : 'foot';
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

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
});
