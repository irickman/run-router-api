import axios from 'axios';
import { JWT } from 'google-auth-library';

import { env } from '../config/env';
import { logError } from '../utils/logger';

const HEADERS = [
  'timestamp',
  'request_id',
  'endpoint',
  'query',
  'location_lat',
  'location_lng',
  'shape',
  'distance_value',
  'distance_unit',
  'landmarks',
  'route_id',
  'distance_meters_actual',
  'elevation_gain_ft',
  'duration_ms',
  'error',
];

export interface RequestLogEntry {
  timestamp: string;
  requestId: string;
  endpoint: string;
  query: string;
  locationLat: number | null;
  locationLng: number | null;
  shape: string;
  distanceValue: number;
  distanceUnit: string;
  landmarks: string[];
  routeId: string;
  distanceMetersActual: number | null;
  elevationGainFt: number | null;
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
    jwtClient = new JWT({
      keyFile: env.googleAuthFile,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return jwtClient;
  } catch {
    return null;
  }
}

function entryToRow(entry: RequestLogEntry): unknown[] {
  return [
    entry.timestamp,
    entry.requestId,
    entry.endpoint,
    entry.query,
    entry.locationLat ?? '',
    entry.locationLng ?? '',
    entry.shape,
    entry.distanceValue,
    entry.distanceUnit,
    entry.landmarks.join(', '),
    entry.routeId,
    entry.distanceMetersActual ?? '',
    entry.elevationGainFt != null ? Math.round(entry.elevationGainFt) : '',
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

    const sheetName = env.requestLogSheetName;
    const spreadsheetId = env.requestLogSpreadsheetId!;
    const range = encodeURIComponent(`${sheetName}!A:Z`);

    await axios.post(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { values: rows },
      { headers: { Authorization: `Bearer ${token.access_token}` }, timeout: 10_000 },
    );
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

export async function ensureRequestLogHeaders() {
  const client = getJwtClient();
  if (!client || !env.requestLogSpreadsheetId) return;

  try {
    const token = await client.authorize();
    if (!token.access_token) return;

    const spreadsheetId = env.requestLogSpreadsheetId;
    const sheetName = env.requestLogSheetName;

    // Create the tab if it doesn't exist.
    const meta = await axios.get(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const sheets = (meta.data.sheets as { properties?: { title?: string } }[]) || [];
    const exists = sheets.some((s) => s.properties?.title === sheetName);
    if (!exists) {
      await axios.post(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
        { requests: [{ addSheet: { properties: { title: sheetName } } }] },
        { headers: { Authorization: `Bearer ${token.access_token}` } },
      );
    }

    const range = encodeURIComponent(`${sheetName}!A1`);
    await axios.put(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=RAW`,
      { values: [HEADERS] },
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
  } catch (err) {
    logError('request logger header setup failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
