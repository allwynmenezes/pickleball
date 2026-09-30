/* ===================== THREE-WAY MERGE =====================
   Used by live sync (lib/store.js) while a save of this phone's changes
   keeps failing: instead of ignoring the server until the save goes
   through, the server's changes are merged with the unsaved local ones.
   base: the last copy this phone had from the server; local: this phone's
   state now; remote: the server's copy now. Pure — tested in
   test/merge.test.mjs.

   Per event (and per player, chat): unchanged here → the server's copy;
   unchanged on the server → ours; changed on both → merged field by field:
   - plain fields (round index, options, check-in, started, …): whichever
     side changed it — ours if both did (the server keeps its host-only
     rules either way);
   - RSVPs: ours for the players whose RSVP we changed;
   - rounds: whichever side remade them (moved on, recomputed after an
     RSVP) — ours if both did — with the other side's new scores on the
     same games laid on top; the same for the playoff bracket.
   Chats keep every message from both; pairing history keeps both sides'
   additions. */
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const byId = list => new Map((list || []).map(x => [x.id, x]));
const teamsOf = c => JSON.stringify([c && c.teamA, c && c.teamB]);
/* Our unsaved score goes on with its baseAt, keeping the server's stamp (the
   server then decides by baseAt); the server's score comes with its stamp. */
const OURS = ['scoreA', 'scoreB', 'baseAt'];
const THEIRS = ['scoreA', 'scoreB', 'scoredAt', 'scoredBy'];
const SPECIAL = new Set(['rsvps', 'roster', 'playoffs']);

/* Lays `from`'s score changes (vs base) onto `into` (mutates `into`), game
   by game, where the teams match. */
function overlayScores(baseGames, fromGames, intoGames, keyOf, fields) {
  (fromGames || []).forEach(f => {
    const b = (baseGames || []).find(x => keyOf(x) === keyOf(f));
    const t = (intoGames || []).find(x => keyOf(x) === keyOf(f));
    if (!t || teamsOf(t) !== teamsOf(f)) return;
    if (b && teamsOf(b) === teamsOf(f) && b.scoreA === f.scoreA && b.scoreB === f.scoreB) return; // not changed there
    fields.forEach(k => { if (k in f) t[k] = f[k]; else delete t[k]; });
  });
}
const shapeOfRoster = r => JSON.stringify((r || []).map(x => [x.offset, (x.courts || []).map(c => [c.court, c.teamA, c.teamB]), x.sitOut || []]));
const shapeOfPlayoffs = p => JSON.stringify(p ? [p.teams, (p.matches || []).map(m => m.id)] : null);

function mergeEvent(b, l, r) {
  b = b || {};
  const out = {};
  new Set([...Object.keys(l), ...Object.keys(r)]).forEach(k => {
    if (SPECIAL.has(k)) return;
    const v = same(l[k], b[k]) ? r[k] : l[k];
    if (v !== undefined) out[k] = clone(v);
  });
  // RSVPs we changed.
  const rs = clone(r.rsvps || {});
  Object.keys({ ...(l.rsvps || {}), ...(b.rsvps || {}) }).forEach(id => {
    const lv = (l.rsvps || {})[id], bv = (b.rsvps || {})[id];
    if (!same(lv, bv)) { if (lv === undefined) delete rs[id]; else rs[id] = clone(lv); }
  });
  if (l.rsvps || r.rsvps) out.rsvps = rs;
  // No-show marks from both sides, kept for whoever is still out.
  if (l.noShows || r.noShows) {
    out.noShows = [...new Set([...(l.noShows || []), ...(r.noShows || [])])].filter(id => rs[id] && rs[id].status === 'out');
  }
  // Rounds: whoever remade them wins the shape; the other's scores go on top.
  if (l.roster !== undefined || r.roster !== undefined) {
    const oursShaped = shapeOfRoster(l.roster) !== shapeOfRoster(b.roster);
    const [main, other] = oursShaped ? [l, r] : [r, l];
    out.roster = clone(main.roster);
    (other.roster || []).forEach(or => {
      const into = (out.roster || []).find(x => x.offset === or.offset);
      const br = (b.roster || []).find(x => x.offset === or.offset);
      if (into) overlayScores(br && br.courts, or.courts, into.courts, c => c.court, oursShaped ? THEIRS : OURS);
    });
  }
  if (l.playoffs !== undefined || r.playoffs !== undefined) {
    const oursShaped = shapeOfPlayoffs(l.playoffs) !== shapeOfPlayoffs(b.playoffs);
    const [main, other] = oursShaped ? [l, r] : [r, l];
    out.playoffs = clone(main.playoffs);
    if (out.playoffs && other.playoffs && shapeOfPlayoffs(out.playoffs) === shapeOfPlayoffs(other.playoffs)) {
      overlayScores(b.playoffs && b.playoffs.matches, other.playoffs.matches, out.playoffs.matches, m => m.id, oursShaped ? THEIRS : OURS);
    }
    if (out.playoffs === undefined) delete out.playoffs;
  }
  return out;
}

function mergeList(base, local, remote, mergeOne) {
  const B = byId(base), L = byId(local), R = byId(remote);
  const out = [];
  const ids = [...new Set([...(remote || []).map(x => x.id), ...(local || []).map(x => x.id)])];
  ids.forEach(id => {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (!l) { if (r && (!b || !same(r, b))) out.push(clone(r)); return; } // we deleted it (unless it changed since)
    if (!r) { if (!b) out.push(clone(l)); return; } // new here, or deleted on the server
    if (same(l, b)) out.push(clone(r));
    else if (same(r, b)) out.push(clone(l));
    else out.push(mergeOne(b, l, r));
  });
  return out;
}

function mergeChat(b, l, r) {
  const out = clone(r);
  out.messages = out.messages || [];
  const seen = new Set(out.messages.map(m => m.id));
  (l.messages || []).forEach(m => { if (!seen.has(m.id)) out.messages.push(clone(m)); });
  out.messages.sort((x, y) => (x.ts || 0) - (y.ts || 0));
  return out;
}

/* Pairing history is counts: keep the server's, plus what we added. */
function mergeHistory(b, l, r) {
  if (same(l, b)) return clone(r);
  if (same(r, b)) return clone(l);
  const out = clone(r || {});
  Object.keys({ ...(l || {}), ...(b || {}) }).forEach(k => {
    const lv = (l || {})[k] || { partner: 0, opponent: 0 }, bv = (b || {})[k] || { partner: 0, opponent: 0 };
    const rv = out[k] || { partner: 0, opponent: 0 };
    out[k] = {
      partner: Math.max(0, rv.partner + lv.partner - bv.partner),
      opponent: Math.max(0, rv.opponent + lv.opponent - bv.opponent),
    };
  });
  return out;
}

export function threeWayMerge(base, local, remote) {
  const b = base || {};
  return {
    ...clone(remote),
    events: mergeList(b.events, local.events, remote.events, mergeEvent),
    players: mergeList(b.players, local.players, remote.players, (bb, l) => clone(l)),
    chats: mergeList(b.chats, local.chats || [], remote.chats || [], mergeChat),
    history: mergeHistory(b.history, local.history, remote.history),
    flagThreshold: same(local.flagThreshold, b.flagThreshold) ? remote.flagThreshold : local.flagThreshold,
    currentEventId: local.currentEventId,
  };
}
