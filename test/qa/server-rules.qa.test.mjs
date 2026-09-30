/* QA (adversarial) checks for the server rules, enforceEventHosts in
   backend-worker/src/state.js (FR-4, FR-5, FR-9; test plan section 2
   item 6). Each check plays a signed-in non-host trying to change what the
   PRD says only the host (or the players of that game) may change.
   Also checks that backend/state.js carries the same rule functions.
   Run from the repo root: node --no-warnings test/qa/server-rules.qa.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { enforceEventHosts } from '../../backend-worker/src/state.js';
import { buildBracket, resolvePlayoffs } from '../../lib/playoffs.js';

let failures = 0, passes = 0;
const check = (name, fn) => {
  try { fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 6).join('\n        ')}`); }
};
const clone = x => JSON.parse(JSON.stringify(x));
const court = (n, teamA, teamB, scoreA = null, scoreB = null, scoredAt) => ({ court: n, mode: 'open', teamA, teamB, scoreA, scoreB, ...(scoredAt ? { scoredAt } : {}) });
const NOW = 1_800_000_000_000;
const stored = {
  id: 'e1', name: 'Tue', createdBy: 'host', published: true, started: true, currentRoundIndex: 1, seriesId: 'S',
  options: { standings: 'winPct', movement: 'game' }, checkedIn: { a: true },
  rsvps: {}, noShows: [],
  roster: [
    { offset: 0, courts: [court(1, ['a', 'b'], ['c', 'd'], 11, 7, NOW - 60000), court(2, ['e', 'f'], ['g', 'h'], 11, 9, NOW - 60000)], sitOut: [] },
    { offset: 15, courts: [court(1, ['a', 'e'], ['b', 'f']), court(2, ['c', 'g'], ['d', 'h'])], sitOut: [] },
    { offset: 30, courts: [court(1, ['a', 'd'], ['b', 'g']), court(2, ['c', 'e'], ['f', 'h'])], sitOut: [], provisional: true },
  ],
};
const save = (edit, requester, base = stored) => {
  const incoming = clone(base); edit(incoming);
  return enforceEventHosts([incoming], [clone(base)], requester)[0];
};
const on = c => [...c.teamA, ...c.teamB];

console.log('QA 6 · server rules — non-host');
check('a player changing round index, options, playoffs, seriesId, checkedIn is reverted', () => {
  const out = save(ev => { ev.currentRoundIndex = 2; ev.options = {}; ev.seriesId = 'X'; ev.playoffs = { type: 'single', teams: [], matches: [] }; ev.checkedIn = {}; }, 'a');
  assert.deepEqual([out.currentRoundIndex, out.options, out.seriesId, 'playoffs' in out, out.checkedIn], [1, stored.options, 'S', false, { a: true }]);
});
check('a player can\'t score another court of the current round by swapping its team order', () => {
  // 'a' plays court 1; court 2 is c,g v d,h. Swap A/B and score it.
  const out = save(ev => { const c = ev.roster[1].courts[1]; [c.teamA, c.teamB] = [c.teamB, c.teamA]; c.scoreA = 11; c.scoreB = 0; c.scoredAt = NOW; }, 'a');
  const c = out.roster[1].courts[1];
  assert.ok(c.scoreA == null && c.scoreB == null, `stored: ${JSON.stringify(c.teamA)} v ${JSON.stringify(c.teamB)} ${c.scoreA}-${c.scoreB}`);
});
check('a player can\'t rewrite who plays in the current round (put themselves on another court)', () => {
  const out = save(ev => { ev.roster[1].courts[1] = court(2, ['c', 'g'], ['d', 'a']); }, 'h');
  assert.deepEqual(on(out.roster[1].courts[1]), ['c', 'g', 'd', 'h']);
});
check('a player can\'t delete the current and later rounds', () => {
  const out = save(ev => { ev.roster = ev.roster.slice(0, 1); }, 'a');
  assert.equal(out.roster.length, 3, `rounds left: ${out.roster.length}`);
});
check('a player can\'t future-date their own score so a host correction can never win', () => {
  const afterPlayer = save(ev => { const c = ev.roster[1].courts[0]; c.scoreA = 11; c.scoreB = 0; c.scoredAt = NOW + 10 * 365 * 864e5; }, 'a');
  // The host corrects it a minute later (host clock).
  const hostCopy = clone(afterPlayer); const c = hostCopy.roster[1].courts[0]; c.scoreA = 6; c.scoreB = 11; c.scoredAt = NOW + 60000;
  const out = enforceEventHosts([hostCopy], [clone(afterPlayer)], 'host')[0];
  assert.deepEqual([out.roster[1].courts[0].scoreA, out.roster[1].courts[0].scoreB], [6, 11]);
});
check('an older host copy doesn\'t clobber a newer player score', () => {
  const afterPlayer = save(ev => { const c = ev.roster[1].courts[0]; c.scoreA = 11; c.scoreB = 4; c.scoredAt = NOW; }, 'a');
  const hostCopy = clone(stored); hostCopy.roster[1].courts[0].scoreA = 2; hostCopy.roster[1].courts[0].scoreB = 11; hostCopy.roster[1].courts[0].baseAt = 0; // (updated after the fix: stamps are the server's; a stale copy never saw the player's stamp)
  const out = enforceEventHosts([hostCopy], [afterPlayer], 'host')[0];
  assert.deepEqual([out.roster[1].courts[0].scoreA, out.roster[1].courts[0].scoreB], [11, 4]);
});
check('a player can\'t score a game of an earlier round they weren\'t in', () => {
  const out = save(ev => { ev.roster[0].courts[1].scoreA = 0; ev.roster[0].courts[1].scoredAt = NOW; }, 'a');
  assert.equal(out.roster[0].courts[1].scoreA, 11);
});
check('a signed-out save (no requester) changes nothing host-only and no scores', () => {
  const out = save(ev => { ev.currentRoundIndex = 2; ev.roster[1].courts[0].scoreA = 11; ev.roster[1].courts[0].scoredAt = NOW; }, null);
  assert.deepEqual([out.currentRoundIndex, out.roster[1].courts[0].scoreA], [1, null]);
});
check('hostless events stay open to everyone', () => {
  const hostless = clone(stored); delete hostless.createdBy;
  const out = save(ev => { ev.currentRoundIndex = 2; ev.options = { movement: 'none' }; }, 'z', hostless);
  assert.deepEqual([out.currentRoundIndex, out.options], [2, { movement: 'none' }]);
});
check('a non-host can\'t delete a hosted event', () => {
  const out = enforceEventHosts([], [clone(stored)], 'a');
  assert.equal(out.length, 1);
});

console.log('QA 6 · server rules — playoffs');
const withPlayoffs = () => {
  const ev = clone(stored);
  ev.playoffs = { type: 'single', teams: [['a', 'b'], ['c', 'd'], ['e', 'f'], ['g', 'h']], matches: buildBracket('single', 4, false) };
  resolvePlayoffs(ev.playoffs);
  return ev;
};
check('a player scores their own semifinal; the final fills in', () => {
  const base = withPlayoffs();
  const out = save(ev => { const m = ev.playoffs.matches[0]; m.scoreA = 11; m.scoreB = 5; m.scoredAt = NOW; }, 'a', base);
  assert.deepEqual(out.playoffs.matches[2].teamA, ['a', 'b']);
});
check('a player can\'t change another match, the teams or the bracket', () => {
  const base = withPlayoffs();
  const out = save(ev => { ev.playoffs.matches[1].scoreA = 11; ev.playoffs.matches[1].scoredAt = NOW; ev.playoffs.teams[0] = ['z', 'y']; ev.playoffs.matches.pop(); }, 'a', base);
  assert.deepEqual([out.playoffs.matches[1].scoreA, out.playoffs.teams[0], out.playoffs.matches.length], [null, ['a', 'b'], 3]);
});
check('a player can\'t change their semifinal result once the final has a score (FR-5 lock)', () => {
  const base = withPlayoffs();
  const [sf1, sf2, fin] = base.playoffs.matches;
  sf1.scoreA = 11; sf1.scoreB = 5; sf1.scoredAt = NOW; sf2.scoreA = 11; sf2.scoreB = 5; sf2.scoredAt = NOW;
  resolvePlayoffs(base.playoffs);
  fin.scoreA = 11; fin.scoreB = 7; fin.scoredAt = NOW + 1000;
  resolvePlayoffs(base.playoffs);
  // Semifinal 1 is seed 1 (a,b) v seed 4 (g,h); 'g' lost it and flips it afterwards.
  const out = save(ev => { const m = ev.playoffs.matches[0]; m.scoreA = 5; m.scoreB = 11; m.scoredAt = NOW + 5000; }, 'g', base);
  const f = out.playoffs.matches[2];
  assert.deepEqual([out.playoffs.matches[0].scoreA, f.teamA, f.scoreA], [11, ['a', 'b'], 11], `final is now ${JSON.stringify(f.teamA)} ${f.scoreA}-${f.scoreB}`);
});
check('a player can\'t start or remove playoffs; the host can', () => {
  const noPo = save(ev => { ev.playoffs = withPlayoffs().playoffs; }, 'a');
  assert.equal('playoffs' in noPo, false);
  const removed = save(ev => { delete ev.playoffs; }, 'a', withPlayoffs());
  assert.ok(removed.playoffs && removed.playoffs.matches.length === 3);
  const host = save(ev => { delete ev.playoffs; }, 'host', withPlayoffs());
  assert.equal(host.playoffs, undefined);
});

console.log('QA 6 · backend/state.js mirrors the Worker');
check('the rule functions are identical in backend/state.js and backend-worker/src/state.js', () => {
  const grab = (src, name) => { const i = src.indexOf(`function ${name}(`); assert.ok(i >= 0, `${name} missing`); const j = src.indexOf('\n}\n', i); return src.slice(i, j).replace(/\s+/g, ' '); };
  const w = readFileSync(new URL('../../backend-worker/src/state.js', import.meta.url), 'utf8');
  const n = readFileSync(new URL('../../backend/state.js', import.meta.url), 'utf8');
  for (const f of ['mergeScore', 'mergeHostRoster', 'mergeRosterForPlayer', 'resolvePlayoffTeams', 'mergePlayoffs', 'enforceEventHosts']) assert.equal(grab(n, f), grab(w, f), f);
  const fields = s => s.slice(s.indexOf('HOST_ONLY_FIELDS = ['), s.indexOf("'seriesId']") + 12).replace(/\s+/g, ' ');
  assert.equal(fields(n), fields(w));
});

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
