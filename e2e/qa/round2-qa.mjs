/* QA round 2 (browser): the app's real saves go through the real server
   rules. page.route answers PUT /api/state with enforceEventHosts from
   backend-worker/src/state.js (the signed-in player is the requester), so
   these check that what the app sends after the 18760cd4 fixes is still
   accepted — a player's RSVP change, a player's own score in a
   results-driven event, the host running the day and the playoffs — and
   the retry of a failed save and forward-only round alerts.
   Run from e2e/ against the web export on :5055: node qa/round2-qa.mjs */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { enforceEventHosts } from '../../backend-worker/src/state.js';

const APP = process.env.APP_URL || 'http://localhost:5055';
const names = { host1: 'Hana Host', p2: 'Ben Brown', p3: 'Cara Cole', p4: 'Dev Dean', p5: 'Eli Ennis', p6: 'Fay Ford', p7: 'Gus Gray', p8: 'Ivy Ives', p9: 'Jo Jones' };
const players = Object.entries(names).map(([id, name], i) => ({ id, name, gender: i % 2 ? 'M' : 'F', claimed: true, dupr: +(5 - i * 0.2).toFixed(1) }));
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const court = (n, teamA, teamB, scoreA = null, scoreB = null) => ({ court: n, mode: 'open', flagged: false, teamA, teamB, scoreA, scoreB });
const on = c => [...c.teamA, ...c.teamB];
const ids8 = ['host1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const baseEvent = (over = {}, ids = ids8) => ({
  id: 'e1', name: 'Tuesday night', date: today, startTime: '23:00', durationMin: 60, courts: 2, gameLenMin: 15,
  segments: [{ start: '23:00', end: '00:00', modes: {} }],
  rsvps: Object.fromEntries(ids.map((id, i) => [id, { status: 'in', start: 0, end: 60, ts: i }])), noShows: [], memberIds: ids,
  roster: null, currentRoundIndex: 0, published: false, started: false, createdBy: 'host1', checkedIn: {},
  ...over,
});

