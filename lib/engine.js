/* ===================== ENGINE =====================
   Pure scheduling/booking logic, ported from the original The Pickle Slot
   single-file web app (same data shapes). Matchmaking has since been
   reworked to keep long events varied and share sitting out fairly — see
   the scheduling engine section and test/engine.test.mjs. Nothing here
   touches state directly except where the original did (assignRound reads
   the players list passed in) — kept framework-agnostic on purpose so it's
   trivially testable and reusable across web/iOS/Android. */

export const GAME_LEN = 15;
export function gameLen(ev) { return (ev && ev.gameLenMin) || GAME_LEN; }
/* A segment can override the event's game length; unset means inherit. */
export function segmentGameLen(ev, seg) { return (seg && seg.gameLenMin) || gameLen(ev); }

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
/* When an event starts and ends, as Dates in the phone's own timezone.
   (An event's date and start time are the local wall-clock time it's
   played at.) Late events can end after midnight — the end date rolls
   over with them. */
export function eventStartsAt(ev) {
  const [y, mo, d] = String(ev.date || '').split('-').map(Number);
  const [h, mi] = String(ev.startTime || '00:00').split(':').map(Number);
  return new Date(y, (mo || 1) - 1, d || 1, h || 0, mi || 0);
}
export function eventEndsAt(ev) {
  const start = eventStartsAt(ev);
  return new Date(start.getTime() + (Number(ev.durationMin) || 0) * 60000);
}
/* Past once it has finished — tonight's game moves to Past events when
   it ends, not at midnight. */
export function isPastEvent(ev, now = new Date()) {
  return eventEndsAt(ev).getTime() <= now.getTime();
}
/* Upcoming soonest first; past most recent first. */
export function splitEventsByTime(events, now = new Date()) {
  const upcoming = [], past = [];
  events.forEach(ev => (isPastEvent(ev, now) ? past : upcoming).push(ev));
  upcoming.sort((a, b) => eventStartsAt(a) - eventStartsAt(b));
  past.sort((a, b) => eventStartsAt(b) - eventStartsAt(a));
  return { upcoming, past };
}
export function fmtClock(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  let hh = h % 12; if (hh === 0) hh = 12;
  return hh + (m ? ':' + String(m).padStart(2, '0') : '') + ap;
}
/* A full-day list of picker options (independent of any event), used for
   choosing an event's own start time — always in 15-min steps regardless of
   the event's own round length, since that's a separate concern. */
export function dayTimeOptions(stepMin = 15) {
  const opts = [];
  for (let total = 0; total < 24 * 60; total += stepMin) {
    const clock = String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
    opts.push({ value: clock, label: fmtClock(clock) });
  }
  return opts;
}
export function timeOptions(ev, selectedOffset) {
  const step = gameLen(ev);
  const numSteps = Math.round(ev.durationMin / step);
  const opts = [];
  for (let i = 0; i <= numSteps; i++) {
    const off = i * step;
    opts.push({ offset: off, clock: offsetToClock(ev, off), label: fmtClock(offsetToClock(ev, off)), selected: off === selectedOffset });
  }
  return opts;
}

/* The event's rounds as [{ offset, len }], laid out segment by segment
   with each segment's own game length. A segment's last round is cut short
   if its game length doesn't divide the segment evenly, so rounds never
   spill into the next segment (or past the end of the event). */
export function roundSlots(ev) {
  const segs = ev.segments && ev.segments.length ? ev.segments : [null];
  const slots = [];
  segs.forEach((seg, i) => {
    const start = seg ? toOffset(ev, seg.start) : 0;
    const end = !seg || i === segs.length - 1 ? ev.durationMin : toOffset(ev, seg.end);
    const len = segmentGameLen(ev, seg);
    for (let off = start; off < end; off += len) slots.push({ offset: off, len: Math.min(len, end - off) });
  });
  return slots.length ? slots : [{ offset: 0, len: gameLen(ev) }];
}
export function roundLenAt(ev, offset) {
  const slot = roundSlots(ev).find(s => s.offset === offset);
  return slot ? slot.len : gameLen(ev);
}
/* Picker options on round boundaries (every round start, plus the event
   end) — for partial-RSVP windows, which must line up with real rounds. */
