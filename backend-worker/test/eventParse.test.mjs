/* Unit tests for src/eventParse.js — the code-only half of "describe your
   event". No server, no AI calls: run with `npm run test:parse`. */
import assert from 'node:assert/strict';
import { extractFromText, buildSegments, matchPlayers, buildDraft } from '../src/eventParse.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message}`); }
};

// Saturday 26 Sep 2026, 10am, US Pacific (UTC-7).
const opts = { now: '2026-09-26T10:00:00-07:00', tzOffsetMin: -420 };
const x = t => extractFromText(t, opts);

console.log('extractFromText');
check('weekday, time range, courts, game length', () => assert.deepEqual(
  x('Next Tuesday 6 to 10pm, 4 courts, 15-minute games'),
  { date: '2026-09-29', startTime: '18:00', durationMin: 240, courts: 4, gameLenMin: 15 },
));
check('"for 3 hours" and number words', () => assert.deepEqual(
  x('tomorrow 7pm for 3 hours on three courts'),
  { date: '2026-09-27', startTime: '19:00', durationMin: 180, courts: 3 },
));
check('day and time in separate phrases; bare 6:30 means evening', () => assert.deepEqual(
  x('Friday night doubles at 6:30 till 9'),
  { date: '2026-10-02', startTime: '18:30', durationMin: 150 },
));
check('explicit am is kept', () => assert.deepEqual(x('Sunday 7am to 9am'), { date: '2026-09-27', startTime: '07:00', durationMin: 120 }));
check('runs past midnight', () => assert.equal(x('tomorrow 11pm to 1am').durationMin, 120));
check('"games of 12 minutes"', () => assert.equal(x('games of 12 minutes, 2 courts').gameLenMin, 12));
check('an hour and a half', () => assert.equal(x('Monday 6pm for an hour and a half').durationMin, 90));
check('uses the user\'s timezone, not the server\'s', () => {
  // 11pm Friday in UTC-7 is already Saturday in UTC.
  assert.equal(extractFromText('tomorrow 6pm', { now: '2026-09-25T23:00:00-07:00', tzOffsetMin: -420 }).date, '2026-09-26');
});
check('nothing event-like → empty', () => assert.deepEqual(x('what is the weather like'), {}));

console.log('buildSegments');
const ev = { startTime: '18:00', durationMin: 240, courts: 2 };
check('no segments → one open segment', () => assert.deepEqual(buildSegments([], ev), [{ start: '18:00', end: '22:00', modes: {} }]));
check('mixed first hour, then open', () => assert.deepEqual(
  buildSegments([{ mode: 'mixed', minutes: 60 }, { mode: 'open', minutes: 0 }], ev),
  [{ start: '18:00', end: '19:00', modes: { 1: 'mixed', 2: 'mixed' } }, { start: '19:00', end: '22:00', modes: {} }],
));
check('last segment stretches to the end', () => assert.equal(buildSegments([{ mode: 'women', minutes: 30 }, { mode: 'men', minutes: 30 }], ev)[1].end, '22:00'));
check('segments past the end are dropped', () => assert.equal(buildSegments([{ mode: 'mixed', minutes: 300 }, { mode: 'men', minutes: 60 }], ev).length, 1));
check('unknown mode becomes open', () => assert.deepEqual(buildSegments([{ mode: 'chaos', minutes: 0 }], ev)[0].modes, {}));

console.log('matchPlayers');
const players = [{ id: 'a', name: 'Priya Shah' }, { id: 'b', name: 'Sam Lee' }, { id: 'c', name: 'Samantha Cruz' }, { id: 'd', name: 'Ben' }, { id: 'e', name: 'Ben Ortiz' }];
check('first name, misspelling, prefix', () => assert.deepEqual(matchPlayers(['priya', 'Samanta', 'sam'], players), { matched: ['a', 'c', 'b'], unmatched: [] }));
check('unknown names are reported, not guessed', () => assert.deepEqual(matchPlayers(['Zed'], players).unmatched, ['Zed']));
check('exact full name wins over ambiguity', () => assert.deepEqual(matchPlayers(['Ben'], players).matched, ['d']));
check('ambiguous prefix is reported', () => assert.deepEqual(matchPlayers(['Be'], [{ id: 'x', name: 'Bea' }, { id: 'y', name: 'Bev' }]).unmatched, ['Be']));

console.log('buildDraft');
check('text wins over the model for dates; model fills the rest', () => {
  const r = buildDraft('Next Tuesday 6 to 10pm', {
    isEvent: true, name: 'Tuesday Mixer', date: '2026-12-25', startTime: '09:00', endTime: '', durationMin: 0,
    courts: 3, gameLenMin: 0, segments: [{ mode: 'mixed', minutes: 60 }], playerNames: ['Priya', 'Zed'], inviteEveryone: false,
  }, players, opts);
  assert.equal(r.draft.date, '2026-09-29');
  assert.equal(r.draft.startTime, '18:00');
  assert.equal(r.draft.courts, 3);
  assert.equal(r.draft.name, 'Tuesday Mixer');
  assert.deepEqual(r.draft.memberIds, ['a']);
  assert.deepEqual(r.unmatchedNames, ['Zed']);
  assert.equal(r.draft.segments.length, 1); // mixed for the whole session: last segment runs to the end
});
check('works without the model (AI down)', () => {
  const r = buildDraft('Thursday 7 to 9pm, 2 courts', null, players, opts);
  assert.deepEqual(r.draft, { name: 'Thursday Evening', date: '2026-10-01', startTime: '19:00', durationMin: 120, courts: 2, gameLenMin: 15, segments: [{ start: '19:00', end: '21:00', modes: {} }], memberIds: [] });
});
check('values are clamped', () => {
  const r = buildDraft('99 courts', { isEvent: true, gameLenMin: 500 }, players, opts);
  assert.equal(r.draft.courts, 20);
  assert.equal(r.draft.gameLenMin, 60);
});
check('everyone invited', () => assert.equal(buildDraft('Tuesday 6pm, everyone', { isEvent: true, inviteEveryone: true }, players, opts).draft.memberIds.length, 5));
check('model says not an event and text has nothing → null', () => assert.equal(buildDraft('write me a poem', { isEvent: false, name: 'Poem', courts: 2 }, players, opts), null));

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
