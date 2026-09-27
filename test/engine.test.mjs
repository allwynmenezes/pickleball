/* Tests for the matchup engine (lib/engine.js): variety over a long event,
   fair sitting out, court types, warm-up repeat, partial RSVPs, kept rounds,
   and speed. Run with `npm test` from the project root. */
import assert from 'node:assert/strict';
import { generateRoster, pairKey, isPastEvent, splitEventsByTime } from '../lib/engine.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message.split('\n').join('\n        ')}`); }
};

/* genders: string like 'MMFF' (repeated to n players); modes: court → mode. */
function event({ n, courts, genders = 'O', modes = {}, durationMin = 240, rsvp = () => ({}), switchAfterWarmup }) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, gender: genders[i % genders.length] }));
  const ev = {
    id: 'e', startTime: '18:00', durationMin, courts, gameLenMin: 15, switchAfterWarmup,
    segments: [{ start: '18:00', end: '22:00', modes }],
    rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: durationMin, ts: i, ...rsvp(i) }])),
    memberIds: players.map(p => p.id), roster: null,
  };
  return { ev, players, rounds: generateRoster(ev, {}, 0, players) };
}
const game = r => r.courts.map(c => `${[...c.teamA].sort()}v${[...c.teamB].sort()}`).sort().join('|');
const onCourt = r => r.courts.flatMap(c => [...c.teamA, ...c.teamB]);
const partnerCounts = rounds => {
  const m = new Map();
  rounds.forEach(r => r.courts.forEach(c => [c.teamA, c.teamB].forEach(t => { const k = pairKey(t[0], t[1]); m.set(k, (m.get(k) || 0) + 1); })));
  return m;
};
const sitOutCounts = (rounds, players) => {
  const m = Object.fromEntries(players.map(p => [p.id, 0]));
  rounds.forEach(r => r.sitOut.forEach(id => { m[id]++; }));
  return Object.values(m);
};

console.log('variety over a 4-hour event');
for (const [n, courts] of [[8, 2], [6, 1], [10, 2], [12, 3], [16, 4]]) {
  check(`${n} players, ${courts} court(s): no two rounds in a row are the same`, () => {
    const { rounds } = event({ n, courts, switchAfterWarmup: true });
    assert.equal(rounds.length, 16);
    rounds.forEach((r, i) => { if (i > 0) assert.notEqual(game(r), game(rounds[i - 1]), `rounds ${i} and ${i + 1} are identical`); });
  });
}
check('8 players, 2 courts: the last hour differs from the rest (the reported bug)', () => {
  const { rounds } = event({ n: 8, courts: 2, switchAfterWarmup: true });
  const lastHour = rounds.slice(12).map(game);
  assert.equal(new Set(lastHour).size, 4, 'each game in the last hour is different');
});
check('8 players, 2 courts: everyone partners everyone, nobody more than 3 times', () => {
  const counts = partnerCounts(event({ n: 8, courts: 2, switchAfterWarmup: true }).rounds);
  assert.equal(counts.size, 28, 'all 28 possible partnerships happen');
  assert.ok(Math.max(...counts.values()) <= 3, `max repeats ${Math.max(...counts.values())}`);
});
check('nobody keeps the same partner two rounds running', () => {
  const { rounds } = event({ n: 12, courts: 3, switchAfterWarmup: true });
  rounds.forEach((r, i) => {
    if (!i) return;
    const prev = new Set(rounds[i - 1].courts.flatMap(c => [pairKey(...c.teamA), pairKey(...c.teamB)]));
    r.courts.forEach(c => [c.teamA, c.teamB].forEach(t => assert.ok(!prev.has(pairKey(...t)), `round ${i + 1} repeats ${t}`)));
  });
});
check('history from earlier sessions is spread too, not ignored', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, gender: 'O' }));
  // p0 and p1 have partnered 5 times before: they should rarely be put together tonight.
  const hist = { [pairKey('p0', 'p1')]: { partner: 5, opponent: 0 } };
  const ev = { startTime: '18:00', durationMin: 120, courts: 2, gameLenMin: 15, switchAfterWarmup: true, segments: [], memberIds: players.map(p => p.id),
    rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: 120, ts: i }])) };
  const counts = partnerCounts(generateRoster(ev, hist, 0, players));
  assert.equal(counts.get(pairKey('p0', 'p1')) || 0, 0);
});

console.log('sitting out');
for (const [n, courts] of [[6, 1], [10, 2], [7, 1], [11, 2]]) {
  check(`${n} players, ${courts} court(s): sit-outs differ by at most 1 between players, never twice in a row when avoidable`, () => {
    // Capacity is courts × 4, so extra players join from the waitlist; make every player "confirmed" by giving the event enough courts, then break the extra ones.
    const total = Math.ceil(n / 4);
    const modes = Object.fromEntries(Array.from({ length: total }, (_, i) => [i + 1, i < courts ? 'open' : 'break']));
    const { rounds, players } = event({ n, courts: total, modes, switchAfterWarmup: true });
    const counts = sitOutCounts(rounds, players);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `sit-outs ${counts}`);
    const benchPerRound = n - courts * 4;
    if (benchPerRound * 2 <= n) {
      rounds.forEach((r, i) => { if (i) r.sitOut.forEach(id => assert.ok(!rounds[i - 1].sitOut.includes(id), `${id} sat out rounds ${i} and ${i + 1}`)); });
    }
  });
}
check('every round: nobody is on two courts or both playing and sitting out', () => {
  const { rounds, players } = event({ n: 11, courts: 3, modes: { 3: 'break' }, genders: 'MF' });
  rounds.forEach((r, i) => {
    const ids = [...onCourt(r), ...r.sitOut];
    assert.equal(new Set(ids).size, ids.length, `round ${i + 1} lists someone twice`);
    assert.equal(ids.length, players.length);
  });
});

