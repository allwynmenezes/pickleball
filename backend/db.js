/* ===================== DATABASE =====================
   Persistence for the app's shared state, using Node's built-in `node:sqlite`
   module (stable since Node 22) — a real relational database with zero
   external services, no native module builds, and no cost. Top-level
   entities (players, events, chats) are their own rows so they can be
   queried/deleted individually; each entity's nested engine-specific shape
   (segments, rsvps, roster rounds, booking slots, messages, ...) is stored
   as a JSON column rather than re-normalized into more tables, since that
   shape is exactly what lib/engine.js already produces and consumes. */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// In production PICKLE_DB_PATH points at a persistent volume (e.g.
// /data/data.sqlite); its folder may not exist yet on first boot.
const DB_PATH = process.env.PICKLE_DB_PATH || path.join(__dirname, 'data.sqlite');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    flagThreshold INTEGER NOT NULL DEFAULT 3,
    currentEventId TEXT
  );
`);

/* Auth columns on `players`, added via idempotent ALTERs rather than in the
   CREATE TABLE above so existing databases pick them up on next boot without
   a separate migration step. `email` is the ONLY one ever exposed through
   the shared /api/state sync (as a computed `claimed` boolean, in state.js)
   — everything else here is read/written exclusively by the auth endpoints,
   since these are per-player secrets, not shared group state. */
const PLAYER_AUTH_COLUMNS = [
  'email TEXT',
  'pendingEmail TEXT',
  'otpHash TEXT',
  'otpExpiresAt INTEGER',
  'otpAttempts INTEGER NOT NULL DEFAULT 0',
  'sessionToken TEXT',
  'sessionExpiresAt INTEGER',
  'claimToken TEXT',
  'claimTokenExpiresAt INTEGER',
  'accountCreatedAt INTEGER',
  'passwordHash TEXT',
  'prevOtpHash TEXT',
  'prevOtpExpiresAt INTEGER',
];
const existingColumns = new Set(db.prepare('PRAGMA table_info(players)').all().map(c => c.name));
for (const def of PLAYER_AUTH_COLUMNS) {
  const name = def.split(' ')[0];
  if (!existingColumns.has(name)) db.exec(`ALTER TABLE players ADD COLUMN ${def}`);
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_email ON players(email) WHERE email IS NOT NULL');

/* Sign-ups waiting on their email code. The player row is only created once
   the code is verified, so an abandoned sign-up never shows up as a player. */
db.exec(`
  CREATE TABLE IF NOT EXISTS signups (
    email TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    gender TEXT NOT NULL,
    otpHash TEXT NOT NULL,
    otpExpiresAt INTEGER NOT NULL,
    otpAttempts INTEGER NOT NULL DEFAULT 0
  )
`);
// passwordHash: chosen at sign-up, applied once the email code verifies.
// claimPlayerId: set when the sign-up came from an invite link, so verify
// turns that existing (host-added) player into the account instead of
// creating a new one.
const signupColumns = new Set(db.prepare('PRAGMA table_info(signups)').all().map(c => c.name));
if (!signupColumns.has('passwordHash')) db.exec('ALTER TABLE signups ADD COLUMN passwordHash TEXT');
if (!signupColumns.has('claimPlayerId')) db.exec('ALTER TABLE signups ADD COLUMN claimPlayerId TEXT');
// The code sent just before the current one stays valid until it expires
// (see checkOtp in auth.js).
if (!signupColumns.has('prevOtpHash')) db.exec('ALTER TABLE signups ADD COLUMN prevOtpHash TEXT');
if (!signupColumns.has('prevOtpExpiresAt')) db.exec('ALTER TABLE signups ADD COLUMN prevOtpExpiresAt INTEGER');

/* One row per signed-in device, so logging in on a phone doesn't sign you
   out of another. Expiry slides forward on every app launch (/auth/me). The
   older single-session column on players is carried over once, so anyone
   already signed in stays signed in. */
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    tokenHash TEXT PRIMARY KEY,
    playerId TEXT NOT NULL,
    expiresAt INTEGER NOT NULL
  )
`);
db.exec(`
  INSERT OR IGNORE INTO sessions (tokenHash, playerId, expiresAt)
  SELECT sessionToken, id, sessionExpiresAt FROM players
  WHERE sessionToken IS NOT NULL AND sessionExpiresAt IS NOT NULL
`);
db.exec('UPDATE players SET sessionToken = NULL, sessionExpiresAt = NULL WHERE sessionToken IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_claimToken ON players(claimToken) WHERE claimToken IS NOT NULL');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_sessionToken ON players(sessionToken) WHERE sessionToken IS NOT NULL');

module.exports = { db, DB_PATH };
