/* QA round 4: adversarial probes of cfac9ce5 — pools of 4–7 with cross-pool
   extra games (lib/engine.js poolRound/formPools/poolGames), the per-field
   three-way merge (lib/merge.js), and RSVP permissions on the server
   (backend-worker/src/state.js enforceEventHosts).
   Run from the repo root: node --no-warnings test/qa/round4.qa.test.mjs
   QA_DUMP=1 prints the fairness table. */
import assert from 'node:assert/strict';
import { enforceEventHosts } from '../../backend-worker/src/state.js';
import {
  generateRoster, recomputeFrom, recomputeFromCurrentRound, applyRoundHistory, getConfirmedAndWaitlist, getRoundPool,
} from '../../lib/engine.js';
import { formatOptions, normalizeOptions } from '../../lib/formats.js';
import { threeWayMerge } from '../../lib/merge.js';

let failures = 0, passes = 0;
const check = (name, fn) => {
  try { fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 8).join('\n        ')}`); }
};
const clone = x => JSON.parse(JSON.stringify(x));
const sorted = a => [...a].sort();
const on = c => [...c.teamA, ...c.teamB];
const T0 = 1_790_000_000_000;

function mkEvent({ n, courts, options = {}, durationMin = 60, rsvp = () => ({}), host = 'hz' }) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, gender: i % 2 ? 'M' : 'F', dupr: +(6 - i * 0.1).toFixed(2) }));
  const endMin = 18 * 60 + durationMin;
  const ev = {
    id: 'e1', name: 'QA', createdBy: host, startTime: '18:00', durationMin, courts, gameLenMin: 15, options,
    segments: [{ start: '18:00', end: `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`, modes: {} }],
    rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: durationMin, ts: i, ...rsvp(i) }])),
    memberIds: [...players.map(p => p.id), host], noShows: [], roster: null, currentRoundIndex: 0, published: false, started: false,
  };
  return { ev, players };
}
function publish(ev, players) {
  ev.roster = generateRoster(ev, {}, 0, players);
  const hist = {}; ev.roster.forEach(r => applyRoundHistory(hist, r, 1));
  ev.published = true;
  return hist;
}
const put = (incoming, stored, requester, now = T0) => enforceEventHosts([clone(incoming)], [clone(stored)], requester, now)[0];
const rosterSig = ev => JSON.stringify((ev.roster || []).map(r => r.courts.map(c => [c.court, sorted(on(c))])));

/* ================================================================ */
console.log('R4 · pools of 4–7 and extra games');
const variants = [
  ['poolPlay', {}], ['poolPlay', { movement: 'set' }], ['poolPlay', { seeding: 'dupr' }], ['poolPlay', { reseed: true }],
  ['singles', { groups: 'fixed', extras: 'rotate' }], ['singles', { groups: 'fixed', movement: 'set', extras: 'rotate' }],
];
const problems = [], zero = [], spreads = [];
let cases = 0;
for (const [key, extra] of variants) for (const courts of [1, 2, 3, 4]) for (const durationMin of [30, 45, 60, 90, 120, 180]) for (const n of [4, 6, 8, 10, 12, 14, 18, 22, 26]) for (const churn of [false, true]) {
  const options = normalizeOptions({ ...formatOptions({}, key), ...extra });
  const rsvp = churn ? (i => (i === 2 ? { status: 'partial', start: 0, end: Math.max(15, Math.floor(durationMin / 30) * 15) } : i >= n - 3 ? { status: 'partial', start: 15, end: durationMin } : {})) : () => ({});
  const { ev, players } = mkEvent({ n, courts, durationMin, options, rsvp });
  const tag = `${key}${JSON.stringify(extra)} ${n}p ${courts}c ${durationMin}m${churn ? ' churn' : ''}`;
  cases++;
  const t0 = Date.now();
  try {
    const hist = publish(ev, players);
    for (let i = 0; i < ev.roster.length; i++) {
      ev.currentRoundIndex = i;
      ev.roster[i].courts.forEach((c, k) => { c.scoreA = (i + k) % 3 ? 11 : 7; c.scoreB = (i + k) % 3 ? 7 : 11; });
      if (i + 1 < ev.roster.length) recomputeFrom(ev, i + 1, hist, players);
    }
  } catch (e) { problems.push(`${tag}: crashed: ${e.message}`); continue; }
  if (Date.now() - t0 > 3000) problems.push(`${tag}: slow (${Date.now() - t0} ms)`);
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const unitSize = options.partners === 'singles' ? 1 : 2;
  let setStart = 0; const setGames = new Map();
  ev.roster.forEach((r, ri) => {
    const pool = getRoundPool(ev, r.offset, confirmed, waitlist);
    const all = [...r.courts.flatMap(on), ...(r.sitOut || [])];
    if (new Set(all).size !== all.length) problems.push(`${tag} r${ri}: a player twice`);
    if (JSON.stringify(sorted(all)) !== JSON.stringify(sorted(pool))) problems.push(`${tag} r${ri}: pool not accounted for`);
    const nums = r.courts.map(c => c.court);
    if (new Set(nums).size !== nums.length || nums.some(x => x < 1 || x > courts)) problems.push(`${tag} r${ri}: bad courts ${nums}`);
    r.courts.forEach(c => { if (c.teamA.length !== unitSize || c.teamB.length !== unitSize) problems.push(`${tag} r${ri}: team size`); });
    if (!r.groupSet) { if (r.courts.length) problems.push(`${tag} r${ri}: no groupSet`); return; }
    (r.groupSet.pools || []).forEach(p => { if (p.length > 7 || p.length < 2) problems.push(`${tag} r${ri}: pool of ${p.length}`); });
    const inPools = new Set((r.groupSet.pools || []).flat());
    r.courts.forEach(c => { [c.teamA.join('+'), c.teamB.join('+')].forEach(k => { if (!inPools.has(k)) problems.push(`${tag} r${ri}: ${k} plays but is in no pool`); }); });
    if (r.groupSet.n === 0) setStart = ri;
    if (!setGames.has(setStart)) setGames.set(setStart, new Set());
    r.courts.forEach(c => {
      const k = [c.teamA.join('+'), c.teamB.join('+')].sort().join(' v ');
      if (setGames.get(setStart).has(k)) problems.push(`${tag} r${ri}: ${k} repeated within a set`);
      setGames.get(setStart).add(k);
      if (c.extra) {
        const pi = x => (r.groupSet.pools || []).findIndex(p => p.includes(x));
        if (pi(c.teamA.join('+')) === pi(c.teamB.join('+'))) problems.push(`${tag} r${ri}: an "extra" game inside one pool`);
      }
    });
    // A court idle while two free units could play a game they haven't played in this set.
    if (r.courts.length < courts) {
      const busy = new Set(r.courts.flatMap(c => [c.teamA.join('+'), c.teamB.join('+')]));
      const free = [...inPools].filter(k => !busy.has(k));
      const sg = setGames.get(setStart);
      const pools = r.groupSet.pools || [];
      const poolOf = k => pools.findIndex(p => p.includes(k));
      const could = free.some((x, i) => free.slice(i + 1).some(y => poolOf(x) === poolOf(y) && !sg.has([x, y].sort().join(' v '))));
      if (could) problems.push(`${tag} r${ri}: a court idle while a pool game could be played`);
    }
  });
  if (!churn) {
    const oddOut = unitSize === 2 && n % 2 ? `p${n - 1}` : null;
    const g = Object.fromEntries(confirmed.filter(id => id !== oddOut).map(id => [id, 0]));
    ev.roster.forEach(r => r.courts.forEach(c => on(c).forEach(id => { if (id in g) g[id]++; })));
    const v = Object.values(g);
    if (!v.length) continue;
    const lo = Math.min(...v), hi = Math.max(...v);
    const slots = ev.roster.reduce((s, r) => s + r.courts.length * 2 * unitSize, 0);
    if (lo === 0 && hi >= 2) zero.push(`${tag}: ${v.filter(x => !x).length} never play, others up to ${hi}`);
    spreads.push({ tag, spread: hi - lo, lo, hi, fair: slots / v.length });
  }
}
check(`${cases} pool events (6 variants × 1–4 courts × 30–180 min × 4–26 players, ± churn): valid rounds, pools of 2–7, no repeats in a set, extras only across pools, no idle court, < 3 s`, () => {
  if (process.env.QA_DUMP) problems.forEach(p => console.log('    ' + p));
  assert.deepEqual(problems.slice(0, 10), [], `${problems.length} problems`);
});
check('nobody goes the whole event without a game while others play 2 or more (R3-1)', () => {
  assert.deepEqual(zero.slice(0, 10), [], `${zero.length} events`);
});
check('games per player differ by at most 2 in every event (full-time players, no churn)', () => {
  const bad = spreads.filter(s => s.spread > 2);
  if (process.env.QA_DUMP) bad.forEach(b => console.log(`    ${b.tag}: ${b.lo}–${b.hi} (fair ${b.fair.toFixed(1)})`));
  assert.deepEqual(bad.slice(0, 8).map(b => `${b.tag}: ${b.lo}–${b.hi}`), [], `${bad.length} of ${spreads.length} events`);
});
check('set movement with pools of 5+: the top 2 move up and the bottom 2 down; the middle stays', () => {
  const { ev, players } = mkEvent({ n: 20, courts: 4, durationMin: 240, options: normalizeOptions({ ...formatOptions({}, 'poolPlay'), movement: 'set', extras: 'rotate' }) });
  const hist = publish(ev, players);
  assert.deepEqual(ev.roster[0].groupSet.pools.map(p => p.length), [5, 5]);
  const num = u => Number(u.split('+')[0].slice(1));
  let end = -1;
  for (let i = 0; i < ev.roster.length; i++) {
    ev.currentRoundIndex = i;
    ev.roster[i].courts.forEach(c => { const a = num(c.teamA.join('+')) < num(c.teamB.join('+')); c.scoreA = a ? 11 : 4; c.scoreB = a ? 4 : 11; });
    if (i + 1 < ev.roster.length) recomputeFrom(ev, i + 1, hist, players);
    if (i > 0 && ev.roster[i + 1] && ev.roster[i + 1].groupSet.n === 0) { end = i + 1; break; }
  }
  assert.ok(end > 0, 'set never ended within 4 hours');
  const [p0, p1] = ev.roster[0].groupSet.pools.map(p => [...p].sort((x, y) => num(x) - num(y)));
  const want = [sorted([...p0.slice(0, 3), ...p1.slice(0, 2)]), sorted([...p0.slice(3), ...p1.slice(2)])];
  assert.deepEqual(ev.roster[end].groupSet.pools.map(sorted), want);
});
check('a single late pair joins the smallest pool and plays in its first round (with a court free)', () => {
  const { ev, players } = mkEvent({ n: 18, courts: 4, durationMin: 90, options: normalizeOptions(formatOptions({}, 'poolPlay')), rsvp: i => (i >= 16 ? { status: 'partial', start: 30, end: 90 } : {}) });
  publish(ev, players);
  const r = ev.roster[2];
  assert.ok(r.groupSet.pools.some(p => p.includes('p16+p17')), 'late pair in a pool');
  assert.ok(ev.roster.slice(2, 4).some(x => x.courts.some(c => on(c).includes('p16'))), 'late pair plays within 2 rounds');
});

/* ================================================================ */
console.log('R4 · RSVP permissions on the server (FR-11)');
const base = () => { const { ev } = mkEvent({ n: 8, courts: 2, host: 'hz' }); ev.roster = []; return ev; };
check('a player changes only their own RSVP; someone else\'s change is reverted', () => {
  const s = base(); const x = clone(s);
  x.rsvps.p1.status = 'out'; x.rsvps.p2.status = 'out'; x.noShows = ['p1', 'p2'];
  const out = put(x, s, 'p1');
  assert.deepEqual([out.rsvps.p1.status, out.rsvps.p2.status, out.noShows], ['out', 'in', ['p1']]);
});
check('a player can\'t delete someone else\'s RSVP or add one for a non-member', () => {
  const s = base(); const x = clone(s);
  delete x.rsvps.p2; x.rsvps.zz = { status: 'in', start: 0, end: 60, ts: 1 };
  const out = put(x, s, 'p1');
  assert.ok(out.rsvps.p2 && !out.rsvps.zz);
});
check('a player can\'t clear someone else\'s no-show mark', () => {
  const s = base(); s.rsvps.p2.status = 'out'; s.noShows = ['p2'];
  const x = clone(s); x.noShows = []; x.rsvps.p2.status = 'in';
  const out = put(x, s, 'p1');
  assert.deepEqual([out.noShows, out.rsvps.p2.status], [['p2'], 'out']);
});
check('an older app build that sends an event without "rsvps" doesn\'t wipe the player\'s own RSVP', () => {
  const s = base(); const x = clone(s); delete x.rsvps;
  const out = put(x, s, 'p1');
  assert.ok(out.rsvps && out.rsvps.p1 && out.rsvps.p1.status === 'in', `p1's RSVP is now ${JSON.stringify(out.rsvps && out.rsvps.p1)}`);
});
check('signed out: no RSVP changes at all', () => {
  const s = base(); const x = clone(s); x.rsvps.p1.status = 'out'; x.rsvps.p2.status = 'out';
  const out = put(x, s, null);
  assert.deepEqual([out.rsvps.p1.status, out.rsvps.p2.status], ['in', 'in']);
});
check('host sets anyone\'s RSVP; hostless event: anyone sets anyone\'s', () => {
  const s = base(); const x = clone(s); x.rsvps.p2.status = 'out';
  assert.equal(put(x, s, 'hz').rsvps.p2.status, 'out');
  const h = base(); delete h.createdBy; const y = clone(h); y.rsvps.p3.status = 'out';
  assert.equal(put(y, h, 'p1').rsvps.p3.status, 'out');
});
check('host marks a player out: the recompute (waitlist promotion) is stored', () => {
  const { ev, players } = mkEvent({ n: 10, courts: 2, host: 'hz' });
  const hist = publish(ev, players);
  const h = clone(ev); h.rsvps.p1.status = 'out'; h.noShows = ['p1'];
  recomputeFromCurrentRound(h, clone(hist), players);
  const out = put(h, ev, 'hz');
  assert.equal(rosterSig(out), rosterSig(h));
  assert.ok(out.roster.every(r => r.courts.some(c => on(c).includes('p8'))));
});
check('a player drops themselves: the recompute is stored (still works after sanitising)', () => {
  const { ev, players } = mkEvent({ n: 10, courts: 2, host: 'hz' });
  const hist = publish(ev, players);
  const m = clone(ev); m.rsvps.p1.status = 'out'; m.noShows = ['p1'];
  recomputeFromCurrentRound(m, clone(hist), players);
  assert.equal(rosterSig(put(m, ev, 'p1')), rosterSig(m));
});
check('a player drops themselves and also (illegally) someone else: their own change stands, the other is reverted, and the rounds match the stored RSVPs', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, host: 'hz' });
  const hist = publish(ev, players);
  const m = clone(ev); m.rsvps.p1.status = 'out'; m.rsvps.p7.status = 'out'; m.noShows = ['p1', 'p7'];
  recomputeFromCurrentRound(m, clone(hist), players);
  const out = put(m, ev, 'p1');
  const sched = id => out.roster.some(r => r.courts.some(c => on(c).includes(id)));
  assert.deepEqual([out.rsvps.p7.status, sched('p7')], ['in', true], 'p7 must stay in and scheduled');
  assert.equal(out.rsvps.p1.status, 'out');
});