console.log('court types');
const genderOf = (players, id) => players.find(p => p.id === id).gender;
check('mixed courts: every team is one man and one woman', () => {
  const { rounds, players } = event({ n: 8, courts: 2, genders: 'MF', modes: { 1: 'mixed', 2: 'mixed' } });
  rounds.forEach(r => r.courts.forEach(c => {
    assert.equal(c.mode, 'mixed');
    [c.teamA, c.teamB].forEach(t => assert.deepEqual(t.map(id => genderOf(players, id)).sort(), ['F', 'M']));
  }));
});
check("men's and women's courts get the right players, with nobody flagged", () => {
  const { rounds, players } = event({ n: 10, courts: 3, genders: 'MMMFFMMFFM', modes: { 1: 'men', 2: 'women', 3: 'open' } });
  rounds.forEach((r, i) => r.courts.forEach(c => {
    assert.equal(c.flagged, false, `round ${i + 1} court ${c.court} flagged`);
    const g = onCourt({ courts: [c] }).map(id => genderOf(players, id));
    if (c.mode === 'men') assert.ok(g.every(x => x === 'M'));
    if (c.mode === 'women') assert.ok(g.every(x => x === 'F'));
  }));
});
check('a court on break is never used', () => {
  const { rounds } = event({ n: 12, courts: 3, modes: { 2: 'break' } });
  rounds.forEach(r => assert.ok(r.courts.every(c => c.court !== 2)));
});

console.log('other rules');
check('the round after the warm-up repeats it by default', () => {
  const { rounds } = event({ n: 8, courts: 2 });
  assert.equal(game(rounds[1]), game(rounds[0]));
  assert.notEqual(game(rounds[2]), game(rounds[1]));
});
check('…and not when the event switches after the warm-up', () => {
  const { rounds } = event({ n: 8, courts: 2, switchAfterWarmup: true });
  assert.notEqual(game(rounds[1]), game(rounds[0]));
});
check('a partial RSVP only plays inside their window', () => {
  const { rounds } = event({ n: 9, courts: 3, modes: { 3: 'break' }, rsvp: i => (i === 0 ? { status: 'partial', start: 60, end: 120 } : {}) });
  rounds.forEach(r => {
    if (r.offset < 60 || r.offset >= 120) assert.ok(!onCourt(r).includes('p0') && !r.sitOut.includes('p0'), `p0 in round at ${r.offset}`);
  });
  assert.ok(rounds.some(r => onCourt(r).includes('p0')), 'p0 plays at some point');
});
check('regenerating from a round keeps the earlier rounds exactly', () => {
  const { ev, players, rounds } = event({ n: 8, courts: 2, switchAfterWarmup: true });
  ev.roster = rounds;
  const again = generateRoster(ev, {}, 6, players);
  assert.deepEqual(again.slice(0, 6), rounds.slice(0, 6));
  assert.equal(again.length, 16);
  assert.notEqual(game(again[6]), game(again[5]));
});

console.log('past and upcoming events');
{
  const ev = (id, date, startTime, durationMin = 120) => ({ id, date, startTime, durationMin });
  const now = new Date(2026, 8, 27, 19, 0); // Sun 27 Sep 2026, 7pm local
  check('an event that finished earlier today is past', () => assert.equal(isPastEvent(ev('a', '2026-09-27', '09:00'), now), true));
  check('an event still running is not past', () => assert.equal(isPastEvent(ev('a', '2026-09-27', '18:00'), now), false));
  check('it becomes past the minute it ends', () => {
    const e = ev('a', '2026-09-27', '17:00', 120);
    assert.equal(isPastEvent(e, new Date(2026, 8, 27, 18, 59)), false);
    assert.equal(isPastEvent(e, new Date(2026, 8, 27, 19, 0)), true);
  });
  check('a late event running past midnight stays upcoming until it ends', () => {
    const e = ev('a', '2026-09-26', '23:00', 180); // Sat 11pm → Sun 2am
    assert.equal(isPastEvent(e, new Date(2026, 8, 27, 1, 0)), false);
    assert.equal(isPastEvent(e, new Date(2026, 8, 27, 2, 0)), true);
  });
  check('upcoming is soonest first, past is most recent first', () => {
    const { upcoming, past } = splitEventsByTime([
      ev('old', '2026-09-01', '18:00'), ev('later', '2026-10-05', '18:00'), ev('yesterday', '2026-09-26', '18:00'),
      ev('soon', '2026-09-28', '18:00'), ev('tonight', '2026-09-27', '20:00'), ev('thismorning', '2026-09-27', '08:00'),
    ], now);
    assert.deepEqual(upcoming.map(e => e.id), ['tonight', 'soon', 'later']);
    assert.deepEqual(past.map(e => e.id), ['thismorning', 'yesterday', 'old']);
  });
}

console.log('speed');
check('32 players on 8 courts, 4 hours, in under half a second', () => {
  const t = Date.now();
  event({ n: 32, courts: 8, genders: 'MF', modes: { 1: 'mixed', 2: 'mixed', 3: 'men', 4: 'women' } });
  const ms = Date.now() - t;
  assert.ok(ms < 500, `${ms} ms`);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
