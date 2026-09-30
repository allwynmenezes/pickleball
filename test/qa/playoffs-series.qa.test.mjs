/* QA (exploratory) checks for playoffs (lib/playoffs.js) and series
   (lib/series.js) against docs/event-options.md FR-5 and FR-6, and
   docs/qa-test-plan.md section 2 items 4-5.
   Run from the repo root: node --no-warnings test/qa/playoffs-series.qa.test.mjs */
import assert from 'node:assert/strict';
import {
  buildBracket, resolvePlayoffs, playoffEntrants, playoffCourts, playoffMatchLocked, pairsPlayed, bracketOrder,
} from '../../lib/playoffs.js';
import { addDays, finishingOrder, nextSessionFields, seasonStandings, seasonStandingsFor } from '../../lib/series.js';
import { computeStandings } from '../../lib/standings.js';

let failures = 0, passes = 0;
const check = (name, fn) => {
  try { fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 6).join('\n        ')}`); }
};
const T = n => Array.from({ length: n }, (_, i) => [`s${i + 1}a`, `s${i + 1}b`]);
const bracket = (type, size, third = false) => ({ type, teams: T(size), matches: buildBracket(type, size, third) });
const key = t => (t ? t.join('+') : null);
/* Plays every ready match; decide(m) → true if team A wins. */
function playAll(p, decide) {
  for (let guard = 0; guard < 50; guard++) {
    resolvePlayoffs(p);
    const m = p.matches.find(x => x.teamA && x.teamB && (x.scoreA == null || x.scoreB == null));
    if (!m) break;
    const a = decide(m);
    m.scoreA = a ? 11 : 5; m.scoreB = a ? 5 : 11;
  }
  return resolvePlayoffs(p);
}

console.log('QA 4 · playoffs');
check('size is cut to the largest of 2/4/8 that fits: 3→2, 5→4, 7→4, 8→8, 1→none', () => {
  const rows = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
  const got = [3, 5, 7, 8, 1].map(n => playoffEntrants({ rows: rows(n), partners: 'singles', requested: 8 }).size);
  assert.deepEqual(got, [2, 4, 4, 8, 0]);
  const rot = [5, 9, 15, 16].map(n => playoffEntrants({ rows: rows(n), partners: 'rotating', requested: 8 }).size);
  assert.deepEqual(rot, [2, 4, 4, 8]);
});
check('rotating: 1&2N, 2&2N−1 … and no player is in two teams', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ id: `p${i}` }));
  const { teams } = playoffEntrants({ rows, partners: 'rotating', requested: 4 });
  assert.deepEqual(teams, [['p0', 'p7'], ['p1', 'p6'], ['p2', 'p5'], ['p3', 'p4']]);
});
check('single elimination of 8: bracket order 1v8, 4v5, 2v7, 3v6; final pairs the semifinal winners', () => {
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  const p = bracket('single', 8, true);
  const r = playAll(p, m => Number(m.teamA[0].slice(1, -1)) < Number(m.teamB[0].slice(1, -1)));
  assert.equal(key(r.champion), 's1a+s1b');
  assert.equal(key(r.runnerUp), 's2a+s2b');
  assert.equal(key(r.third), 's3a+s3b');
});
function doubleElimCheck(size, trials) {
  check(`double elimination of ${size}: ${trials} result patterns — nobody out before 2 losses, champion ≤ 1 loss, every team plays, GF = WB champion v LB champion`, () => {
    for (let t = 0; t < trials; t++) {
      const p = bracket('double', size);
      let bits = t; let seed = t * 7919 + 1;
      const r = playAll(p, () => { if (size === 4) { const b = bits & 1; bits >>= 1; return !!b; } seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 2 === 0; });
      assert.ok(r.champion, `trial ${t}: no champion`);
      const losses = new Map(p.teams.map(x => [key(x), 0])); const played = new Map(p.teams.map(x => [key(x), 0]));
      p.matches.forEach(m => {
        assert.ok(m.teamA && m.teamB, `trial ${t}: ${m.id} never filled`);
        assert.notEqual(key(m.teamA), key(m.teamB), `trial ${t}: ${m.id} a team plays itself`);
        const lost = m.scoreA > m.scoreB ? m.teamB : m.teamA;
        losses.set(key(lost), losses.get(key(lost)) + 1);
        played.set(key(m.teamA), played.get(key(m.teamA)) + 1); played.set(key(m.teamB), played.get(key(m.teamB)) + 1);
      });
      // Nobody plays after their second loss.
      const count = new Map(p.teams.map(x => [key(x), 0]));
      p.matches.forEach(m => { [m.teamA, m.teamB].forEach(x => assert.ok(count.get(key(x)) < 2, `trial ${t}: ${key(x)} plays ${m.id} after 2 losses`)); const lost = m.scoreA > m.scoreB ? m.teamB : m.teamA; count.set(key(lost), count.get(key(lost)) + 1); });
      assert.ok(losses.get(key(r.champion)) <= 1, `trial ${t}: champion lost ${losses.get(key(r.champion))}`);
      p.teams.forEach(x => { if (key(x) !== key(r.champion)) assert.ok(losses.get(key(x)) >= 1, `trial ${t}: ${key(x)} never lost but isn't champion`); });
      const gf = p.matches.find(m => m.id === 'GF');
      const wf = p.matches.find(m => m.id === `W${Math.log2(size)}-1`);
      const wbChamp = wf.scoreA > wf.scoreB ? wf.teamA : wf.teamB;
      assert.equal(key(gf.teamA), key(wbChamp));
      assert.equal(losses.get(key(gf.teamB)) - (gf.scoreB < gf.scoreA ? 1 : 0), 1, `trial ${t}: LB champion should arrive with exactly 1 loss`);
      p.teams.forEach(x => { if (key(x) !== key(gf.teamA) && key(x) !== key(gf.teamB)) assert.equal(losses.get(key(x)), 2, `trial ${t}: ${key(x)} out with ${losses.get(key(x))} loss(es)`); });
    }
  });
}
doubleElimCheck(4, 64);
doubleElimCheck(8, 300);
check('correcting a semifinal after the final has a score is locked', () => {
  const p = bracket('single', 4);
  playAll(p, () => true);
  assert.equal(playoffMatchLocked(p, 'W1-1'), true);
  assert.equal(playoffMatchLocked(p, 'W2-1'), false);
});
check('correcting a semifinal before the final is scored changes the final\'s team and clears nothing else', () => {
  const p = bracket('single', 4, true);
  resolvePlayoffs(p);
  const [sf1, sf2] = p.matches;
  sf1.scoreA = 11; sf1.scoreB = 3; sf2.scoreA = 11; sf2.scoreB = 9; resolvePlayoffs(p);
  sf1.scoreA = 3; sf1.scoreB = 11; resolvePlayoffs(p);
  const f = p.matches.find(m => m.id === 'W2-1'), third = p.matches.find(m => m.id === '3RD');
  assert.deepEqual([key(f.teamA), key(f.teamB)], ['s4a+s4b', 's2a+s2b']);
  assert.deepEqual([key(third.teamA), key(third.teamB)], ['s1a+s1b', 's3a+s3b']);
  assert.deepEqual([sf2.scoreA, sf2.scoreB], [11, 9]);
});
check('correcting a result without changing the winner keeps the later match\'s score', () => {
  const p = bracket('single', 4);
  playAll(p, () => true);
  const sf = p.matches[0]; sf.scoreB = 9; resolvePlayoffs(p);
  assert.equal(p.matches.find(m => m.id === 'W2-1').scoreA, 11);
});
check('ready matches get courts 1..N in bracket order; the rest wait', () => {
  const p = bracket('single', 8); resolvePlayoffs(p);
  const c = playoffCourts(p, 3);
  assert.deepEqual(['W1-1', 'W1-2', 'W1-3', 'W1-4'].map(id => c.get(id)), [1, 2, 3, null]);
  assert.equal(c.has('W2-1'), false);
});
check('fixed pairs: pairs ranked by their best player', () => {
  const rows = ['c', 'a', 'd', 'b'].map(id => ({ id }));
  const { teams } = playoffEntrants({ rows, partners: 'fixed', pairs: [['a', 'b'], ['c', 'd']], requested: 2 });
  assert.deepEqual(teams, [['c', 'd'], ['a', 'b']]);
});
check('fixed pairs changed during the event: no player is seeded into two playoff teams (store.startPlayoffs pair list)', () => {
  // The host re-paired after round 1: host pairs now h+p2, p3+p4; round 1 was played as h+p3 v p2+p4.
  const ev = { currentRoundIndex: 1, roster: [
    { courts: [{ court: 1, teamA: ['h', 'p3'], teamB: ['p2', 'p4'], scoreA: 11, scoreB: 2 }, { court: 2, teamA: ['p5', 'p6'], teamB: ['p7', 'p8'], scoreA: 11, scoreB: 4 }] },
    { courts: [{ court: 1, teamA: ['h', 'p2'], teamB: ['p5', 'p6'], scoreA: 11, scoreB: 6 }, { court: 2, teamA: ['p3', 'p4'], teamB: ['p7', 'p8'], scoreA: 11, scoreB: 8 }] },
  ] };
  const hostPairs = [['h', 'p2'], ['p3', 'p4'], ['p5', 'p6'], ['p7', 'p8']];
  // Same list lib/store.js startPlayoffs builds (lines 716-717).
  const seen = new Set();
  const pairs = [...hostPairs, ...pairsPlayed(ev)].filter(p => { const k = [...p].sort().join('+'); if (seen.has(k)) return false; seen.add(k); return true; });
  const { teams } = playoffEntrants({ rows: computeStandings(ev, 'winPct', 2), partners: 'fixed', pairs, requested: 4 });
  const all = teams.flat();
  assert.equal(new Set(all).size, all.length, `teams: ${JSON.stringify(teams)}`);
});
check('season seeding only seeds players who are in this session (FR-6 "Playoffs can be seeded from season standings")', () => {
  const g = (a, b, c, d) => ({ court: 1, teamA: [a, b], teamB: [c, d], scoreA: 11, scoreB: 1 });
  const s1 = { id: 's1', seriesId: 's1', date: '2026-09-01', startTime: '18:00', currentRoundIndex: 0, memberIds: ['a', 'b', 'c', 'd', 'x', 'y', 'z', 'w'], roster: [{ courts: [g('x', 'y', 'a', 'b'), { ...g('z', 'w', 'c', 'd'), court: 2 }] }] };
  const s2 = { id: 's2', seriesId: 's1', date: '2026-09-08', startTime: '18:00', currentRoundIndex: 0, memberIds: ['a', 'b', 'c', 'd'], rsvps: {}, roster: [{ courts: [g('a', 'c', 'b', 'd')] }] };
  // (Updated after the fix: the app seeds from seasonStandingsFor — season
  // form among this session's players.)
  const rows = seasonStandingsFor([s1, s2], s2, 'winPct');
  const { teams } = playoffEntrants({ rows, partners: 'rotating', requested: 2 });
  const here = new Set(s2.roster.flatMap(r => r.courts.flatMap(c => [...c.teamA, ...c.teamB])));
  assert.deepEqual(teams.flat().filter(id => !here.has(id)), [], `seeded ${JSON.stringify(teams)} for a session played by a,b,c,d`);
});