export function roundTimeOptions(ev, selectedOffset) {
  const offsets = roundSlots(ev).map(s => s.offset).concat(ev.durationMin);
  if (selectedOffset != null && !offsets.includes(selectedOffset)) offsets.push(selectedOffset);
  return offsets.sort((a, b) => a - b).map(off => ({
    offset: off, clock: offsetToClock(ev, off), label: fmtClock(offsetToClock(ev, off)), selected: off === selectedOffset,
  }));
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
/* How undesirable a game is — lower is better. It counts how OFTEN people
   have already partnered or faced each other, not just whether they have:
   scoring only "never met" pairs made every option tie at zero once a small
   group had all met (about 2 hours in with 8 players), and the first
   option — the same game — then won every remaining round.
   A repeat partner costs more than a repeat opponent, and repeating last
   round's partner or opponent costs extra, so back-to-back games differ. */
const COST = { partner: 10, opponent: 1, lastPartner: 40, lastOpponent: 4 };
/* Tries every group of four in the pool and every way to split it into two
   teams, and returns the cheapest ({ group, teamA, teamB, cost }), or null
   if no group has a valid split. The per-pair costs are worked out once up
   front so the search itself (thousands of groups for a big pool) is only
   array lookups — this runs on the phone, once per court per round. */
function pickBestGroup(hist, pool, recent, isValidTeam) {
  const n = pool.length;
  const last = (recent && recent.lastRound) || { partners: new Set(), opponents: new Set() };
  const P = new Float64Array(n * n); // cost of i and j as partners (Infinity: not allowed)
  const O = new Float64Array(n * n); // cost of i and j as opponents
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const a = pool[i], b = pool[j], key = pairKey(a, b), h = getHist(hist, a, b);
    const p = isValidTeam && !isValidTeam([a, b]) ? Infinity
      : COST.partner * h.partner + (last.partners.has(key) ? COST.lastPartner : 0);
    const o = COST.opponent * h.opponent + (last.opponents.has(key) ? COST.lastOpponent : 0);
    P[i * n + j] = P[j * n + i] = p;
    O[i * n + j] = O[j * n + i] = o;
  }
  // Teams (w,x) v (y,z): both partner costs plus the four opponent costs.
  const cost = (w, x, y, z) => P[w * n + x] + P[y * n + z] + O[w * n + y] + O[w * n + z] + O[x * n + y] + O[x * n + z];
  let best = null, bestCost = Infinity;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
    const c1 = cost(i, j, k, l), c2 = cost(i, k, j, l), c3 = cost(i, l, j, k);
    const c = Math.min(c1, c2, c3);
    if (c < bestCost) {
      bestCost = c;
      best = c === c1 ? [i, j, k, l] : c === c2 ? [i, k, j, l] : [i, l, j, k];
    }
  }
  if (!best) return null;
  const [w, x, y, z] = best.map(i => pool[i]);
  return { group: [w, x, y, z], teamA: [w, x], teamB: [y, z], cost: bestCost };
}
function pickBestGroupGeneral(hist, pool, recent) {
  return pickBestGroup(hist, pool, recent);
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
/* Picks the best 4-player mixed group from a pool that may include Male,
   Female, and Other players together. A group only counts if it has at
   least one valid mixed split — e.g. 3 Male + 1 Other has no valid split
   and is correctly rejected. */
function pickBestGroupMixedFlexible(hist, pool, byId, recent) {
  return pickBestGroup(hist, pool, recent, team => isValidMixedTeam(byId, team));
}
export function playersAvailableAt(event, offset, idList) {
  const step = roundLenAt(event, offset);
  return idList.filter(id => {
    const r = event.rsvps[id];
    if (!r || (r.status !== 'in' && r.status !== 'partial')) return false;
    return offset >= r.start && (offset + step) <= r.end;
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
/* recent (optional, from generateRoster): { lastRound: { partners,
   opponents, sitOut } as Sets, sitOuts: { [playerId]: rounds sat out so
   far } }. Used to vary games round to round and to share sitting out. */
export function assignRound(event, offset, pool, hist, players, recent) {
  const modesMap = getSegmentModes(event, offset);
  /* Courts on "break" this segment are excluded entirely — never assigned
     players — rather than just deprioritized, so capacity planning (which
     courts are actually usable) accounts for them up front. */
  const availableCourts = [];
  for (let c = 1; c <= event.courts; c++) {
    if ((modesMap[c] || 'open') !== 'break') availableCourts.push(c);
  }
  const byId = id => players.find(p => p.id === id);
  /* When not everyone can play this round, decide who sits out first, and
     fairly: whoever sat out last round plays, then whoever has sat out
     most so far. Leaving it to the leftovers of game-picking made the same
     people sit out round after round. The courts in use still get the
     players their type needs (4 women for a women's court, 2 men and 2
     women for mixed) before anyone else is chosen, as far as the pool
     allows — otherwise fairness could empty a women's court. */
  let benched = [];
  const playing = Math.min(availableCourts.length * 4, pool.length - (pool.length % 4));
  if (recent && pool.length > playing) {
    const satLast = id => (recent.lastRound && recent.lastRound.sitOut.has(id) ? 1 : 0);
    const satCount = id => (recent.sitOuts && recent.sitOuts[id]) || 0;
    const ranked = pool
      .map((id, i) => ({ id, i }))
      .sort((a, b) => satLast(b.id) - satLast(a.id) || satCount(b.id) - satCount(a.id) || a.i - b.i)
      .map(x => x.id);
    const genderOf = id => (byId(id) ? byId(id).gender : 'O');
    const need = { M: 0, F: 0 };
    availableCourts.slice(0, playing / 4).forEach(c => {
      const mode = modesMap[c] || 'open';
      if (mode === 'men') need.M += 4;
      else if (mode === 'women') need.F += 4;
      else if (mode === 'mixed') { need.M += 2; need.F += 2; }
    });
    const chosen = [];
    ['M', 'F'].forEach(g => chosen.push(...ranked.filter(id => genderOf(id) === g).slice(0, need[g])));
    ranked.forEach(id => { if (chosen.length < playing && !chosen.includes(id)) chosen.push(id); });
    benched = ranked.filter(id => !chosen.includes(id));
    pool = pool.filter(id => chosen.includes(id));
  }
  const courtsNeeded = Math.min(Math.ceil(pool.length / 4), availableCourts.length);
  let remainingMen = pool.filter(id => byId(id) && byId(id).gender === 'M');
  let remainingWomen = pool.filter(id => byId(id) && byId(id).gender === 'F');
  let remainingOther = pool.filter(id => { const p = byId(id); return p && p.gender !== 'M' && p.gender !== 'F'; });

  const courtOrder = [];
  for (let i = 0; i < courtsNeeded; i++) {
    const c = availableCourts[i];
    courtOrder.push({ court: c, mode: modesMap[c] || 'open' });
  }
  const priority = { mixed: 0, men: 1, women: 2, open: 3 };
  const processOrder = [...courtOrder].sort((a, b) => priority[a.mode] - priority[b.mode]);

  const results = []; const openQueue = [];
  processOrder.forEach(entry => {
    if (entry.mode === 'mixed') {
      const mixedPool = [...remainingMen, ...remainingWomen, ...remainingOther];
      const pick = mixedPool.length >= 4 ? pickBestGroupMixedFlexible(hist, mixedPool, byId, recent) : null;
      if (pick) {
        remainingMen = remainingMen.filter(id => !pick.group.includes(id));
        remainingWomen = remainingWomen.filter(id => !pick.group.includes(id));
        remainingOther = remainingOther.filter(id => !pick.group.includes(id));
        results.push({ court: entry.court, mode: 'mixed', flagged: false, teamA: pick.teamA, teamB: pick.teamB, scoreA: null, scoreB: null });
      } else openQueue.push(entry.court);
    } else if (entry.mode === 'men') {
      if (remainingMen.length >= 4) {
        const pick = pickBestGroupGeneral(hist, remainingMen, recent);
        remainingMen = remainingMen.filter(id => !pick.group.includes(id));
        results.push({ court: entry.court, mode: 'men', flagged: false, teamA: pick.teamA, teamB: pick.teamB, scoreA: null, scoreB: null });
      } else openQueue.push(entry.court);
    } else if (entry.mode === 'women') {
      if (remainingWomen.length >= 4) {
        const pick = pickBestGroupGeneral(hist, remainingWomen, recent);
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
    const pick = pickBestGroupGeneral(hist, openPool, recent);
    openPool = openPool.filter(id => !pick.group.includes(id));
    const originalMode = courtOrder.find(c => c.court === courtNum).mode;
    results.push({ court: courtNum, mode: 'open', flagged: originalMode !== 'open', teamA: pick.teamA, teamB: pick.teamB, scoreA: null, scoreB: null });
  });

  results.sort((a, b) => a.court - b.court);
  return { results, sitOut: [...openPool, ...benched] };
}
export function generateRoster(event, globalHist, fromRoundIndex, players) {
  const { confirmed, waitlist } = getConfirmedAndWaitlist(event, players);
  const workingHist = JSON.parse(JSON.stringify(globalHist));
  const rounds = [];
  // Rounds before fromRoundIndex are kept exactly as they happened; new
  // rounds pick up at the first round slot after the last kept one ends.
  const kept = (event.roster || []).slice(0, fromRoundIndex);
  kept.forEach(r => { applyRoundHistory(workingHist, r, 1); rounds.push(r); });
  const lastKept = kept[kept.length - 1];
  const resumeAt = lastKept ? lastKept.offset + (lastKept.len || gameLen(event)) : 0;
  roundSlots(event).filter(s => s.offset >= resumeAt).forEach(({ offset, len }) => {
    const pool = getRoundPool(event, offset, confirmed, waitlist);
    const round = (rounds.length === 1 && repeatWarmup(event, rounds[0], offset, len, pool))
      || (() => {
        const { results, sitOut } = assignRound(event, offset, pool, workingHist, players, recentContext(rounds));
        return { offset, len, courts: results, sitOut, played: false };
      })();
    applyRoundHistory(workingHist, round, 1);
    rounds.push(round);
  });
  return rounds;
}
/* What assignRound needs to know about this event's rounds so far: who
   partnered, faced each other and sat out last round, and how many rounds
   each player has sat out. */
function recentContext(rounds) {
  const last = rounds[rounds.length - 1];
  const lastRound = { partners: new Set(), opponents: new Set(), sitOut: new Set(last ? last.sitOut || [] : []) };
  (last ? last.courts || [] : []).forEach(c => {
    if (!c.teamA || !c.teamB) return;
    lastRound.partners.add(pairKey(c.teamA[0], c.teamA[1]));
    lastRound.partners.add(pairKey(c.teamB[0], c.teamB[1]));
    c.teamA.forEach(p1 => c.teamB.forEach(p2 => lastRound.opponents.add(pairKey(p1, p2))));
  });
  const sitOuts = {};
  rounds.forEach(r => (r.sitOut || []).forEach(id => { sitOuts[id] = (sitOuts[id] || 0) + 1; }));
  return { lastRound, sitOuts };
}
/* Unless the event opts into switching (event.switchAfterWarmup), the round
   right after the warm-up keeps the warm-up's exact games — same courts,
   same partners, same opponents — so people play "for real" with who they
   warmed up with. Only possible when everyone from the warm-up is still
   available then; otherwise that round is generated normally. */
export function repeatWarmup(event, warmup, offset, len, pool) {
  if (event.switchAfterWarmup || !warmup || !warmup.courts.length) return null;
  const playing = warmup.courts.flatMap(c => [...c.teamA, ...c.teamB]);
  if (!playing.every(id => pool.includes(id))) return null;
  return {
    offset, len, played: false, repeatsWarmup: true,
    courts: warmup.courts.map(c => ({ ...c, teamA: [...c.teamA], teamB: [...c.teamB], scoreA: null, scoreB: null })),
    sitOut: pool.filter(id => !playing.includes(id)),
  };
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
function chunkRange(startOffset, endOffset, courtNum, slots) {
  let remaining = endOffset - startOffset, curStart = startOffset;
  while (remaining > 0) {
    const block = Math.min(120, remaining);
    slots.push({ id: uid(), court: courtNum, start: curStart, end: curStart + block, status: 'open', claimedBy: null });
    curStart += block; remaining -= block;
  }
}
export function computeBookingPlan(event, players) {
  const { confirmed, waitlist } = getConfirmedAndWaitlist(event, players);
  const rounds = roundSlots(event);
  const req = rounds.map(r => Math.ceil(getRoundPool(event, r.offset, confirmed, waitlist).length / 4));
  const maxCourts = Math.max(0, ...req);
  const slots = [];
  for (let c = 1; c <= maxCourts; c++) {
    let start = null;
    for (let i = 0; i <= rounds.length; i++) {
      const active = i < rounds.length && req[i] >= c;
      if (active && start === null) start = i;
      if (!active && start !== null) {
        chunkRange(rounds[start].offset, rounds[i - 1].offset + rounds[i - 1].len, c, slots);
        start = null;
      }
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
  const segSig = (ev.segments || []).map(s => `${s.start}-${s.end}:${segmentGameLen(ev, s)}`).join('|');
  return JSON.stringify({ courts: ev.courts, durationMin: ev.durationMin, gameLenMin: gameLen(ev), segSig, rsvpSig });
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
