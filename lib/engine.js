/* ===================== ENGINE =====================
   Pure scheduling/booking logic, ported from the original The Pickle Slot
   single-file web app (same data shapes). Matchmaking has since been
   reworked to keep long events varied and share sitting out fairly — see
   the scheduling engine section and test/engine.test.mjs. Nothing here
   touches state directly except where the original did (assignRound reads
   the players list passed in) — kept framework-agnostic on purpose so it's
   trivially testable and reusable across web/iOS/Android. */

import { computeStandings } from './standings.js';

export const GAME_LEN = 15;
/* Event options — the settings that turn the one event into other formats
   (see lib/formats.js for the presets that fill them in). Every default is
   the original behaviour, so an event without options works exactly as
   before:
   - standings  'off' | 'winPct' | 'courtPoints'
   - seeding    'off' | 'dupr' | 'manual' (seedOrder: player ids, best first)
                — where the first round (or first set of groups) starts;
     reseed     true: every round is re-seeded from the standings so far
   - groups     'off' | 'fixed': groups of 4 stay together for 3 rounds and
                play every partner combination (pairs/singles: every opponent)
   - movement   'none' | 'game' (winners up a court, losers down, after every
                game) | 'set' (with groups: top 2 up, bottom 2 down after each
                group's 3 games)
   - partners   'rotating' | 'fixed' (pairs: [[a, b]]) | 'singles'
   - playoffs   'none' | 'single' | 'double'; playoffTeams 2|4|8; thirdPlace;
                playoffSeedFrom 'event' | 'season'
   - repeat     'none' | 'weekly' | 'ladder' (a series: see lib/series.js)
   - games      'scheduled' | 'none' (a clinic or lesson: RSVPs only)
   - extras     'waitlist' | 'rotate': players beyond the courts' capacity
                wait for a spot, or everyone plays and sits out in turns */
export const DEFAULT_OPTIONS = {
  format: 'popcorn', standings: 'off',
  seeding: 'off', seedOrder: [], reseed: false,
  groups: 'off', movement: 'none',
  partners: 'rotating', pairs: [],
  playoffs: 'none', playoffTeams: 4, thirdPlace: false, playoffSeedFrom: 'event',
  repeat: 'none', games: 'scheduled', extras: 'waitlist',
};
export function eventOptions(ev) {
  return { ...DEFAULT_OPTIONS, ...((ev && ev.options) || {}) };
}
/* Players per court: 2 for singles, 4 otherwise. */
export function perCourt(ev) { return eventOptions(ev).partners === 'singles' ? 2 : 4; }
/* How many confirmed players the event takes before waitlisting — no limit
   when extra players rotate in. */
export function playerCapacity(ev) {
  return eventOptions(ev).extras === 'rotate' ? Infinity : ev.courts * perCourt(ev);
}
/* Anything beyond rotating-partner variety goes through assignFormatRound. */
export function usesFormatEngine(ev) {
  const o = eventOptions(ev);
  return o.seeding !== 'off' || !!o.reseed || o.groups !== 'off' || o.movement !== 'none' || o.partners !== 'rotating';
}
/* Results decide the next round (re-seeding, movement): rounds after the
   one being played are provisional until its scores are in. */
export function resultsDriven(ev) {
  const o = eventOptions(ev);
  return !!o.reseed || o.movement !== 'none';
}
export function isFinishedGame(c) {
  return !!c && c.scoreA != null && c.scoreB != null && c.scoreA !== c.scoreB;
}

/* Every court is on break in this segment — no games at all. */
export function isBreakSegment(ev, s) {
  const modes = (s && s.modes) || {};
  for (let c = 1; c <= ev.courts; c++) if (modes[c] !== 'break') return false;
  return ev.courts > 0;
}
/* The event's segments with a break (every court on break) from startOff
   for `minutes`, carved out of whatever segments it overlaps: the parts
   before and after keep their segments' modes (and game lengths). A game
   piece left shorter than one game is folded into its neighbour rather
   than squeezed. Returns null for a break that doesn't fit. */
