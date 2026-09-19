/* ===================== ENGINE =====================
   Pure scheduling/booking logic, ported verbatim (same shapes, same
   behavior) from the original Courtside single-file web app. Nothing here
   touches state directly except where the original did (assignRound reads
   the players list passed in) — kept framework-agnostic on purpose so it's
   trivially testable and reusable across web/iOS/Android. */

export const GAME_LEN = 15;

export function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/* ===================== TIME HELPERS ===================== */
export function toOffset(event, hhmm) {
  const [eh, em] = event.startTime.split(':').map(Number);
  const [h, m] = hhmm.split(':').map(Number);
  let diff = (h * 60 + m) - (eh * 60 + em);
  if (diff < 0) diff += 24 * 60;
  return diff;
}
export function offsetToClock(event, offset) {
  const [eh, em] = event.startTime.split(':').map(Number);
  let total = (eh * 60 + em + offset) % (24 * 60);
  const h = Math.floor(total / 60), m = total % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
export function fmtClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  let hh = h % 12; if (hh === 0) hh = 12;
  return hh + (m ? ':' + String(m).padStart(2, '0') : '') + ap;
}
export function timeOptions(ev, selectedOffset) {
  const numSteps = Math.round(ev.durationMin / GAME_LEN);
  const opts = [];
  for (let i = 0; i <= numSteps; i++) {
    const off = i * GAME_LEN;
    opts.push({ offset: off, clock: offsetToClock(ev, off), label: fmtClock(offsetToClock(ev, off)), selected: off === selectedOffset });
  }
  return opts;
}

/* ===================== GENDER DISPLAY HELPERS ===================== */
export function genderLabel(g) { return g === 'M' ? 'Male' : g === 'F' ? 'Female' : 'Other'; }
export function genderInitial(g) { return g === 'M' ? 'M' : g === 'F' ? 'F' : 'O'; }

/* ===================== PAIRING HISTORY ===================== */
export function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
export function getHist(hist, a, b) { const k = pairKey(a, b); return hist[k] || { partner: 0, opponent: 0 }; }
export function bumpHist(hist, a, b, field, delta) {
  const k = pairKey(a, b);
  if (!hist[k]) hist[k] = { partner: 0, opponent: 0 };
  hist[k][field] += delta;
  if (hist[k][field] < 0) hist[k][field] = 0;
}
export function applyRoundHistory(hist, round, sign) {
  (round.courts || []).forEach(c => {
    if (!c.teamA || !c.teamB) return;
    bumpHist(hist, c.teamA[0], c.teamA[1], 'partner', sign);
    bumpHist(hist, c.teamB[0], c.teamB[1], 'partner', sign);
    c.teamA.forEach(p1 => c.teamB.forEach(p2 => bumpHist(hist, p1, p2, 'opponent', sign)));
  });
}

/* ===================== SCHEDULING ENGINE ===================== */
function scoreSplit(hist, teamA, teamB) {
  let score = 0;
  if (getHist(hist, teamA[0], teamA[1]).partner === 0) score += 2;
  if (getHist(hist, teamB[0], teamB[1]).partner === 0) score += 2;
  teamA.forEach(p1 => teamB.forEach(p2 => { if (getHist(hist, p1, p2).opponent === 0) score += 1; }));
  return score;
}
function bestSplitGeneral(hist, four) {
  const [a, b, c, d] = four;
  const options = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
  let best = null, bestScore = -1;
  options.forEach(([teamA, teamB]) => { const s = scoreSplit(hist, teamA, teamB); if (s > bestScore) { bestScore = s; best = { teamA, teamB }; } });
  return { ...best, score: bestScore };
}
function pickBestGroupGeneral(hist, pool) {
  let bestScore = -1, bestGroup = null, bestSplit = null;
  const n = pool.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
    const four = [pool[i], pool[j], pool[k], pool[l]];
    const sp = bestSplitGeneral(hist, four);
    if (sp.score > bestScore) { bestScore = sp.score; bestGroup = four; bestSplit = sp; }
  }
  return { group: bestGroup, teamA: bestSplit.teamA, teamB: bestSplit.teamB };
}
/* A team of 2 is valid for "mixed" as long as it isn't two players who are
   both specifically Male or both specifically Female. Other-gender players
   have no fixed-gender pairing restriction, so O+M, O+F, and O+O are all
   fine — this is what lets Other players fill mixed courts. */
