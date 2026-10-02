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
  'published', 'started', 'startedAt', 'currentRoundIndex',
  // Playoffs (players may still score their own match — mergePlayoffs) and
  // which series the event belongs to.
  'playoffs', 'seriesId',
  // "Create a group chat for this event".
  'groupChat'];

/* Scores. The server stamps each accepted score (scoredAt, scoredBy); the
   phone's clock is never trusted. A phone sends baseAt — the stamp of the
   score it last saw for that game — with a change: the change is taken if
   nobody else scored the game since (baseAt isn't older than the stored
   stamp), or if the last score was the same person's (typing "1", "11"
   before the first save comes back). So a phone with an out-of-date copy —
   the host's included — never undoes someone else's newer score. */
const sameTeams = (a, b) => !!a && !!b && JSON.stringify([a.teamA, a.teamB]) === JSON.stringify([b.teamA, b.teamB]);
const plays = (c, id) => !!id && [...(c.teamA || []), ...(c.teamB || [])].includes(id);
const hasScore = c => !!c && (c.scoreA != null || c.scoreB != null);
const clean = c => { const out = { ...c }; delete out.baseAt; return out; };
function mergeScore(before, inc, allowed, requester, now) {
  const out = clean(inc);
  if (!before || !sameTeams(before, inc)) {
    // A new game. Only an allowed editor (the host) brings a score with it.
    if (!allowed || !hasScore(inc)) { out.scoreA = allowed ? inc.scoreA : null; out.scoreB = allowed ? inc.scoreB : null; delete out.scoredAt; delete out.scoredBy; return out; }
    return { ...out, scoredAt: now, scoredBy: requester || null };
  }
  const keep = () => {
    const k = { ...out, scoreA: before.scoreA, scoreB: before.scoreB };
    if (before.scoredAt) { k.scoredAt = before.scoredAt; k.scoredBy = before.scoredBy || null; } else { delete k.scoredAt; delete k.scoredBy; }
    return k;
  };
  if (inc.scoreA === before.scoreA && inc.scoreB === before.scoreB) return keep();
  if (!allowed) return keep();
  const base = 'baseAt' in inc ? Number(inc.baseAt) || 0 : Number(inc.scoredAt) || 0;
  const mineLast = !!before.scoredAt && (before.scoredBy || null) === (requester || null);
  if (base < (before.scoredAt || 0) && !mineLast) return keep();
  return { ...out, scoredAt: now, scoredBy: requester || null };
}

/* The host's (or a hostless event's) roster: taken as sent, with the score
   rule above. */
function mergeHostRoster(prevRoster, incomingRoster, requester, now) {
  if (!Array.isArray(incomingRoster)) return incomingRoster;
  return incomingRoster.map((round, i) => {
    const prevRound = Array.isArray(prevRoster) ? prevRoster[i] : null;
    const same = prevRound && round && prevRound.offset === round.offset;
    return {
      ...round,
      courts: (round.courts || []).map(c => mergeScore(same ? (prevRound.courts || []).find(x => x.court === c.court) : null, c, true, requester, now)),
    };
  });
}

/* A non-host's roster. Rounds already played, and the round being played
   once games have started, stay exactly as stored. Later rounds may be
   remade (a player's RSVP change, or a score in an event whose next rounds
   depend on results, does that) — but only into rounds made of the event's
   own players on real courts, nobody twice, nobody added or dropped unless
   their RSVP says so, at the same times, and with no scores on new games. Scores change only on the player's own games. The roster keeps
   its length; there's no roster to make before the host makes one. */