console.log('QA 5 · series');
check('addDays across month, year and leap-year boundaries', () => {
  assert.deepEqual(
    ['2026-01-28', '2025-12-29', '2024-02-25', '2023-02-25', '2024-02-28', '2026-10-29', '2026-03-05'].map(d => addDays(d, 7)),
    ['2026-02-04', '2026-01-05', '2024-03-03', '2023-03-04', '2024-03-06', '2026-11-05', '2026-03-12'],
  );
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
});
check('ladder finishing order: last round court 1 down, winners first; sit-outs after, by standings; unscored court keeps team A first', () => {
  const ev = { memberIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], currentRoundIndex: 1, options: { repeat: 'ladder' }, roster: [
    { courts: [{ court: 1, teamA: ['a', 'b'], teamB: ['c', 'd'], scoreA: 11, scoreB: 3 }, { court: 2, teamA: ['e', 'f'], teamB: ['g', 'h'], scoreA: 11, scoreB: 9 }], sitOut: ['i', 'j'] },
    { courts: [{ court: 1, teamA: ['a', 'i'], teamB: ['b', 'e'], scoreA: 2, scoreB: 11 }, { court: 2, teamA: ['c', 'j'], teamB: ['f', 'd'] }], sitOut: ['g', 'h'] },
  ] };
  const order = finishingOrder(ev);
  assert.deepEqual(order.slice(0, 8), ['b', 'e', 'a', 'i', 'c', 'j', 'f', 'd']);
  assert.deepEqual(order.slice(8).sort(), ['g', 'h']);
  const next = nextSessionFields({ ...ev, id: 'L1', name: 'Ladder', date: '2026-12-29', startTime: '18:00', durationMin: 60, courts: 2 });
  assert.deepEqual([next.date, next.options.seeding, next.options.seedOrder.length, next.seriesId], ['2027-01-05', 'manual', 10, 'L1']);
});
check('ladder: members who never played still get a seed; non-members are left out', () => {
  const ev = { id: 'L', date: '2026-01-01', memberIds: ['a', 'b', 'c', 'd', 'new'], currentRoundIndex: 0, options: { repeat: 'ladder' },
    roster: [{ courts: [{ court: 1, teamA: ['a', 'b'], teamB: ['c', 'gone'], scoreA: 11, scoreB: 3 }] }] };
  const o = nextSessionFields(ev).options.seedOrder;
  assert.deepEqual(o, ['a', 'b', 'c', 'd', 'new']); // 'd' is a member who didn't play; 'gone' isn't a member
});
check('season standings add every session; a session with no roster is fine', () => {
  const e = (id, date, roster) => ({ id, seriesId: 'S', date, startTime: '18:00', roster });
  const rows = seasonStandings([e('1', '2026-01-01', [{ courts: [{ court: 1, teamA: ['a'], teamB: ['b'], scoreA: 11, scoreB: 2 }] }]), e('2', '2026-01-08', null), e('3', '2026-01-15', [{ courts: [{ court: 1, teamA: ['a'], teamB: ['b'], scoreA: 3, scoreB: 11 }] }])], 'S');
  assert.deepEqual(rows.map(r => [r.id, r.wins, r.games]), [['a', 1, 2], ['b', 1, 2]]);
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