export function segmentsWithBreak(ev, startOff, minutes) {
  const end = Math.min(ev.durationMin, startOff + minutes);
  if (!(minutes >= 5) || startOff < 0 || end <= startOff) return null;
  const step = gameLen(ev);
  const segs = ev.segments && ev.segments.length ? ev.segments : [{ start: ev.startTime, end: offsetToClock(ev, ev.durationMin), modes: {} }];
  const breakModes = Object.fromEntries(Array.from({ length: ev.courts }, (_, i) => [i + 1, 'break']));
  const pieces = [];
  segs.forEach((s, i) => {
    const a = toOffset(ev, s.start);
    const b = i === segs.length - 1 ? ev.durationMin : toOffset(ev, s.end);
    const keep = (x, y) => { if (y > x) pieces.push({ a: x, b: y, seg: s }); };
    keep(a, Math.min(b, startOff));
    keep(Math.max(a, end), b);
  });
  pieces.push({ a: startOff, b: end, isBreak: true });
  pieces.sort((p, q) => p.a - q.a);
  const isGame = p => p && !p.isBreak && !isBreakSegment(ev, p.seg);
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    if (!isGame(p) || p.b - p.a >= step) continue;
    if (isGame(pieces[i - 1]) && pieces[i - 1].b === p.a) { pieces[i - 1].b = p.b; pieces.splice(i--, 1); }
    else if (isGame(pieces[i + 1]) && pieces[i + 1].a === p.b) { pieces[i + 1].a = p.a; pieces.splice(i--, 1); }
  }
  return pieces.map(p => (p.isBreak
    ? { start: offsetToClock(ev, p.a), end: offsetToClock(ev, p.b), modes: { ...breakModes } }
    : { ...p.seg, modes: { ...(p.seg.modes || {}) }, start: offsetToClock(ev, p.a), end: offsetToClock(ev, p.b) }));
}
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
/* Today's date (YYYY-MM-DD) on the phone's own calendar. Not
   toISOString(), which gives the UTC date — in the evening in the
   Americas that's already tomorrow. */
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
/* 'draft' until published; a published event becomes 'completed' once it
   has ended on the phone's clock (see isPastEvent). Derived, not stored,
   so it's always right for wherever the phone is. */
export function eventStatus(ev, now = new Date()) {
  if (!ev.published) return 'draft';
  return isPastEvent(ev, now) ? 'completed' : 'published';
}
export const STATUS_BADGE = {
  draft: { label: 'Draft', kind: 'wait' },
  published: { label: 'Published', kind: 'ok' },
  completed: { label: 'Completed', kind: 'done' },
};
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
/* Minutes from one "HH:MM" to the next; an end at or before the start is
   taken as the next day. */
export function minutesBetween(start, end) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const d = (eh * 60 + em) - (sh * 60 + sm);
  return d > 0 ? d : d + 24 * 60;
}
/* 150 → "2 hr 30 min". */
export function fmtDuration(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return [h ? `${h} hr` : '', m ? `${m} min` : ''].filter(Boolean).join(' ') || '0 min';
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
    // Singles have no partner.
    if (c.teamA.length === 2) bumpHist(hist, c.teamA[0], c.teamA[1], 'partner', sign);
    if (c.teamB.length === 2) bumpHist(hist, c.teamB[0], c.teamB[1], 'partner', sign);
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
  const capacity = playerCapacity(event);
  return { confirmed: entries.slice(0, capacity).map(e => e[0]), waitlist: entries.slice(capacity).map(e => e[0]) };
}
/* The pool of players actually on court for one 15-min round. Regular
   (confirmed) players who are available at this offset go first; if that
   leaves empty capacity, the gap is filled from the waitlist, FIFO, up to
   the court capacity already being paid for. */
export function getRoundPool(event, offset, confirmed, waitlist) {
  const availableConfirmed = playersAvailableAt(event, offset, confirmed);
  const capacity = playerCapacity(event);
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
  // Every court on break: no games, and nobody counts as sitting out.
  if (!availableCourts.length) return { results: [], sitOut: [] };
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
  if (eventOptions(event).games === 'none') return rounds; // a clinic: no games to schedule
  const formats = usesFormatEngine(event);
  const driven = resultsDriven(event);
  roundSlots(event).filter(s => s.offset >= resumeAt).forEach(({ offset, len }) => {
    const pool = getRoundPool(event, offset, confirmed, waitlist);
    let round;
    if (formats) {
      const { results, sitOut, groupSet } = assignFormatRound(event, offset, pool, workingHist, players, rounds);
      round = { offset, len, courts: results, sitOut, played: false };
      if (groupSet) round.groupSet = groupSet;
      // Decided by results not yet in: shown, but it will change.
      const prev = lastPlayedRound(rounds);
      if (driven && prev && results.length && !(groupSet && groupSet.n > 0) && prev.courts.some(c => !isFinishedGame(c))) round.provisional = true;
    } else {
      round = (rounds.length === 1 && repeatWarmup(event, rounds[0], offset, len, pool))
        || (() => {
          const { results, sitOut } = assignRound(event, offset, pool, workingHist, players, recentContext(rounds));
          return { offset, len, courts: results, sitOut, played: false };
        })();
    }
    applyRoundHistory(workingHist, round, 1);
    rounds.push(round);
  });
  return rounds;
}
function lastPlayedRound(rounds) {
  for (let i = rounds.length - 1; i >= 0; i--) if (rounds[i].courts && rounds[i].courts.length) return rounds[i];
  return null;
}

