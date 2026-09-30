/* Tests for enforceEventHosts (src/state.js): what a non-host may change on
   a hosted event — notably scores. Run with `npm run test:parse`. */
import assert from 'node:assert/strict';
import { enforceEventHosts } from '../src/state.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message.split('\n').join('\n        ')}`); }
};
const clone = x => JSON.parse(JSON.stringify(x));
const court = (n, teamA, teamB, scoreA = null, scoreB = null) => ({ court: n, mode: 'open', teamA, teamB, scoreA, scoreB });
const stored = {
  id: 'e1', name: 'Tue', createdBy: 'host', published: true, started: true, currentRoundIndex: 1,
  options: { standings: 'winPct' }, checkedIn: { a: true },
  roster: [
    { offset: 0, courts: [court(1, ['a', 'b'], ['c', 'd'], 11, 7), court(2, ['e', 'f'], ['g', 'h'], 11, 9)] },
    { offset: 15, courts: [court(1, ['a', 'c'], ['e', 'g']), court(2, ['b', 'd'], ['f', 'h'])] },
    { offset: 30, courts: [court(1, ['a', 'd'], ['b', 'g']), court(2, ['c', 'e'], ['f', 'h'])] },
  ],
};
const save = (edit, requester) => {
  const incoming = clone(stored); edit(incoming);
  return enforceEventHosts([incoming], [clone(stored)], requester)[0];
};

console.log('scores and event day');
check('a player can enter the score of their own game', () => {
  const out = save(ev => { ev.roster[1].courts[0].scoreA = 11; ev.roster[1].courts[0].scoreB = 4; }, 'a');
  assert.deepEqual([out.roster[1].courts[0].scoreA, out.roster[1].courts[0].scoreB], [11, 4]);
});
check('…but not the score of someone else\'s game', () => {
  const out = save(ev => { ev.roster[1].courts[1].scoreA = 11; }, 'a');
  assert.equal(out.roster[1].courts[1].scoreA, null);
});
check('…and not change who played in rounds already played', () => {
  const out = save(ev => { ev.roster[0].courts[0].teamA = ['a', 'z']; ev.roster[0].courts[1].scoreA = 0; }, 'a');
  assert.deepEqual(out.roster[0], stored.roster[0]);
});
check('…and can correct their own score in a played round', () => {
  const out = save(ev => { ev.roster[0].courts[0].scoreB = 8; }, 'c');
  assert.equal(out.roster[0].courts[0].scoreB, 8);
});
check('a recompute of the current and later rounds (a player\'s RSVP change) still goes through', () => {
  const out = save(ev => { ev.roster[2].courts[1] = court(2, ['c', 'x'], ['f', 'h']); }, 'e');
  assert.deepEqual(out.roster[2].courts[1].teamA, ['c', 'x']);
});
check('running the day and options are host-only', () => {
  const out = save(ev => { ev.currentRoundIndex = 2; ev.started = false; ev.published = false; ev.options = { standings: 'off' }; ev.checkedIn = {}; }, 'a');
  assert.deepEqual([out.currentRoundIndex, out.started, out.published, out.options, out.checkedIn], [1, true, true, { standings: 'winPct' }, { a: true }]);
});
check('the host can change anything', () => {
  const out = save(ev => { ev.roster[1].courts[1].scoreA = 11; ev.currentRoundIndex = 2; ev.roster[0].courts[0].teamA = ['a', 'z']; }, 'host');
  assert.deepEqual([out.roster[1].courts[1].scoreA, out.currentRoundIndex, out.roster[0].courts[0].teamA], [11, 2, ['a', 'z']]);
});
check('an event with no host stays open to everyone', () => {
  const hostless = { ...clone(stored), createdBy: undefined };
  const incoming = clone(hostless); incoming.roster[1].courts[1].scoreA = 11; incoming.currentRoundIndex = 2;
  const out = enforceEventHosts([incoming], [hostless], 'a')[0];
  assert.deepEqual([out.roster[1].courts[1].scoreA, out.currentRoundIndex], [11, 2]);
});
check('a signed-out save changes no scores', () => {
  const out = save(ev => { ev.roster[1].courts[0].scoreA = 11; }, null);
  assert.equal(out.roster[1].courts[0].scoreA, null);
});

