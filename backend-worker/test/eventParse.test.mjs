/* Unit tests for src/eventParse.js — the code-only half of "describe your
   event". No server, no AI calls: run with `npm run test:parse`. */
import assert from 'node:assert/strict';
import { extractFromText, buildSegments, buildTimedSegments, matchPlayers, buildDraft, buildEdit, fixCommonMishearings, describeModes } from '../src/eventParse.js';

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
check('"9 to noon" keeps the morning start', () => assert.deepEqual(x('Saturday 9 to noon, 4 courts'), { date: '2026-09-26', startTime: '09:00', durationMin: 180, courts: 4 }));
check('weekday after the time range', () => assert.deepEqual(x('night session 8pm to midnight on Friday'), { date: '2026-10-02', startTime: '20:00', durationMin: 240 }));
check('"7ish" and "tmrw"', () => assert.deepEqual(x('tmrw 7ish till 10'), { date: '2026-09-27', startTime: '19:00', durationMin: 180 }));
check('short weekday names', () => assert.equal(x('tues 6pm').date, '2026-09-29'));
check('"two and a half hours" and bare "2hrs"', () => {
  assert.equal(x('Wednesday at 6 for two and a half hours').durationMin, 150);
  assert.equal(x('sunday 4pm 2hrs 3 courts').durationMin, 120);
});
check('"games of 20 minutes" is not read as a time', () => assert.deepEqual(
  x('games of 20 minutes, 3 courts, next Friday 5 to 8'),
  { date: '2026-10-02', startTime: '17:00', durationMin: 180, courts: 3, gameLenMin: 20 },
));
check('a time range beats a part\'s length; "a 15 minute break" is not a time', () => assert.deepEqual(
  x("men's doubles for an hour, then a 15 minute break, then mixed. Saturday 3 to 6pm"),
  { date: '2026-09-26', startTime: '15:00', durationMin: 180 },
));
check('"half day" is not a time; the dated range wins', () => assert.deepEqual(
  x('half day event on Oct 17 from 9 till 1, 6 courts, women first 2 hours then mixed'),
  { date: '2026-10-17', startTime: '09:00', durationMin: 240, courts: 6 },
));
check('the event\'s length, not a part\'s, when several are mentioned', () => {
  const t = 'Next Thursday. The event will span for a duration of four hours. The games will go on for one hour and after one hour there will be a break of ten minutes.';
  assert.equal(x(t).durationMin, 240);
  assert.equal(x('the game spanning for a period of four hours').durationMin, 240);
  assert.equal(x('Tuesday 6pm, mixed for 30 minutes then open').durationMin, undefined, 'a part\'s length is not the event\'s');
});
check('"one court will have mixed" is about a court, not a count', () => {
  assert.equal(x('One court will have a mixed game and the other any combination').courts, undefined);
  assert.equal(x('Make one court mixed').courts, undefined);
  assert.equal(x('Tuesday 6pm on 1 court').courts, 1);
  assert.equal(x('just one court, friday 6pm').courts, 1);
});
check('game length, however it\'s put', () => {
  assert.equal(x('Can you update the game length to be 20mins each?').gameLenMin, 20);
  assert.equal(x('game length 12 min').gameLenMin, 12);
  assert.equal(x('make each game 20 minutes').gameLenMin, 20);
  assert.equal(x('games should be 18 minutes').gameLenMin, 18);
  assert.equal(x('20 min rounds, 3 courts').gameLenMin, 20);
  assert.equal(x('Tuesday 6pm for 2 hours, 15 min each').gameLenMin, 15);
  assert.equal(x('mixed for the first 30 minutes').gameLenMin, undefined, 'a part of the session is not a game length');
});
check('"15 min games" is not a duration', () => assert.equal(x('Monday 6pm, 15 min games').durationMin, undefined));
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