/* ===================== FORMAT ENGINE =====================
   Rounds for events with seeding, re-seeding, court groups, movement, fixed
   pairs or singles (see DEFAULT_OPTIONS). Everyone plays as "units": a player
   (rotating partners, singles) or a fixed pair. Each round:
   1. who plays — sitting out is shared fairly (sat out last round → plays;
      then most rounds sat out), ties going against the lowest-placed;
   2. the order units are placed on courts, court 1 being the top court:
      movement from the last game, else standings (re-seed), else seeding
      (first round or first set only), else variety (least-met opponents);
   3. the games on each court: seeded fours play 1&4 v 2&3; after movement,
      partners are split (least-played-together split); groups cycle through
      every partner (or opponent) combination over their 3 rounds.
   Court types: breaks are honoured; a mixed court gets a mixed split when
   the four allow one. Men's/women's courts only apply to plain rotating
   events (their players are picked by gender, which placement overrides). */
const SPLITS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
const unitKey = u => u.join('+');
const courtOf = (court, teamA, teamB, mode = 'open') => ({ court, mode, flagged: false, teamA, teamB, scoreA: null, scoreB: null });

/* The units that play from a pool: players, or the host's fixed pairs.
   Players without a complete pair keep the partner they last played with
   in this event (pairs formed on the day stay together); the rest are
   paired in RSVP order. An odd one out is a unit of one, which never plays
   (and so sits out). */
export function unitsFor(event, pool, rounds = []) {
  const o = eventOptions(event);
  if (o.partners !== 'fixed') return pool.map(id => [id]);
  const inPool = new Set(pool), used = new Set(), units = [];
  const take = p => {
    if (Array.isArray(p) && p.length === 2 && p[0] !== p[1] && p.every(id => inPool.has(id) && !used.has(id))) {
      units.push([p[0], p[1]]); used.add(p[0]); used.add(p[1]);
    }
  };
  (o.pairs || []).forEach(take);
  for (let i = rounds.length - 1; i >= 0; i--) (rounds[i].courts || []).forEach(c => { take(c.teamA); take(c.teamB); });
  const loose = pool.filter(id => !used.has(id));
  for (let i = 0; i + 1 < loose.length; i += 2) units.push([loose[i], loose[i + 1]]);
  if (loose.length % 2) units.push([loose[loose.length - 1]]);
  return units;
}
/* Stable sort by a list of numeric keys (lower first). */
function sortUnits(units, keys) {
  return units
    .map((u, i) => ({ u, i, k: keys.map(f => f(u)) }))
    .sort((a, b) => {
      for (let j = 0; j < a.k.length; j++) if (a.k[j] !== b.k[j]) return a.k[j] < b.k[j] ? -1 : 1;
      return a.i - b.i;
    })
    .map(x => x.u);
}
/* Seed position: best DUPR first (unrated last), or the host's order. */
function seedKey(o, players) {
  const byId = new Map(players.map(p => [p.id, p]));
  if (o.seeding === 'dupr') return u => {
    const r = u.map(id => byId.get(id) && Number(byId.get(id).dupr)).filter(n => Number.isFinite(n) && n > 0);
    return r.length ? -(r.reduce((a, b) => a + b, 0) / r.length) : Infinity;
  };
  if (o.seeding === 'manual') return u => {
    const idx = u.map(id => (o.seedOrder || []).indexOf(id)).filter(i => i >= 0);
    return idx.length ? Math.min(...idx) : Infinity;
  };
  return () => 0;
}
function hasResults(rounds) { return rounds.some(r => (r.courts || []).some(isFinishedGame)); }
/* Standings position so far (players without a finished game last). */
function standingsKey(rounds, o) {
  const rows = computeStandings({ roster: rounds, currentRoundIndex: rounds.length - 1 }, o.standings === 'courtPoints' ? 'courtPoints' : 'winPct');
  const pos = new Map(rows.map((r, i) => [r.id, i]));
  return u => Math.min(...u.map(id => (pos.has(id) ? pos.get(id) : Infinity)));
}
/* Where each player goes after the last game: the winners up a court, the
   losers down one (court 1's winners and the bottom court's losers stay).
   A game without a result keeps its four where they were. Arrivals from
   below sort ahead of those staying, who sort ahead of arrivals from above,
   so a court that ends up with too many pushes the latter on down. */