function isValidMixedTeam(byId, team) {
  const g0 = byId(team[0]) ? byId(team[0]).gender : null;
  const g1 = byId(team[1]) ? byId(team[1]).gender : null;
  if (g0 === 'M' && g1 === 'M') return false;
  if (g0 === 'F' && g1 === 'F') return false;
  return true;
}
function bestSplitMixedFlexible(hist, four, byId) {
  const [a, b, c, d] = four;
  const options = [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]];
  let best = null, bestScore = -1;
  options.forEach(([teamA, teamB]) => {
    if (!isValidMixedTeam(byId, teamA) || !isValidMixedTeam(byId, teamB)) return;
    const s = scoreSplit(hist, teamA, teamB);
    if (s > bestScore) { bestScore = s; best = { teamA, teamB }; }
  });
  if (!best) return null;
  return { ...best, score: bestScore };
}
/* Picks the best 4-player mixed group from a pool that may include Male,
   Female, and Other players together. A group only counts if it has at
   least one valid mixed split — e.g. 3 Male + 1 Other has no valid split
   and is correctly rejected. */
function pickBestGroupMixedFlexible(hist, pool, byId) {
  let bestScore = -1, bestGroup = null, bestSplit = null;
  const n = pool.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
    const four = [pool[i], pool[j], pool[k], pool[l]];
    const sp = bestSplitMixedFlexible(hist, four, byId);
    if (sp && sp.score > bestScore) { bestScore = sp.score; bestGroup = four; bestSplit = sp; }
  }
  if (!bestGroup) return null;
  return { group: bestGroup, teamA: bestSplit.teamA, teamB: bestSplit.teamB };
}
export function playersAvailableAt(event, offset, idList) {
  return idList.filter(id => {
    const r = event.rsvps[id];
    if (!r || (r.status !== 'in' && r.status !== 'partial')) return false;
    return offset >= r.start && (offset + GAME_LEN) <= r.end;
  });
}
export function ensureMembers(ev, players) {
  if (!ev.memberIds) ev.memberIds = players.map(p => p.id);
}
export function getConfirmedAndWaitlist(event, players) {
  ensureMembers(event, players);
  const memberSet = new Set(event.memberIds);
  const entries = Object.entries(event.rsvps || {})
    .filter(([id, r]) => memberSet.has(id) && (r.status === 'in' || r.status === 'partial'))
    .sort((a, b) => a[1].ts - b[1].ts);
  const capacity = event.courts * 4;
  return { confirmed: entries.slice(0, capacity).map(e => e[0]), waitlist: entries.slice(capacity).map(e => e[0]) };
}
/* The pool of players actually on court for one 15-min round. Regular
   (confirmed) players who are available at this offset go first; if that
   leaves empty capacity, the gap is filled from the waitlist, FIFO, up to
   the court capacity already being paid for. */
