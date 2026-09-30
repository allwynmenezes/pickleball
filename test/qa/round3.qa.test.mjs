/* QA round 3: adversarial probes of f842f888 — the pool scheduler for
   pairs/singles groups (lib/engine.js poolRound), the three-way merge used
   while saves fail (lib/merge.js), and the stricter non-host roster merge
   (backend-worker/src/state.js) against legitimate flows.
   Run from the repo root: node --no-warnings test/qa/round3.qa.test.mjs */
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

function mkEvent({ n, courts, options = {}, durationMin = 60, rsvp = () => ({}), host = 'hz', segGameLen }) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, gender: i % 2 ? 'M' : 'F', dupr: +(6 - i * 0.1).toFixed(2) }));
  const endMin = 18 * 60 + durationMin;
  const ev = {
    id: 'e1', name: 'QA', createdBy: host, startTime: '18:00', durationMin, courts, gameLenMin: 15, options,
    segments: [{ start: '18:00', end: `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`, modes: {}, ...(segGameLen ? { gameLenMin: segGameLen } : {}) }],
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
/* What a player's phone does for an RSVP change (lib/store.js setRsvp). */
function playerRsvp(ev, hist, players, id, status, window) {
  const mine = clone(ev);
  const rec = mine.rsvps[id] || { start: 0, end: mine.durationMin, ts: T0 };
  const wasActive = rec.status === 'in' || rec.status === 'partial';
  rec.status = status;
  if ((status === 'in' || status === 'partial') && !wasActive) rec.ts = T0 + 999;
  if (status === 'in') { rec.start = 0; rec.end = mine.durationMin; }
  if (window) Object.assign(rec, window);
  mine.rsvps[id] = rec;
  if (status === 'out') mine.noShows = [...new Set([...(mine.noShows || []), id])]; else mine.noShows = (mine.noShows || []).filter(x => x !== id);
  recomputeFromCurrentRound(mine, clone(hist), players);
  return mine;
}

/* ================================================================ */
console.log('R3 · pool scheduler (pairs / singles groups)');
const variants = [
  ['poolPlay', {}], ['poolPlay', { extras: 'waitlist' }], ['poolPlay', { movement: 'set' }], ['poolPlay', { seeding: 'dupr' }],
  ['singles', { groups: 'fixed', extras: 'rotate' }], ['singles', { groups: 'fixed', movement: 'set', extras: 'rotate' }],
];
const poolProblems = [];
const unfair = [];
let poolCases = 0;
for (const [key, extra] of variants) for (const courts of [1, 2, 3, 4]) for (const durationMin of [30, 45, 60, 90, 120]) for (const n of [8, 10, 13, 16, 18, 24]) for (const churn of [false, true]) {
  const options = normalizeOptions({ ...formatOptions({}, key), ...extra });
  const rsvp = churn ? (i => (i === 2 ? { status: 'partial', start: 0, end: Math.max(15, Math.floor(durationMin / 30) * 15) } : i >= n - 2 ? { status: 'partial', start: 15, end: durationMin } : {})) : () => ({});
  const { ev, players } = mkEvent({ n, courts, durationMin, options, rsvp });
  const tag = `${key}${JSON.stringify(extra)} ${n}p ${courts}c ${durationMin}m${churn ? ' churn' : ''}`;
  poolCases++;
  let hist;
  try {
    hist = publish(ev, players);
    for (let i = 0; i < ev.roster.length; i++) {
      ev.currentRoundIndex = i;
      ev.roster[i].courts.forEach((c, k) => { c.scoreA = (i + k) % 3 ? 11 : 7; c.scoreB = (i + k) % 3 ? 7 : 11; });
      if (i + 1 < ev.roster.length) recomputeFrom(ev, i + 1, hist, players);
    }
  } catch (e) { poolProblems.push(`${tag}: crashed: ${e.message}`); continue; }
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const unitSize = options.partners === 'singles' ? 1 : 2;
  const setGames = new Map(); // set start index -> Set of game keys
  let setStart = 0;
  ev.roster.forEach((r, ri) => {
    const pool = getRoundPool(ev, r.offset, confirmed, waitlist);
    const all = [...r.courts.flatMap(on), ...(r.sitOut || [])];
    if (new Set(all).size !== all.length) poolProblems.push(`${tag} r${ri}: a player twice`);
    if (JSON.stringify(sorted(all)) !== JSON.stringify(sorted(pool))) poolProblems.push(`${tag} r${ri}: pool not accounted for`);
    const nums = r.courts.map(c => c.court);
    if (new Set(nums).size !== nums.length || nums.some(x => x < 1 || x > courts)) poolProblems.push(`${tag} r${ri}: bad court numbers ${nums}`);
    r.courts.forEach(c => { if (c.teamA.length !== unitSize || c.teamB.length !== unitSize) poolProblems.push(`${tag} r${ri}: team size`); });
    if (!r.groupSet) { poolProblems.push(`${tag} r${ri}: no groupSet`); return; }
    if (r.groupSet.n === 0) setStart = ri;
    if (!setGames.has(setStart)) setGames.set(setStart, new Set());
    r.courts.forEach(c => {
      const k = [c.teamA.join('+'), c.teamB.join('+')].sort().join(' v ');
      if (setGames.get(setStart).has(k)) poolProblems.push(`${tag} r${ri}: game ${k} repeated within a set`);
      setGames.get(setStart).add(k);
    });
    // Idle court while two free units of one pool still have a game to play.
    if (r.courts.length < courts && r.groupSet.pools) {
      const busy = new Set(r.courts.flatMap(c => [c.teamA.join('+'), c.teamB.join('+')]));
      const done = new Set(r.groupSet.done || []);
      const idle = r.groupSet.pools.some(p => p.some((x, i) => p.some((y, j) => j > i && !busy.has(x) && !busy.has(y) && !done.has([x, y].sort().join(' v ')))));
      if (idle) poolProblems.push(`${tag} r${ri}: a court idle while a pool game could be played`);
    }
  });
  // Fairness among full-time confirmed players.
  if (!churn && options.extras === 'rotate') {
    // With pairs and an odd count, the last player (RSVP order) has no partner: out by design.
    const g = Object.fromEntries(confirmed.filter(id => !(unitSize === 2 && n % 2 && id === `p${n - 1}`)).map(id => [id, 0]));
    ev.roster.forEach(r => r.courts.forEach(c => on(c).forEach(id => { if (id in g) g[id]++; })));
    const v = Object.values(g);
    const lo = Math.min(...v), hi = Math.max(...v);
    if (lo === 0 && hi >= 2) unfair.push(`${tag}: ${v.filter(x => x === 0).length} player(s) never play while others play ${hi} (rounds ${ev.roster.length})`);
  }
}
check(`${poolCases} pool events (${variants.length} variants × 1–4 courts × 30–120 min × 8–24 players, with and without churn) generate and play out validly`, () => {
  assert.deepEqual(poolProblems.slice(0, 10), [], `${poolProblems.length} problems`);
});
check('pools: nobody who RSVPed (extras rotate) goes the whole event without a game while others play 2 or more', () => {
  if (process.env.QA_DUMP) console.log(unfair.join('\n'));
  assert.deepEqual(unfair.slice(0, 10), [], `${unfair.length} events`);
});
check('pools: a late-arriving pool gets games in the same round a court is free', () => {
  const { ev, players } = mkEvent({ n: 16, courts: 3, durationMin: 90, options: normalizeOptions(formatOptions({}, 'poolPlay')), rsvp: i => (i >= 8 ? { status: 'partial', start: 30, end: 90 } : {}) });
  publish(ev, players);
  const r = ev.roster[2];
  assert.equal(r.courts.length, 3, `round 3: ${r.courts.length} courts, sitting ${r.sitOut.join(',')}`);
  assert.ok(r.courts.some(c => on(c).some(id => Number(id.slice(1)) >= 8)), 'a late pair plays');
});
check('pools: seeded pools open 1 v 4 and 2 v 3', () => {
  const { ev, players } = mkEvent({ n: 16, courts: 4, durationMin: 60, options: normalizeOptions({ ...formatOptions({}, 'poolPlay'), seeding: 'dupr' }) });
  publish(ev, players);
  const pool = ev.roster[0].groupSet.pools[0];
  const games = ev.roster[0].courts.filter(c => pool.includes(c.teamA.join('+'))).map(c => sorted([c.teamA.join('+'), c.teamB.join('+')]));
  assert.deepEqual(sorted(games.map(g => g.join(' v '))), sorted([[pool[0], pool[3]], [pool[1], pool[2]]].map(g => sorted(g).join(' v '))));
});

/* ================================================================ */
console.log('R3 · server merge vs legitimate flows');
check('partial RSVP window (leave at 30 min) before start: the recompute is accepted', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2 });
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p3', 'partial', { start: 0, end: 30 });
  const out = put(mine, ev, 'p3');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('partial RSVP window (arrive at 30 min) before start: the recompute is accepted', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2 });
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p3', 'partial', { start: 30, end: 60 });
  const out = put(mine, ev, 'p3');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('waitlist promotion: a confirmed player drops out and the first waitlisted player is scheduled (server accepts)', () => {
  const { ev, players } = mkEvent({ n: 10, courts: 2 }); // capacity 8: p8, p9 waitlisted
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p1', 'out');
  assert.ok(mine.roster.every(r => r.courts.some(c => on(c).includes('p8'))), 'p8 promoted (client)');
  const out = put(mine, ev, 'p1');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('a waitlisted player drops out: nothing changes and the save goes through', () => {
  const { ev, players } = mkEvent({ n: 10, courts: 2 });
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p9', 'out');
  const out = put(mine, ev, 'p9');
  assert.deepEqual([out.rsvps.p9.status, rosterSig(out)], ['out', rosterSig(ev)]);
});
check('a player who was out comes back in (rotate): they are scheduled again (server accepts)', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2, options: { extras: 'rotate' }, rsvp: i => (i === 4 ? { status: 'out' } : {}) });
  ev.noShows = ['p4'];
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p4', 'in');
  assert.ok(mine.roster.some(r => r.courts.some(c => on(c).includes('p4'))));
  const out = put(mine, ev, 'p4');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('a host who doesn\'t play (no RSVP, not in any round): a player\'s drop-out recompute is accepted', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2, host: 'hz' });
  assert.ok(!ev.rsvps.hz);
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p0', 'out');
  const out = put(mine, ev, 'p0');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('a playing host (RSVP in): a player\'s drop-out recompute is accepted and the host stays scheduled', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2, host: 'p0' });
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p5', 'out');
  const out = put(mine, ev, 'p5');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('Scramble (groups): a player\'s early-leave recompute mid-event (games started, round 2) is accepted', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, durationMin: 90, options: normalizeOptions(formatOptions({}, 'scramble')) });
  const hist = publish(ev, players); ev.started = true; ev.currentRoundIndex = 1;
  const mine = playerRsvp(ev, hist, players, 'p6', 'partial', { start: 0, end: 45 });
  const out = put(mine, ev, 'p6');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('Pool play: a pair member\'s drop-out (pools re-formed) is accepted', () => {
  const { ev, players } = mkEvent({ n: 16, courts: 3, durationMin: 90, options: normalizeOptions(formatOptions({}, 'poolPlay')) });
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p3', 'out');
  const out = put(mine, ev, 'p3');
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('Gauntlet (re-seed): a player\'s own score remakes the later rounds (accepted)', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: normalizeOptions(formatOptions({}, 'gauntlet')) });
  const hist = publish(ev, players); ev.started = true;
  const mine = clone(ev);
  const c = mine.roster[0].courts[0]; const me = c.teamA[0];
  Object.assign(c, { baseAt: 0, scoreA: 3, scoreB: 11 });
  recomputeFrom(mine, 1, clone(hist), players);
  const out = put(mine, ev, me);
  assert.equal(rosterSig(out), rosterSig(mine));
});
check('segments with a longer game length (20 min): a partial RSVP on a round boundary is accepted', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2, durationMin: 60, segGameLen: 20 });
  const hist = publish(ev, players);
  const mine = playerRsvp(ev, hist, players, 'p2', 'partial', { start: 0, end: 40 });
  const out = put(mine, ev, 'p2');
  assert.equal(rosterSig(out), rosterSig(mine));
});

