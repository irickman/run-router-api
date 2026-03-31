import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import * as schema from './schema';

const dbPath = process.env.DATABASE_URL || path.join(process.cwd(), 'data', 'routes.db');

// Ensure data directory exists
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });

export function initializeSchema() {
  const createUsers = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      strava_id INTEGER UNIQUE,
      email TEXT,
      name TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      created_at TEXT NOT NULL
    )`;

  const createRoutes = `
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      route_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      query TEXT NOT NULL,
      parameters TEXT NOT NULL,
      route_data TEXT NOT NULL,
      gpx TEXT,
      score REAL,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`;

  const createSessions = `
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      conversation_history TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`;

  const createFeedback = `
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      route_id TEXT REFERENCES routes(id),
      user_id TEXT REFERENCES users(id),
      rating INTEGER,
      liked_aspects TEXT,
      change_suggestions TEXT,
      comment TEXT,
      created_at TEXT NOT NULL
    )`;

  const createUserPreferences = `
    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      typical_distance REAL,
      preferred_surfaces TEXT,
      elevation_preference TEXT,
      safety_sensitivity TEXT,
      default_location_lat REAL,
      default_location_lng REAL,
      updated_at TEXT NOT NULL
    )`;

  sqlite.prepare(createUsers).run();
  sqlite.prepare(createRoutes).run();
  sqlite.prepare(createSessions).run();
  sqlite.prepare(createFeedback).run();
  sqlite.prepare(createUserPreferences).run();
}