function movedKey(prev) {
  const courts = [...prev.courts].sort((a, b) => a.court - b.court);
  const K = courts.length;
  const done = courts.map(isFinishedGame);
  const where = new Map();
  const put = (ids, target, sub) => ids.forEach(id => where.set(id, target * 10 + sub));
  // Nobody moves into a court whose game has no result (it keeps its four),
  // so every court still ends up with four.
  courts.forEach((c, k) => {
    if (!done[k]) { put([...c.teamA, ...c.teamB], k, 5); return; }
    const [win, lose] = c.scoreA > c.scoreB ? [c.teamA, c.teamB] : [c.teamB, c.teamA];
    if (k > 0 && done[k - 1]) put(win, k - 1, 2); else put(win, k, 5);
    if (k < K - 1 && done[k + 1]) put(lose, k + 1, 8); else put(lose, k, 5);
  });
  return u => Math.min(...u.map(id => (where.has(id) ? where.get(id) : Infinity)));
}
/* The rounds of the most recent set of groups. */
function lastSetRounds(rounds) {
  const out = [];
  for (let i = rounds.length - 1; i >= 0; i--) {
    const r = rounds[i];
    if (!r.courts || !r.courts.length) continue;
    if (!r.groupSet) break;
    out.unshift(r);
    if (r.groupSet.n === 0) break;
  }
  return out;
}
/* After a set of groups: in each group the top 2 (by wins, then point
   difference, in that set) move up a group and the bottom 2 down. A group
   with no results stays together. */
function setMovedKey(setRounds, groups) {
  const tally = new Map();
  setRounds.forEach(r => r.courts.forEach(c => {
    if (!isFinishedGame(c)) return;
    [[c.teamA, c.scoreA - c.scoreB], [c.teamB, c.scoreB - c.scoreA]].forEach(([team, d]) => team.forEach(id => {
      const t = tally.get(id) || { w: 0, d: 0, g: 0 };
      t.g++; t.d += d; if (d > 0) t.w++;
      tally.set(id, t);
    }));
  }));
  const where = new Map();
  const G = groups.length;
  const score = u => tally.get(u[0]) || { w: 0, d: 0, g: 0 };
  const hasResults = groups.map(g => g.some(k => score(k.split('+')).g));
  groups.forEach((g, gi) => {
    const units = g.map(k => k.split('+'));
    if (!hasResults[gi]) { units.forEach(u => where.set(unitKey(u), gi * 10 + 5)); return; }
    const ranked = units.map((u, i) => ({ u, i })).sort((a, b) => score(b.u).w - score(a.u).w || score(b.u).d - score(a.u).d || a.i - b.i);
    ranked.forEach(({ u }, pos) => {
      // Up (top 2) or down (bottom 2) a group — but never into a group
      // with no results, which stays together. In a pool of 5 or more the
      // middle stays.
      const up = pos < 2, down = !up && pos >= units.length - 2;
      const key = up
        ? (gi > 0 && hasResults[gi - 1] ? (gi - 1) * 10 + 2 : gi * 10 + 5)
        : down ? (gi < G - 1 && hasResults[gi + 1] ? (gi + 1) * 10 + 8 : gi * 10 + 5) : gi * 10 + 5;
      where.set(unitKey(u), key + pos * 0.1);
    });
  });
  return u => (where.has(unitKey(u)) ? where.get(unitKey(u)) : Infinity);
}
/* Who plays, keeping the given order: fairness first (sat out last round,
   then most rounds sat out); on a tie the lowest-placed sits. */
function chooseUnits(ordered, count, recent) {
  if (ordered.length <= count) return ordered;
  const satLast = u => (u.some(id => recent.lastRound.sitOut.has(id)) ? 1 : 0);
  const satCount = u => Math.max(0, ...u.map(id => recent.sitOuts[id] || 0));
  const keep = new Set(ordered
    .map((u, i) => ({ u, i }))
    .sort((a, b) => satLast(b.u) - satLast(a.u) || satCount(b.u) - satCount(a.u) || a.i - b.i)
    .slice(0, count)
    .map(x => x.i));
  return ordered.filter((_, i) => keep.has(i));
}
function splitCost(hist, recent, a, b) {
  const last = recent.lastRound;
  const partner = (x, y) => COST.partner * getHist(hist, x, y).partner + (last.partners.has(pairKey(x, y)) ? COST.lastPartner : 0);
  const opp = (x, y) => COST.opponent * getHist(hist, x, y).opponent + (last.opponents.has(pairKey(x, y)) ? COST.lastOpponent : 0);
  return partner(a[0], a[1]) + partner(b[0], b[1]) + a.reduce((s, x) => s + b.reduce((t, y) => t + opp(x, y), 0), 0);
}
/* Two teams from four ranked players. Seeded: 1&4 v 2&3. Otherwise the
   split with the least history (so partners from last game are split). A
   mixed court prefers a mixed split. */