function mergeRosterForPlayer(prev, ev, requester, now) {
  const prevRoster = prev.roster;
  if (!Array.isArray(prevRoster)) return prevRoster;
  const incoming = Array.isArray(ev.roster) ? ev.roster : [];
  const currentIdx = prev.currentRoundIndex || 0;
  const frozenTo = prev.started ? currentIdx : currentIdx - 1; // rounds up to this index keep their games
  const members = new Set([...(prev.memberIds || []), ...Object.keys(prev.rsvps || {})]);
  /* Later rounds are only remade by a save that explains it: the player's
     own RSVP change, or — where results decide the rounds — their own
     score. Anything else (say, an out-of-date copy saved along with a chat
     message) keeps the rounds as stored. */
  const rsvpOf = (e, id) => JSON.stringify(((e && e.rsvps) || {})[id] || null);
  const ownRsvpChanged = !!requester && rsvpOf(prev, requester) !== rsvpOf(ev, requester);
  const o = prev.options || {};
  const driven = !!o.reseed || (!!o.movement && o.movement !== 'none');
  const ownScoreChanged = driven && !!requester && prevRoster.some((p, i) => (p.courts || []).some(c => {
    if (!plays(c, requester)) return false;
    const a = incoming[i] && Array.isArray(incoming[i].courts) ? incoming[i].courts.find(x => x.court === c.court) : null;
    return !!a && sameTeams(a, c) && (a.scoreA !== c.scoreA || a.scoreB !== c.scoreB);
  }));
  const mayRemake = ownRsvpChanged || ownScoreChanged;
  const rsvps = (ev && ev.rsvps) || {};
  const available = (id, r) => {
    const x = rsvps[id];
    return !!x && (x.status === 'in' || x.status === 'partial') && r.offset >= (x.start || 0) && (x.end == null || r.offset < x.end);
  };
  const everyone = r => [...(r.courts || []).flatMap(c => [...(c.teamA || []), ...(c.teamB || [])]), ...(r.sitOut || [])];
  const validRound = (r, p) => {
    if (!r || !Array.isArray(r.courts) || r.offset !== p.offset) return false;
    const nums = r.courts.map(c => c.court);
    if (!nums.every(n => Number.isInteger(n) && n >= 1 && n <= (prev.courts || 0)) || new Set(nums).size !== nums.length) return false;
    if (!r.courts.every(c => Array.isArray(c.teamA) && Array.isArray(c.teamB) && c.teamA.length === c.teamB.length && c.teamA.length >= 1 && c.teamA.length <= 2)) return false;
    const ids = everyone(r);
    if (!ids.every(id => members.has(id)) || new Set(ids).size !== ids.length) return false;
    // Nobody leaves or joins a round unless their RSVP says so.
    const had = new Set(everyone(p)), has = new Set(ids);
    for (const id of had) if (!has.has(id) && available(id, r)) return false;
    for (const id of has) if (!had.has(id) && !available(id, r)) return false;
    return true;
  };
  return prevRoster.map((p, i) => {
    const inc = incoming[i];
    const base = mayRemake && i > frozenTo && validRound(inc, p) ? inc : p;
    return {
      ...base,
      courts: (base.courts || []).map(c => {
        const before = (p.courts || []).find(x => x.court === c.court);
        const after = inc && Array.isArray(inc.courts) ? inc.courts.find(x => x.court === c.court) : null;
        const sent = after && sameTeams(after, c) ? after : c;
        // A remade game has no score yet: only an existing game of theirs can be scored.
        return mergeScore(before, sent, sameTeams(before, sent) && plays(c, requester), requester, now);
      }),
    };
  });
}

/* Playoffs (see lib/playoffs.js): the host starts, changes or removes the
   bracket; anyone may score a match they play in, until a later match that
   depends on it has a score. After merging, each match's teams are worked
   out again from the results (the same rule as resolvePlayoffs in
   lib/playoffs.js), so the next round's players can score straight away. */
