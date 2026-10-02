/* QA browser checks for event formats (server simulated with page.route),
   modelled on e2e/formats.mjs. Covers docs/qa-test-plan.md section 2 item 7
   (option controls show/hide, seed order buttons, clinic steps, player
   gating), item 8 (live sync safety), plus playoff/series UI paths found in
   code review. Run from e2e/ against the web export on :5055:
     node qa/formats-qa.mjs */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:5055';
const names = { host1: 'Hana Host', p2: 'Ben Brown', p3: 'Cara Cole', p4: 'Dev Dean', p5: 'Eli Ennis', p6: 'Fay Ford', p7: 'Gus Gray', p8: 'Ivy Ives' };
const players = Object.entries(names).map(([id, name], i) => ({ id, name, gender: i % 2 ? 'M' : 'F', claimed: true, dupr: +(5 - i * 0.2).toFixed(1) }));
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const court = (n, teamA, teamB, scoreA = null, scoreB = null) => ({ court: n, mode: 'open', flagged: false, teamA, teamB, scoreA, scoreB });
const ids = Object.keys(names);
const baseEvent = (over = {}) => ({
  id: 'e1', name: 'Tuesday ladder', date: today, startTime: '23:00', durationMin: 60, courts: 2, gameLenMin: 15,
  segments: [{ start: '23:00', end: '00:00', modes: {} }],
  rsvps: Object.fromEntries(ids.map((id, i) => [id, { status: 'in', start: 0, end: 60, ts: i }])), noShows: [], memberIds: ids,
  roster: null, currentRoundIndex: 0, published: false, started: false, createdBy: 'host1', checkedIn: {},
  ...over,
});

