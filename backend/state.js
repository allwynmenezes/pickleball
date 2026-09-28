/* ===================== STATE (server-side) =====================
   Reads/writes the full app state — the same shape as the client's
   lib/store.js `state` object — against the SQLite tables in db.js.
   The client is the source of truth for *when* something changed (it owns
   the optimistic mutation via lib/engine.js), this module is the source of
   truth for what's actually durable: every PUT replaces the full snapshot,
   diffed against what's on disk so deleted entities are actually removed. */
const { db } = require('./db');

/* The Setup step's fields. Only the event's host (createdBy) may change
   them; for anyone else the stored values win. Everything else on an event
   — RSVPs, court claims, roster, scores — stays open to the whole group.
   (Same rule as the Cloudflare Worker's state.js.) */
const HOST_ONLY_FIELDS = ['name', 'date', 'startTime', 'durationMin', 'courts', 'gameLenMin', 'segments', 'memberIds', 'courtNames', 'createdBy', 'aiMessages'];

/* A new event's host is whoever saves it (never someone they name); a
   non-host's edits to setup fields are reverted; a non-host can't delete an
   event (it's put back). Events with no host stay open. */
function enforceEventHosts(incoming, stored, requester) {
  const storedById = new Map(stored.map(e => [e.id, e]));
  const incomingIds = new Set(incoming.map(e => e.id));
  const out = incoming.map(ev => {
    const prev = storedById.get(ev.id);
    if (!prev) {
      const { createdBy, ...rest } = ev;
      return requester ? { ...rest, createdBy: requester } : rest;
    }
    if (!prev.createdBy) return ev;
    if (prev.createdBy === requester) return { ...ev, createdBy: prev.createdBy };
    const kept = { ...ev };
    HOST_ONLY_FIELDS.forEach(f => { if (f in prev) kept[f] = prev[f]; else delete kept[f]; });
    return kept;
  });
  stored.forEach(prev => {
    if (!incomingIds.has(prev.id) && prev.createdBy && prev.createdBy !== requester) out.push(prev);
  });
  return out;
}

function defaultState() {
  return { players: [], events: [], currentEventId: null, history: {}, flagThreshold: 3, chats: [] };
}

function readState() {
  /* Auth columns (email, OTP/session hashes, claim tokens — see db.js) are
     deliberately never selected here: this row goes into the shared state
     blob every device fetches with GET /api/state, so only `claimed` (a
     safe yes/no derived from `email IS NOT NULL`) crosses that boundary.
     Anything else lives behind the dedicated auth.js endpoints instead. */
  const players = db.prepare("SELECT id, name, gender, (email IS NOT NULL) AS claimed FROM players").all()
    .map(p => ({ ...p, claimed: !!p.claimed }));
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

/* `protectWhere` names rows the sync may never delete even when a client
   leaves them out — account holders are created only by claiming an
   invite, and must never disappear because an event removed a player. */
function replaceRows(table, incomingRows, toRow, protectWhere) {
  const existingIds = db.prepare(`SELECT id FROM ${table}${protectWhere ? ` WHERE NOT (${protectWhere})` : ''}`).all().map(r => r.id);
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

function writeState(incoming, requester = null) {
  const state = { ...defaultState(), ...incoming };
  const storedEvents = db.prepare('SELECT id, data FROM events').all().map(r => ({ id: r.id, ...JSON.parse(r.data) }));
  state.events = enforceEventHosts(state.events, storedEvents, requester);

  db.exec('BEGIN');
  try {
    replaceRows('players', state.players, {
      columns: ['name', 'gender'],
      values: p => [p.name, p.gender],
    }, 'email IS NOT NULL');
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

module.exports = { defaultState, readState, writeState };
