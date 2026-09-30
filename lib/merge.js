/* ===================== THREE-WAY MERGE =====================
   Used by live sync (lib/store.js) while a save of this phone's changes
   keeps failing: instead of ignoring the server until the save goes
   through, the server's changes are merged with the unsaved local ones.
   base: the last copy this phone had from the server; local: this phone's
   state now; remote: the server's copy now. Pure — tested in
   test/merge.test.mjs.

   Per event (and per player, chat): unchanged here → the server's copy;
   unchanged on the server → ours; changed on both → the server's copy with
   our own changes laid on top: scores we entered (on the same game), RSVPs
   we changed, and playoff scores. Chats keep every message from both. */
const same = (a, b) => JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
const clone = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const byId = list => new Map((list || []).map(x => [x.id, x]));
const teamsOf = c => JSON.stringify([c && c.teamA, c && c.teamB]);
const scoreFields = ['scoreA', 'scoreB', 'baseAt'];

function overlayScores(baseGames, localGames, remoteGames, keyOf) {
  (localGames || []).forEach(l => {
    const b = (baseGames || []).find(x => keyOf(x) === keyOf(l));
    const r = (remoteGames || []).find(x => keyOf(x) === keyOf(l));
    if (!r || teamsOf(r) !== teamsOf(l)) return;
    if (b && teamsOf(b) === teamsOf(l) && b.scoreA === l.scoreA && b.scoreB === l.scoreB) return; // not ours
    scoreFields.forEach(k => { if (k in l) r[k] = l[k]; else if (k === 'baseAt') delete r[k]; });
  });
}

function mergeEvent(b, l, r) {
  const out = clone(r);
  // RSVPs we changed.
  const rs = { ...(out.rsvps || {}) };
  Object.keys({ ...(l.rsvps || {}), ...((b && b.rsvps) || {}) }).forEach(id => {
    const lv = (l.rsvps || {})[id], bv = ((b && b.rsvps) || {})[id];
    if (!same(lv, bv)) { if (lv === undefined) delete rs[id]; else rs[id] = clone(lv); }
  });
  out.rsvps = rs;
  // Scores we entered, round by round (matched by round time).
  (l.roster || []).forEach(lr => {
    const rr = (out.roster || []).find(x => x.offset === lr.offset);
    const br = ((b && b.roster) || []).find(x => x.offset === lr.offset);
    if (rr) overlayScores(br && br.courts, lr.courts, rr.courts, c => c.court);
  });
  if (l.playoffs && out.playoffs) overlayScores(b && b.playoffs && b.playoffs.matches, l.playoffs.matches, out.playoffs.matches, m => m.id);
  return out;
}

function mergeList(base, local, remote, mergeOne) {
  const B = byId(base), L = byId(local), R = byId(remote);
  const out = [];
  const ids = [...new Set([...(remote || []).map(x => x.id), ...(local || []).map(x => x.id)])];
  ids.forEach(id => {
    const b = B.get(id), l = L.get(id), r = R.get(id);
    if (!l) { if (r && b && !same(r, b)) out.push(clone(r)); else if (r && !b) out.push(clone(r)); return; } // we deleted it (unless it changed since)
    if (!r) { if (!b) out.push(clone(l)); return; } // new here, or deleted on the server
    if (same(l, b)) out.push(clone(r));
    else if (same(r, b)) out.push(clone(l));
    else out.push(mergeOne(b, l, r));
  });
  return out;
}

function mergeChat(b, l, r) {
  const out = clone(r);
  const seen = new Set((out.messages || []).map(m => m.id));
  (l.messages || []).forEach(m => { if (!seen.has(m.id)) out.messages.push(clone(m)); });
  out.messages.sort((x, y) => (x.ts || 0) - (y.ts || 0));
  return out;
}

export function threeWayMerge(base, local, remote) {
  const b = base || {};
  return {
    ...clone(remote),
    events: mergeList(b.events, local.events, remote.events, mergeEvent),
    players: mergeList(b.players, local.players, remote.players, (bb, l) => clone(l)),
    chats: mergeList(b.chats, local.chats || [], remote.chats || [], mergeChat),
    history: same(local.history, b.history) ? clone(remote.history) : clone(local.history),
    flagThreshold: same(local.flagThreshold, b.flagThreshold) ? remote.flagThreshold : local.flagThreshold,
    currentEventId: local.currentEventId,
  };
}