const browser = await chromium.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
let failures = 0, passes = 0, page, server, meId, failPuts = 0, puts = 0;
const errors = [];
const step = async (name, fn) => {
  try { await fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) {
    failures++;
    console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 4).join('\n        ')}`);
    await page.screenshot({ path: `screenshots/FAILED-qa2-${failures}.png` }).catch(() => {});
  }
};
async function openAs(me, events, path) {
  if (page) await page.close();
  meId = me;
  const player = players.find(p => p.id === me);
  server = { players, events, chats: [], history: {}, flagThreshold: 3, currentEventId: null };
  failPuts = 0; puts = 0;
  page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: 'tok', player })]);
  await page.route('**/api/state', r => {
    if (r.request().method() === 'PUT') {
      puts++;
      if (failPuts > 0) { failPuts--; return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'down' }) }); }
      const body = JSON.parse(r.request().postData());
      body.events = enforceEventHosts(body.events, server.events, meId);
      server = { ...body };
    }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(server) });
  });
  await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ player }) }));
  await page.goto(APP + path);
}
const shown = (text, timeout = 8000) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout });
const saved = (id = 'e1') => server.events.find(e => e.id === id);
const byLabel = label => page.getByLabel(label, { exact: true }).filter({ visible: true }).first();
const confirmModal = async label => { await page.getByText(label, { exact: true }).filter({ visible: true }).last().click(); await page.waitForTimeout(500); };
const rowPill = (name, pill) => page.getByText(name, { exact: true }).filter({ visible: true }).first()
  .locator(`xpath=ancestor::div[.//div[normalize-space(text())="${pill}"]][1]`).getByText(pill, { exact: true }).first();

/* A published (not started) round robin of 9 made by the real engine: the
   host publishes it first through the app. */
console.log('R2 · a player\'s RSVP change is accepted by the server');
await openAs('host1', [baseEvent({}, [...ids8, 'p9'])], '/event/e1?step=roster');
await step('host publishes the roster (through the server rules)', async () => {
  await shown('Generate roster');
  await page.getByText('Generate roster', { exact: true }).filter({ visible: true }).first().click();
  await page.waitForTimeout(800);
  await page.getByText(/^Publish/).filter({ visible: true }).first().click();
  await page.waitForTimeout(400);
  const confirm = page.getByText(/^Publish/).filter({ visible: true });
  if (await confirm.count() > 1) await confirm.last().click();
  await page.waitForTimeout(800);
  assert.equal(saved().published, true);
  assert.ok(saved().roster.length >= 4);
});
const published = JSON.parse(JSON.stringify(saved()));
await openAs('p7', [published], '/event/e1?step=rsvp');
await step('player marks themselves Out before games start: the server stores rounds without them', async () => {
  await shown('Gus Gray');
  await rowPill('Gus Gray', 'Out').click();
  await page.waitForTimeout(1200);
  const ev = saved();
  assert.equal(ev.rsvps.p7.status, 'out');
  const inGames = ev.roster.some(r => r.courts.some(c => on(c).includes('p7')));
  assert.equal(inGames, false, 'p7 still in games on the server');
  assert.ok(ev.roster.every(r => r.courts.length === 2), 'still two games a round (8 players left)');
});

console.log('R2 · a player scores their own game in King of the Court (games started)');
const kotc = () => baseEvent({
  published: true, started: true, options: { format: 'kingOfCourt', movement: 'game', standings: 'courtPoints', extras: 'rotate' },
  roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: false },
    { offset: 15, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p4']), court(2, ['p5', 'p7'], ['p6', 'p8'])], sitOut: [], played: false, provisional: true },
    { offset: 30, len: 15, courts: [court(1, ['host1', 'p4'], ['p2', 'p3']), court(2, ['p5', 'p8'], ['p6', 'p7'])], sitOut: [], played: false, provisional: true },
    { offset: 45, len: 15, courts: [court(1, ['host1', 'p5'], ['p2', 'p6']), court(2, ['p3', 'p7'], ['p4', 'p8'])], sitOut: [], played: false, provisional: true },
  ],
});
await openAs('p7', [kotc()], '/event/e1?step=rounds');
await step('player enters their game\'s score: stored with the server\'s stamp; the other court stays unscored', async () => {
  await shown('Round 1 of 4 · 11pm');
  await byLabel('Score for Gus Gray and Ivy Ives').fill('11');
  await byLabel('Score for Eli Ennis and Fay Ford').fill('7');
  await page.waitForTimeout(1200);
  const c = saved().roster[0].courts[1];
  assert.deepEqual([c.scoreB, c.scoreA, c.scoredBy], [11, 7, 'p7']);
  assert.ok(!('baseAt' in c), 'baseAt not stored');
  assert.equal(saved().roster[0].courts[0].scoreA, null);
});
await step('…the host then scores court 1 and moves on: round 2 follows the movement rule on the server', async () => {
  await openAs('host1', [JSON.parse(JSON.stringify(saved()))], '/event/e1?step=rounds');
  await shown('Round 1 of 4 · 11pm');
  await byLabel('Score for Hana Host and Ben Brown').fill('11');
  await byLabel('Score for Cara Cole and Dev Dean').fill('5');
  await page.waitForTimeout(800);
  await page.getByText('Next round', { exact: true }).click();
  await page.waitForTimeout(1000);
  const ev = saved();
  assert.equal(ev.currentRoundIndex, 1);
  assert.deepEqual(on(ev.roster[1].courts[0]).sort(), ['host1', 'p2', 'p7', 'p8'].sort());
  assert.deepEqual([ev.roster[0].courts[1].scoreB, ev.roster[0].courts[0].scoreA], [11, 11], 'both scores kept');
});

