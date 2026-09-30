/* Tests for lib/playoffs.js, lib/series.js and lib/formats.js. Run with `npm test`. */
import assert from 'node:assert/strict';
import { buildBracket, resolvePlayoffs, bracketOrder, playoffEntrants, playoffCourts, playoffMatchLocked } from '../lib/playoffs.js';
import { seasonStandings, nextSessionFields, finishingOrder, addDays } from '../lib/series.js';
import { FORMATS, formatOptions, normalizeOptions, describeOptions } from '../lib/formats.js';
import { eventOptions } from '../lib/engine.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); }
};
const teams = n => Array.from({ length: n }, (_, i) => [`t${i + 1}`]);
/* Plays a match: the better seed (lower number) wins unless told otherwise. */
const play = (p, id, aWins = true) => { const m = p.matches.find(x => x.id === id); m.scoreA = aWins ? 11 : 5; m.scoreB = aWins ? 5 : 11; resolvePlayoffs(p); };

console.log('playoffs');
check('bracket order: 1 v 8, 4 v 5, 2 v 7, 3 v 6', () => {
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.deepEqual(bracketOrder(4), [1, 4, 2, 3]);
});
check('single elimination of 8: 7 matches (+ 3rd place), top seed wins it all', () => {
  const p = { type: 'single', teams: teams(8), matches: buildBracket('single', 8, true) };
  assert.equal(p.matches.length, 8);
  resolvePlayoffs(p);
  ['W1-1', 'W1-2', 'W1-3', 'W1-4', 'W2-1', 'W2-2', 'W3-1', '3RD'].forEach(id => play(p, id));
  const r = resolvePlayoffs(p);
  assert.deepEqual([r.champion, r.runnerUp, r.third], [['t1'], ['t2'], ['t4']]);
  assert.equal(p.matches.find(m => m.id === 'W3-1').label, 'Final');
});
check('double elimination of 4: a team is out after two losses; grand final', () => {
  const p = { type: 'double', teams: teams(4), matches: buildBracket('double', 4) };
  assert.deepEqual(p.matches.map(m => m.id), ['W1-1', 'W1-2', 'W2-1', 'L1-1', 'L2-1', 'GF']);
  resolvePlayoffs(p);
  play(p, 'W1-1'); play(p, 'W1-2'); // t1 beat t4, t2 beat t3
  play(p, 'W2-1', false);             // t2 beats t1 in the winners' final
  assert.deepEqual([p.matches[3].teamA, p.matches[3].teamB], [['t4'], ['t3']]);
  play(p, 'L1-1', false);             // t3 beats t4 (t4 out)
  assert.deepEqual([p.matches[4].teamA, p.matches[4].teamB], [['t3'], ['t1']]);
  play(p, 'L2-1', false);             // t1 beats t3
  assert.deepEqual([p.matches[5].teamA, p.matches[5].teamB], [['t2'], ['t1']]);
  play(p, 'GF', false);
  assert.deepEqual(resolvePlayoffs(p).champion, ['t1']);
});
check('double elimination of 8: 14 matches, every team but the champion loses twice', () => {
  const p = { type: 'double', teams: teams(8), matches: buildBracket('double', 8) };
  assert.equal(p.matches.length, 14);
  resolvePlayoffs(p);
  const losses = new Map();
  p.matches.forEach(m => {
    const aWins = Number(m.teamA[0].slice(1)) < Number(m.teamB[0].slice(1)); // better seed wins
    play(p, m.id, aWins);
    const loser = aWins ? m.teamB : m.teamA;
    losses.set(loser[0], (losses.get(loser[0]) || 0) + 1);
  });
  assert.deepEqual(resolvePlayoffs(p).champion, ['t1']);
  for (let i = 2; i <= 8; i++) assert.ok(losses.get(`t${i}`) >= 1, `t${i}`);
  assert.equal([...losses.values()].reduce((a, b) => a + b, 0), 14);
});
check('correcting an earlier result clears the stale later score', () => {
  const p = { type: 'single', teams: teams(4), matches: buildBracket('single', 4) };
  resolvePlayoffs(p);
  play(p, 'W1-1'); play(p, 'W1-2'); play(p, 'W2-1');
  assert.ok(playoffMatchLocked(p, 'W1-1'));
  const m = p.matches[0]; m.scoreA = 2; m.scoreB = 11; resolvePlayoffs(p);
  assert.deepEqual(p.matches[2].teamA, ['t4']);
  assert.equal(p.matches[2].scoreA, null);
});
check('courts go to ready matches in bracket order', () => {
  const p = { type: 'single', teams: teams(8), matches: buildBracket('single', 8) };
  resolvePlayoffs(p);
  const courts = playoffCourts(p, 3);
  assert.deepEqual([courts.get('W1-1'), courts.get('W1-3'), courts.get('W1-4'), courts.has('W2-1')], [1, 3, null, false]);
});
check('entrants: rotating partners pair the best with the worst of the top 2N', () => {
  const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map(id => ({ id }));
  assert.deepEqual(playoffEntrants({ rows, partners: 'rotating', requested: 4 }), { size: 4, teams: [['a', 'h'], ['b', 'g'], ['c', 'f'], ['d', 'e']] });
  assert.equal(playoffEntrants({ rows: rows.slice(0, 5), partners: 'rotating', requested: 8 }).size, 2);
});
check('entrants: fixed pairs placed by their best player; singles by rank', () => {
  const rows = ['c', 'a', 'd', 'b'].map(id => ({ id }));
  assert.deepEqual(playoffEntrants({ rows, partners: 'fixed', pairs: [['a', 'b'], ['c', 'd']], requested: 4 }).teams, [['c', 'd'], ['a', 'b']]);
  assert.deepEqual(playoffEntrants({ rows, partners: 'singles', requested: 4 }).teams, [['c'], ['a'], ['d'], ['b']]);
});