function splitFour(ids, seeded, mode, hist, recent, genderOf) {
  const options = SPLITS.map(([a, b]) => [[ids[a[0]], ids[a[1]]], [ids[b[0]], ids[b[1]]]]);
  const mixedOk = ([a, b]) => [a, b].every(t => !(genderOf(t[0]) === genderOf(t[1]) && (genderOf(t[0]) === 'M' || genderOf(t[0]) === 'F')));
  let order = seeded ? [options[2], options[1], options[0]]
    : [...options].sort((x, y) => splitCost(hist, recent, x[0], x[1]) - splitCost(hist, recent, y[0], y[1]));
  if (mode === 'mixed') {
    const ok = order.filter(mixedOk);
    if (ok.length) return { teams: ok[0], mode: 'mixed' };
    return { teams: order[0], mode: 'open', flagged: true };
  }
  return { teams: order[0], mode: 'open' };
}
/* Cheapest opponents among units (pairs or singles), least-met first. */
function pickMatch(hist, units, recent) {
  const last = recent.lastRound;
  const cost = (u, v) => u.reduce((s, x) => s + v.reduce((t, y) => t + COST.opponent * getHist(hist, x, y).opponent + (last.opponents.has(pairKey(x, y)) ? COST.lastOpponent : 0), 0), 0);
  let best = null, bestCost = Infinity;
  for (let i = 0; i < units.length; i++) for (let j = i + 1; j < units.length; j++) {
    const c = cost(units[i], units[j]);
    if (c < bestCost) { bestCost = c; best = [units[i], units[j]]; }
  }
  return best;
}
/* Groups of 4 units with the least history among them, greedily. */
function varietyGroups(hist, units, recent) {
  const groups = [];
  let rest = [...units];
  const pairCost = (x, y) => COST.partner * getHist(hist, x, y).partner + COST.opponent * getHist(hist, x, y).opponent;
  while (rest.length >= 4) {
    let best = null, bestCost = Infinity;
    const n = rest.length;
    if (n > 28) { best = rest.slice(0, 4); } else {
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) for (let l = k + 1; l < n; l++) {
        const g = [rest[i], rest[j], rest[k], rest[l]];
        let c = 0;
        for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) g[a].forEach(x => g[b].forEach(y => { c += pairCost(x, y); }));
        if (c < bestCost) { bestCost = c; best = g; }
      }
    }
    groups.push(best);
    rest = rest.filter(u => !best.includes(u));
  }
  return groups;
}
/* Pools of 4 pairs (or 4 singles players): each pool plays its 6 games,
   everyone once. Every round the courts are filled with games still to be
   played, those who have sat out most going first (a unit plays at most
   one game a round), so no court sits idle while a game could be played and
   everyone gets games even when the event is too short for every pool to
   finish. A set ends when every pool's games are played; seeded pools open
   with 1 v 4 and 2 v 3. groupSet: { n, pools, groups (= pools), done }. */
const POOL_GAMES = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
const POOL_GAMES_SEEDED = [[0, 3], [1, 2], [0, 2], [1, 3], [0, 1], [2, 3]];
/* Every game of a pool of s, in round-robin order (the circle method:
   1 v s, 2 v s−1 … first). */
function poolGames(s, seeded) {
  if (s === 4) return seeded ? POOL_GAMES_SEEDED : POOL_GAMES;
  const ids = Array.from({ length: s }, (_, i) => i);
  if (s % 2) ids.push(null);
  const m = ids.length, out = [];
  for (let r = 0; r < m - 1; r++) {
    for (let i = 0; i < m / 2; i++) {
      const a = ids[i], b = ids[m - 1 - i];
      if (a != null && b != null) out.push([Math.min(a, b), Math.max(a, b)]);
    }
    ids.splice(1, 0, ids.pop());
  }
  return out;
}
/* Everyone into pools: groups of 4 (by the given order, or least-met), the
   ones left over added one each to the smallest pools — so a pool has 4 to
   7 units and nobody waits outside a pool. */
