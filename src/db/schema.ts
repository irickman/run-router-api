import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  strava_id: integer('strava_id').unique(),
  email: text('email'),
  name: text('name'),
  access_token: text('access_token'),
  refresh_token: text('refresh_token'),
  token_expires_at: integer('token_expires_at'),
  created_at: text('created_at').notNull(),
});

export const routes = sqliteTable('routes', {
  id: text('id').primaryKey(),
  session_id: text('session_id').notNull(),
  route_id: text('route_id').notNull(),
  user_id: text('user_id').references(() => users.id),
  name: text('name').notNull(),
  query: text('query').notNull(),
  parameters: text('parameters').notNull(),
  route_data: text('route_data').notNull(),
  gpx: text('gpx'),
  score: real('score'),
  is_favorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  created_at: text('created_at').notNull(),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  user_id: text('user_id').references(() => users.id),
  conversation_history: text('conversation_history').notNull().default('[]'),
  created_at: text('created_at').notNull(),
  updated_at: text('updated_at').notNull(),
});

export const feedback = sqliteTable('feedback', {
  id: text('id').primaryKey(),
  route_id: text('route_id').references(() => routes.id),
  user_id: text('user_id').references(() => users.id),
  rating: integer('rating'),
  liked_aspects: text('liked_aspects'),
  change_suggestions: text('change_suggestions'),
  comment: text('comment'),
  created_at: text('created_at').notNull(),
});

export const user_preferences = sqliteTable('user_preferences', {
  id: text('id').primaryKey(),
  user_id: text('user_id').notNull().references(() => users.id),
  typical_distance: real('typical_distance'),
  preferred_surfaces: text('preferred_surfaces'),
  elevation_preference: text('elevation_preference'),
  safety_sensitivity: text('safety_sensitivity'),
  default_location_lat: real('default_location_lat'),
  default_location_lng: real('default_location_lng'),
  updated_at: text('updated_at').notNull(),
});