console.log('series');
const court = (n, teamA, teamB, scoreA = null, scoreB = null) => ({ court: n, teamA, teamB, scoreA, scoreB });
check('season standings add up every session in the series', () => {
  const events = [
    { seriesId: 's', date: '2026-10-06', startTime: '18:00', roster: [{ courts: [court(1, ['a', 'b'], ['c', 'd'], 11, 3)] }] },
    { seriesId: 's', date: '2026-10-13', startTime: '18:00', roster: [{ courts: [court(1, ['a', 'c'], ['b', 'd'], 11, 9)] }] },
    { seriesId: 'other', date: '2026-10-13', startTime: '18:00', roster: [{ courts: [court(1, ['d', 'x'], ['y', 'z'], 11, 0)] }] },
  ];
  const s = seasonStandings(events, 's');
  const by = id => s.find(r => r.id === id);
  assert.deepEqual([by('a').wins, by('a').games, by('d').wins, by('d').games], [2, 2, 0, 2]);
});
check('next session: a week later, same setup, a ladder seeded by finishing order', () => {
  const ev = {
    id: 'e1', name: 'Ladder', date: '2026-12-29', startTime: '18:00', durationMin: 60, courts: 2, gameLenMin: 15,
    segments: [{ start: '18:00', end: '19:00', modes: { 1: 'open' } }], memberIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    options: { repeat: 'ladder', movement: 'game' }, currentRoundIndex: 0,
    roster: [{ courts: [court(1, ['a', 'b'], ['c', 'd'], 5, 11), court(2, ['e', 'f'], ['g', 'h'], 11, 2)] }],
  };
  const next = nextSessionFields(ev);
  assert.equal(next.date, '2027-01-05');
  assert.equal(next.seriesId, 'e1');
  assert.deepEqual(next.options.seedOrder, ['c', 'd', 'a', 'b', 'e', 'f', 'g', 'h']);
  assert.equal(next.options.seeding, 'manual');
  assert.deepEqual(finishingOrder(ev).slice(0, 2), ['c', 'd']);
  assert.equal(addDays('2026-02-26', 7), '2026-03-05');
});

console.log('formats');
check('every preset produces valid, normalised options', () => {
  FORMATS.forEach(f => {
    const o = formatOptions({}, f.key);
    assert.deepEqual(normalizeOptions(o), o, f.key);
    assert.equal(o.format, f.key);
    assert.ok(describeOptions({ options: o }).length > 0);
  });
});
check('switching format keeps the host\'s pairs and seed order', () => {
  const ev = { options: { pairs: [['a', 'b']], seedOrder: ['b', 'a'], movement: 'game' } };
  const o = formatOptions(ev, 'shuffle');
  assert.deepEqual([o.pairs, o.seedOrder, o.movement, o.partners], [[['a', 'b']], ['b', 'a'], 'none', 'fixed']);
  assert.equal(eventOptions({ options: o }).extras, 'waitlist');
});
check('normalising: groups move per set; movement turns standings on', () => {
  assert.equal(normalizeOptions({ groups: 'fixed', movement: 'game', standings: 'off', playoffs: 'none' }).movement, 'set');
  assert.equal(normalizeOptions({ groups: 'off', movement: 'game', standings: 'off', playoffs: 'none' }).standings, 'courtPoints');
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