function formPools(hist, units, recent, order) {
  if (units.length < 2) return [];
  if (units.length < 4) return [units];
  const k = Math.floor(units.length / 4);
  let pools;
  if (order) {
    const sizes = Array.from({ length: k }, (_, i) => Math.floor(order.length / k) + (i < order.length % k ? 1 : 0));
    let at = 0;
    pools = sizes.map(sz => { const p = order.slice(at, at + sz); at += sz; return p; });
  } else {
    pools = varietyGroups(hist, units, recent);
    const inPools = new Set(pools.flat());
    units.filter(u => !inPools.has(u)).forEach(u => pools.reduce((a, b) => (b.length < a.length ? b : a)).push(u));
  }
  return pools;
}
function poolRound({ o, units, courts, rounds, prev, hist, recent, seed, played }) {
  const have = new Map(units.map(u => [unitKey(u), u]));
  const gs = prev && prev.groupSet && prev.groupSet.pools ? prev.groupSet : null;
  const gameKey = (x, y) => [x, y].sort().join(' v ');
  const gamesOf = (pools, seeded) => pools.flatMap(p => poolGames(p.length, seeded).map(([i, j]) => [p[i], p[j]]));
  let pools, done, n, seeded;
  const left = gs ? gamesOf(gs.pools, gs.seeded).filter(([x, y]) => !gs.done.includes(gameKey(x, y))) : [];
  if (gs && left.length && gs.pools.every(p => p.every(k => have.has(k)))) {
    pools = gs.pools.map(p => [...p]); done = [...gs.done]; n = gs.n + 1; seeded = !!gs.seeded;
    if (o.movement !== 'set') {
      // Newcomers (late arrivals): a pool of their own once there are 4,
      // otherwise into the smallest pools — nobody waits for the set to end.
      const inPools = new Set(pools.flat());
      const free = units.filter(u => !inPools.has(unitKey(u)));
      const fresh = free.length >= 4 ? varietyGroups(hist, free, recent) : [];
      fresh.forEach(g => pools.push(g.map(unitKey)));
      const placed = new Set(fresh.flat().map(unitKey));
      const rest = free.filter(u => !placed.has(unitKey(u))).map(unitKey);
      const overflow = [];
      rest.forEach(k => {
        const smallest = pools.reduce((a, b) => (b.length < a.length ? b : a));
        if (smallest.length < 7) smallest.push(k); else overflow.push(k);
      });
      // Pools are 7 at most; anyone left over starts a pool of their own.
      if (overflow.length >= 2) pools.push(overflow);
    }
  } else {
    let order = null;
    if (o.movement === 'set' && gs) order = sortUnits(units, [setMovedKey(lastSetRounds(rounds), gs.pools), seed]);
    else if (o.reseed && hasResults(rounds)) order = sortUnits(units, [standingsKey(rounds, o), seed]);
    else if (o.seeding !== 'off' && (!rounds.some(r => r.groupSet) || o.reseed)) order = sortUnits(units, [seed]);
    seeded = !!order && o.movement !== 'set';
    pools = formPools(hist, units, recent, order).map(g => g.map(unitKey)); done = []; n = 0;
  }
  // How much a unit is owed a game: rounds sat out, then sat out last round.
  const need = k => Math.max(0, ...(have.get(k) || []).map(id => recent.sitOuts[id] || 0)) * 2
    + ((have.get(k) || []).some(id => recent.lastRound.sitOut.has(id)) ? 1 : 0);
  /* The games to choose from: pool games still to be played, and — for
     players owed a game whose pool can't give them one this round — extra
     games across pools (not part of the pools' round robins, never the same
     game twice in a set). Each is worth the squares of what its two units
     are owed, so the longest-waiting play first; an extra game gives way to
     an equal pool game. Courts are filled best first. */
  const worth = (x, y) => need(x) * need(x) + need(y) * need(y);
  const inPool = new Map(pools.flatMap((p, pi) => p.map(k => [k, pi])));
  const cands = gamesOf(pools, seeded).map(([x, y], i) => ({ x, y, i, w: worth(x, y) }))
    .filter(({ x, y }) => !done.includes(gameKey(x, y)));
  const keys = [...inPool.keys()];
  keys.forEach((x, i) => keys.slice(i + 1).forEach(y => {
    if (inPool.get(x) !== inPool.get(y) && need(x) >= 2 && need(y) >= 2 && !done.includes(gameKey(x, y))) {
      cands.push({ x, y, i: 1e6 + i, w: worth(x, y) - 0.5, extra: true });
    }
  }));
  cands.sort((p, q) => q.w - p.w || p.i - q.i);
  const busy = new Set();
  const results = [];
  cands.forEach(({ x, y, extra }) => {
    if (results.length >= courts.length || busy.has(x) || busy.has(y)) return;
    busy.add(x); busy.add(y);
    const c = courtOf(courts[results.length], have.get(x), have.get(y));
    results.push(extra ? { ...c, extra: true } : c);
    done.push(gameKey(x, y));
  });
  return {
    results, sitOut: played(results),
    groupSet: { n, pools, groups: pools, done, len: gamesOf(pools, seeded).length, ns: pools.map(() => n), ...(seeded ? { seeded: true } : {}) },
  };
}
export function assignFormatRound(event, offset, pool, hist, players, rounds) {
  const o = eventOptions(event);
  const modesMap = getSegmentModes(event, offset);
  const courts = [];
  for (let c = 1; c <= event.courts; c++) if ((modesMap[c] || 'open') !== 'break') courts.push(c);
  if (!courts.length) return { results: [], sitOut: [] };
  const byId = new Map(players.map(p => [p.id, p]));
  const genderOf = id => (byId.get(id) ? byId.get(id).gender : 'O');
  const recent = recentContext(rounds);
  const upc = o.partners === 'rotating' ? 4 : 2; // units per court
  const unitSize = o.partners === 'fixed' ? 2 : 1;
  const units = unitsFor(event, pool, rounds).filter(u => u.length === unitSize);
  const prev = lastPlayedRound(rounds);
  const seed = seedKey(o, players);
  const played = results => { const on = new Set(results.flatMap(c => [...c.teamA, ...c.teamB])); return pool.filter(id => !on.has(id)); };

  if (o.groups === 'fixed' && upc === 2) return poolRound({ o, units, courts, rounds, prev, hist, recent, seed, played });
  if (o.groups === 'fixed') {
    /* Groups of 4 players, one court each, for a 3-round set. Each group is
       at its own point in its set (ns) and keeps its court (gc) until the
       set ends. A group carries on while all four are here. With movement
       between groups the groups stay in step: when one can't carry on,
       everyone starts a new set. Otherwise groups that finish (or lose a
       player) are re-formed from whoever is free — so late arrivals and
       those sitting out get a free court as soon as there's one. */
    const setLen = 3;
    const maxGroups = Math.min(Math.floor(units.length / 4), courts.length);
    const have = new Map(units.map(u => [unitKey(u), u]));
    const gs = prev && prev.groupSet && !prev.groupSet.pools ? prev.groupSet : null;
    const prevNs = gs ? (gs.ns || gs.groups.map(() => gs.n)) : [];
    const prevSeeded = gs ? (gs.seededGroups || gs.groups.map(() => !!gs.seeded)) : [];
    const prevCourts = gs ? (gs.gc || []) : [];
    let entries = [];
    if (gs && (gs.len || 3) === setLen) {
      gs.groups.forEach((g, i) => {
        if (prevNs[i] < setLen - 1 && g.every(k => have.has(k))) entries.push({ g, n: prevNs[i] + 1, seeded: prevSeeded[i], court: prevCourts[i] });
      });
    }
    entries = entries.slice(0, maxGroups);
    const inStep = o.movement === 'set';
    if (inStep ? !(gs && entries.length === gs.groups.length && entries.length) : !entries.length) {
      let order = null;
      if (o.movement === 'set' && gs) order = sortUnits(units, [setMovedKey(lastSetRounds(rounds), gs.groups), seed]);
      else if (o.reseed && hasResults(rounds)) order = sortUnits(units, [standingsKey(rounds, o), seed]);
      else if (o.seeding !== 'off' && (!rounds.some(r => r.groupSet) || o.reseed)) order = sortUnits(units, [seed]);
      const seededSet = !!order && o.movement !== 'set';
      const chosen = chooseUnits(order || units, maxGroups * 4, recent);
      const formed = order
        ? Array.from({ length: maxGroups }, (_, g) => chosen.slice(g * 4, g * 4 + 4))
        : varietyGroups(hist, chosen, recent);
      entries = formed.map((g, gi) => ({ g: g.map(unitKey), n: 0, seeded: seededSet, court: courts[gi] }));
    } else if (!inStep && entries.length < maxGroups) {
      const busy = new Set(entries.flatMap(e => e.g));
      const free = units.filter(u => !busy.has(unitKey(u)));
      const room = Math.min(maxGroups - entries.length, Math.floor(free.length / 4));
      if (room > 0) {
        const chosen = chooseUnits(free, room * 4, recent);
        varietyGroups(hist, chosen, recent).slice(0, room).forEach(g => entries.push({ g: g.map(unitKey), n: 0, seeded: false }));
      }
    }
    // Courts: a group part-way through its set keeps its court.
    const taken = new Set();
    entries.forEach(e => { if (e.court && courts.includes(e.court) && !taken.has(e.court)) taken.add(e.court); else e.court = null; });
    entries.forEach(e => { if (!e.court) { e.court = courts.find(c => !taken.has(c)); taken.add(e.court); } });
    const results = entries.map(({ g, n, seeded, court }) => {
      // Seeded groups open with 1 & 4 v 2 & 3.
      const cycle = seeded ? [2, 1, 0] : [0, 1, 2];
      const ids = g.map(k => have.get(k)[0]);
      const [x, y] = SPLITS[cycle[n]];
      return courtOf(court, [ids[x[0]], ids[x[1]]], [ids[y[0]], ids[y[1]]]);
    });
    results.sort((p, q) => p.court - q.court);
    const ns = entries.map(e => e.n);
    return {
      results, sitOut: played(results),
      groupSet: { n: ns.length ? Math.min(...ns) : 0, ns, len: setLen, groups: entries.map(e => e.g), gc: entries.map(e => e.court), seededGroups: entries.map(e => !!e.seeded) },
    };
  }

  const count = Math.min(courts.length * upc, Math.floor(units.length / upc) * upc);
  let order = null, seeded = false;
  if (o.movement === 'game' && prev) order = sortUnits(units, [movedKey(prev), seed]);
  else if (o.reseed && hasResults(rounds)) { order = sortUnits(units, [standingsKey(rounds, o), seed]); seeded = true; }
  else if (o.seeding !== 'off' && (!prev || o.reseed)) { order = sortUnits(units, [seed]); seeded = true; }

  if (!order && upc === 4) {
    // Plain variety with rotating partners: the original matchmaking.
    return assignRound(event, offset, pool, hist, players, recent);
  }
  const chosen = chooseUnits(order || units, count, recent);
  const results = [];
  if (order) {
    for (let i = 0; i * upc < chosen.length; i++) {
      const chunk = chosen.slice(i * upc, i * upc + upc);
      const mode = modesMap[courts[i]] || 'open';
      if (upc === 4) {
        const s = splitFour(chunk.map(u => u[0]), seeded, mode, hist, recent, genderOf);
        results.push({ ...courtOf(courts[i], s.teams[0], s.teams[1], s.mode), flagged: !!s.flagged });
      } else {
        results.push(courtOf(courts[i], chunk[0], chunk[1]));
      }
    }
  } else {
    let rest = chosen;
    courts.slice(0, chosen.length / 2).forEach(c => {
      const m = pickMatch(hist, rest, recent);
      if (!m) return;
      results.push(courtOf(c, m[0], m[1]));
      rest = rest.filter(u => u !== m[0] && u !== m[1]);
    });
  }
  return { results, sitOut: played(results) };
}
/* What assignRound needs to know about this event's rounds so far: who
   partnered, faced each other and sat out last round, and how many rounds
   each player has sat out. */