export function getRoundPool(event, offset, confirmed, waitlist) {
  const availableConfirmed = playersAvailableAt(event, offset, confirmed);
  const capacity = event.courts * 4;
  if (availableConfirmed.length >= capacity) return availableConfirmed;
  const need = capacity - availableConfirmed.length;
  const availableWaitlist = playersAvailableAt(event, offset, waitlist);
  const pulled = availableWaitlist.slice(0, need);
  return [...availableConfirmed, ...pulled];
}
export function getSegmentModes(event, offset) {
  const segs = event.segments || [];
  const seg = segs.find(s => {
    const st = toOffset(event, s.start), en = toOffset(event, s.end);
    return offset >= st && offset < en;
  });
  return seg ? (seg.modes || {}) : {};
}
export function assignRound(event, offset, pool, hist, players) {
  const modesMap = getSegmentModes(event, offset);
  const courtsNeeded = Math.min(Math.ceil(pool.length / 4), event.courts);
  const byId = id => players.find(p => p.id === id);
  let remainingMen = pool.filter(id => byId(id) && byId(id).gender === 'M');
  let remainingWomen = pool.filter(id => byId(id) && byId(id).gender === 'F');
  let remainingOther = pool.filter(id => { const p = byId(id); return p && p.gender !== 'M' && p.gender !== 'F'; });

  const courtOrder = [];
  for (let c = 1; c <= courtsNeeded; c++) courtOrder.push({ court: c, mode: modesMap[c] || 'open' });
  const priority = { mixed: 0, men: 1, women: 2, open: 3 };
  const processOrder = [...courtOrder].sort((a, b) => priority[a.mode] - priority[b.mode]);

  const results = []; const openQueue = [];
  processOrder.forEach(entry => {
    if (entry.mode === 'mixed') {
      const mixedPool = [...remainingMen, ...remainingWomen, ...remainingOther];
      const pick = mixedPool.length >= 4 ? pickBestGroupMixedFlexible(hist, mixedPool, byId) : null;
      if (pick) {
        remainingMen = remainingMen.filter(id => !pick.group.includes(id));
        remainingWomen = remainingWomen.filter(id => !pick.group.includes(id));
        remainingOther = remainingOther.filter(id => !pick.group.includes(id));
        results.push({ court: entry.court, mode: 'mixed', flagged: false, teamA: pick.teamA, teamB: pick.teamB, scoreA: null, scoreB: null });
      } else openQueue.push(entry.court);
    } else if (entry.mode === 'men') {
      if (remainingMen.length >= 4) {
        const pick = pickBestGroupGeneral(hist, remainingMen);
        remainingMen = remainingMen.filter(id => !pick.group.includes(id));
        results.push({ court: entry.court, mode: 'men', flagged: false, teamA: pick.teamA, teamB: pick.teamB, scoreA: null, scoreB: null });
      } else openQueue.push(entry.court);
    } else if (entry.mode === 'women') {
      if (remainingWomen.length >= 4) {
        const pick = pickBestGroupGeneral(hist, remainingWomen);
        remainingWomen = remainingWomen.filter(id => !pick.group.includes(id));
        results.push({ court: entry.court, mode: 'women', flagged: false, teamA: pick.teamA, teamB: pick.teamB, scoreA: null, scoreB: null });
      } else openQueue.push(entry.court);
    } else {
      openQueue.push(entry.court);
    }
  });

  let openPool = [...remainingMen, ...remainingWomen, ...remainingOther];
  openQueue.sort((a, b) => a - b).forEach(courtNum => {
    if (openPool.length < 4) return;
    const pick = pickBestGroupGeneral(hist, openPool);
    openPool = openPool.filter(id => !pick.group.includes(id));
    const originalMode = courtOrder.find(c => c.court === courtNum).mode;
    results.push({ court: courtNum, mode: 'open', flagged: originalMode !== 'open', teamA: pick.teamA, teamB: pick.teamB, scoreA: null, scoreB: null });
  });

  results.sort((a, b) => a.court - b.court);
  return { results, sitOut: openPool };
}
export function generateRoster(event, globalHist, fromRoundIndex, players) {
  const { confirmed, waitlist } = getConfirmedAndWaitlist(event, players);
  const workingHist = JSON.parse(JSON.stringify(globalHist));
  const rounds = [];
  const numRounds = Math.max(1, Math.ceil(event.durationMin / GAME_LEN));
  for (let i = 0; i < numRounds; i++) {
    const offset = i * GAME_LEN;
    if (i < fromRoundIndex && event.roster && event.roster[i]) {
      const existing = event.roster[i];
      applyRoundHistory(workingHist, existing, 1);
      rounds.push(existing);
      continue;
    }
    const pool = getRoundPool(event, offset, confirmed, waitlist);
    const { results, sitOut } = assignRound(event, offset, pool, workingHist, players);
    const round = { offset, courts: results, sitOut, played: false };
    applyRoundHistory(workingHist, round, 1);
    rounds.push(round);
  }
  return rounds;
}
/* Reruns the generator for everything from the current round onward,
   undoing that stretch's old contribution to pairing history first. Rounds
   already played stay exactly as they happened. */