console.log('buildTimedSegments');
{
  const ev4 = { startTime: '18:00', durationMin: 240, courts: 2 };
  const seg = (start, end, mode, courtModes = []) => ({ start, end, mode, courtModes });
  const show = segs => segs.map(s => `${s.start}-${s.end} ${JSON.stringify(s.modes)}`);
  check('a break every hour lands on the hour, with open play between', () => assert.deepEqual(
    show(buildTimedSegments([seg('19:00', '19:15', 'break'), seg('20:00', '20:15', 'break'), seg('21:00', '21:15', 'break')], ev4)),
    ['18:00-19:00 {}', '19:00-19:15 {"1":"break","2":"break"}', '19:15-20:00 {}', '20:00-20:15 {"1":"break","2":"break"}', '20:15-21:00 {}', '21:00-21:15 {"1":"break","2":"break"}', '21:15-22:00 {}'],
  ));
  check('different modes per court', () => assert.deepEqual(
    show(buildTimedSegments([seg('18:00', '19:00', 'open', [{ court: 1, mode: 'mixed' }, { court: 2, mode: 'men' }]), seg('19:00', '22:00', 'mixed')], ev4)),
    ['18:00-19:00 {"1":"mixed","2":"men"}', '19:00-22:00 {"1":"mixed","2":"mixed"}'],
  ));
  check('one court differs from the rest', () => assert.deepEqual(
    show(buildTimedSegments([seg('18:00', '22:00', 'women', [{ court: 2, mode: 'open' }])], ev4)),
    ['18:00-22:00 {"1":"women"}'],
  ));
  check('parts are sorted, clipped to the event, and overlaps trimmed', () => assert.deepEqual(
    show(buildTimedSegments([seg('21:00', '23:00', 'mixed'), seg('17:00', '19:00', 'men'), seg('18:30', '19:30', 'women')], ev4)),
    ['18:00-19:00 {"1":"men","2":"men"}', '19:00-19:30 {"1":"women","2":"women"}', '19:30-21:00 {}', '21:00-22:00 {"1":"mixed","2":"mixed"}'],
  ));
  check('courts that don\'t exist and unknown modes are ignored', () => assert.deepEqual(
    show(buildTimedSegments([seg('18:00', '22:00', 'chaos', [{ court: 5, mode: 'men' }, { court: 1, mode: 'mixed' }])], ev4)),
    ['18:00-22:00 {"1":"mixed"}'],
  ));
  check('an event past midnight', () => assert.deepEqual(
    show(buildTimedSegments([seg('23:00', '00:30', 'mixed')], { startTime: '22:00', durationMin: 180, courts: 1 })),
    ['22:00-23:00 {}', '23:00-00:30 {"1":"mixed"}', '00:30-01:00 {}'],
  ));
  check('nothing usable → null', () => assert.equal(buildTimedSegments([{ start: 'soon', end: '', mode: 'mixed' }], ev4), null));
}

console.log('speech and replies');
check('"codes"/"cords" heard for courts are corrected; other words untouched', () => {
  assert.equal(fixCommonMishearings('Make one of the codes mixed and the other code any combination'), 'Make one of the courts mixed and the other court any combination');
  assert.equal(fixCommonMishearings('Cords 3 and 4, decode the barcode'), 'Courts 3 and 4, decode the barcode');
});
check('replies describe per-court modes', () => {
  assert.equal(describeModes({ 1: 'mixed' }, 2), 'court 1 mixed, court 2 any combination');
  assert.equal(describeModes({ 1: 'mixed', 2: 'mixed' }, 2), 'mixed');
  assert.equal(describeModes({}, 3), 'any combination');
});

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
check('courts: court numbers are counted, not read as a count', () => {
  assert.equal(x('Tuesday 6pm on courts 3 and 4').courts, 2);
  assert.equal(x('Tuesday 6pm, courts 1-3').courts, 3);
  assert.equal(x('Tuesday 6pm on court 5').courts, 1);
  assert.equal(x('Tuesday 6pm, courts 2, 4 & 6').courts, 3);
  assert.equal(x("sat 6pm, court 1 mixed, court 2 mens and court 3 womens").courts, 3, 'every court named counts');
});
check('courts: worked out from a stated player count, 4 to a court, rounded down', () => {
  const c = t => buildDraft(t, null, players, opts).draft.courts;
  assert.equal(c('Saturday 6 to 10pm, 8 players'), 2);
  assert.equal(c('Saturday 6 to 10pm, 12 people'), 3);
  assert.equal(c('Saturday 6 to 10pm, 10 players'), 2);
  assert.equal(c('Saturday 6 to 10pm, 3 courts, 16 players'), 3, 'a stated court count wins');
});
check('courts: worked out from named players when at least 4 are named', () => {
  const eight = ['Priya', 'Sam', 'Ben', 'Samantha', 'Ann', 'Bo', 'Cy', 'Di'];
  const r = buildDraft('Saturday 6 to 10pm', { isEvent: true, playerNames: eight }, players, opts);
  assert.equal(r.draft.courts, 2);
  assert.equal(r.courtsFrom, 8);
  assert.ok(r.filled.includes('courts'));
  assert.equal(buildDraft('Saturday 6 to 10pm', { isEvent: true, playerNames: ['Priya', 'Sam'] }, players, opts).draft.courts, 4, 'two names: keep the default');
});
check('courts: "everyone" uses the whole group', () => {
  const group = Array.from({ length: 9 }, (_, i) => ({ id: `g${i}`, name: `G${i}` }));
  assert.equal(buildDraft('Saturday 6pm, everyone', { isEvent: true, inviteEveryone: true }, group, opts).draft.courts, 2);
});
check('everyone invited', () => assert.equal(buildDraft('Tuesday 6pm, everyone', { isEvent: true, inviteEveryone: true }, players, opts).draft.memberIds.length, 5));
check('model says not an event and text has nothing → null', () => assert.equal(buildDraft('write me a poem', { isEvent: false, name: 'Poem', courts: 2 }, players, opts), null));
check('model says not an event even though the text has a date → null', () => assert.equal(buildDraft('what is the weather like tomorrow', { isEvent: false }, players, opts), null));
check('a past date from the model rolls forward to the next one', () => {
  assert.equal(buildDraft('Christmas eve social', { isEvent: true, date: '2024-12-24' }, players, opts).draft.date, '2026-12-24');
  assert.equal(buildDraft('New year social', { isEvent: true, date: '2026-01-01' }, players, opts).draft.date, '2027-01-01');
});