console.log('newer score wins');
const scored = (ev, ri, ci, a, b, at) => Object.assign(ev.roster[ri].courts[ci], { scoreA: a, scoreB: b, scoredAt: at });
check('the host saving an out-of-date copy keeps a player\'s newer score', () => {
  const prev = clone(stored); scored(prev, 1, 1, 11, 6, 2000); // a player (f) scored at t=2000
  const incoming = clone(stored); scored(incoming, 1, 1, 3, 11, 1000); incoming.name = 'Renamed';
  const out = enforceEventHosts([incoming], [prev], 'host')[0];
  assert.deepEqual([out.roster[1].courts[1].scoreA, out.roster[1].courts[1].scoreB, out.name], [11, 6, 'Renamed']);
});
check('…but the host\'s own newer correction goes through', () => {
  const prev = clone(stored); scored(prev, 1, 1, 11, 6, 2000);
  const incoming = clone(stored); scored(incoming, 1, 1, 11, 8, 3000);
  assert.equal(enforceEventHosts([incoming], [prev], 'host')[0].roster[1].courts[1].scoreB, 8);
});
check('a player\'s stale copy doesn\'t undo a newer score on their own game', () => {
  const prev = clone(stored); scored(prev, 1, 0, 11, 2, 5000);
  const incoming = clone(stored); scored(incoming, 1, 0, 4, 11, 4000);
  assert.deepEqual([enforceEventHosts([incoming], [prev], 'a')[0].roster[1].courts[0].scoreA], [11]);
});

console.log('playoffs');
const bracket = () => ({
  type: 'single', teams: [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']],
  matches: [
    { id: 'W1-1', a: { seed: 1 }, b: { seed: 4 }, teamA: ['a', 'b'], teamB: ['g', 'h'], scoreA: null, scoreB: null },
    { id: 'W1-2', a: { seed: 2 }, b: { seed: 3 }, teamA: ['c', 'd'], teamB: ['e', 'f'], scoreA: null, scoreB: null },
    { id: 'W2-1', a: { winnerOf: 'W1-1' }, b: { winnerOf: 'W1-2' }, teamA: null, teamB: null, scoreA: null, scoreB: null },
  ],
});
const withBracket = () => ({ ...clone(stored), playoffs: bracket() });
check('a player scores their own playoff match; the final fills in', () => {
  const prev = withBracket();
  const incoming = clone(prev); Object.assign(incoming.playoffs.matches[0], { scoreA: 11, scoreB: 4, scoredAt: 10 });
  const out = enforceEventHosts([incoming], [prev], 'g')[0];
  assert.deepEqual([out.playoffs.matches[0].scoreA, out.playoffs.matches[2].teamA], [11, ['a', 'b']]);
});
check('…but not someone else\'s match, nor the bracket itself', () => {
  const prev = withBracket();
  const incoming = clone(prev);
  Object.assign(incoming.playoffs.matches[1], { scoreA: 11, scoreB: 4, scoredAt: 10 });
  incoming.playoffs.teams[0] = ['z', 'y'];
  const out = enforceEventHosts([incoming], [prev], 'a')[0];
  assert.deepEqual([out.playoffs.matches[1].scoreA, out.playoffs.teams[0]], [null, ['a', 'b']]);
});
check('a player can\'t start or remove playoffs; the host can', () => {
  const started = { ...clone(stored), playoffs: bracket() };
  assert.equal(enforceEventHosts([started], [clone(stored)], 'a')[0].playoffs, undefined);
  const removed = clone(stored);
  assert.ok(enforceEventHosts([removed], [withBracket()], 'a')[0].playoffs);
  assert.equal(enforceEventHosts([removed], [withBracket()], 'host')[0].playoffs, undefined);
  assert.ok(enforceEventHosts([started], [clone(stored)], 'host')[0].playoffs);
});
check('the series an event belongs to is host-only', () => {
  const out = save(ev => { ev.seriesId = 'hijack'; }, 'a');
  assert.equal(out.seriesId, undefined);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
