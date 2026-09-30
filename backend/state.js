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
const HOST_ONLY_FIELDS = ['name', 'date', 'startTime', 'durationMin', 'courts', 'gameLenMin', 'segments', 'memberIds', 'courtNames', 'createdBy', 'aiMessages', 'options', 'checkedIn',
  // Running event day is the host's job too.
  'published', 'started', 'startedAt', 'currentRoundIndex'];

/* A new event's host is whoever saves it (never someone they name); a
   non-host's edits to setup fields are reverted; a non-host can't delete an
   event (it's put back). Events with no host stay open. */
/* A non-host's roster: rounds already played stay as stored, and any score
   they change must be on a court they played on. The current and later rounds
   may still be recomputed (a player's own RSVP change does that), but even
   there only their own games' scores can change. */
function mergeRosterForPlayer(prevRoster, incomingRoster, requester, currentIdx) {
  if (!Array.isArray(prevRoster)) return incomingRoster;
  if (!Array.isArray(incomingRoster)) return prevRoster;
  const plays = c => [...(c.teamA || []), ...(c.teamB || [])].includes(requester);
  const sameTeams = (a, b) => a && b && JSON.stringify([a.teamA, a.teamB]) === JSON.stringify([b.teamA, b.teamB]);
  const merged = incomingRoster.map((round, i) => {
    const prevRound = prevRoster[i];
    const base = i < currentIdx && prevRound ? prevRound : round;
    return {
      ...base,
      courts: (base.courts || []).map(c => {
        const before = prevRound && (prevRound.courts || []).find(x => x.court === c.court);
        const after = (round.courts || []).find(x => x.court === c.court);
        if (!sameTeams(before, c)) return c; // a recomputed game: nothing to protect yet
        const mine = plays(c) && sameTeams(after, c);
        return { ...c, scoreA: mine ? after.scoreA : before.scoreA, scoreB: mine ? after.scoreB : before.scoreB };
      }),
    };
  });
  return prevRoster.slice(merged.length, currentIdx).length ? [...merged, ...prevRoster.slice(merged.length, currentIdx)] : merged;
}

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
    if ('roster' in ev || 'roster' in prev) kept.roster = mergeRosterForPlayer(prev.roster, ev.roster, requester, prev.currentRoundIndex || 0);
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
  const players = db.prepare("SELECT id, name, gender, dupr, (email IS NOT NULL) AS claimed FROM players").all()
    .map(({ dupr, ...p }) => ({ ...p, ...(dupr != null ? { dupr } : {}), claimed: !!p.claimed }));
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

/* A DUPR doubles rating is 2.000–8.000; anything else is stored as none. */
const duprOf = p => { const n = Number(p && p.dupr); return Number.isFinite(n) && n >= 2 && n <= 8 ? Math.round(n * 1000) / 1000 : null; };

function writeState(incoming, requester = null) {
  const state = { ...defaultState(), ...incoming };
  const storedEvents = db.prepare('SELECT id, data FROM events').all().map(r => ({ id: r.id, ...JSON.parse(r.data) }));
  state.events = enforceEventHosts(state.events, storedEvents, requester);

  db.exec('BEGIN');
  try {
    replaceRows('players', state.players, {
      columns: ['name', 'gender', 'dupr'],
      values: p => [p.name, p.gender, duprOf(p)],
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
