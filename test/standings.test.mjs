/* Tests for lib/standings.js — run with `npm test` from the project root. */
import assert from 'node:assert/strict';
import { finishedGames, computeStandings } from '../lib/standings.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message.split('\n').join('\n        ')}`); }
};
const court = (courtNo, teamA, teamB, scoreA = null, scoreB = null) => ({ court: courtNo, mode: 'open', teamA, teamB, scoreA, scoreB });
const round = (...courts) => ({ offset: 0, courts, sitOut: [] });
const by = (list, id) => list.find(r => r.id === id);

console.log('standings');
{
  const ev = {
    currentRoundIndex: 2,
    roster: [
      round(court(1, ['a', 'b'], ['c', 'd'], 11, 5), court(2, ['e', 'f'], ['g', 'h'], 9, 11)),
      round(court(1, ['a', 'c'], ['e', 'g'], 11, 9), court(2, ['b', 'd'], ['f', 'h'], 4, 11)),
      round(court(1, ['a', 'e'], ['b', 'f'], 7, 11), court(2, ['c', 'g'], ['d', 'h'])), // court 2 not scored yet
      round(court(1, ['a', 'h'], ['b', 'g'], 11, 0)), // future round: ignored
    ],
  };
  check('only finished games up to the current round count', () => {
    const g = finishedGames(ev);
    assert.equal(g.length, 5);
    assert.ok(g.every(x => x.round <= 2));
  });
  check('win % with average point differential', () => {
    const s = computeStandings(ev, 'winPct');
    const a = by(s, 'a');
    assert.deepEqual([a.games, a.wins, a.losses, a.pointsFor, a.pointsAgainst], [3, 2, 1, 29, 25]);
    assert.equal(Math.round(a.winPct * 100), 67);
    assert.equal(a.avgDiff, 4 / 3);
  });
  check('ranked by win %, then average point differential', () => {
    const s = computeStandings(ev, 'winPct');
    // h and f both 2-0/2-1… check ordering is monotonic in winPct then avgDiff
    for (let i = 1; i < s.length; i++) {
      const p = s[i - 1], c = s[i];
      assert.ok(p.winPct > c.winPct || (p.winPct === c.winPct && p.avgDiff >= c.avgDiff), `${p.id} before ${c.id}`);
    }
    assert.equal(s[0].id, 'h'); // 2-0
  });
  check('court points: a win on the top court is worth more', () => {
    const s = computeStandings(ev, 'courtPoints');
    // two courts per round: court 1 win = 2 points, court 2 win = 1 point
    assert.equal(by(s, 'a').courtPoints, 2 + 2);       // won court 1 twice
    assert.equal(by(s, 'h').courtPoints, 1 + 1);       // won court 2 twice
    assert.equal(by(s, 'b').courtPoints, 2 + 2);       // court 1 (r1) + court 1 (r3)
    assert.ok(s.findIndex(r => r.id === 'a') < s.findIndex(r => r.id === 'h'));
  });
  check('equal scores are not a finished game; players with no games are not listed', () => {
    const s = computeStandings({ currentRoundIndex: 0, roster: [round(court(1, ['a', 'b'], ['c', 'd'], 5, 5))] });
    assert.deepEqual(s, []);
  });
  check('tied players share a rank', () => {
    const s = computeStandings({ currentRoundIndex: 0, roster: [round(court(1, ['a', 'b'], ['c', 'd'], 11, 5))] });
    assert.deepEqual(s.map(r => [r.id, r.rank]), [['a', 1], ['b', 1], ['c', 3], ['d', 3]]);
  });
  check('a sit-out never counts against a player', () => {
    const s = computeStandings({ currentRoundIndex: 1, roster: [
      { ...round(court(1, ['a', 'b'], ['c', 'd'], 11, 5)), sitOut: ['e'] },
      round(court(1, ['e', 'b'], ['c', 'd'], 11, 3)),
    ] });
    assert.deepEqual([by(s, 'e').games, by(s, 'e').winPct], [1, 1]);
  });
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