console.log('buildEdit');
{
  const cur = { name: 'Tuesday Night', date: '2026-09-29', startTime: '18:00', durationMin: 180, courts: 3, gameLenMin: 15,
    segments: [{ start: '18:00', end: '21:00', modes: {} }], memberIds: ['a', 'd'] };
  const blank = { understood: true, name: '', date: '', startTime: '', endTime: '', durationMin: 0, courts: 0, playerCount: 0, gameLenMin: 0, segments: [], addPlayers: [], removePlayers: [], inviteEveryone: false };
  const edit = (text, ai) => buildEdit(text, ai === null ? null : { ...blank, ...ai }, cur, players, opts);
  check('a start-time change keeps the length and reports old → new', () => {
    const r = edit('push it back an hour', { startTime: '19:00' });
    assert.deepEqual(r.changes, { startTime: '19:00' });
    assert.equal(r.summary, 'Start 6pm → 7pm');
  });
  check('"push it back an hour" is not read as a 1-hour event', () => {
    const r = edit('push it back an hour', { startTime: '19:00' });
    assert.equal(r.changes.durationMin, undefined);
  });
  check('"end at 11" changes the length, not the start', () => {
    const r = edit('end at 11', { endTime: '23:00' });
    assert.deepEqual(r.changes, { durationMin: 300 });
  });
  check('a full time range in the message is trusted over the model', () => {
    const r = edit('make it 7 to 9pm', { startTime: '07:00', durationMin: 120 });
    assert.deepEqual(r.changes, { startTime: '19:00', durationMin: 120 });
  });
  check('"add 2 courts" is relative: the model decides, not the text', () => {
    assert.deepEqual(edit('add 2 courts', { courts: 5 }).changes, { courts: 5 });
    assert.deepEqual(edit('change to 2 courts', { courts: 0 }).changes, { courts: 2 });
  });
  check('a new day from the text', () => assert.deepEqual(edit('move it to Friday', {}).changes, { date: '2026-10-02' }));
  check('play format for the last hour', () => {
    const r = edit('mixed for the last hour', { segments: [{ mode: 'open', minutes: 120 }, { mode: 'mixed', minutes: 0 }] });
    assert.deepEqual(r.changes.segments, [{ start: '18:00', end: '20:00', modes: {} }, { start: '20:00', end: '21:00', modes: { 1: 'mixed', 2: 'mixed', 3: 'mixed' } }]);
    assert.match(r.summary, /8pm–9pm mixed/);
  });
  check('an echoed, unchanged play format is not a change', () => assert.equal(edit('keep it open', { segments: [{ mode: 'open', minutes: 0 }] }), null));
  check('add and remove players; unknown names reported', () => {
    const r = edit('add Sam and Zed, drop Ben', { addPlayers: ['Sam', 'Zed'], removePlayers: ['Ben'] });
    assert.deepEqual(r.changes, { addIds: ['b'], removeIds: ['d'] });
    assert.deepEqual(r.unmatchedNames, ['Zed']);
    assert.equal(r.summary, 'Added Sam Lee · Removed Ben');
  });
  check('removing someone who isn\'t in the event is reported, not guessed', () => {
    const r = edit('drop Samantha', { removePlayers: ['Samantha'] });
    assert.deepEqual(r, { changes: {}, summary: '', unmatchedNames: ['Samantha'] });
  });
  check('"now" is not a date change, and repeated current values are ignored', () => {
    assert.deepEqual(edit('we only have 2 courts now', { courts: 2, date: '2026-09-26' }).changes, { courts: 2 });
    assert.deepEqual(edit('push it back an hour', { startTime: '19:00', endTime: '21:00' }).changes, { startTime: '19:00' });
  });
  check('in an edit, "court 2" says which court, not how many', () => {
    const r = edit("make court 2 men's doubles for the first hour", { segments: [{ start: '18:00', end: '19:00', mode: 'open', courtModes: [{ court: 2, mode: 'men' }] }] });
    assert.equal(r.changes.courts, undefined);
    assert.deepEqual(r.changes.segments, [{ start: '18:00', end: '19:00', modes: { 2: 'men' } }, { start: '19:00', end: '21:00', modes: {} }]);
  });
  check('nothing to change → null', () => assert.equal(edit('thanks!', {}), null));
  check('works on text alone when the model is down', () => assert.deepEqual(edit('make it 7 to 9pm on 4 courts', null).changes, { startTime: '19:00', durationMin: 120, courts: 4 }));
  check('a past date from the model rolls forward', () => assert.equal(edit('christmas eve', { date: '2024-12-24' }).changes.date, '2026-12-24'));
}

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