export function recomputeFromCurrentRound(ev, history, players) {
  const idx = ev.currentRoundIndex || 0;
  ev.roster.slice(idx).forEach(r => applyRoundHistory(history, r, -1));
  const newRounds = generateRoster(ev, history, idx, players);
  const merged = ev.roster.slice(0, idx).concat(newRounds.slice(idx));
  merged.slice(idx).forEach(r => applyRoundHistory(history, r, 1));
  ev.roster = merged;
}

/* ===================== BOOKING COORDINATION ===================== */
function chunkRange(startIdx, endIdx, courtNum, slots) {
  let remaining = (endIdx - startIdx) * GAME_LEN, curStart = startIdx * GAME_LEN;
  while (remaining > 0) {
    const block = Math.min(120, remaining);
    slots.push({ id: uid(), court: courtNum, start: curStart, end: curStart + block, status: 'open', claimedBy: null });
    curStart += block; remaining -= block;
  }
}
export function computeBookingPlan(event, players) {
  const { confirmed, waitlist } = getConfirmedAndWaitlist(event, players);
  const numRounds = Math.max(1, Math.ceil(event.durationMin / GAME_LEN));
  const req = [];
  for (let i = 0; i < numRounds; i++) {
    const pool = getRoundPool(event, i * GAME_LEN, confirmed, waitlist);
    req.push(Math.ceil(pool.length / 4));
  }
  const maxCourts = Math.max(0, ...req);
  const slots = [];
  for (let c = 1; c <= maxCourts; c++) {
    let start = null;
    for (let i = 0; i <= numRounds; i++) {
      const active = i < numRounds && req[i] >= c;
      if (active && start === null) start = i;
      if (!active && start !== null) { chunkRange(start, i, c, slots); start = null; }
    }
  }
  return slots;
}
export function bookingPlanSignature(ev) {
  const rsvpSig = Object.entries(ev.rsvps || {})
    .filter(([id, r]) => r.status === 'in' || r.status === 'partial')
    .sort((a, b) => a[1].ts - b[1].ts)
    .map(([id, r]) => `${id}:${r.start}-${r.end}`)
    .join(',');
  return JSON.stringify({ courts: ev.courts, durationMin: ev.durationMin, rsvpSig });
}
export function isBookingPlanStale(ev) {
  if (!ev.bookingSlots || ev.bookingSlots.length === 0) return false;
  return ev.bookingPlanBasis !== bookingPlanSignature(ev);
}
/* Recomputes the ideal plan and merges with what's already there: a slot
   already claimed/confirmed is kept whenever an identical slot is still
   needed. A no-longer-needed slot is only dropped if nobody had claimed it. */
export function reconcileBookingPlan(ev, players) {
  const ideal = computeBookingPlan(ev, players);
  const existing = ev.bookingSlots || [];
  const usedExistingIdx = new Set();
  const merged = ideal.map(idealSlot => {
    const matchIdx = existing.findIndex((s, idx) => !usedExistingIdx.has(idx) && s.court === idealSlot.court && s.start === idealSlot.start && s.end === idealSlot.end);
    if (matchIdx >= 0) { usedExistingIdx.add(matchIdx); return existing[matchIdx]; }
    return idealSlot;
  });
  const keptOrphans = existing.filter((s, idx) => !usedExistingIdx.has(idx) && s.status !== 'open');
  ev.bookingSlots = [...merged, ...keptOrphans];
  ev.bookingPlanBasis = bookingPlanSignature(ev);
}