/* ================================================================ */
console.log('R4 · per-field merge (lib/merge.js)');
const st = events => ({ players: [{ id: 'p1', name: 'A' }], events, chats: [], history: {}, flagThreshold: 3, currentEventId: null });
const ev0 = () => ({ id: 'e1', createdBy: 'hz', currentRoundIndex: 0, started: true, published: true, options: {}, checkedIn: {}, noShows: [],
  rsvps: Object.fromEntries(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'].map((id, i) => [id, { status: 'in', start: 0, end: 60, ts: i }])),
  roster: [{ offset: 0, courts: [{ court: 1, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], scoreA: null, scoreB: null }, { court: 2, teamA: ['p5', 'p6'], teamB: ['p7', 'p8'], scoreA: null, scoreB: null }], sitOut: ['p9'] },
    { offset: 15, courts: [{ court: 1, teamA: ['p1', 'p3'], teamB: ['p2', 'p9'], scoreA: null, scoreB: null }, { court: 2, teamA: ['p5', 'p7'], teamB: ['p6', 'p8'], scoreA: null, scoreB: null }], sitOut: ['p4'] }] });
check('host offline: Next round survives a player\'s score arriving on the server (R3-3)', () => {
  const b = st([ev0()]); const l = clone(b); l.events[0].currentRoundIndex = 1;
  const r = clone(b); Object.assign(r.events[0].roster[0].courts[1], { scoreA: 11, scoreB: 5, scoredAt: T0, scoredBy: 'p5' });
  const m = threeWayMerge(b, l, r).events[0];
  assert.deepEqual([m.currentRoundIndex, m.roster[0].courts[1].scoreA, m.roster[0].courts[1].scoredAt], [1, 11, T0]);
});
check('host offline marks p2 "Not here" (noShows, checkedIn) while p9 RSVPs out on the server: both no-shows kept', () => {
  const b = st([ev0()]);
  const l = clone(b); Object.assign(l.events[0], { noShows: ['p2'], checkedIn: { p2: false } }); l.events[0].rsvps.p2.status = 'out';
  const r = clone(b); r.events[0].noShows = ['p9']; r.events[0].rsvps.p9.status = 'out';
  const m = threeWayMerge(b, l, r).events[0];
  assert.deepEqual([m.rsvps.p2.status, m.rsvps.p9.status], ['out', 'out']);
  assert.deepEqual(sorted(m.noShows), ['p2', 'p9'], `noShows = ${JSON.stringify(m.noShows)} while rsvps say p2 and p9 are out`);
});
check('both sides remade the rounds (host offline moved on, a player dropped out on the server): the merged rounds don\'t schedule the player who is out', () => {
  const b = st([ev0()]);
  const l = clone(b); const le = l.events[0]; le.currentRoundIndex = 1;
  le.roster[1].courts[0] = { court: 1, teamA: ['p1', 'p4'], teamB: ['p2', 'p9'], scoreA: null, scoreB: null }; le.roster[1].sitOut = ['p3']; // host's remake
  const r = clone(b); const re = r.events[0]; re.rsvps.p9.status = 'out'; re.noShows = ['p9'];
  re.roster[1].courts[0] = { court: 1, teamA: ['p1', 'p3'], teamB: ['p2', 'p4'], scoreA: null, scoreB: null }; re.roster[1].sitOut = [];
  const m = threeWayMerge(b, l, r).events[0];
  const sched = m.roster.slice(1).some(x => x.courts.some(c => on(c).includes('p9')));
  assert.ok(!(m.rsvps.p9.status === 'out' && sched), 'p9 is out but still scheduled in round 2 of the merged state (which the host then saves)');
});
check('our unsaved score goes on the server\'s reshaped rounds only where the teams match', () => {
  const b = st([ev0()]);
  const l = clone(b); Object.assign(l.events[0].roster[1].courts[1], { scoreA: 11, scoreB: 2, baseAt: 0 });
  const r = clone(b); r.events[0].roster[1].courts[1] = { court: 2, teamA: ['p5', 'p8'], teamB: ['p6', 'p7'], scoreA: null, scoreB: null };
  const m = threeWayMerge(b, l, r).events[0];
  assert.deepEqual([m.roster[1].courts[1].teamA, m.roster[1].courts[1].scoreA], [['p5', 'p8'], null]);
});
check('options changed on both sides: ours wins as a whole (document: a player\'s phone can\'t change options anyway)', () => {
  const b = st([ev0()]);
  const l = clone(b); l.events[0].options = { standings: 'winPct' };
  const r = clone(b); r.events[0].options = { seeding: 'dupr' };
  assert.deepEqual(threeWayMerge(b, l, r).events[0].options, { standings: 'winPct' });
});
check('a field deleted on the server (playoffs removed by "Back to pool play") stays deleted when we didn\'t touch it', () => {
  const b = st([{ ...ev0(), playoffs: { type: 'single', teams: [['p1'], ['p2']], matches: [{ id: 'W1-1', a: { seed: 1 }, b: { seed: 2 }, teamA: ['p1'], teamB: ['p2'], scoreA: null, scoreB: null }] } }]);
  const l = clone(b); l.events[0].currentRoundIndex = 1;
  const r = clone(b); delete r.events[0].playoffs;
  assert.equal(threeWayMerge(b, l, r).events[0].playoffs, undefined);
});
check('a field we deleted (startedAt on Stop games) stays deleted when the server didn\'t touch it', () => {
  const b = st([{ ...ev0(), startedAt: 123 }]);
  const l = clone(b); l.events[0].started = false; delete l.events[0].startedAt;
  const r = clone(b); r.events[0].rsvps.p9.status = 'out';
  const m = threeWayMerge(b, l, r).events[0];
  assert.deepEqual([m.started, 'startedAt' in m], [false, false]);
});
check('history: both sides\' additions are kept; our removals (a recompute) come off', () => {
  const b = st([]); b.history = { 'a|b': { partner: 2, opponent: 1 } };
  const l = clone(b); l.history['a|b'].partner = 1; l.history['c|d'] = { partner: 1, opponent: 0 };
  const r = clone(b); r.history['a|b'].opponent = 3; r.history['e|f'] = { partner: 0, opponent: 1 };
  assert.deepEqual(threeWayMerge(b, l, r).history, { 'a|b': { partner: 1, opponent: 3 }, 'c|d': { partner: 1, opponent: 0 }, 'e|f': { partner: 0, opponent: 1 } });
});
check('merging is stable: merging the result again with the same server copy changes nothing', () => {
  const b = st([ev0()]); const l = clone(b); l.events[0].currentRoundIndex = 1; l.events[0].rsvps.p3.status = 'partial';
  const r = clone(b); Object.assign(r.events[0].roster[0].courts[0], { scoreA: 11, scoreB: 3, scoredAt: T0 });
  const m1 = threeWayMerge(b, l, r);
  const m2 = threeWayMerge(r, m1, r);
  assert.deepEqual(m2.events, m1.events);
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