const browser = await chromium.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
let failures = 0, passes = 0, page, server, putMode = 'ok', putDelayMs = 0, puts = 0;
const errors = [];
const step = async (name, fn) => {
  try { await fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) {
    failures++;
    console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 4).join('\n        ')}`);
    await page.screenshot({ path: `screenshots/FAILED-qa-${failures}.png` }).catch(() => {});
  }
};
async function openAs(meId, events, path) {
  if (page) await page.close();
  const me = players.find(p => p.id === meId);
  server = { players, events, chats: [], history: {}, flagThreshold: 3, currentEventId: null };
  putMode = 'ok'; putDelayMs = 0; puts = 0;
  page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: 'tok', player: me })]);
  await page.route('**/api/state', async r => {
    if (r.request().method() === 'PUT') {
      puts++;
      if (putDelayMs) await new Promise(res => setTimeout(res, putDelayMs));
      if (putMode === 'fail') return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) });
      server = JSON.parse(r.request().postData());
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(server) });
  });
  await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ player: me }) }));
  await page.goto(APP + path);
}
const shown = (text, timeout = 8000) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout });
const visibleCount = text => page.getByText(text, { exact: true }).filter({ visible: true }).count();
const saved = (id = 'e1') => server.events.find(e => e.id === id);
// Dropdowns open the app's own list (lib/ui.js Select): the field is
// labelled "<label>: <current value>"; its options sit in a dialog.
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const field = label => page.getByLabel(new RegExp(`^${esc(label)}: `)).filter({ visible: true }).first();
const dialog = () => page.locator('[role="dialog"]').last();
const choose = async (label, option) => {
  await field(label).click();
  await dialog().getByText(option, { exact: true }).first().click();
  await page.waitForTimeout(400);
};
const optionsOf = async label => {
  await field(label).click();
  await dialog().getByText('Cancel', { exact: true }).waitFor();
  const texts = await dialog().getByRole('button').allInnerTexts();
  await dialog().getByText('Cancel', { exact: true }).click();
  await page.waitForTimeout(300);
  return texts.map(t => t.split('\n')[0].trim()).filter(t => t && t !== 'Cancel');
};
const confirmModal = async label => { await page.getByText(label, { exact: true }).filter({ visible: true }).last().click(); await page.waitForTimeout(500); };
const byLabel = label => page.getByLabel(label, { exact: true }).filter({ visible: true }).first();
const SEEDING = 'Seeding — where the first round starts';

/* ------------------------------------------------------------------ */
console.log('QA 7 · Setup option controls show and hide (FR-1)');
await openAs('host1', [baseEvent()], '/event/e1?step=setup');
await step('defaults: no pairs editor, no seed editor, movement offers "after every game", no playoff sub-options', async () => {
  await page.getByText('Edit', { exact: true }).filter({ visible: true }).last().click();
  await shown('Format & options');
  assert.equal(await page.getByText(/^Pairs \(\d+\)$/).filter({ visible: true }).count(), 0, 'pairs editor');
  assert.equal(await page.getByLabel(/^Move .* up$/).filter({ visible: true }).count(), 0, 'seed editor');
  assert.deepEqual(await optionsOf('Court movement'), ['None', 'After every game: winners up, losers down']);
  assert.equal(await visibleCount('Teams in the playoffs'), 0);
  assert.equal(await visibleCount('Seed the playoffs from'), 0);
});
await step('fixed pairs shows the pairs editor; rotating hides it', async () => {
  await choose('Partners', 'Fixed pairs');
  await page.getByText(/^Pairs \(\d+\)$/).filter({ visible: true }).first().waitFor({ timeout: 3000 });
  await choose('Partners', 'Rotating partners');
  assert.equal(await page.getByText(/^Pairs \(\d+\)$/).filter({ visible: true }).count(), 0);
});
await step('manual seeding shows the seed editor; up/down reorder options.seedOrder', async () => {
  await choose(SEEDING, 'Manual order');
  await byLabel('Move Ben Brown up').waitFor({ timeout: 3000 });
  await byLabel('Move Ben Brown up').click();
  await page.waitForTimeout(500);
  assert.deepEqual(saved().options.seedOrder.slice(0, 3), ['p2', 'host1', 'p3']);
  await byLabel('Move Cara Cole down').click();
  await page.waitForTimeout(500);
  assert.deepEqual(saved().options.seedOrder.slice(0, 4), ['p2', 'host1', 'p4', 'p3']);
  await byLabel('Move Ben Brown up').click(); // already first: no change
  await page.waitForTimeout(400);
  assert.equal(saved().options.seedOrder[0], 'p2');
  await choose(SEEDING, 'By DUPR rating');
  assert.equal(await page.getByLabel(/^Move .* up$/).filter({ visible: true }).count(), 0);
});
await step('groups on: movement offers "after each group\'s 3 games" instead of "after every game"', async () => {
  await choose('Court groups', 'Groups of 4 for 3 games');
  assert.deepEqual(await optionsOf('Court movement'), ['None', "After each group's 3 games: top 2 up, bottom 2 down"]);
  await choose('Court movement', "After each group's 3 games: top 2 up, bottom 2 down");
  assert.equal(saved().options.movement, 'set');
});
await step('groups off with set movement: movement becomes "after every game" (normalised)', async () => {
  await choose('Court groups', 'Mix everyone');
  assert.equal(saved().options.movement, 'game');
  assert.deepEqual(await optionsOf('Court movement'), ['None', 'After every game: winners up, losers down']);
  await choose('Court movement', 'None');
});
await step('playoffs: sub-options appear; 3rd place only for single; no size 2 for double; "Seed from" only for series', async () => {
  await choose('Playoffs', 'Single elimination');
  await shown('Teams in the playoffs');
  await shown('Play a 3rd-place match');
  assert.equal(await visibleCount('Seed the playoffs from'), 0);
  await choose('Playoffs', 'Double elimination');
  assert.equal(await visibleCount('Play a 3rd-place match'), 0);
  const sizes = await optionsOf('Teams in the playoffs');
  assert.ok(!sizes.includes('2'), `sizes: ${sizes}`);
  await choose('Repeat', 'Weekly series (season standings)');
  await shown('Seed the playoffs from');
  await choose('Repeat', 'One-off');
  assert.equal(await visibleCount('Seed the playoffs from'), 0);
  await choose('Playoffs', 'None');
  assert.equal(await visibleCount('Teams in the playoffs'), 0);
});
await step('no games (clinic) hides partners, seeding, groups, movement, standings and playoffs', async () => {
  await choose('Games', 'No games (clinic / lesson)');
  for (const t of ['Partners', 'Court groups', 'Court movement', 'Standings', 'Playoffs']) assert.equal(await visibleCount(t), 0, t);
  await shown('Repeat');
  await choose('Games', 'Scheduled games');
  await shown('Partners');
});
await step('every option change is saved at once; format becomes Custom', async () => {
  assert.equal(saved().options.format, 'custom');
});

/* ------------------------------------------------------------------ */
console.log('QA 7 · clinic steps (FR-7)');
await openAs('host1', [baseEvent({ options: { format: 'clinic', games: 'none' } })], '/event/e1?step=setup');
await step('a clinic shows 4 steps: Setup, RSVP, Courts, Details', async () => {
  await shown('Setup');
  const present = [];
  for (const t of ['Setup', 'RSVP', 'Courts', 'Roster', 'Rounds', 'Details']) if (await visibleCount(t)) present.push(t);
  assert.deepEqual(present, ['Setup', 'RSVP', 'Courts', 'Details']);
});
await openAs('host1', [baseEvent({ published: true, options: { format: 'clinic', games: 'none' } })], '/event/e1?step=rounds');
await step('a Rounds link to a clinic opens safely (PRD says it explains "no games"; observed: it lands on Setup)', async () => {
  // components/eventSteps/RoundsStep.js:24 has the "no games" text, but
  // app/event/[id].js:171 drops the step, so the link falls back to Setup.
  const noGames = page.getByText(/This event has no games/).filter({ visible: true }).first();
  const setup = page.getByText('View mode', { exact: true }).filter({ visible: true }).first();
  await Promise.race([noGames.waitFor({ timeout: 8000 }), setup.waitFor({ timeout: 8000 })]);
});

/* ------------------------------------------------------------------ */
console.log('QA 7 · what a player sees (FR-4, FR-5)');
const poolEvent = (over = {}) => baseEvent({
  published: true, started: true, options: { format: 'poolPlay', partners: 'fixed', groups: 'fixed', standings: 'winPct', playoffs: 'single', playoffTeams: 4, pairs: [['host1', 'p2'], ['p3', 'p4'], ['p5', 'p6'], ['p7', 'p8']] },
  currentRoundIndex: 2,
  roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4'], 11, 3), court(2, ['p5', 'p6'], ['p7', 'p8'], 11, 9)], sitOut: [], played: false },
    { offset: 15, len: 15, courts: [court(1, ['host1', 'p2'], ['p5', 'p6'], 11, 5), court(2, ['p3', 'p4'], ['p7', 'p8'], 11, 7)], sitOut: [], played: false },
    { offset: 30, len: 15, courts: [court(1, ['host1', 'p2'], ['p7', 'p8'], 11, 1), court(2, ['p3', 'p4'], ['p5', 'p6'], 4, 11)], sitOut: [], played: false },
    { offset: 45, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: false },
  ],
  ...over,
});
await openAs('p7', [poolEvent()], '/event/e1?step=rounds');
await step('a player sees no Start games, Next/Prev round, Start playoffs or Check-in', async () => {
  await shown('Round 3 of 4 · 11:30pm');
  for (const t of ['Start games', 'Stop games', 'Next round', 'Prev round', 'Start playoffs']) assert.equal(await visibleCount(t), 0, t);
  assert.equal(await page.getByText(/^Check-in \(/).filter({ visible: true }).count(), 0, 'check-in');
});
const bracketEvent = () => {
  const ev = poolEvent();
  ev.roster = ev.roster.slice(0, 3);
  ev.playoffs = { type: 'single', startedAt: 1, teams: [['host1', 'p2'], ['p5', 'p6'], ['p3', 'p4'], ['p7', 'p8']], matches: [
    { id: 'W1-1', label: 'Semifinal 1', stage: 'W', a: { seed: 1 }, b: { seed: 4 }, teamA: ['host1', 'p2'], teamB: ['p7', 'p8'], scoreA: null, scoreB: null },
    { id: 'W1-2', label: 'Semifinal 2', stage: 'W', a: { seed: 2 }, b: { seed: 3 }, teamA: ['p5', 'p6'], teamB: ['p3', 'p4'], scoreA: null, scoreB: null },
    { id: 'W2-1', label: 'Final', stage: 'W', a: { winnerOf: 'W1-1' }, b: { winnerOf: 'W1-2' }, teamA: null, teamB: null, scoreA: null, scoreB: null },
  ] };
  return ev;
};
await openAs('p7', [bracketEvent()], '/event/e1?step=rounds');
await step('a player can score their own playoff match but not another; no "Back to pool play"', async () => {
  await shown('Playoffs · single elimination');
  assert.equal(await byLabel('Semifinal 1 score for Gus Gray and Ivy Ives').isEditable(), true);
  assert.equal(await byLabel('Semifinal 2 score for Eli Ennis and Fay Ford').isEditable(), false);
  assert.equal(await visibleCount('Back to pool play'), 0);
  await byLabel('Semifinal 1 score for Gus Gray and Ivy Ives').fill('11');
  await byLabel('Semifinal 1 score for Hana Host and Ben Brown').fill('6');
  await page.waitForTimeout(700);
  const m = saved().playoffs.matches[0];
  assert.deepEqual([m.scoreA, m.scoreB], [6, 11]);
});
await step('ready matches show their court; the final waits for earlier results', async () => {
  await shown('Waiting for earlier results');
});
await openAs('host1', [bracketEvent()], '/event/e1?step=rounds');
await step('host: once the final has a score, a semifinal score box is locked', async () => {
  for (const [l, v] of [['Semifinal 1 score for Hana Host and Ben Brown', '11'], ['Semifinal 1 score for Gus Gray and Ivy Ives', '3'], ['Semifinal 2 score for Eli Ennis and Fay Ford', '11'], ['Semifinal 2 score for Cara Cole and Dev Dean', '5']]) await byLabel(l).fill(v);
  await page.waitForTimeout(500);
  await byLabel('Final score for Hana Host and Ben Brown').fill('11');
  await page.waitForTimeout(500);
  assert.equal(await byLabel('Semifinal 1 score for Hana Host and Ben Brown').isEditable(), false);
  assert.equal(await visibleCount('Back to pool play'), 0, 'no way back once scored');
});

/* ------------------------------------------------------------------ */
console.log('QA · playoffs from pairs that changed during the event');
await openAs('host1', [poolEvent({
  // The host re-paired after round 1 (h+p3 / p2+p4 played round 1).
  currentRoundIndex: 1,
  roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p4'], 11, 3), court(2, ['p5', 'p6'], ['p7', 'p8'], 11, 9)], sitOut: [], played: false },
    { offset: 15, len: 15, courts: [court(1, ['host1', 'p2'], ['p5', 'p6'], 11, 5), court(2, ['p3', 'p4'], ['p7', 'p8'], 11, 7)], sitOut: [], played: false },
    { offset: 30, len: 15, courts: [court(1, ['host1', 'p2'], ['p7', 'p8']), court(2, ['p3', 'p4'], ['p5', 'p6'])], sitOut: [], played: false },
  ],
})], '/event/e1?step=rounds');
await step('Start playoffs never puts a player in two teams', async () => {
  await page.getByText('Start playoffs', { exact: true }).filter({ visible: true }).first().click();
  await confirmModal('Start playoffs');
  await shown('Playoffs · single elimination');
  const flat = saved().playoffs.teams.flat();
  assert.equal(new Set(flat).size, flat.length, `teams: ${JSON.stringify(saved().playoffs.teams)}`);
});

/* ------------------------------------------------------------------ */
console.log('QA · series on the Rounds step and summary (FR-6)');
{
  const s1 = baseEvent({ id: 's1', name: 'League', date: '2026-01-06', published: true, seriesId: 's1', options: { format: 'league', repeat: 'weekly', standings: 'winPct' }, roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4'], 11, 3), court(2, ['p5', 'p6'], ['p7', 'p8'], 11, 9)], sitOut: [], played: false }] });
  const s2 = baseEvent({ id: 's2', name: 'League', published: true, seriesId: 's1', options: { format: 'league', repeat: 'weekly', standings: 'winPct' }, roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p4'], 11, 3), court(2, ['p5', 'p7'], ['p6', 'p8'], 11, 9)], sitOut: [], played: false }] });
  await openAs('p5', [s1, s2], '/event/s2?step=rounds');
  await step('Season standings appear once the series has 2 sessions', async () => {
    await page.getByText(/^Season standings · 2 sessions$/).filter({ visible: true }).first().waitFor({ timeout: 8000 });
  });
  await openAs('host1', [s1, s2], '/event/s2?step=setup');
  await step('summary shows "Session 2 of 2"', async () => { await shown('Session 2 of 2'); });
}

/* ------------------------------------------------------------------ */
console.log('QA 8 · live sync safety (FR-8)');
const plain = () => baseEvent({ published: true, started: true, options: { standings: 'winPct' }, roster: [
  { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: false },
  { offset: 15, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p4']), court(2, ['p5', 'p7'], ['p6', 'p8'])], sitOut: [], played: false }] });
await openAs('host1', [plain()], '/event/e1?step=rounds');
await step('a poll during a slow save (12 s) does not overwrite the score being entered', async () => {
  await shown('Round 1 of 2 · 11pm');
  putDelayMs = 12000;
  await byLabel('Score for Hana Host and Ben Brown').fill('11');
  await page.waitForTimeout(10000); // at least one poll (8 s) while the PUT is in flight
  assert.equal(await byLabel('Score for Hana Host and Ben Brown').inputValue(), '11');
  putDelayMs = 0;
  await page.waitForTimeout(4000);
  assert.equal(saved().roster[0].courts[0].scoreA, 11);
  assert.equal(await byLabel('Score for Hana Host and Ben Brown').inputValue(), '11');
});
await openAs('host1', [plain()], '/event/e1?step=rounds');
await step('a score whose save failed (server 500) is not silently wiped by the next poll', async () => {
  await shown('Round 1 of 2 · 11pm');
  putMode = 'fail';
  await byLabel('Score for Hana Host and Ben Brown').fill('11');
  await page.waitForTimeout(11000); // the save fails, then a poll arrives with the old state
  const v = await byLabel('Score for Hana Host and Ben Brown').inputValue();
  putMode = 'ok';
  assert.equal(v, '11', `score box now "${v}" (server never got it; ${puts} PUT attempt(s))`);
});

await openAs('p7', [poolEvent({ started: true })], '/event/e1?step=rounds');
await step('a player gets a "Playoffs have started" alert naming their match; tapping it opens Rounds', async () => {
  await shown('Round 3 of 4 · 11:30pm');
  const ev = server.events[0];
  const b = bracketEvent();
  ev.roster = b.roster; ev.playoffs = b.playoffs;
  await page.getByText(/Playoffs have started — you're in Semifinal 1\./).filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await page.getByText(/Playoffs have started/).filter({ visible: true }).first().click();
  await shown('Playoffs · single elimination');
});
await step('the host does not get a round alert for their own event', async () => {
  await openAs('host1', [poolEvent({ started: true })], '/event/e1?step=setup');
  await shown('Setup');
  server.events[0].currentRoundIndex = 3;
  await page.waitForTimeout(10000);
  assert.equal(await page.getByText(/^Round 4:/).filter({ visible: true }).count(), 0);
});
await step('a round alert hides by itself after about 12 s', async () => {
  await openAs('p7', [poolEvent({ started: true })], '/event/e1?step=setup');
  await shown('Setup');
  server.events[0].currentRoundIndex = 3;
  await page.getByText(/^Round 4:/).filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(13000);
  assert.equal(await page.getByText(/^Round 4:/).filter({ visible: true }).count(), 0);
});

await step('no errors on the page', async () => assert.deepEqual(errors, []));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
