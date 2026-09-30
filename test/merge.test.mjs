/* Tests for lib/merge.js (live sync while a save is failing). Run with `npm test`. */
import assert from 'node:assert/strict';
import { threeWayMerge } from '../lib/merge.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); }
};
const clone = x => JSON.parse(JSON.stringify(x));
const court = (n, teamA, teamB, scoreA = null, scoreB = null) => ({ court: n, teamA, teamB, scoreA, scoreB });
const base = {
  players: [{ id: 'a', name: 'A' }], chats: [{ id: 'c', messages: [{ id: 'm1', ts: 1 }] }], history: {}, flagThreshold: 3,
  events: [
    { id: 'e1', currentRoundIndex: 0, rsvps: { a: { status: 'in' } }, roster: [
      { offset: 0, courts: [court(1, ['a', 'b'], ['c', 'd']), court(2, ['e', 'f'], ['g', 'h'])] },
      { offset: 15, courts: [court(1, ['a', 'c'], ['b', 'd'])] },
    ] },
    { id: 'e2', name: 'Other' },
  ],
};

console.log('merge');
check('the host moving on and our unsaved score both survive', () => {
  const local = clone(base); Object.assign(local.events[0].roster[0].courts[0], { scoreA: 11, scoreB: 5, baseAt: 0 });
  const remote = clone(base); remote.events[0].currentRoundIndex = 1; Object.assign(remote.events[0].roster[0].courts[1], { scoreA: 9, scoreB: 11, scoredAt: 5 });
  const m = threeWayMerge(base, local, remote).events[0];
  assert.equal(m.currentRoundIndex, 1);
  assert.deepEqual([m.roster[0].courts[0].scoreA, m.roster[0].courts[0].baseAt, m.roster[0].courts[1].scoreB], [11, 0, 11]);
});
check('our score is dropped if the game changed on the server', () => {
  const local = clone(base); Object.assign(local.events[0].roster[1].courts[0], { scoreA: 11, scoreB: 2 });
  const remote = clone(base); remote.events[0].roster[1].courts[0] = court(1, ['a', 'd'], ['b', 'c']);
  assert.equal(threeWayMerge(base, local, remote).events[0].roster[1].courts[0].scoreA, null);
});
check('our RSVP change survives; events we didn\'t touch follow the server', () => {
  const local = clone(base); local.events[0].rsvps.a = { status: 'out' };
  const remote = clone(base); remote.events[0].started = true; remote.events[1].name = 'Renamed';
  const m = threeWayMerge(base, local, remote);
  assert.deepEqual([m.events[0].rsvps.a.status, m.events[0].started, m.events[1].name], ['out', true, 'Renamed']);
});
check('chats keep messages from both sides; new events on either side are kept', () => {
  const local = clone(base); local.chats[0].messages.push({ id: 'm2', ts: 3 }); local.events.push({ id: 'mine' });
  const remote = clone(base); remote.chats[0].messages.push({ id: 'm3', ts: 2 }); remote.events.push({ id: 'theirs' });
  const m = threeWayMerge(base, local, remote);
  assert.deepEqual(m.chats[0].messages.map(x => x.id), ['m1', 'm3', 'm2']);
  assert.deepEqual(m.events.map(e => e.id).sort(), ['e1', 'e2', 'mine', 'theirs']);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