console.log('R3 · server merge — adversarial');
check('a player can\'t drop someone else by also changing that person\'s RSVP in the same save', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3 });
  const hist = publish(ev, players); ev.started = true;
  const mine = clone(ev);
  // Touch my own RSVP (same status, new window) and mark the victim out.
  mine.rsvps.p1 = { ...mine.rsvps.p1, status: 'partial', start: 0, end: 60 };
  mine.rsvps.p7 = { ...mine.rsvps.p7, status: 'out' };
  mine.noShows = ['p7'];
  recomputeFromCurrentRound(mine, clone(hist), players);
  const out = put(mine, ev, 'p1');
  const later = out.roster.slice(1).some(r => r.courts.some(c => on(c).includes('p7')));
  assert.ok(later && out.rsvps.p7.status !== 'out', `p7 now ${out.rsvps.p7.status} and ${later ? 'still' : 'no longer'} scheduled`);
});
check('a player can\'t mark another player out on their own (RSVP of someone else)', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3 });
  publish(ev, players);
  const mine = clone(ev); mine.rsvps.p7.status = 'out';
  const out = put(mine, ev, 'p1');
  assert.equal(out.rsvps.p7.status, 'in');
});
check('a stale copy saved with a chat message keeps the stored rounds (N-7)', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2 });
  const hist = publish(ev, players);
  const stale = clone(ev);
  const h = clone(ev); h.options = { seeding: 'dupr', format: 'custom' }; recomputeFromCurrentRound(h, clone(hist), players);
  const s1 = put(h, ev, 'hz');
  const out = put(stale, s1, 'p7');
  assert.equal(rosterSig(out), rosterSig(s1));
});

