/* Tests for the format options in lib/engine.js (seeding, re-seeding, court
   groups, movement, fixed pairs, singles, clinics). Run with `npm test`. */
import assert from 'node:assert/strict';
import { generateRoster, recomputeFrom, usesFormatEngine, getConfirmedAndWaitlist, pairKey, unitsFor } from '../lib/engine.js';

let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.stack.split('\n').slice(0, 3).join('\n        ')}`); }
};

/* n players p0..p(n-1); p0 has the best DUPR, descending. */
function setup({ n, courts, options = {}, durationMin = 120, genders = 'O', modes = {} }) {
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, gender: genders[i % genders.length], dupr: 6 - i * 0.1 }));
  const ev = {
    id: 'e', startTime: '18:00', durationMin, courts, gameLenMin: 15, options,
    segments: [{ start: '18:00', end: '20:00', modes }],
    // RSVP order is reversed so seeding visibly reorders.
    rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: durationMin, ts: n - i }])),
    memberIds: players.map(p => p.id), roster: null, currentRoundIndex: 0,
  };
  ev.roster = generateRoster(ev, {}, 0, players);
  return { ev, players };
}
const onCourt = c => [...c.teamA, ...c.teamB].sort();
const courtWith = (r, id) => r.courts.find(c => onCourt(c).includes(id));
const sorted = a => [...a].sort();
/* Team A wins every game in a round. */
const winAll = r => r.courts.forEach(c => { c.scoreA = 11; c.scoreB = 5; });

console.log('formats');
check('an event with no options uses the original engine', () => {
  assert.equal(usesFormatEngine({}), false);
  assert.equal(usesFormatEngine({ options: { standings: 'winPct' } }), false);
  assert.equal(usesFormatEngine({ options: { seeding: 'dupr' } }), true);
});

check('seeding by DUPR: the top 4 on court 1, playing 1&4 v 2&3', () => {
  const { ev } = setup({ n: 8, courts: 2, options: { seeding: 'dupr' } });
  const c1 = ev.roster[0].courts[0];
  assert.deepEqual(onCourt(c1), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual([sorted(c1.teamA), sorted(c1.teamB)], [['p0', 'p3'], ['p1', 'p2']]);
  assert.deepEqual(onCourt(ev.roster[0].courts[1]), ['p4', 'p5', 'p6', 'p7']);
});

check('seeding only sets the start: later rounds mix by variety', () => {
  const { ev } = setup({ n: 8, courts: 2, options: { seeding: 'dupr' } });
  const r1 = ev.roster[1];
  assert.notDeepEqual(onCourt(r1.courts[0]), ['p0', 'p1', 'p2', 'p3']);
});

check('manual seeding follows the host\'s order', () => {
  const order = ['p7', 'p6', 'p5', 'p4', 'p3', 'p2', 'p1', 'p0'];
  const { ev } = setup({ n: 8, courts: 2, options: { seeding: 'manual', seedOrder: order } });
  assert.deepEqual(onCourt(ev.roster[0].courts[0]), ['p4', 'p5', 'p6', 'p7']);
});

check('Gauntlet (re-seed every round): round 2 regroups by standings', () => {
  const { ev, players } = setup({ n: 8, courts: 2, options: { seeding: 'dupr', reseed: true, standings: 'winPct' } });
  // Round 1: court 1 p0&p3 v p1&p2, court 2 p4&p7 v p5&p6. Let the B teams win.
  ev.roster[0].courts.forEach(c => { c.scoreA = 3; c.scoreB = 11; });
  const hist = {};
  recomputeFrom(ev, 1, hist, players);
  // Winners p1,p2 (by +8) and p5,p6 (+8) are 1–0; the top four by standings
  // are the winners: court 1 is p1, p2, p5, p6.
  assert.deepEqual(onCourt(ev.roster[1].courts[0]), ['p1', 'p2', 'p5', 'p6']);
  assert.ok(!ev.roster[1].provisional, 'decided');
});

check('King of the Court: winners up, losers down, partners split', () => {
  const { ev, players } = setup({ n: 12, courts: 3, options: { seeding: 'dupr', movement: 'game', standings: 'courtPoints' } });
  const r0 = ev.roster[0];
  winAll(r0);
  recomputeFrom(ev, 1, {}, players);
  const r1 = ev.roster[1];
  const [c1, c2, c3] = r0.courts;
  // Court 1: its winners stay, court 2's winners come up.
  assert.deepEqual(onCourt(r1.courts[0]), sorted([...c1.teamA, ...c2.teamA]));
  // Court 2: court 1's losers come down, court 3's winners come up.
  assert.deepEqual(onCourt(r1.courts[1]), sorted([...c1.teamB, ...c3.teamA]));
  // Court 3: court 2's losers come down, its own losers stay.
  assert.deepEqual(onCourt(r1.courts[2]), sorted([...c2.teamB, ...c3.teamB]));
  // Partners who won together are split up.
  r1.courts.forEach(c => [c.teamA, c.teamB].forEach(t => {
    assert.ok(![c1.teamA, c2.teamA, c1.teamB, c3.teamA, c2.teamB, c3.teamB].some(old => pairKey(old[0], old[1]) === pairKey(t[0], t[1])), `repeat partners ${t}`);
  }));
});

check('movement: a game without a result stays on its court; later rounds are provisional', () => {
  const { ev, players } = setup({ n: 8, courts: 2, options: { seeding: 'dupr', movement: 'game' } });
  recomputeFrom(ev, 1, {}, players);
  assert.deepEqual(onCourt(ev.roster[1].courts[0]), onCourt(ev.roster[0].courts[0]));
  assert.ok(ev.roster[1].provisional);
});

check('movement with more players than spots: sitting out is shared fairly', () => {
  const { ev, players } = setup({ n: 10, courts: 2, durationMin: 150, options: { movement: 'game', extras: 'rotate' } });
  for (let i = 0; i < ev.roster.length - 1; i++) { winAll(ev.roster[i]); recomputeFrom(ev, i + 1, {}, players); }
  const sat = Object.fromEntries(players.map(p => [p.id, 0]));
  ev.roster.forEach(r => r.sitOut.forEach(id => { sat[id]++; }));
  const counts = Object.values(sat);
  assert.ok(counts.every(n => n > 0), 'everyone sits sometime');
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, JSON.stringify(sat));
  ev.roster.forEach(r => assert.equal(r.courts.length, 2));
});

check('Scramble (groups of 4): three rounds together, every partner once', () => {
  const { ev } = setup({ n: 8, courts: 2, options: { groups: 'fixed' } });
  const [r0, r1, r2, r3] = ev.roster;
  [0, 1].forEach(ci => {
    const four = onCourt(r0.courts[ci]);
    assert.deepEqual(onCourt(r1.courts[ci]), four);
    assert.deepEqual(onCourt(r2.courts[ci]), four);
    const partners = new Set([r0, r1, r2].flatMap(r => [r.courts[ci].teamA, r.courts[ci].teamB]).map(t => pairKey(t[0], t[1])));
    assert.equal(partners.size, 6);
  });
  assert.equal(r3.groupSet.n, 0, 'a new set starts');
  assert.deepEqual([r0.groupSet.n, r1.groupSet.n, r2.groupSet.n], [0, 1, 2]);
});

check('Double Header (groups + DUPR seeding): the first set is grouped by rating', () => {
  const { ev } = setup({ n: 8, courts: 2, options: { groups: 'fixed', seeding: 'dupr' } });
  assert.deepEqual(onCourt(ev.roster[0].courts[0]), ['p0', 'p1', 'p2', 'p3']);
  assert.deepEqual(onCourt(ev.roster[0].courts[1]), ['p4', 'p5', 'p6', 'p7']);
});

check('Up & Down the River / Cream of the Crop: top 2 up, bottom 2 down after each set', () => {
  const { ev, players } = setup({ n: 8, courts: 2, options: { groups: 'fixed', seeding: 'dupr', movement: 'set' } });
  // Court 2: p4 and p5 win all three of their games.
  for (let i = 0; i < 3; i++) {
    ev.roster[i].courts.forEach(c => {
      const aHas = id => c.teamA.includes(id);
      if (c.court === 1) { c.scoreA = aHas('p0') ? 11 : 4; c.scoreB = aHas('p0') ? 4 : 11; }
      else { const aStrong = aHas('p4') || aHas('p5'); c.scoreA = aStrong ? 11 : 6; c.scoreB = aStrong ? 6 : 11; }
    });
  }
  recomputeFrom(ev, 3, {}, players);
  const top = onCourt(ev.roster[3].courts[0]);
  assert.ok(top.includes('p4') && top.includes('p5'), `p4/p5 moved up: ${top}`);
  assert.ok(top.includes('p0'), 'p0 stays up');
  assert.equal(top.length, 4);
});

check('Shuffle (fixed pairs): pairs stay together, opponents change', () => {
  const pairs = [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p5'], ['p6', 'p7']];
  const { ev } = setup({ n: 8, courts: 2, options: { partners: 'fixed', pairs } });
  const keys = new Set(pairs.map(p => pairKey(p[0], p[1])));
  ev.roster.forEach(r => r.courts.forEach(c => [c.teamA, c.teamB].forEach(t => assert.ok(keys.has(pairKey(t[0], t[1])), `split pair ${t}`))));
  const opp = r => r.courts.map(c => [c.teamA.join(), c.teamB.join()].sort().join(' v ')).sort().join(' | ');
  assert.notEqual(opp(ev.roster[0]), opp(ev.roster[1]));
  // Over 3 rounds each pair meets each other pair once.
  const met = new Set(ev.roster.slice(0, 3).flatMap(r => r.courts.map(c => [c.teamA.join(), c.teamB.join()].sort().join(' v '))));
  assert.equal(met.size, 6);
});

check('fixed pairs: players without a pair are paired in RSVP order; an odd one out sits', () => {
  const ev = { options: { partners: 'fixed', pairs: [['a', 'b']] } };
  assert.deepEqual(unitsFor(ev, ['a', 'b', 'c', 'd', 'e']), [['a', 'b'], ['c', 'd'], ['e']]);
});

check('Rumble (fixed pairs + re-seed): winning pairs meet on court 1', () => {
  const pairs = [['p0', 'p1'], ['p2', 'p3'], ['p4', 'p5'], ['p6', 'p7']];
  const { ev, players } = setup({ n: 8, courts: 2, options: { partners: 'fixed', pairs, reseed: true, standings: 'winPct' } });
  winAll(ev.roster[0]);
  recomputeFrom(ev, 1, {}, players);
  const winners = ev.roster[0].courts.map(c => c.teamA.join());
  const c1 = ev.roster[1].courts[0];
  assert.deepEqual([c1.teamA.join(), c1.teamB.join()].sort(), winners.sort());
});

check('singles: 1 v 1, two players a court; capacity counts 2 a court', () => {
  const { ev } = setup({ n: 6, courts: 2, options: { partners: 'singles' } });
  ev.roster.forEach(r => {
    assert.equal(r.courts.length, 2);
    r.courts.forEach(c => { assert.equal(c.teamA.length, 1); assert.equal(c.teamB.length, 1); });
  });
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, []);
  assert.deepEqual([confirmed.length, waitlist.length], [4, 2]);
});

check('extra players waitlisted by default; with "rotate" everyone plays in turns', () => {
  const wait = setup({ n: 10, courts: 2 });
  assert.equal(getConfirmedAndWaitlist(wait.ev, wait.players).waitlist.length, 2);
  assert.ok(wait.ev.roster.every(r => r.sitOut.length === 0));
  const { ev, players } = setup({ n: 10, courts: 2, options: { extras: 'rotate' } });
  assert.equal(getConfirmedAndWaitlist(ev, players).waitlist.length, 0);
  const sat = Object.fromEntries(players.map(p => [p.id, 0]));
  ev.roster.forEach(r => { assert.equal(r.sitOut.length, 2); r.sitOut.forEach(id => { sat[id]++; }); });
  assert.ok(Math.max(...Object.values(sat)) - Math.min(...Object.values(sat)) <= 1);
});

check('singles groups (pool play): 4 players on 2 courts meet everyone over a set', () => {
  const { ev } = setup({ n: 4, courts: 2, options: { partners: 'singles', groups: 'fixed' } });
  const met = new Set(ev.roster.slice(0, 3).flatMap(r => r.courts.map(c => pairKey(c.teamA[0], c.teamB[0]))));
  assert.equal(met.size, 6);
});

check('a mixed court gets a mixed split when seeded', () => {
  const { ev } = setup({ n: 4, courts: 1, genders: 'MMFF', options: { seeding: 'dupr' }, modes: { 1: 'mixed' } });
  const c = ev.roster[0].courts[0];
  assert.equal(c.mode, 'mixed');
  [c.teamA, c.teamB].forEach(t => assert.notEqual(t[0][1] % 4 < 2, t[1][1] % 4 < 2));
});

check('a clinic (no games) has no rounds', () => {
  const { ev } = setup({ n: 8, courts: 2, options: { games: 'none' } });
  assert.deepEqual(ev.roster, []);
});

check('recomputing keeps scores already entered on unchanged games', () => {
  const { ev, players } = setup({ n: 8, courts: 2, options: { seeding: 'dupr', reseed: true } });
  ev.roster[1].courts[0].scoreA = 9;
  const before = JSON.stringify(ev.roster[1].courts[0].teamA);
  recomputeFrom(ev, 1, {}, players);
  if (JSON.stringify(ev.roster[1].courts[0].teamA) === before) assert.equal(ev.roster[1].courts[0].scoreA, 9);
});

check('a break round has no games and nobody counts as sitting out', () => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, gender: 'O' }));
  const ev = {
    startTime: '18:00', durationMin: 45, courts: 2, gameLenMin: 15, options: { movement: 'game' },
    segments: [{ start: '18:00', end: '18:15', modes: {} }, { start: '18:15', end: '18:30', modes: { 1: 'break', 2: 'break' } }, { start: '18:30', end: '18:45', modes: {} }],
    rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: 45, ts: i }])), memberIds: players.map(p => p.id),
  };
  const r = generateRoster(ev, {}, 0, players);
  assert.deepEqual([r[1].courts.length, r[1].sitOut.length, r[2].courts.length], [0, 0, 2]);
});

check('big events stay fast (40 players, 10 courts, groups, 4 hours)', () => {
  const t = Date.now();
  setup({ n: 40, courts: 10, durationMin: 240, options: { groups: 'fixed' } });
  setup({ n: 40, courts: 10, durationMin: 240, options: { partners: 'fixed' } });
  assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
