/* The shared group state (players, events, chats, pairing history, config)
   as one JSON snapshot — same contract as the local backend's state.js:
   GET returns it, PUT replaces it (deleting whatever the client dropped),
   except that account holders are never deleted by a sync, and an event's
   setup can only be changed — or the event deleted — by its host. D1's
   batch() runs the whole write as a single transaction. */
import { json, err, readJson, sha256 } from './util.js';

/* The Setup step's fields. Only the event's host (createdBy) may change
   them; for anyone else the stored values win. Everything else on an event
   — RSVPs, court claims, roster, scores — stays open to the whole group. */
const HOST_ONLY_FIELDS = ['name', 'date', 'startTime', 'durationMin', 'courts', 'gameLenMin', 'segments', 'memberIds', 'courtNames', 'createdBy', 'aiMessages'];

export async function requesterId(request, db) {
  const [scheme, token] = (request.headers.get('Authorization') || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  const session = await db.prepare('SELECT playerId, expiresAt FROM sessions WHERE tokenHash = ?').bind(await sha256(token)).first();
  return session && Date.now() <= session.expiresAt ? session.playerId : null;
}

/* Applies host-only rules to an incoming list of events against what's
   stored: a new event's host is whoever is saving it (never someone they
   name); a non-host's edits to setup fields are reverted; a non-host can't
   delete an event (it's put back). Events with no host stay open. */
export function enforceEventHosts(incoming, stored, requester) {
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

export function defaultState() {
  return { players: [], events: [], currentEventId: null, history: {}, flagThreshold: 3, chats: [] };
}

export async function readState(db) {
  const [players, events, chats, history, config] = await db.batch([
    db.prepare('SELECT id, name, gender, (email IS NOT NULL) AS claimed FROM players'),
    db.prepare('SELECT id, data FROM events'),
    db.prepare('SELECT id, data FROM chats'),
    db.prepare('SELECT data FROM history WHERE id = 1'),
    db.prepare('SELECT flagThreshold, currentEventId FROM config WHERE id = 1'),
  ]);
  const historyRow = history.results[0];
  const configRow = config.results[0];
  return {
    players: players.results.map(p => ({ id: p.id, name: p.name, gender: p.gender, claimed: !!p.claimed })),
    events: events.results.map(r => ({ id: r.id, ...JSON.parse(r.data) })),
    chats: chats.results.map(r => ({ id: r.id, ...JSON.parse(r.data) })),
    history: historyRow ? JSON.parse(historyRow.data) : {},
    flagThreshold: configRow ? configRow.flagThreshold : 3,
    currentEventId: configRow ? configRow.currentEventId : null,
  };
}

function validate(body) {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object.';
  if (!Array.isArray(body.players)) return '"players" must be an array.';
  if (!Array.isArray(body.events)) return '"events" must be an array.';
  if (body.chats !== undefined && !Array.isArray(body.chats)) return '"chats" must be an array.';
  if (body.history !== undefined && (typeof body.history !== 'object' || body.history === null)) return '"history" must be an object.';
  if (body.players.some(p => !p || typeof p.id !== 'string')) return 'Every player needs a string "id".';
  if (body.events.some(e => !e || typeof e.id !== 'string')) return 'Every event needs a string "id".';
  if ((body.chats || []).some(c => !c || typeof c.id !== 'string')) return 'Every chat needs a string "id".';
  return null;
}

async function replaceRowsStatements(db, table, rows, columns, values, protectWhere) {
  const existing = (await db.prepare(`SELECT id FROM ${table}${protectWhere ? ` WHERE NOT (${protectWhere})` : ''}`).all()).results;
  const incoming = new Set(rows.map(r => r.id));
  const stmts = existing.filter(r => !incoming.has(r.id)).map(r => db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(r.id));
  const upsertSql = `INSERT INTO ${table} (id, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})
    ON CONFLICT(id) DO UPDATE SET ${columns.map(c => `${c} = excluded.${c}`).join(', ')}`;
  rows.forEach(r => stmts.push(db.prepare(upsertSql).bind(r.id, ...values(r))));
  return stmts;
}

export async function getState(request, env) {
  return json(await readState(env.DB));
}

export async function putState(request, env) {
  const body = await readJson(request);
  const problem = validate(body);
  if (problem) return err(400, problem);
  const state = { ...defaultState(), ...body };
  const db = env.DB;
  const storedEvents = (await db.prepare('SELECT id, data FROM events').all()).results.map(r => ({ id: r.id, ...JSON.parse(r.data) }));
  state.events = enforceEventHosts(state.events, storedEvents, await requesterId(request, db));
  const stmts = [
    ...await replaceRowsStatements(db, 'players', state.players, ['name', 'gender'], p => [p.name, p.gender], 'email IS NOT NULL'),
    ...await replaceRowsStatements(db, 'events', state.events, ['data'], e => { const { id, ...rest } = e; return [JSON.stringify(rest)]; }),
    ...await replaceRowsStatements(db, 'chats', state.chats || [], ['data'], c => { const { id, ...rest } = c; return [JSON.stringify(rest)]; }),
    db.prepare('INSERT INTO history (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .bind(JSON.stringify(state.history || {})),
    db.prepare(`INSERT INTO config (id, flagThreshold, currentEventId) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET flagThreshold = excluded.flagThreshold, currentEventId = excluded.currentEventId`)
      .bind(Math.max(1, parseInt(state.flagThreshold, 10) || 1), state.currentEventId || null),
  ];
  await db.batch(stmts);
  return json(await readState(db));
}
