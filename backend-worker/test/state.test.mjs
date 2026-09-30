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

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
