/* QA round 2: regression checks for the fixes in 18760cd4 (server merge,
   score stamps, groups with per-group counters and 6-round narrow sets,
   movement into unscored courts, playoff entrants). Each server check runs
   a real client flow (lib/engine.js, as lib/store.js does it) and sends the
   result through enforceEventHosts (backend-worker/src/state.js).
   Run from the repo root: node --no-warnings test/qa/round2.qa.test.mjs */
import assert from 'node:assert/strict';
import { enforceEventHosts } from '../../backend-worker/src/state.js';
import {
  generateRoster, recomputeFrom, recomputeFromCurrentRound, applyRoundHistory, pairKey, getConfirmedAndWaitlist, getRoundPool,
} from '../../lib/engine.js';
import { formatOptions, normalizeOptions } from '../../lib/formats.js';
import { buildBracket, resolvePlayoffs } from '../../lib/playoffs.js';

let failures = 0, passes = 0;
const check = (name, fn) => {
  try { fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 6).join('\n        ')}`); }
};
const clone = x => JSON.parse(JSON.stringify(x));
const sorted = a => [...a].sort();
const on = c => [...c.teamA, ...c.teamB];
const T0 = 1_790_000_000_000;

function mkEvent({ n, courts, options = {}, durationMin = 60, rsvp = () => ({}), host = 'hz' }) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, gender: 'O', dupr: +(6 - i * 0.1).toFixed(2) }));
  const endMin = 18 * 60 + durationMin;
  const ev = {
    id: 'e1', name: 'QA', createdBy: host, startTime: '18:00', durationMin, courts, gameLenMin: 15, options,
    segments: [{ start: '18:00', end: `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`, modes: {} }],
    rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: durationMin, ts: i, ...rsvp(i) }])),
    memberIds: players.map(p => p.id), noShows: [], roster: null, currentRoundIndex: 0, published: false, started: false,
  };
  return { ev, players };
}
function publish(ev, players) {
  ev.roster = generateRoster(ev, {}, 0, players);
  const hist = {}; ev.roster.forEach(r => applyRoundHistory(hist, r, 1));
  ev.published = true;
  return hist;
}
/* One save: `requester` sends `incoming`, the server merges against `stored`. */
const put = (incoming, stored, requester, now) => enforceEventHosts([clone(incoming)], [clone(stored)], requester, now)[0];

/* ================================================================ */
console.log('R2 · server merge — legitimate flows still work');
check('a player\'s RSVP drop-out before games start: the recomputed rounds are stored', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2 });
  const hist = publish(ev, players);
  const stored = put(ev, {}, 'hz', T0) && clone(ev); // the host's published copy
  const mine = clone(stored);
  mine.rsvps.p5.status = 'out'; mine.noShows = ['p5'];
  recomputeFromCurrentRound(mine, clone(hist), players);
  const out = put(mine, stored, 'p5', T0 + 1000);
  assert.deepEqual(out.roster.map(r => r.courts.map(on)), mine.roster.map(r => r.courts.map(on)));
  assert.ok(out.roster.every(r => !on({ teamA: r.courts.flatMap(c => c.teamA), teamB: r.courts.flatMap(c => c.teamB) }).includes('p5')), 'p5 is in no game');
});
check('a player\'s partial RSVP (leaving early) before games start is stored', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 2 });
  const hist = publish(ev, players);
  const stored = clone(ev);
  const mine = clone(stored);
  mine.rsvps.p8 = { ...mine.rsvps.p8, status: 'partial', start: 0, end: 30 };
  recomputeFromCurrentRound(mine, clone(hist), players);
  const out = put(mine, stored, 'p8', T0);
  assert.ok(out.roster.slice(2).every(r => !r.courts.some(c => on(c).includes('p8'))), 'p8 not in rounds 3–4');
  assert.deepEqual(out.roster.map(r => r.courts.map(on)), mine.roster.map(r => r.courts.map(on)));
});
check('King of the Court, games started: a player scores their own game; the remade later rounds are stored', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: normalizeOptions(formatOptions({}, 'kingOfCourt')) });
  const hist = publish(ev, players);
  ev.started = true;
  const stored = clone(ev);
  const mine = clone(stored);
  const me = mine.roster[0].courts[1].teamA[0];
  mine.roster[0].courts.forEach(c => { if (!c.baseAt) c.baseAt = c.scoredAt || 0; c.scoreA = 11; c.scoreB = 4; }); // host scored court 1 earlier in reality — here the player types both? no: only their own
  // Only their own court is theirs; reset court 1 to the stored state.
  mine.roster[0].courts[0] = clone(stored.roster[0].courts[0]);
  recomputeFrom(mine, 1, clone(hist), players);
  const out = put(mine, stored, me, T0);
  assert.deepEqual([out.roster[0].courts[1].scoreA, out.roster[0].courts[1].scoreB], [11, 4]);
  assert.equal(out.roster[0].courts[1].scoredBy, me);
  assert.deepEqual(out.roster[1].courts.map(on), mine.roster[1].courts.map(on), 'remade round 2 stored');
});
check('typing "1" then "11" before the first save comes back: both saves are taken', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2 });
  publish(ev, players); ev.started = true;
  const stored = clone(ev);
  const me = stored.roster[0].courts[0].teamA[0];
  const a = clone(stored); const c = a.roster[0].courts[0]; c.baseAt = 0; c.scoreA = 1;
  const s1 = put(a, stored, me, T0);
  c.scoreA = 11; // same local copy, baseAt still 0
  const s2 = put(a, s1, me, T0 + 500);
  assert.equal(s2.roster[0].courts[0].scoreA, 11);
});
check('host correction with a fresh copy wins over a player\'s score; the player\'s stale copy then can\'t undo it', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2 });
  publish(ev, players); ev.started = true;
  const stored = clone(ev);
  const me = stored.roster[0].courts[0].teamA[0];
  const p = clone(stored); Object.assign(p.roster[0].courts[0], { baseAt: 0, scoreA: 11, scoreB: 3 });
  const s1 = put(p, stored, me, T0);
  const h = clone(s1); Object.assign(h.roster[0].courts[0], { baseAt: s1.roster[0].courts[0].scoredAt, scoreA: 3, scoreB: 11 });
  const s2 = put(h, s1, 'hz', T0 + 1000);
  assert.deepEqual([s2.roster[0].courts[0].scoreA, s2.roster[0].courts[0].scoreB], [3, 11], 'host correction');
  // The player's phone still has its own copy (baseAt 0) and types again.
  Object.assign(p.roster[0].courts[0], { scoreB: 4 });
  const s3 = put(p, s2, me, T0 + 2000);
  assert.deepEqual([s3.roster[0].courts[0].scoreA, s3.roster[0].courts[0].scoreB], [3, 11], 'stale player copy');
});
check('host flows: recompute after an option change, next round, check-in, start playoffs — all stored as sent', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: { standings: 'winPct', playoffs: 'single', playoffTeams: 2 } });
  const hist = publish(ev, players);
  const stored = clone(ev);
  const h = clone(stored);
  h.options = { ...h.options, seeding: 'dupr', format: 'custom' };
  recomputeFromCurrentRound(h, clone(hist), players);
  h.currentRoundIndex = 1; h.started = true; h.checkedIn = { p1: true };
  h.roster[0].courts.forEach(c => { c.baseAt = 0; c.scoreA = 11; c.scoreB = 2; });
  h.playoffs = { type: 'single', teams: [['p0', 'p3'], ['p1', 'p2']], matches: buildBracket('single', 2, false) };
  resolvePlayoffs(h.playoffs);
  const out = put(h, stored, 'hz', T0);
  assert.deepEqual([out.options.seeding, out.currentRoundIndex, out.started, out.checkedIn], ['dupr', 1, true, { p1: true }]);
  assert.deepEqual(out.roster.map(r => r.courts.map(on)), h.roster.map(r => r.courts.map(on)));
  assert.equal(out.roster[0].courts[0].scoreA, 11);
  assert.deepEqual(out.playoffs.matches[0].teamA, ['p0', 'p3']);
  assert.ok(!('baseAt' in out.roster[0].courts[0]), 'baseAt is not stored');
});
check('a player scores their own playoff match; the host\'s stale copy (baseAt 0) doesn\'t undo it', () => {
  const { ev } = mkEvent({ n: 8, courts: 2 });
  ev.roster = []; ev.published = true;
  ev.playoffs = { type: 'single', teams: [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p5'], ['p6', 'p7']], matches: buildBracket('single', 4, false) };
  resolvePlayoffs(ev.playoffs);
  const stored = clone(ev);
  const p = clone(stored); Object.assign(p.playoffs.matches[1], { baseAt: 0, scoreA: 11, scoreB: 6 });
  const s1 = put(p, stored, 'p2', T0);
  assert.deepEqual(s1.playoffs.matches[2].teamB, ['p2', 'p3']);
  const h = clone(stored); Object.assign(h.playoffs.matches[0], { baseAt: 0, scoreA: 11, scoreB: 1 });
  const s2 = put(h, s1, 'hz', T0 + 1000);
  assert.deepEqual([s2.playoffs.matches[1].scoreA, s2.playoffs.matches[0].scoreA, s2.playoffs.matches[2].teamA, s2.playoffs.matches[2].teamB], [11, 11, ['p0', 'p1'], ['p2', 'p3']]);
});

console.log('R2 · server merge — adversarial');
const started = () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, durationMin: 60 });
  publish(ev, players); ev.started = true; ev.currentRoundIndex = 1;
  return clone(ev);
};
check('once started, a player can\'t reshape the round in play or score another court in it', () => {
  const stored = started();
  const me = stored.roster[1].courts[0].teamA[0];
  const x = clone(stored);
  x.roster[1].courts[1] = { ...x.roster[1].courts[1], teamA: x.roster[1].courts[1].teamB, teamB: x.roster[1].courts[1].teamA, scoreA: 11, scoreB: 0 };
  x.roster[1].courts[2].scoreA = 11; x.roster[1].courts[2].baseAt = 9e15;
  const out = put(x, stored, me, T0);
  assert.deepEqual(out.roster[1], stored.roster[1]);
});
check('a player can\'t drop other players from later rounds (they vanish from games and sit-outs)', () => {
  const stored = started();
  const me = stored.roster[2].courts[0].teamA[0];
  const victim = stored.roster[2].courts[2].teamB[1];
  const x = clone(stored);
  x.roster.slice(2).forEach(r => {
    r.courts = r.courts.filter(c => !on(c).includes(victim));
    r.sitOut = (r.sitOut || []).filter(id => id !== victim);
  });
  const out = put(x, stored, me, T0);
  const present = out.roster.slice(2).every(r => [...r.courts.flatMap(on), ...(r.sitOut || [])].includes(victim));
  assert.ok(present, `${victim} no longer appears in rounds 3–4 (${out.roster.slice(2).map(r => r.courts.length + ' courts').join(', ')})`);
});
check('a player can\'t put two games on the same court or use a court the event doesn\'t have', () => {
  const stored = started();
  const me = stored.roster[2].courts[0].teamA[0];
  const x = clone(stored);
  x.roster[2].courts[1].court = 1; x.roster[2].courts[2].court = 9;
  const out = put(x, stored, me, T0);
  assert.deepEqual(out.roster[2].courts.map(c => c.court), [1, 2, 3]);
});
check('a player can\'t rewrite later rounds of an event whose later rounds don\'t depend on results (no RSVP change)', () => {
  const stored = started();
  const me = stored.roster[3].courts[2].teamA[0];
  const x = clone(stored);
  // Put themselves on court 1 with the two best players every later round.
  x.roster.slice(2).forEach(r => {
    const all = [...r.courts.flatMap(on), ...(r.sitOut || [])];
    const rest = all.filter(id => !['p0', 'p1', me].includes(id));
    const four = [me, 'p0', 'p1', rest[0]];
    const others = rest.slice(1);
    r.courts = [{ court: 1, mode: 'open', teamA: [me, 'p0'], teamB: ['p1', rest[0]], scoreA: null, scoreB: null },
      { court: 2, mode: 'open', teamA: others.slice(0, 2), teamB: others.slice(2, 4), scoreA: null, scoreB: null },
      { court: 3, mode: 'open', teamA: others.slice(4, 6), teamB: others.slice(6, 8), scoreA: null, scoreB: null }];
    r.sitOut = others.slice(8);
    void four;
  });
  const out = put(x, stored, me, T0);
  assert.deepEqual(out.roster.slice(2).map(r => r.courts.map(on)), stored.roster.slice(2).map(r => r.courts.map(on)), 'hand-made rounds accepted');
});
check('a player\'s stale copy (made before the host\'s re-seed) doesn\'t revert the host\'s rounds when the player saves something else', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2 });
  const hist = publish(ev, players);
  const playerCopy = clone(ev); // the player's phone, last synced now
  const h = clone(ev);
  h.options = { seeding: 'dupr', format: 'custom' };
  recomputeFromCurrentRound(h, clone(hist), players);
  const s1 = put(h, ev, 'hz', T0); // the host's change is stored
  // Before its next poll, the player's phone saves an unrelated change (a chat, their own DUPR…).
  const out = put(playerCopy, s1, 'p7', T0 + 3000);
  assert.deepEqual(out.roster.map(r => r.courts.map(on)), s1.roster.map(r => r.courts.map(on)), 'the host\'s seeded rounds were replaced by the player\'s old ones');
});
check('the host can still score games and change rounds when the stored roster has server stamps (no baseAt sent by an old app)', () => {
  const stored = started();
  const h = clone(stored); Object.assign(h.roster[1].courts[0], { scoreA: 11, scoreB: 9 }); // no baseAt, no scoredAt
  const out = put(h, stored, 'hz', T0);
  assert.equal(out.roster[1].courts[0].scoreA, 11);
});

/* ================================================================ */
console.log('R2 · groups (per-group counters, narrow sets)');
function courtStability(ev) {
  const bad = [];
  for (let i = 1; i < ev.roster.length; i++) {
    const r = ev.roster[i], p = ev.roster[i - 1];
    if (!r.groupSet || !p.groupSet) continue;
    const ns = r.groupSet.ns || r.groupSet.groups.map(() => r.groupSet.n);
    r.groupSet.groups.forEach((g, gi) => {
      if (!ns[gi]) return;
      const ids = new Set(g.flatMap(k => k.split('+')));
      const courtsNow = sorted(r.courts.filter(c => on(c).some(id => ids.has(id))).map(c => c.court));
      const pgi = p.groupSet.groups.findIndex(x => JSON.stringify(x) === JSON.stringify(g));
      const pids = pgi >= 0 ? new Set(p.groupSet.groups[pgi].flatMap(k => k.split('+'))) : new Set();
      const courtsBefore = sorted(p.courts.filter(c => on(c).some(id => pids.has(id))).map(c => c.court));
      if (JSON.stringify(courtsNow) !== JSON.stringify(courtsBefore)) bad.push(`round ${i}: group ${g.join(',')} moved from court ${courtsBefore} to ${courtsNow} mid-set`);
    });
  }
  return bad;
}
check('staggered groups (late arrivals start a group mid-set): each group keeps its court until its set ends', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, durationMin: 120, options: normalizeOptions(formatOptions({}, 'scramble')), rsvp: i => (i >= 8 ? { start: 15 } : {}) });
  publish(ev, players);
  const ns = ev.roster.map(r => (r.groupSet.ns || []).join(''));
  assert.ok(ns.some(s => new Set(s).size > 1), `groups never staggered: ${ns.join(' ')}`);
  assert.deepEqual(courtStability(ev), []);
});
check('staggered groups: every group that completes a set played each partner combination once', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, durationMin: 120, options: normalizeOptions(formatOptions({}, 'scramble')), rsvp: i => (i >= 8 ? { start: 15 } : {}) });
  publish(ev, players);
  const bad = [];
  ev.roster.forEach((r, i) => (r.groupSet.ns || []).forEach((n, gi) => {
    if (n !== 2) return;
    const g = r.groupSet.groups[gi]; const ids = new Set(g);
    const partners = new Set();
    for (let k = i - 2; k <= i; k++) ev.roster[k].courts.filter(c => on(c).every(id => ids.has(id))).forEach(c => { partners.add(pairKey(...c.teamA)); partners.add(pairKey(...c.teamB)); });
    if (partners.size !== 6) bad.push(`round ${i} group ${g}: ${partners.size} partner pairs`);
  }));
  assert.deepEqual(bad, []);
});
const poolOpts = extra => normalizeOptions({ ...formatOptions({}, 'poolPlay'), ...extra });
/* (Updated after round 2: pairs/singles groups are now pools scheduled
   onto every free court — a set lasts until each pool has played its 6
   games, however many rounds that takes.) */
const setEnd = ev => { const i = ev.roster.findIndex((r, k) => k > 0 && r.groupSet && r.groupSet.n === 0); return i < 0 ? ev.roster.length : i; };
check('pools (pairs): within a set each pool of 4 pairs plays all 6 match-ups, and every court is used', () => {
  const { ev, players } = mkEvent({ n: 16, courts: 3, durationMin: 90, options: poolOpts({}) });
  publish(ev, players);
  const end = setEnd(ev);
  const g0 = ev.roster[0].groupSet.groups;
  ev.roster.slice(0, end).forEach((r, i) => assert.deepEqual(r.groupSet.groups, g0, `round ${i}`));
  g0.forEach(g => {
    const units = new Set(g);
    const games = new Set(ev.roster.slice(0, end).flatMap(r => r.courts.filter(c => units.has(c.teamA.join('+'))).map(c => [c.teamA.join('+'), c.teamB.join('+')].sort().join(' v '))));
    assert.equal(games.size, 6, `group ${g}`);
  });
  ev.roster.slice(0, end).forEach((r, i) => assert.equal(r.courts.length, 3, `round ${i}`));
});
check('narrow sets with movement "set": after 6 rounds the top 2 pairs of each group move up, the bottom 2 down', () => {
  const { ev, players } = mkEvent({ n: 24, courts: 3, durationMin: 180, options: poolOpts({ movement: 'set' }) });
  const hist = publish(ev, players);
  const end = setEnd(ev);
  const num = u => Number(u.split('+')[0].slice(1));
  for (let i = 0; i < end; i++) {
    ev.currentRoundIndex = i;
    ev.roster[i].courts.forEach(c => { const a = num(c.teamA.join('+')) < num(c.teamB.join('+')); c.scoreA = a ? 11 : 4; c.scoreB = a ? 4 : 11; });
    recomputeFrom(ev, i + 1, hist, players);
  }
  const groups = ev.roster[0].groupSet.groups;
  const rank = g => [...g].sort((x, y) => num(x) - num(y)); // lower first player id wins every game
  const r = groups.map(rank);
  const want = [sorted([...r[0].slice(0, 2), ...r[1].slice(0, 2)]), sorted([...r[0].slice(2), ...r[2].slice(0, 2)]), sorted([...r[1].slice(2), ...r[2].slice(2)])];
  const got = ev.roster[end].groupSet.groups.map(sorted);
  assert.deepEqual(got, want);
  assert.equal(ev.roster[end].groupSet.n, 0);
});
check('narrow sets with movement "set": a pair leaving mid-set starts a new set for everyone without crashing', () => {
  const { ev, players } = mkEvent({ n: 24, courts: 3, durationMin: 180, options: poolOpts({ movement: 'set' }), rsvp: i => (i === 4 || i === 5 ? { status: 'partial', start: 0, end: 45 } : {}) });
  publish(ev, players);
  assert.ok(ev.roster.every(r => r.groupSet), 'groupSet on every round');
  const r3 = ev.roster[3];
  assert.ok(!r3.courts.some(c => on(c).includes('p4')), 'p4 gone');
  assert.equal(r3.groupSet.n, 0, 'new set');
});
function gamesPerPlayer(ev, players) {
  const g = Object.fromEntries(players.map(p => [p.id, 0]));
  ev.roster.forEach(r => r.courts.forEach(c => on(c).forEach(id => { g[id]++; })));
  return g;
}
for (const [n, courts, durationMin] of [[16, 1, 60], [16, 2, 60], [16, 3, 60], [24, 3, 90]]) {
  check(`Pool play, ${n} players / ${courts} court(s) / ${durationMin} min (extras rotate): everyone gets at least one game`, () => {
    const { ev, players } = mkEvent({ n, courts, durationMin, options: normalizeOptions(formatOptions({}, 'poolPlay')) });
    publish(ev, players);
    const g = gamesPerPlayer(ev, players);
    const zero = Object.entries(g).filter(([, v]) => v === 0).map(([k]) => k);
    assert.deepEqual(zero, [], `games: ${JSON.stringify(g)}`);
  });
}
check('Pool play, 16 players / 3 courts: no court sits idle while 2 or more pairs sit out', () => {
  const { ev, players } = mkEvent({ n: 16, courts: 3, durationMin: 60, options: normalizeOptions(formatOptions({}, 'poolPlay')) });
  publish(ev, players);
  const bad = ev.roster.map((r, i) => (r.courts.length < 3 && r.sitOut.length >= 4 ? `round ${i}: ${r.courts.length} courts, ${r.sitOut.length} sit` : null)).filter(Boolean);
  assert.deepEqual(bad, []);
});
check('matrix: every preset still yields valid rounds with late arrivals and early leavers (no duplicates, pool accounted for)', () => {
  const probs = [];
  for (const key of ['scramble', 'doubleHeader', 'upDownRiver', 'creamOfCrop', 'poolPlay', 'kingOfCourt', 'shuffle', 'rumble', 'singles']) {
    for (const [n, courts] of [[9, 2], [13, 3], [17, 4], [20, 3]]) {
      const { ev, players } = mkEvent({ n, courts, durationMin: 150, options: normalizeOptions(formatOptions({}, key)), rsvp: i => (i % 5 === 1 ? { status: 'partial', start: 30, end: 150 } : i % 7 === 2 ? { status: 'partial', start: 0, end: 75 } : {}) });
      const hist = publish(ev, players);
      for (let i = 0; i < ev.roster.length; i++) {
        ev.currentRoundIndex = i;
        ev.roster[i].courts.forEach((c, k) => { c.scoreA = (i + k) % 2 ? 11 : 6; c.scoreB = (i + k) % 2 ? 6 : 11; });
        if (i + 1 < ev.roster.length) recomputeFrom(ev, i + 1, hist, players);
      }
      const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
      ev.roster.forEach((r, ri) => {
        const pool = getRoundPool(ev, r.offset, confirmed, waitlist);
        const all = [...r.courts.flatMap(on), ...(r.sitOut || [])];
        if (new Set(all).size !== all.length) probs.push(`${key} ${n}/${courts} r${ri}: duplicate`);
        if (JSON.stringify(sorted(all)) !== JSON.stringify(sorted(pool))) probs.push(`${key} ${n}/${courts} r${ri}: pool mismatch`);
        if (new Set(r.courts.map(c => c.court)).size !== r.courts.length) probs.push(`${key} ${n}/${courts} r${ri}: court twice`);
      });
    }
  }
  assert.deepEqual(probs.slice(0, 8), []);
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
