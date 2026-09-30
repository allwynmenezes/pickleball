-- D1 schema for The Pickle Slot's Cloudflare Worker backend. Same tables
-- and columns as the local Node backend (backend/db.js), so data moves
-- between them 1:1. Safe to re-run: everything is IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT NOT NULL,
  -- Auth columns: only `email` ever reaches the shared state (as `claimed`).
  email TEXT,
  pendingEmail TEXT,
  otpHash TEXT,
  otpExpiresAt INTEGER,
  otpAttempts INTEGER NOT NULL DEFAULT 0,
  prevOtpHash TEXT,
  prevOtpExpiresAt INTEGER,
  sessionToken TEXT,
  sessionExpiresAt INTEGER,
  claimToken TEXT,
  claimTokenExpiresAt INTEGER,
  accountCreatedAt INTEGER,
  passwordHash TEXT,
  dupr REAL -- DUPR doubles rating, typed in (not synced); used for seeding
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_claimToken ON players(claimToken) WHERE claimToken IS NOT NULL;

CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  flagThreshold INTEGER NOT NULL DEFAULT 3,
  currentEventId TEXT
);

-- Sign-ups waiting on their email code; the player only exists once verified.
CREATE TABLE IF NOT EXISTS signups (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT NOT NULL,
  otpHash TEXT NOT NULL,
  otpExpiresAt INTEGER NOT NULL,
  otpAttempts INTEGER NOT NULL DEFAULT 0,
  passwordHash TEXT,
  claimPlayerId TEXT,
  prevOtpHash TEXT,
  prevOtpExpiresAt INTEGER
);

-- One row per signed-in device; expiry slides forward on each app launch.
CREATE TABLE IF NOT EXISTS sessions (
  tokenHash TEXT PRIMARY KEY,
  playerId TEXT NOT NULL,
  expiresAt INTEGER NOT NULL
);

-- One row per "describe your event" request, for the AI usage limits in
-- src/ai.js. Worker-only: the local Node backend has no AI endpoint.
-- Rows older than two days are deleted as new ones come in.
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playerId TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_calls_player_ts ON ai_calls(playerId, ts);
CREATE INDEX IF NOT EXISTS idx_ai_calls_ts ON ai_calls(ts);
