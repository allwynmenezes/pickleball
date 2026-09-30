/* QA (exploratory) checks for the event-format engine: lib/engine.js,
   lib/formats.js, lib/standings.js. Written by QA against
   docs/event-options.md (FR-2, FR-3) and docs/qa-test-plan.md section 2
   items 1-3. Run from the repo root: node --no-warnings test/qa/formats.qa.test.mjs
   A FAIL here is a suspected defect; see docs/qa-report.md. */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  generateRoster, recomputeFrom, applyRoundHistory, getConfirmedAndWaitlist, getRoundPool, resultsDriven,
  eventOptions, playerCapacity, pairKey,
} from '../../lib/engine.js';
import { FORMATS, formatOptions, normalizeOptions } from '../../lib/formats.js';
import { computeStandings } from '../../lib/standings.js';

let failures = 0, passes = 0;
const check = (name, fn) => {
  try { fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 6).join('\n        ')}`); }
};
const clone = x => JSON.parse(JSON.stringify(x));
const sorted = a => [...a].sort();
const onCourt = c => [...c.teamA, ...c.teamB];
/* Deterministic PRNG. */
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* The original engine (before the event-options work), for FR-2(a). */
const base = execSync('git show 5c7a937b:lib/engine.js', { encoding: 'utf8', maxBuffer: 1 << 24 });
const dir = mkdtempSync(join(tmpdir(), 'pickle-qa-'));
writeFileSync(join(dir, 'engine.mjs'), base);
const Orig = await import(pathToFileURL(join(dir, 'engine.mjs')).href);

/* n players p0.. (p0 best DUPR). */
function mkEvent({ n, courts, options = {}, durationMin = 120, genders = 'O', modes = {}, rsvp = () => ({}), unrated = [], segments }) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, gender: genders[i % genders.length], ...(unrated.includes(i) ? {} : { dupr: +(6 - i * 0.1).toFixed(2) }) }));
  const end = `${String(18 + Math.floor(durationMin / 60)).padStart(2, '0')}:${String(durationMin % 60).padStart(2, '0')}`;
  const ev = {
    id: 'e', startTime: '18:00', durationMin, courts, gameLenMin: 15, options,
    segments: segments || [{ start: '18:00', end, modes }],
    rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: durationMin, ts: i, ...rsvp(i) }])),
    memberIds: players.map(p => p.id), roster: null, currentRoundIndex: 0,
  };
  return { ev, players };
}
/* Like publishRoster: roster + shared history. */
function publish(ev, players) {
  ev.roster = generateRoster(ev, {}, 0, players);
  const hist = {};
  ev.roster.forEach(r => applyRoundHistory(hist, r, 1));
  ev.published = true; ev.currentRoundIndex = 0;
  return hist;
}
/* Event day as the store runs it (advanceRound + setScore): each round is
   (re)made from the latest scores when reached, then scored. */
function playOut(ev, players, hist, seed = 1, scoreFn) {
  const r = rng(seed);
  const driven = resultsDriven(ev);
  for (let i = 0; i < ev.roster.length; i++) {
    ev.currentRoundIndex = i;
    const scored = x => (x.courts || []).some(c => c.scoreA != null || c.scoreB != null);
    if (i > 0 && driven && !scored(ev.roster[i])) recomputeFrom(ev, i, hist, players);
    ev.roster[i].courts.forEach((c, k) => {
      const s = scoreFn ? scoreFn(c, k, i) : (r() < 0.5 ? [11, Math.floor(r() * 10)] : [Math.floor(r() * 10), 11]);
      if (!s) return;
      [c.scoreA, c.scoreB] = s; c.scoredAt = 1;
    });
    if (driven && ev.roster.length > i + 1) recomputeFrom(ev, i + 1, hist, players);
  }
}
/* Invariants for every round of a roster. Returns a list of problems. */
function invariants(ev, players, { checkPairs = true } = {}) {
  const probs = [];
  const o = eventOptions(ev);
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const size = o.partners === 'singles' ? 1 : 2;
  (ev.roster || []).forEach((r, ri) => {
    const pool = getRoundPool(ev, r.offset, confirmed, waitlist);
    const on = r.courts.flatMap(onCourt);
    const all = [...on, ...(r.sitOut || [])];
    if (new Set(all).size !== all.length) probs.push(`round ${ri}: a player appears twice`);
    const isBreak = (ev.segments || []).length && r.courts.length === 0 && (r.sitOut || []).length === 0;
    if (!isBreak && JSON.stringify(sorted(all)) !== JSON.stringify(sorted(pool))) probs.push(`round ${ri}: on court + sitting out != pool (${all.length} vs ${pool.length})`);
    r.courts.forEach(c => {
      if (c.teamA.length !== size || c.teamB.length !== size) probs.push(`round ${ri} court ${c.court}: team sizes ${c.teamA.length}/${c.teamB.length}, expected ${size}`);
      if (c.court < 1 || c.court > ev.courts) probs.push(`round ${ri}: court ${c.court} out of range`);
    });
    if (new Set(r.courts.map(c => c.court)).size !== r.courts.length) probs.push(`round ${ri}: a court used twice`);
    if (checkPairs && o.partners === 'fixed' && (o.pairs || []).length) {
      const partnerOf = new Map(); o.pairs.forEach(([a, b]) => { partnerOf.set(a, b); partnerOf.set(b, a); });
      r.courts.forEach(c => [c.teamA, c.teamB].forEach(t => {
        t.forEach(id => { if (partnerOf.has(id) && pool.includes(partnerOf.get(id)) && !t.includes(partnerOf.get(id))) probs.push(`round ${ri}: fixed pair of ${id} split`); });
      }));
    }
  });
  return probs;
}
/* Groups: every group part-way through its set was the same group, one
   step earlier, in the round before. (Updated after the fix: each group has
   its own counter, groupSet.ns, and pairs/singles groups on one court play
   6-round sets, groupSet.len.) */
function groupProblems(ev) {
  const probs = [];
  const rs = ev.roster.filter(r => r.courts.length);
  const nsOf = gs => gs.ns || gs.groups.map(() => gs.n);
  rs.forEach((r, i) => {
    if (!r.groupSet) { probs.push(`round at ${r.offset}: no groupSet`); return; }
    const len = r.groupSet.len || 3;
    const ns = nsOf(r.groupSet);
    r.groupSet.groups.forEach((g, gi) => {
      if (ns[gi] > len - 1) probs.push(`round at ${r.offset}: set longer than ${len}`);
      if (ns[gi] === 0) return;
      const p = rs[i - 1];
      const pi = p && p.groupSet ? p.groupSet.groups.findIndex(x => JSON.stringify(x) === JSON.stringify(g)) : -1;
      if (pi < 0) probs.push(`round at ${r.offset}: groups changed mid-set`);
      else if (nsOf(p.groupSet)[pi] !== ns[gi] - 1) probs.push(`round at ${r.offset}: set counter jumps`);
    });
  });
  return probs;
}
function sitStats(ev, players) {
  const counts = Object.fromEntries(players.map(p => [p.id, 0]));
  let consecutive = 0;
  ev.roster.forEach((r, i) => {
    (r.sitOut || []).forEach(id => { counts[id]++; });
    const prev = ev.roster[i - 1];
    if (prev && r.courts.length && prev.courts.length) {
      const both = (r.sitOut || []).filter(id => (prev.sitOut || []).includes(id));
      const prevPlayers = prev.courts.flatMap(onCourt).length;
      // Avoidable: enough people played last round to fill this round's sit-outs.
      if (both.length && (r.sitOut || []).length <= prevPlayers) consecutive += both.length;
    }
  });
  const v = Object.values(counts);
  return { spread: Math.max(...v) - Math.min(...v), consecutive, counts };
}

/* ---------------------------------------------------------------- */
console.log('QA 1 · defaults unchanged (FR-2a)');
const defaultCases = [];
for (const n of [5, 7, 8, 9, 10, 12, 13, 16]) for (const courts of [1, 2, 3]) for (const durationMin of [60, 120]) for (const genders of ['O', 'MF', 'MMF']) defaultCases.push({ n, courts, durationMin, genders });
for (const extra of [
  { n: 10, courts: 3, durationMin: 120, genders: 'MF', modes: { 1: 'mixed', 2: 'men', 3: 'women' } },
  { n: 9, courts: 2, durationMin: 120, genders: 'MF', modes: { 2: 'break' } },
  { n: 11, courts: 2, durationMin: 120, genders: 'O', rsvp: i => (i === 3 ? { start: 30, end: 90, status: 'partial' } : {}) },
]) defaultCases.push(extra);
for (const opts of [{}, { standings: 'winPct' }, { standings: 'courtPoints' }, { playoffs: 'single', playoffTeams: 4 }, { repeat: 'weekly' }, { format: 'popcorn' }]) {
  check(`options ${JSON.stringify(opts)}: roster identical to the original engine over ${defaultCases.length} setups`, () => {
    for (const c of defaultCases) {
      const { ev, players } = mkEvent({ ...c, options: opts });
      const now = generateRoster(clone(ev), {}, 0, players);
      const evOld = clone(ev); delete evOld.options;
      const was = Orig.generateRoster(evOld, {}, 0, players);
      assert.deepEqual(now, was, `differs for ${JSON.stringify(c)}`);
    }
  });
}

/* ---------------------------------------------------------------- */
console.log('QA 2 · every preset × players × courts × length');
const matrixFailures = [];
const slow = [];
const sitSpread = [];
for (const f of FORMATS) {
  let cases = 0;
  const problems = [];
  for (const n of [8, 9, 10, 12, 13]) for (const courts of [1, 2, 3]) for (const durationMin of [60, 120]) for (const hostPairs of [false, true]) {
    const options = normalizeOptions(formatOptions({ options: hostPairs ? { pairs: [['p0', 'p5'], ['p2', 'p7']] } : {} }, f.key));
    if (hostPairs && options.partners !== 'fixed') continue;
    cases++;
    const { ev, players } = mkEvent({ n, courts, durationMin, options, genders: 'MF' });
    const t0 = Date.now();
    let hist;
    try {
      hist = publish(ev, players);
      playOut(ev, players, hist, n * 100 + courts);
    } catch (e) { problems.push(`${n}p ${courts}c ${durationMin}m: crashed: ${e.message}`); continue; }
    const ms = Date.now() - t0;
    if (ms > 3000) slow.push(`${f.key} ${n}p ${courts}c ${durationMin}m: ${ms} ms`);
    const tag = `${n}p ${courts}c ${durationMin}m${hostPairs ? ' +pairs' : ''}`;
    invariants(ev, players).forEach(p => problems.push(`${tag}: ${p}`));
    if (options.groups === 'fixed') groupProblems(ev).forEach(p => problems.push(`${tag}: ${p}`));
    if (options.games === 'none' && ev.roster.length) problems.push(`${tag}: a clinic has rounds`);
    if (options.extras === 'rotate') {
      const { confirmed } = getConfirmedAndWaitlist(ev, players);
      if (confirmed.length !== n) problems.push(`${tag}: rotate but only ${confirmed.length}/${n} confirmed`);
      if (options.partners !== 'fixed') {
        const s = sitStats(ev, players);
        sitSpread.push({ f: f.key, tag, ...s });
      }
    }
    // A court left empty while enough players sit out to fill it.
    if (options.games !== 'none') ev.roster.forEach((r, ri) => {
      if (!r.courts.length && !(r.sitOut || []).length) return; // a break
      const upc = options.partners === 'singles' ? 2 : 4;
      if (r.courts.length < courts && (r.sitOut || []).length >= upc && options.groups !== 'fixed') problems.push(`${tag}: round ${ri}: ${courts - r.courts.length} court(s) empty while ${r.sitOut.length} sit out`);
      if (r.courts.length === 0 && (r.sitOut || []).length >= upc) problems.push(`${tag}: round ${ri}: no games at all, ${r.sitOut.length} sit out`);
    });
  }
  check(`${f.key}: ${cases} rosters generate and are valid (no duplicates, pool accounted for, team sizes, pairs kept, groups kept, < 3 s)`, () => {
    if (problems.length) { matrixFailures.push([f.key, problems]); assert.fail(`${problems.length} problems, e.g.\n${problems.slice(0, 4).join('\n')}`); }
  });
}
check('no roster took longer than 3 s to generate and play out', () => assert.deepEqual(slow, []));
check('extras rotate (non-group presets): sit-outs differ by at most 1 and nobody sits twice in a row when avoidable', () => {
  const bad = sitSpread.filter(s => !['scramble', 'doubleHeader'].includes(s.f) && (s.spread > 1 || s.consecutive));
  assert.deepEqual(bad.map(b => `${b.f} ${b.tag}: spread ${b.spread}, back-to-back ${b.consecutive}`), []);
});
// (Updated after triage, D-10 accepted as by design: a group keeps its four
// for a whole 3-game set, so sitting out comes a set at a time — the fair
// share is measured in sets: nobody sits more than one set more than anyone.)
check('extras rotate with groups (Scramble, Double Header): sit-outs differ by at most one set (FR-2j)', () => {
  const bad = sitSpread.filter(s => ['scramble', 'doubleHeader'].includes(s.f) && s.spread > 3);
  assert.deepEqual(bad.map(b => `${b.f} ${b.tag}: spread ${b.spread}, back-to-back ${b.consecutive}`).slice(0, 6), []);
});

/* ---------------------------------------------------------------- */
console.log('QA 3 · movement per game (FR-2e)');
const KOTC = normalizeOptions(formatOptions({}, 'kingOfCourt'));
/* Where each player of round `prev` should be in the next round. */
function expectMoves(prev) {
  const courts = [...prev.courts].sort((a, b) => a.court - b.court);
  const K = courts.length; const want = new Map();
  courts.forEach((c, k) => {
    const done = c.scoreA != null && c.scoreB != null && c.scoreA !== c.scoreB;
    if (!done) { onCourt(c).forEach(id => want.set(id, courts[k].court)); return; }
    const [w, l] = c.scoreA > c.scoreB ? [c.teamA, c.teamB] : [c.teamB, c.teamA];
    w.forEach(id => want.set(id, courts[Math.max(0, k - 1)].court));
    l.forEach(id => want.set(id, courts[Math.min(K - 1, k + 1)].court));
  });
  return want;
}
function movementCheck(n, courts, scoreFn, label) {
  check(label, () => {
    const { ev, players } = mkEvent({ n, courts, options: { ...KOTC, extras: 'waitlist' }, durationMin: 60 });
    const hist = publish(ev, players);
    ev.roster[0].courts.forEach((c, k) => { const s = scoreFn(c, k); if (s) { [c.scoreA, c.scoreB] = s; } });
    recomputeFrom(ev, 1, hist, players);
    const want = expectMoves(ev.roster[0]);
    const next = ev.roster[1];
    const bad = [];
    next.courts.forEach(c => onCourt(c).forEach(id => { if (want.get(id) !== c.court) bad.push(`${id} on court ${c.court}, expected ${want.get(id)}`); }));
    assert.deepEqual(bad, []);
    // Partners split: nobody partners last round's partner.
    const lastPartner = new Set(ev.roster[0].courts.flatMap(c => [pairKey(...c.teamA), pairKey(...c.teamB)]));
    const kept = next.courts.flatMap(c => [c.teamA, c.teamB]).filter(t => lastPartner.has(pairKey(...t)));
    assert.deepEqual(kept, [], 'partners should be split');
    const decided = ev.roster[0].courts.every(c => c.scoreA != null && c.scoreB != null && c.scoreA !== c.scoreB);
    assert.equal(!!next.provisional, !decided, 'provisional flag');
  });
}
movementCheck(12, 3, () => [11, 5], '12 players / 3 courts, team A wins everywhere');
movementCheck(12, 3, (c, k) => (k === 1 ? [3, 11] : [11, 3]), '12 players / 3 courts, team B wins on the middle court');
movementCheck(4, 1, () => [11, 5], '1 court: winners and losers both stay');
/* An unscored (or tied) game: its four stay on that court (FR-2e). */
function staysCheck(label, scoreFn, stayK) {
  check(label, () => {
    const { ev, players } = mkEvent({ n: 12, courts: 3, options: { ...KOTC, extras: 'waitlist' }, durationMin: 60 });
    const hist = publish(ev, players);
    ev.roster[0].courts.forEach((c, k) => { const s = scoreFn(c, k); if (s) [c.scoreA, c.scoreB] = s; });
    recomputeFrom(ev, 1, hist, players);
    const four = sorted(onCourt(ev.roster[0].courts[stayK]));
    const now = ev.roster[1].courts.find(c => c.court === stayK + 1);
    assert.deepEqual(sorted(onCourt(now)), four, `court ${stayK + 1} was ${four} and is now ${sorted(onCourt(now))}`);
    assert.equal(!!ev.roster[1].provisional, true, 'next round provisional');
  });
}
staysCheck('an unscored middle court keeps its four in place (next round provisional)', (c, k) => (k === 1 ? null : [11, 7]), 1);
staysCheck('an unscored top court keeps its four in place', (c, k) => (k === 0 ? null : [11, 7]), 0);
staysCheck('a tied score on court 1 is not a result: that court\'s four stay', (c, k) => (k === 0 ? [9, 9] : [11, 7]), 0);
check('with an unscored middle court nobody moves more than one court', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, options: { ...KOTC, extras: 'waitlist' }, durationMin: 60 });
  const hist = publish(ev, players);
  ev.roster[0].courts.forEach((c, k) => { if (k !== 1) { c.scoreA = 11; c.scoreB = 7; } });
  recomputeFrom(ev, 1, hist, players);
  const was = new Map(ev.roster[0].courts.flatMap(c => onCourt(c).map(id => [id, c.court])));
  const far = ev.roster[1].courts.flatMap(c => onCourt(c).filter(id => Math.abs(was.get(id) - c.court) > 1).map(id => `${id}: court ${was.get(id)} → ${c.court}`));
  assert.deepEqual(far, []);
});
movementCheck(16, 4, (c, k) => (k % 2 ? [2, 11] : [11, 2]), '16 players / 4 courts, alternating winners');

check('King of the Court, 14 players / 3 courts, rotate: every round valid, sit-out spread <= 1, no avoidable back-to-back sits', () => {
  const { ev, players } = mkEvent({ n: 14, courts: 3, options: KOTC, durationMin: 180, segments: [{ start: '18:00', end: '21:00', modes: {} }] });
  const hist = publish(ev, players);
  playOut(ev, players, hist, 7);
  assert.deepEqual(invariants(ev, players), []);
  const s = sitStats(ev, players);
  assert.ok(s.spread <= 1 && s.consecutive === 0, `spread ${s.spread}, back-to-back ${s.consecutive}: ${JSON.stringify(s.counts)}`);
});
check('King of the Court: winners keep moving up over a whole event (court-1 winners never drop)', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, options: { ...KOTC, extras: 'waitlist' }, durationMin: 120 });
  const hist = publish(ev, players);
  playOut(ev, players, hist, 3);
  const bad = [];
  for (let i = 0; i + 1 < ev.roster.length; i++) {
    const want = expectMoves(ev.roster[i]);
    ev.roster[i + 1].courts.forEach(c => onCourt(c).forEach(id => { if (want.get(id) !== c.court) bad.push(`r${i + 1} ${id}: court ${c.court} not ${want.get(id)}`); }));
  }
  assert.deepEqual(bad, []);
});

/* ---------------------------------------------------------------- */
console.log('QA 4 · seeding, re-seeding, groups, set movement, pairs, singles, breaks');
check('DUPR seeding, unrated players start at the bottom (FR-2b)', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: { seeding: 'dupr' }, unrated: [0, 1] });
  publish(ev, players);
  assert.deepEqual(sorted(onCourt(ev.roster[0].courts[0])), ['p2', 'p3', 'p4', 'p5']);
  const c1 = ev.roster[0].courts[0];
  assert.deepEqual([sorted(c1.teamA), sorted(c1.teamB)].sort(), [['p2', 'p5'], ['p3', 'p4']].sort());
});
check('Double Header: the first set of groups is seeded by DUPR (top 4 on court 1)', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: normalizeOptions(formatOptions({}, 'doubleHeader')) });
  publish(ev, players);
  assert.deepEqual(sorted(onCourt(ev.roster[0].courts[0])), ['p0', 'p1', 'p2', 'p3']);
});
check('Double Header: a seeded four\'s first game is 1&4 v 2&3 ("Seeded fours play 1&4 v 2&3", PRD §3)', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: normalizeOptions(formatOptions({}, 'doubleHeader')) });
  publish(ev, players);
  const c1 = ev.roster[0].courts[0];
  assert.deepEqual([sorted(c1.teamA), sorted(c1.teamB)].sort(), [['p0', 'p3'], ['p1', 'p2']].sort(), `got ${c1.teamA} v ${c1.teamB}`);
});
check('Scramble: each group\'s 3 games cover every partner combination once (FR-2f)', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, options: normalizeOptions(formatOptions({}, 'scramble')), durationMin: 90, segments: [{ start: '18:00', end: '19:30', modes: {} }] });
  publish(ev, players);
  for (let s = 0; s < 2; s++) {
    const set = ev.roster.slice(s * 3, s * 3 + 3);
    set[0].groupSet.groups.forEach((g, gi) => {
      const partners = new Set(set.flatMap(r => [r.courts[gi].teamA, r.courts[gi].teamB].map(t => pairKey(...t))));
      assert.equal(partners.size, 6, `set ${s} group ${gi}`);
    });
  }
});
check('groups: a new set starts early when a member becomes unavailable', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: normalizeOptions(formatOptions({}, 'scramble')), rsvp: i => (i === 0 ? { status: 'partial', start: 0, end: 30 } : {}) });
  publish(ev, players);
  // (Updated after the fix: the intact group may finish its set; the group
  // that lost a player doesn't carry on without them.)
  ev.roster[2].groupSet.groups.forEach(g => assert.ok(!g.includes('p0'), 'p0 is gone'));
  assert.equal(ev.roster[2].courts.length, 1, 'the one group of 4 that 7 players allow still plays');
  assert.ok(!onCourt(ev.roster[2].courts[0]).concat(ev.roster[2].sitOut).includes('p0'));
});
check('groups: a late arrival who could fill an empty court is not left sitting for the rest of a set', () => {
  // 8 players on 3 courts from the start, 4 more arrive for round 2: a third group fits.
  const { ev, players } = mkEvent({ n: 12, courts: 3, options: normalizeOptions(formatOptions({}, 'scramble')), rsvp: i => (i >= 8 ? { start: 15 } : {}) });
  publish(ev, players);
  const r = ev.roster[1];
  assert.equal(r.courts.length, 3, `round 2 uses ${r.courts.length} court(s), sitting out: ${r.sitOut.join(',')}`);
});
check('Up & Down the River: after a set the top 2 of each group move up, the bottom 2 down (FR-2g)', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, options: normalizeOptions(formatOptions({}, 'upDownRiver')), durationMin: 90, segments: [{ start: '18:00', end: '19:30', modes: {} }] });
  const hist = publish(ev, players);
  // Every game: lower id sum wins, so rankings are deterministic.
  const score = c => { const s = t => t.reduce((a, id) => a + Number(id.slice(1)), 0); return s(c.teamA) < s(c.teamB) ? [11, 4] : [4, 11]; };
  for (let i = 0; i < 3; i++) { ev.currentRoundIndex = i; ev.roster[i].courts.forEach(c => { [c.scoreA, c.scoreB] = score(c); }); recomputeFrom(ev, i + 1, hist, players); }
  const groups = ev.roster[0].groupSet.groups.map(g => g.map(k => k));
  const tally = new Map();
  ev.roster.slice(0, 3).forEach(r => r.courts.forEach(c => { const d = c.scoreA - c.scoreB; c.teamA.forEach(id => { const t = tally.get(id) || { w: 0, d: 0 }; t.w += d > 0; t.d += d; tally.set(id, t); }); c.teamB.forEach(id => { const t = tally.get(id) || { w: 0, d: 0 }; t.w += d < 0; t.d -= d; tally.set(id, t); }); }));
  const rank = g => [...g].map((id, i) => ({ id, i })).sort((a, b) => tally.get(b.id).w - tally.get(a.id).w || tally.get(b.id).d - tally.get(a.id).d || a.i - b.i).map(x => x.id);
  const r = groups.map(rank);
  const want = [sorted([...r[0].slice(0, 2), ...r[1].slice(0, 2)]), sorted([...r[0].slice(2), ...r[2].slice(0, 2)]), sorted([...r[1].slice(2), ...r[2].slice(2)])];
  const got = ev.roster[3].courts.map(c => sorted(onCourt(c)));
  assert.deepEqual(got, want);
});
check('set movement: a group with no results stays together', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: normalizeOptions(formatOptions({}, 'upDownRiver')), durationMin: 90, segments: [{ start: '18:00', end: '19:30', modes: {} }] });
  const hist = publish(ev, players);
  for (let i = 0; i < 3; i++) { ev.currentRoundIndex = i; const c = ev.roster[i].courts[1]; c.scoreA = 11; c.scoreB = 3; recomputeFrom(ev, i + 1, hist, players); }
  // Court 1 group unscored: its four should still be together on court 1.
  assert.deepEqual(sorted(onCourt(ev.roster[3].courts[0])), sorted(onCourt(ev.roster[0].courts[0])));
});
check('fixed pairs stay together; an odd player out sits (FR-2h)', () => {
  const { ev, players } = mkEvent({ n: 9, courts: 3, options: { partners: 'fixed', pairs: [['p0', 'p8'], ['p1', 'p7']] } });
  publish(ev, players);
  assert.deepEqual(invariants(ev, players), []);
  ev.roster.forEach(r => assert.ok(r.sitOut.includes('p6'), 'p6 is the odd one out in RSVP order'));
});
check('fixed pairs: players paired on the day stay paired when another player leaves early', () => {
  // No host pairs: paired in RSVP order p0+p1, p2+p3, ... p1 leaves after round 2.
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: { partners: 'fixed' }, rsvp: i => (i === 1 ? { status: 'partial', start: 0, end: 30 } : {}) });
  publish(ev, players);
  const teams = r => r.courts.flatMap(c => [c.teamA, c.teamB]).map(t => pairKey(...t));
  const first = new Set(teams(ev.roster[0]));
  const later = teams(ev.roster[3]).filter(k => !first.has(k));
  assert.deepEqual(later, [], 'new pairs formed among players whose partner is still here');
});
check('singles: 1 v 1 and capacity is 2 per court (FR-2i)', () => {
  const { ev, players } = mkEvent({ n: 7, courts: 2, options: normalizeOptions(formatOptions({}, 'singles')) });
  publish(ev, players);
  assert.equal(playerCapacity(ev), 4);
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  assert.deepEqual([confirmed.length, waitlist.length], [4, 3]);
  ev.roster.forEach(r => r.courts.forEach(c => assert.deepEqual([c.teamA.length, c.teamB.length], [1, 1])));
});
check('Pool play on 1 court still schedules games (pairs groups need 2 courts)', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 1, options: normalizeOptions(formatOptions({}, 'poolPlay')) });
  publish(ev, players);
  const games = ev.roster.reduce((s, r) => s + r.courts.length, 0);
  assert.ok(games > 0, `0 games in ${ev.roster.length} rounds; everyone sits out every round`);
});
for (const key of ['popcorn', 'kingOfCourt', 'scramble', 'shuffle']) {
  check(`${key}: a break segment gives rounds with no games and no sit-outs (FR-2k)`, () => {
    const options = normalizeOptions(formatOptions({}, key));
    const { ev, players } = mkEvent({ n: 10, courts: 2, options, segments: [{ start: '18:00', end: '18:30', modes: {} }, { start: '18:30', end: '19:00', modes: { 1: 'break', 2: 'break' } }, { start: '19:00', end: '20:00', modes: {} }] });
    const hist = publish(ev, players);
    playOut(ev, players, hist, 5);
    const brk = ev.roster.filter(r => r.offset >= 30 && r.offset < 60);
    assert.equal(brk.length, 2);
    brk.forEach(r => assert.deepEqual([r.courts.length, (r.sitOut || []).length], [0, 0]));
  });
}
check('re-seed (Gauntlet): every round after the first is filled in standings order (FR-2d)', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: normalizeOptions(formatOptions({}, 'gauntlet')), durationMin: 60 });
  const hist = publish(ev, players);
  playOut(ev, players, hist, 11);
  for (let i = 1; i < ev.roster.length; i++) {
    const rows = computeStandings({ roster: ev.roster.slice(0, i), currentRoundIndex: i - 1 }, 'winPct');
    const top4 = rows.slice(0, 4).map(r => r.id).sort();
    assert.deepEqual(sorted(onCourt(ev.roster[i].courts[0])), top4, `round ${i}`);
  }
});
check('FR-3: remade games with the same teams on the same court keep their scores', () => {
  const { ev, players } = mkEvent({ n: 8, courts: 2, options: KOTC, durationMin: 60 });
  const hist = publish(ev, players);
  ev.roster[0].courts.forEach(c => { c.scoreA = 11; c.scoreB = 2; });
  recomputeFrom(ev, 1, hist, players);
  ev.roster[1].courts[0].scoreA = 11; ev.roster[1].courts[0].scoreB = 6;
  const before = clone(ev.roster[1].courts[0]);
  recomputeFrom(ev, 1, hist, players);
  assert.deepEqual([ev.roster[1].courts[0].scoreA, ev.roster[1].courts[0].scoreB], [before.scoreA, before.scoreB]);
});
check('history stays consistent after many recomputes (no negative or runaway counts)', () => {
  const { ev, players } = mkEvent({ n: 12, courts: 3, options: KOTC, durationMin: 120 });
  const hist = publish(ev, players);
  playOut(ev, players, hist, 9);
  const truth = {}; ev.roster.forEach(r => applyRoundHistory(truth, r, 1));
  const strip = h => Object.fromEntries(Object.entries(h).filter(([, v]) => v.partner || v.opponent));
  assert.deepEqual(strip(hist), strip(truth));
});

/* ---------------------------------------------------------------- */
console.log('QA 5 · option rules and presets');
check('normalizeOptions: groups + game movement → set; set without groups → game; double needs 4', () => {
  assert.equal(normalizeOptions({ groups: 'fixed', movement: 'game', standings: 'off' }).movement, 'set');
  assert.equal(normalizeOptions({ groups: 'off', movement: 'set', standings: 'off' }).movement, 'game');
  assert.equal(normalizeOptions({ playoffs: 'double', playoffTeams: 2, standings: 'off' }).playoffTeams, 4);
  for (const o of [{ reseed: true }, { movement: 'game' }, { playoffs: 'single' }]) assert.notEqual(normalizeOptions({ standings: 'off', movement: 'none', playoffs: 'none', ...o }).standings, 'off');
});
check('every preset is already normal (normalizeOptions changes nothing)', () => {
  FORMATS.forEach(f => { const o = formatOptions({}, f.key); assert.deepEqual(normalizeOptions(o), o, f.key); });
});
check('switching presets keeps the host\'s playoffTeams (PRD §4), including into Pool play', () => {
  const o = formatOptions({ options: { playoffTeams: 8, pairs: [['a', 'b']], seedOrder: ['a'] } }, 'poolPlay');
  assert.deepEqual([o.playoffTeams, o.pairs, o.seedOrder], [8, [['a', 'b']], ['a']]);
});
check('court points: a win on the k-th of N courts earns N−k+1', () => {
  const ev = { currentRoundIndex: 0, roster: [{ courts: [
    { court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 11, scoreB: 1 },
    { court: 2, teamA: ['e', 'f'], teamB: ['g', 'h'], scoreA: 11, scoreB: 1 },
    { court: 3, teamA: ['i', 'j'], teamB: ['k', 'l'], scoreA: 1, scoreB: 11 },
  ] }] };
  const rows = Object.fromEntries(computeStandings(ev, 'courtPoints').map(r => [r.id, r.courtPoints]));
  assert.deepEqual([rows.a, rows.e, rows.k, rows.c], [3, 2, 1, 0]);
});

/* ---------------------------------------------------------------- */
console.log('QA 6 · stress (information)');
for (const [key, n, courts] of [['popcorn', 32, 8], ['scramble', 32, 8], ['kingOfCourt', 40, 8], ['shuffle', 32, 8], ['doubleHeader', 29, 7]]) {
  check(`${key}: ${n} players / ${courts} courts / 3 h generates and plays out in < 3 s`, () => {
    const { ev, players } = mkEvent({ n, courts, options: normalizeOptions(formatOptions({}, key)), durationMin: 180, segments: [{ start: '18:00', end: '21:00', modes: {} }] });
    const t0 = Date.now();
    const hist = publish(ev, players);
    playOut(ev, players, hist, 2);
    const ms = Date.now() - t0;
    assert.deepEqual(invariants(ev, players), []);
    assert.ok(ms < 3000, `${ms} ms`);
  });
}

if (matrixFailures.length) {
  console.log('\nmatrix details:');
  matrixFailures.forEach(([k, p]) => { console.log(`  ${k}: ${p.length}`); p.slice(0, 8).forEach(x => console.log(`    ${x}`)); });
}
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