/* ================================================================ */
console.log('R3 · three-way merge (lib/merge.js)');
const st = events => ({ players: [{ id: 'p1', name: 'A' }], events, chats: [], history: {}, flagThreshold: 3, currentEventId: null });
const evBase = () => ({ id: 'e1', createdBy: 'hz', currentRoundIndex: 0, started: true, published: true, options: {}, rsvps: { p1: { status: 'in', start: 0, end: 60, ts: 1 }, p2: { status: 'in', start: 0, end: 60, ts: 2 } },
  roster: [{ offset: 0, courts: [{ court: 1, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], scoreA: null, scoreB: null }, { court: 2, teamA: ['p5', 'p6'], teamB: ['p7', 'p8'], scoreA: null, scoreB: null }] },
    { offset: 15, courts: [{ court: 1, teamA: ['p1', 'p3'], teamB: ['p2', 'p4'], scoreA: null, scoreB: null }, { court: 2, teamA: ['p5', 'p7'], teamB: ['p6', 'p8'], scoreA: null, scoreB: null }] }] });
check('host offline taps "Next round" while a player\'s score reaches the server: the host\'s move survives the merge', () => {
  const base = st([evBase()]);
  const local = clone(base); local.events[0].currentRoundIndex = 1;
  const remote = clone(base); Object.assign(remote.events[0].roster[0].courts[1], { scoreA: 11, scoreB: 5, scoredAt: T0, scoredBy: 'p5' });
  const m = threeWayMerge(base, local, remote);
  assert.deepEqual([m.events[0].currentRoundIndex, m.events[0].roster[0].courts[1].scoreA], [1, 11]);
});
check('host offline changes an option (Setup) while a player RSVPs: the host\'s option change survives', () => {
  const base = st([evBase()]);
  const local = clone(base); local.events[0].options = { standings: 'winPct' };
  const remote = clone(base); remote.events[0].rsvps.p2.status = 'out';
  const m = threeWayMerge(base, local, remote);
  assert.deepEqual([m.events[0].options, m.events[0].rsvps.p2.status], [{ standings: 'winPct' }, 'out']);
});
check('player offline drops out while the host scores: merged event has the RSVP and a roster without them', () => {
  const base = st([evBase()]);
  const local = clone(base); local.events[0].rsvps.p1.status = 'out'; local.events[0].roster[1].courts[0] = { court: 1, teamA: ['p9', 'p3'], teamB: ['p2', 'p4'], scoreA: null, scoreB: null };
  const remote = clone(base); Object.assign(remote.events[0].roster[0].courts[0], { scoreA: 11, scoreB: 2, scoredAt: T0, scoredBy: 'hz' });
  const m = threeWayMerge(base, local, remote);
  const e = m.events[0];
  assert.equal(e.rsvps.p1.status, 'out');
  assert.ok(!on(e.roster[1].courts[0]).includes('p1'), `rsvp says out but round 2 still has p1: ${JSON.stringify(e.roster[1].courts[0])}`);
});
check('both sides score the same game differently: ours is laid on top (the server then decides by baseAt)', () => {
  const base = st([evBase()]);
  const local = clone(base); Object.assign(local.events[0].roster[0].courts[0], { scoreA: 11, scoreB: 9, baseAt: 0 });
  const remote = clone(base); Object.assign(remote.events[0].roster[0].courts[0], { scoreA: 5, scoreB: 11, scoredAt: T0, scoredBy: 'p3' });
  const m = threeWayMerge(base, local, remote);
  const c = m.events[0].roster[0].courts[0];
  assert.deepEqual([c.scoreA, c.scoreB, c.baseAt, c.scoredAt], [11, 9, 0, T0]);
});
check('chats: messages from both sides are kept once, in time order', () => {
  const base = st([]); base.chats = [{ id: 'c1', messages: [{ id: 'm1', ts: 1, text: 'a' }] }];
  const local = clone(base); local.chats[0].messages.push({ id: 'm2', ts: 3, text: 'mine' });
  const remote = clone(base); remote.chats[0].messages.push({ id: 'm3', ts: 2, text: 'theirs' });
  const m = threeWayMerge(base, local, remote);
  assert.deepEqual(m.chats[0].messages.map(x => x.id), ['m1', 'm3', 'm2']);
});
check('chats: a new chat started offline and one started on the server are both kept', () => {
  const base = st([]);
  const local = clone(base); local.chats.push({ id: 'cL', messages: [{ id: 'x', ts: 1 }] });
  const remote = clone(base); remote.chats.push({ id: 'cR', messages: [{ id: 'y', ts: 1 }] });
  assert.deepEqual(sorted(threeWayMerge(base, local, remote).chats.map(c => c.id)), ['cL', 'cR']);
});
check('deletions: an event deleted offline stays deleted unless the server changed it; deleted on the server and untouched here stays deleted', () => {
  const e2 = { id: 'e2', name: 'B' };
  const base = st([evBase(), e2]);
  const local = clone(base); local.events = local.events.filter(e => e.id !== 'e2');
  const remote = clone(base);
  assert.deepEqual(threeWayMerge(base, local, remote).events.map(e => e.id), ['e1']);
  const local2 = clone(base); const remote2 = clone(base); remote2.events = remote2.events.filter(e => e.id !== 'e2');
  assert.deepEqual(threeWayMerge(base, local2, remote2).events.map(e => e.id), ['e1']);
});
check('no base yet (first save failed before any poll): nothing local is lost', () => {
  const local = st([evBase()]); local.events[0].rsvps.p1.status = 'out'; local.events.push({ id: 'new', name: 'Made offline' });
  const remote = st([evBase()]); remote.events[0].currentRoundIndex = 1;
  const m = threeWayMerge(null, local, remote);
  assert.ok(m.events.some(e => e.id === 'new'), 'offline-created event kept');
  assert.equal(m.events.find(e => e.id === 'e1').rsvps.p1.status, 'out');
});
check('history: local recompute and remote history changes are not silently dropped (both changed)', () => {
  const base = st([]); base.history = { 'a|b': { partner: 1, opponent: 0 } };
  const local = clone(base); local.history['c|d'] = { partner: 1, opponent: 0 };
  const remote = clone(base); remote.history['e|f'] = { partner: 1, opponent: 0 };
  const m = threeWayMerge(base, local, remote);
  assert.ok(m.history['c|d'] && m.history['e|f'], `history keys: ${Object.keys(m.history)}`);
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
