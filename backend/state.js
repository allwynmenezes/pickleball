/* ===================== STATE (server-side) =====================
   Reads/writes the full app state — the same shape as the client's
   lib/store.js `state` object — against the SQLite tables in db.js.
   The client is the source of truth for *when* something changed (it owns
   the optimistic mutation via lib/engine.js), this module is the source of
   truth for what's actually durable: every PUT replaces the full snapshot,
   diffed against what's on disk so deleted entities are actually removed. */
const { db } = require('./db');

function defaultState() {
  return { players: [], events: [], currentEventId: null, history: {}, flagThreshold: 3, chats: [] };
}

function readState() {
  const players = db.prepare('SELECT id, name, gender FROM players').all();
  const events = db.prepare('SELECT id, data FROM events').all()
    .map(row => ({ id: row.id, ...JSON.parse(row.data) }));
  const chats = db.prepare('SELECT id, data FROM chats').all()
    .map(row => ({ id: row.id, ...JSON.parse(row.data) }));
  const historyRow = db.prepare('SELECT data FROM history WHERE id = 1').get();
  const configRow = db.prepare('SELECT flagThreshold, currentEventId FROM config WHERE id = 1').get();

  return {
    players,
    events,
    chats,
    history: historyRow ? JSON.parse(historyRow.data) : {},
    flagThreshold: configRow ? configRow.flagThreshold : 3,
    currentEventId: configRow ? configRow.currentEventId : null,
  };
}

function replaceRows(table, incomingRows, toRow) {
  const existingIds = db.prepare(`SELECT id FROM ${table}`).all().map(r => r.id);
  const incomingIds = new Set(incomingRows.map(r => r.id));
  const del = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  existingIds.forEach(id => { if (!incomingIds.has(id)) del.run(id); });

  const upsert = db.prepare(`
    INSERT INTO ${table} (id, ${toRow.columns.join(', ')})
    VALUES (?, ${toRow.columns.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${toRow.columns.map(c => `${c} = excluded.${c}`).join(', ')}
  `);
  incomingRows.forEach(r => upsert.run(r.id, ...toRow.values(r)));
}

function writeState(incoming) {
  const state = { ...defaultState(), ...incoming };

  db.exec('BEGIN');
  try {
    replaceRows('players', state.players, {
      columns: ['name', 'gender'],
      values: p => [p.name, p.gender],
    });
    replaceRows('events', state.events, {
      columns: ['data'],
      values: e => { const { id, ...rest } = e; return [JSON.stringify(rest)]; },
    });
    replaceRows('chats', state.chats || [], {
      columns: ['data'],
      values: c => { const { id, ...rest } = c; return [JSON.stringify(rest)]; },
    });
    db.prepare(`
      INSERT INTO history (id, data) VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET data = excluded.data
    `).run(JSON.stringify(state.history || {}));
    db.prepare(`
      INSERT INTO config (id, flagThreshold, currentEventId) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET flagThreshold = excluded.flagThreshold, currentEventId = excluded.currentEventId
    `).run(Math.max(1, parseInt(state.flagThreshold, 10) || 1), state.currentEventId || null);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  return readState();
}

function resetState() {
  db.exec('BEGIN');
  db.exec('DELETE FROM players');
  db.exec('DELETE FROM events');
  db.exec('DELETE FROM chats');
  db.exec('DELETE FROM history');
  db.exec('DELETE FROM config');
  db.exec('COMMIT');
  return defaultState();
}

module.exports = { defaultState, readState, writeState, resetState };