function recentContext(rounds) {
  const last = rounds[rounds.length - 1];
  const lastRound = { partners: new Set(), opponents: new Set(), sitOut: new Set(last ? last.sitOut || [] : []) };
  (last ? last.courts || [] : []).forEach(c => {
    if (!c.teamA || !c.teamB) return;
    if (c.teamA.length === 2) lastRound.partners.add(pairKey(c.teamA[0], c.teamA[1]));
    if (c.teamB.length === 2) lastRound.partners.add(pairKey(c.teamB[0], c.teamB[1]));
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
  recomputeFrom(ev, ev.currentRoundIndex || 0, history, players);
}
/* The same from any round on (results-driven events regenerate the rounds
   after the one being played as its scores come in). A regenerated game
   with the same teams on the same court keeps any score already entered. */
export function recomputeFrom(ev, fromIdx, history, players) {
  const idx = Math.max(0, Math.min(fromIdx, ev.roster.length));
  const old = ev.roster.slice(idx);
  old.forEach(r => applyRoundHistory(history, r, -1));
  const newRounds = generateRoster(ev, history, idx, players);
  const fresh = newRounds.slice(idx);
  fresh.forEach((r, i) => {
    const was = old[i];
    if (!was || was.offset !== r.offset) return;
    r.courts.forEach(c => {
      const same = (was.courts || []).find(x => x.court === c.court && JSON.stringify([x.teamA, x.teamB]) === JSON.stringify([c.teamA, c.teamB]));
      if (same && (same.scoreA != null || same.scoreB != null)) {
        c.scoreA = same.scoreA; c.scoreB = same.scoreB;
        ['scoredAt', 'scoredBy', 'baseAt'].forEach(k => { if (k in same) c[k] = same[k]; });
      }
    });
  });
  const merged = ev.roster.slice(0, idx).concat(fresh);
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
  const req = rounds.map(r => Math.ceil(getRoundPool(event, r.offset, confirmed, waitlist).length / perCourt(event)))
    .map(n => Math.min(n, event.courts));
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
