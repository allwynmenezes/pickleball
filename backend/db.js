/* ===================== DATABASE =====================
   Persistence for the app's shared state, using Node's built-in `node:sqlite`
   module (stable since Node 22) — a real relational database with zero
   external services, no native module builds, and no cost. Top-level
   entities (players, events, chats) are their own rows so they can be
   queried/deleted individually; each entity's nested engine-specific shape
   (segments, rsvps, roster rounds, booking slots, messages, ...) is stored
   as a JSON column rather than re-normalized into more tables, since that
   shape is exactly what lib/engine.js already produces and consumes. */
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.PICKLE_DB_PATH || path.join(__dirname, 'data.sqlite');
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

module.exports = { db, DB_PATH };
