import axios from 'axios';
import { JWT } from 'google-auth-library';

import { env } from '../config/env';
import { logError, logInfo } from '../utils/logger';

const REQUEST_HEADERS = [
  'timestamp',
  'route_id',
  'query',
  'shape',
  'distance_requested',
  'distance_actual_miles',
  'elevation_gain_ft',
  'landmarks',
  'duration_ms',
  'error',
];

export interface RequestLogEntry {
  timestamp: string;
  routeId: string;
  query: string;
  shape: string;
  distanceRequested: string;
  distanceMilesActual: number | null;
  elevationGainFt: number | null;
  landmarks: string[];
  durationMs: number;
  error: string;
}

const FLUSH_INTERVAL_MS = 10_000;
const MAX_BUFFER_SIZE = 20;

let buffer: unknown[][] = [];
let flushTimer: NodeJS.Timeout | null = null;
let jwtClient: JWT | null = null;

function getJwtClient(): JWT | null {
  if (!env.requestLogSpreadsheetId) return null;
  if (jwtClient) return jwtClient;
  try {
    if (env.googleServiceAccountJson) {
      const creds = JSON.parse(env.googleServiceAccountJson);
      jwtClient = new JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    } else {
      jwtClient = new JWT({
        keyFile: env.googleAuthFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    }
    return jwtClient;
  } catch {
    return null;
  }
}

function entryToRow(entry: RequestLogEntry): unknown[] {
  return [
    entry.timestamp,
    entry.routeId,
    entry.query,
    entry.shape,
    entry.distanceRequested,
    entry.distanceMilesActual != null ? Math.round(entry.distanceMilesActual * 100) / 100 : '',
    entry.elevationGainFt != null ? Math.round(entry.elevationGainFt) : '',
    entry.landmarks.join(', '),
    entry.durationMs,
    entry.error,
  ];
}

async function flush() {
  if (!buffer.length) return;
  const rows = buffer.splice(0);
  const client = getJwtClient();
  if (!client) return;

  try {
    const token = await client.authorize();
    if (!token.access_token) return;

    const spreadsheetId = env.requestLogSpreadsheetId!;
    const range = encodeURIComponent(`${env.requestLogSheetName}!A:Z`);

    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: rows },
      { headers: { Authorization: `Bearer ${token.access_token}` }, timeout: 10_000 },
    );
    logInfo('request logger flushed', { rowCount: rows.length });
  } catch (err) {
    logError('request logger flush failed', {
      rowCount: rows.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL_MS);
}

export function logRequest(entry: RequestLogEntry) {
  if (!env.requestLogSpreadsheetId) return;
  buffer.push(entryToRow(entry));
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

async function ensureTab(accessToken: string, spreadsheetId: string, tabName: string, headers: string[]) {
  const meta = await axios.get(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const sheets = (meta.data.sheets as { properties?: { title?: string } }[]) || [];
  if (!sheets.some((s) => s.properties?.title === tabName)) {
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: tabName } } }] },
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
  }
  const range = encodeURIComponent(`${tabName}!A1`);
  await axios.put(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
    { values: [headers] },
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
}

const EVAL_HEADERS = [
  'timestamp',
  'route_id',
  'query',
  'pass',
  'score',
  'evaluation',
  'distance_requested',
  'distance_actual_miles',
  'distance_accuracy_pct',
];

export interface EvalLogEntry {
  timestamp: string;
  routeId: string;
  query: string;
  pass: boolean;
  score: number;
  evaluation: string;
  distanceRequested: string;
  distanceMilesActual: number;
  distanceAccuracyPct: number;
}

export function logEval(entry: EvalLogEntry) {
  if (!env.requestLogSpreadsheetId) return;
  const row = [
    entry.timestamp,
    entry.routeId,
    entry.query,
    entry.pass,
    Math.round(entry.score * 100) / 100,
    entry.evaluation,
    entry.distanceRequested,
    Math.round(entry.distanceMilesActual * 100) / 100,
    Math.round(entry.distanceAccuracyPct * 10) / 10,
  ];
  appendRow(env.requestLogSpreadsheetId, 'ai_evals', row);
}

async function appendRow(spreadsheetId: string, tabName: string, row: unknown[]) {
  const client = getJwtClient();
  if (!client) return;
  try {
    const token = await client.authorize();
    if (!token.access_token) return;
    const range = encodeURIComponent(`${tabName}!A:Z`);
    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: [row] },
      { headers: { Authorization: `Bearer ${token.access_token}` }, timeout: 10_000 },
    );
  } catch (err) {
    logError('eval log failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function ensureSheetTabs() {
  const client = getJwtClient();
  if (!client || !env.requestLogSpreadsheetId) return;
  try {
    const token = await client.authorize();
    if (!token.access_token) return;
    const id = env.requestLogSpreadsheetId;
    await ensureTab(token.access_token, id, env.requestLogSheetName, REQUEST_HEADERS);
    await ensureTab(token.access_token, id, 'ai_evals', EVAL_HEADERS);
  } catch (err) {
    logError('sheet tab setup failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