function resolvePlayoffTeams(p) {
  const res = new Map();
  const done = m => m.teamA && m.teamB && m.scoreA != null && m.scoreB != null && m.scoreA !== m.scoreB;
  const teamOf = src => {
    if (!src) return null;
    if (src.seed) return (p.teams || [])[src.seed - 1] || null;
    const r = res.get(src.winnerOf || src.loserOf) || {};
    return (src.winnerOf ? r.winner : r.loser) || null;
  };
  p.matches.forEach(m => {
    const A = teamOf(m.a), B = teamOf(m.b);
    if (JSON.stringify(A) !== JSON.stringify(m.teamA || null) || JSON.stringify(B) !== JSON.stringify(m.teamB || null)) {
      if (m.teamA || m.teamB) { m.scoreA = null; m.scoreB = null; delete m.scoredAt; delete m.scoredBy; }
      m.teamA = A; m.teamB = B;
    }
    res.set(m.id, done(m) ? (m.scoreA > m.scoreB ? { winner: A, loser: B } : { winner: B, loser: A }) : {});
  });
  return p;
}
const lockedMatch = (p, id) => p.matches.some(m => hasScore(m) && [m.a, m.b].some(s => s && (s.winnerOf === id || s.loserOf === id)));
function mergePlayoffs(prev, incoming, requester, isHost, now) {
  const valid = p => !!p && Array.isArray(p.matches);
  if (isHost) {
    if (!valid(incoming)) return incoming;
    const sameBracket = valid(prev) && JSON.stringify(prev.matches.map(m => m.id)) === JSON.stringify(incoming.matches.map(m => m.id)) && JSON.stringify(prev.teams) === JSON.stringify(incoming.teams);
    return resolvePlayoffTeams({
      ...incoming,
      matches: incoming.matches.map(m => mergeScore(sameBracket ? prev.matches.find(x => x.id === m.id) : null, m, true, requester, now)),
    });
  }
  if (!valid(prev)) return prev;
  return resolvePlayoffTeams({
    ...prev,
    matches: prev.matches.map(m => {
      const inc = valid(incoming) && incoming.matches.find(x => x.id === m.id);
      if (!inc || !sameTeams(inc, m)) return { ...m };
      return mergeScore(m, inc, plays(m, requester) && !lockedMatch(prev, m.id), requester, now);
    }),
  });
}

/* Applies host-only rules to an incoming list of events against what's
   stored: a new event's host is whoever is saving it (never someone they
   name); a non-host's edits to setup fields are reverted; a non-host can't
   delete an event (it's put back). Events with no host stay open. Scores
   follow the rule above for everyone. */
function enforceEventHosts(incoming, stored, requester, now = Date.now()) {
  const storedById = new Map(stored.map(e => [e.id, e]));
  const incomingIds = new Set(incoming.map(e => e.id));
  const out = incoming.map(ev => {
    const prev = storedById.get(ev.id);
    if (!prev) {
      const { createdBy, ...rest } = ev;
      const fresh = requester ? { ...rest, createdBy: requester } : rest;
      if (Array.isArray(fresh.roster)) fresh.roster = mergeHostRoster(null, fresh.roster, requester, now);
      return fresh;
    }
    if (!prev.createdBy || prev.createdBy === requester) {
      const kept = prev.createdBy ? { ...ev, createdBy: prev.createdBy } : { ...ev };
      if ('roster' in ev) kept.roster = mergeHostRoster(prev.roster, ev.roster, requester, now);
      if ('playoffs' in ev) kept.playoffs = mergePlayoffs(prev.playoffs, ev.playoffs, requester, true, now);
      return kept;
    }
    const kept = { ...ev };
    HOST_ONLY_FIELDS.forEach(f => { if (f in prev) kept[f] = prev[f]; else delete kept[f]; });
    // Only their own RSVP (and their own no-show mark).
    const rsvps = { ...(prev.rsvps || {}) };
    if (requester && ev.rsvps && requester in ev.rsvps) rsvps[requester] = ev.rsvps[requester];
    else if (requester && ev.rsvps) delete rsvps[requester]; // (a save without RSVPs leaves theirs alone)
    if ('rsvps' in prev || 'rsvps' in ev) kept.rsvps = rsvps;
    const noShows = (prev.noShows || []).filter(id => id !== requester);
    if (requester && (ev.noShows || []).includes(requester)) noShows.push(requester);
    if ('noShows' in prev || 'noShows' in ev) kept.noShows = noShows;
    if ('roster' in ev || 'roster' in prev) kept.roster = mergeRosterForPlayer(prev, kept.rsvps ? { ...ev, rsvps: kept.rsvps } : ev, requester, now);
    if ('playoffs' in prev) kept.playoffs = mergePlayoffs(prev.playoffs, ev.playoffs, requester, false, now);
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