console.log('R2 · playoffs through the server rules');
const pool = () => baseEvent({
  published: true, started: true, options: { format: 'poolPlay', partners: 'fixed', groups: 'fixed', standings: 'winPct', playoffs: 'single', playoffTeams: 4, extras: 'rotate', pairs: [['host1', 'p2'], ['p3', 'p4'], ['p5', 'p6'], ['p7', 'p8']] },
  currentRoundIndex: 2,
  roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4'], 11, 3), court(2, ['p5', 'p6'], ['p7', 'p8'], 11, 9)], sitOut: [], played: false },
    { offset: 15, len: 15, courts: [court(1, ['host1', 'p2'], ['p5', 'p6'], 11, 5), court(2, ['p3', 'p4'], ['p7', 'p8'], 11, 7)], sitOut: [], played: false },
    { offset: 30, len: 15, courts: [court(1, ['host1', 'p2'], ['p7', 'p8'], 11, 1), court(2, ['p3', 'p4'], ['p5', 'p6'], 4, 11)], sitOut: [], played: false },
    { offset: 45, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: false },
  ],
});
await openAs('host1', [pool()], '/event/e1?step=rounds');
await step('host starts playoffs; the bracket is stored', async () => {
  await page.getByText('Start playoffs', { exact: true }).filter({ visible: true }).first().click();
  await confirmModal('Start playoffs');
  await shown('Playoffs · single elimination');
  assert.equal(saved().playoffs.matches.length, 3);
});
await step('a player scores their semifinal; the host\'s phone shows the final filled in', async () => {
  const withBracket = JSON.parse(JSON.stringify(saved()));
  await openAs('p7', [withBracket], '/event/e1?step=rounds');
  await shown('Playoffs · single elimination');
  await byLabel('Semifinal 1 score for Gus Gray and Ivy Ives').fill('11');
  await byLabel('Semifinal 1 score for Hana Host and Ben Brown').fill('9');
  await page.waitForTimeout(1200);
  const m = saved().playoffs.matches;
  assert.deepEqual([m[0].scoreA, m[0].scoreB, m[2].teamA], [9, 11, ['p7', 'p8']]);
});

console.log('R2 · failed save retried (D-6)');
const plain = () => baseEvent({ published: true, started: true, options: { standings: 'winPct' }, roster: [
  { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: false },
  { offset: 15, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p4']), court(2, ['p5', 'p7'], ['p6', 'p8'])], sitOut: [], played: false }] });
await openAs('host1', [plain()], '/event/e1?step=rounds');
await step('a save that fails twice is retried by the sync loop and reaches the server; the box keeps the score', async () => {
  await shown('Round 1 of 2 · 11pm');
  failPuts = 2;
  await byLabel('Score for Hana Host and Ben Brown').fill('11');
  await page.waitForTimeout(20000);
  assert.equal(await byLabel('Score for Hana Host and Ben Brown').inputValue(), '11');
  assert.equal(saved().roster[0].courts[0].scoreA, 11, `server never got it (${puts} PUTs)`);
});
await step('the app tells the user a change hasn\'t been saved yet while saves are failing', async () => {
  failPuts = 1000;
  await byLabel('Score for Cara Cole and Dev Dean').fill('4');
  await page.waitForTimeout(3000);
  const hint = await page.getByText(/not saved|unsaved|offline|couldn.t save|retrying/i).filter({ visible: true }).count();
  failPuts = 0;
  assert.ok(hint > 0, 'no visible sign that the score is not saved');
});
await openAs('p7', [plain()], '/event/e1?step=rounds');
await step('while a player\'s save keeps failing, the host moving on still reaches their phone', async () => {
  await shown('Round 1 of 2 · 11pm');
  failPuts = 1000;
  await byLabel('Score for Gus Gray and Ivy Ives').fill('11');
  await page.waitForTimeout(1500);
  server.events[0].currentRoundIndex = 1; // the host moved on
  const ok = await page.getByText('Round 2 of 2 · 11:15pm', { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 20000 }).then(() => true, () => false);
  failPuts = 0;
  assert.ok(ok, `still on round 1 after 20 s (${puts} PUT attempts, all failing): live sync stops while a save is failing`);
});

console.log('R2 · round alerts only moving forward');
await openAs('p7', [{ ...plain(), currentRoundIndex: 1 }], '/event/e1?step=setup');
await step('the host stepping back a round gives no alert; moving forward does', async () => {
  await shown('Setup');
  server.events[0].currentRoundIndex = 0;
  await page.waitForTimeout(10000);
  assert.equal(await page.getByText(/^Round 1:/).filter({ visible: true }).count(), 0, 'alert on stepping back');
  server.events[0].currentRoundIndex = 1;
  await page.getByText(/^Round 2:/).filter({ visible: true }).first().waitFor({ timeout: 15000 });
});

await step('no errors on the page', async () => assert.deepEqual(errors, []));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
