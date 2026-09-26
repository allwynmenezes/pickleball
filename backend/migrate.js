/* ===================== ONE-TIME DATA IMPORT =====================
   Moves an existing database (players with their accounts, events, chats,
   pairing history, settings) into a freshly deployed backend — see
   scripts/export-to-server.js for the sending side.

   Deliberately hard to misuse:
     - it doesn't exist unless MIGRATION_TOKEN is set on the server;
     - the request must carry that same token;
     - it only writes into an EMPTY database, so live data can never be
       overwritten.
   Remove MIGRATION_TOKEN from the server once the import is done.
   Sessions and pending sign-ups aren't moved — people just log in again. */
const crypto = require('node:crypto');
const express = require('express');
const { db } = require('./db');

const TABLES = ['players', 'events', 'chats', 'history', 'config'];

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const router = express.Router();

router.post('/admin/import', (req, res) => {
  const expected = process.env.MIGRATION_TOKEN;
  if (!expected) return res.status(404).json({ error: 'Not found.' });
  if (!tokenMatches(req.headers['x-migration-token'], expected)) return res.status(403).json({ error: 'Bad token.' });
  const existing = db.prepare('SELECT COUNT(*) AS n FROM players').get().n + db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  if (existing > 0) return res.status(409).json({ error: 'This database already has data — refusing to overwrite it.' });

  const counts = {};
  db.exec('BEGIN');
  try {
    for (const table of TABLES) {
      const rows = Array.isArray(req.body[table]) ? req.body[table] : [];
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name));
      for (const row of rows) {
        const keys = Object.keys(row).filter(k => columns.has(k));
        db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
          .run(...keys.map(k => row[k]));
      }
      counts[table] = rows.length;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('import failed', e);
    return res.status(500).json({ error: `Import failed: ${e.message}` });
  }
  res.json({ ok: true, imported: counts });
});

module.exports = { router };
