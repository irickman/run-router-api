import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import axios from 'axios';

const spreadsheetId = requireEnv('EVAL_SPREADSHEET_ID');
const gogAccount = process.env.EVAL_GOG_ACCOUNT || process.env.GOG_ACCOUNT || '';
const referenceGpxDir = process.env.EVAL_REFERENCE_GPX_DIR || 'eval-artifacts/reference-gpx';
const caseIds = csvEnv('EVAL_CASE_IDS');
const caseLimit = Number(process.env.EVAL_CASE_LIMIT || 0);
const overwrite = truthy(process.env.EVAL_OVERWRITE_REFERENCE_GPX);
const cookieHeader = process.env.STRAVA_COOKIE_HEADER || '';

type Row = Record<string, string>;

type FetchResult = {
  case_id: string;
  reference_gpx_file: string;
  strava_url: string;
  status: 'downloaded' | 'skipped_existing' | 'auth_required' | 'invalid_response' | 'error';
  bytes?: number;
  error?: string;
};

async function main() {
  mkdirSync(path.resolve(referenceGpxDir), { recursive: true });
  const rows = readEvalCases()
    .filter((row) => row.scenario === 'generate_route_api')
    .filter((row) => isEnabled(row.enabled))
    .filter((row) => row.reference_strava_url?.trim() && row.reference_gpx_file?.trim());

  const filtered = filterCases(rows);
  const results: FetchResult[] = [];

  for (const row of filtered) {
    results.push(await fetchReferenceGpx(row));
  }

  console.log(
    JSON.stringify(
      {
        total: results.length,
        downloaded: results.filter((result) => result.status === 'downloaded').length,
        skippedExisting: results.filter((result) => result.status === 'skipped_existing').length,
        authRequired: results.filter((result) => result.status === 'auth_required').length,
        invalidResponse: results.filter((result) => result.status === 'invalid_response').length,
        errors: results.filter((result) => result.status === 'error').length,
        referenceGpxDir: path.resolve(referenceGpxDir),
        results,
      },
      null,
      2
    )
  );
}

function filterCases(rows: Row[]): Row[] {
  let filtered = rows;
  if (caseIds.length) {
    const allowed = new Set(caseIds);
    filtered = filtered.filter((row) => allowed.has(row.case_id));
  }
  if (caseLimit > 0) {
    filtered = filtered.slice(0, caseLimit);
  }
  return filtered;
}

async function fetchReferenceGpx(row: Row): Promise<FetchResult> {
  const caseId = row.case_id;
  const stravaUrl = row.reference_strava_url.trim();
  const referenceFile = row.reference_gpx_file.trim();
  const destination = safeResolve(referenceGpxDir, referenceFile);
  const baseResult = {
    case_id: caseId,
    reference_gpx_file: referenceFile,
    strava_url: stravaUrl,
  };

  if (!overwrite && existsSync(destination)) {
    return { ...baseResult, status: 'skipped_existing' };
  }

  const routeId = stravaRouteId(stravaUrl);
  if (!routeId) {
    return { ...baseResult, status: 'error', error: 'could_not_parse_strava_route_id' };
  }

  try {
    const response = await axios.get<string>(`https://www.strava.com/routes/${routeId}/export_gpx`, {
      headers: {
        Accept: 'application/gpx+xml, application/xml, text/xml, */*',
        ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      },
      maxRedirects: 0,
      responseType: 'text',
      timeout: Number(process.env.STRAVA_EXPORT_TIMEOUT_MS || 30_000),
      validateStatus: (status) => status >= 200 && status < 400,
    });

    if (response.status >= 300) {
      const location = String(response.headers.location || '');
      if (/\/login\b/.test(location)) {
        return { ...baseResult, status: 'auth_required' };
      }
      return { ...baseResult, status: 'invalid_response', error: `redirect:${location || response.status}` };
    }

    if (!looksLikeGpx(response.data)) {
      return { ...baseResult, status: 'invalid_response', error: responseSummary(response.data) };
    }

    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, response.data);
    return { ...baseResult, status: 'downloaded', bytes: Buffer.byteLength(response.data) };
  } catch (err) {
    return { ...baseResult, status: 'error', error: formatError(err) };
  }
}

function readEvalCases(): Row[] {
  const response = runGogJson<{ values?: string[][] }>(['sheets', 'get', spreadsheetId, 'eval_cases!A:Z']);
  return rowsFromValues(response.values || []);
}

function stravaRouteId(url: string): string | null {
  const match = url.match(/strava\.com\/routes\/(\d+)/i);
  return match?.[1] || null;
}

function looksLikeGpx(value: string): boolean {
  return /<gpx\b/i.test(value) && /<(trkpt|rtept)\b/i.test(value);
}

function responseSummary(value: string): string {
  return value.replace(/\s+/g, ' ').slice(0, 160);
}

function formatError(err: unknown): string {
  const response = err && typeof err === 'object' && 'response' in err ? (err as { response?: unknown }).response : null;
  if (response && typeof response === 'object' && 'status' in response) {
    const status = (response as { status?: unknown }).status;
    const headers = (response as { headers?: Record<string, unknown> }).headers || {};
    const location = String(headers.location || '');
    if (status === 301 || status === 302 || /\/login\b/.test(location)) return 'auth_required';
    return `HTTP ${String(status)}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function safeResolve(baseDir: string, value: string): string {
  const base = path.resolve(baseDir);
  const normalized = path.normalize(value);
  const resolved = path.resolve(base, normalized);
  const relative = path.relative(base, resolved);
  if (path.isAbsolute(value) || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`unsafe reference_gpx_file: ${value}`);
  }
  return resolved;
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
  return JSON.parse(runGog(args)) as T;
}

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

function isEnabled(raw: string | undefined): boolean {
  if (!raw || !raw.trim()) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'y';
}

function truthy(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'y';
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
});
