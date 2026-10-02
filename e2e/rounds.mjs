/* Browser test for event day with standings (server simulated): the host
   enters any score and standings update; a player can score only their own
   game and doesn't see check-in; the host's check-in takes a player out;
   Setup shows the Standings option. Run like assistant.mjs (npm run test:rounds). */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:5055';
const names = { host1: 'Hana Host', p2: 'Ben Brown', p3: 'Cara Cole', p4: 'Dev Dean', p5: 'Eli Ennis', p6: 'Fay Ford', p7: 'Gus Gray', p8: 'Ivy Ives' };
const players = Object.entries(names).map(([id, name], i) => ({ id, name, gender: i % 2 ? 'M' : 'F', claimed: true }));
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const court = (n, teamA, teamB, scoreA = null, scoreB = null) => ({ court: n, mode: 'open', flagged: false, teamA, teamB, scoreA, scoreB });
const baseEvent = () => ({
  id: 'e1', name: 'Tuesday ladder', date: today, startTime: '18:00', durationMin: 60, courts: 2, gameLenMin: 15,
  segments: [{ start: '18:00', end: '19:00', modes: { 1: 'open', 2: 'open' } }],
  rsvps: Object.fromEntries(Object.keys(names).map((id, i) => [id, { status: 'in', start: 0, end: 60, ts: i }])), noShows: [], memberIds: Object.keys(names),
  roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4'], 11, 5), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: {} },
    { offset: 15, len: 15, courts: [court(1, ['host1', 'p3'], ['p5', 'p7']), court(2, ['p2', 'p4'], ['p6', 'p8'])], sitOut: [], played: {} },
  ],
  currentRoundIndex: 0, published: true, started: false, createdBy: 'host1', options: { standings: 'winPct' }, checkedIn: {},
});

const browser = await chromium.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
let failures = 0, page, puts;
const errors = [];
const step = async (name, fn) => {
  try { await fn(); console.log(`  ok  - ${name}`); } catch (e) {
    failures++;
    console.error(`FAIL  - ${name}\n        ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `screenshots/FAILED-rounds-${failures}.png` }).catch(() => {});
  }
};
async function openAs(meId, stepName, ev = baseEvent()) {
  if (page) await page.close();
  const me = players.find(p => p.id === meId);
  let state = { players, events: [ev], chats: [], history: {}, flagThreshold: 3, currentEventId: null };
  page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  puts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: 'tok', player: me })]);
  await page.route('**/api/state', r => {
    if (r.request().method() === 'PUT') { state = JSON.parse(r.request().postData()); puts.push(state); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) });
  });
  await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ player: me }) }));
  await page.goto(`${APP}/event/e1?step=${stepName}`);
}
const shown = (text) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 8000 });
const lastEvent = () => puts.length ? puts[puts.length - 1].events.find(e => e.id === 'e1') : null;
const score = (label) => page.getByLabel(label, { exact: true }).filter({ visible: true }).first();
const editableScores = async () => {
  let n = 0;
  for (const el of await page.locator('[aria-label^="Score for"]').filter({ visible: true }).all()) if (await el.isEditable()) n++;
  return n;
};

await openAs('host1', 'rounds');
await step('host sees standings from the scores so far', async () => {
  await shown('Standings');
  await shown('Win %');
  await shown('1–0');
});
await step('host can enter any score and standings update', async () => {
  assert.equal(await editableScores(), 4);
  await score('Score for Eli Ennis and Fay Ford').fill('11');
  await score('Score for Gus Gray and Ivy Ives').fill('9');
  await page.waitForTimeout(800);
  const c2 = lastEvent().roster[0].courts[1];
  assert.deepEqual([c2.scoreA, c2.scoreB], [11, 9]);
  assert.equal(await page.getByText('1–0', { exact: true }).filter({ visible: true }).count(), 4);
});
await step('host check-in: "Not here" takes a player out, "Here" brings them back', async () => {
  await shown('Check-in (0 of 8 here)');
  await page.getByLabel('Not here: Ivy Ives', { exact: true }).click();
  await page.waitForTimeout(800);
  assert.ok(lastEvent().noShows.includes('p8'), 'p8 marked out');
  await page.getByLabel('Here: Ivy Ives', { exact: true }).click();
  await page.waitForTimeout(800);
  assert.ok(!lastEvent().noShows.includes('p8'), 'p8 back in');
  assert.equal(lastEvent().checkedIn.p8, true);
  await shown('Check-in (1 of 8 here)');
});

await openAs('p7', 'rounds');
await step('a player can score only their own game', async () => {
  await shown("The host runs the rounds. You can enter the score of any game you're playing in.");
  assert.equal(await editableScores(), 2);
  await score('Score for Gus Gray and Ivy Ives').fill('7');
  await page.waitForTimeout(800);
  assert.equal(lastEvent().roster[0].courts[1].scoreB, 7);
});
await step('players see standings but not check-in or round controls', async () => {
  await shown('Standings');
  assert.equal(await page.getByText(/^Check-in/).filter({ visible: true }).count(), 0);
  assert.equal(await page.getByText('Next round', { exact: true }).filter({ visible: true }).count(), 0);
});

await openAs('host1', 'setup');
await step('Setup summary shows the Standings choice', async () => {
  await shown('Standings');
  await shown('Win %');
});

// A break on every court from 6:15 to 6:45: the roster's two empty rounds
// there show as one Break row, and don't count as rounds.
const withBreak = () => ({
  ...baseEvent(), published: false, currentRoundIndex: 0,
  segments: [
    { start: '18:00', end: '18:15', modes: {} },
    { start: '18:15', end: '18:45', modes: { 1: 'break', 2: 'break' } },
    { start: '18:45', end: '19:00', modes: {} },
  ],
  roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [] },
    { offset: 15, len: 15, courts: [], sitOut: [] },
    { offset: 30, len: 15, courts: [], sitOut: [] },
    { offset: 45, len: 15, courts: [court(1, ['host1', 'p3'], ['p5', 'p7']), court(2, ['p2', 'p4'], ['p6', 'p8'])], sitOut: [] },
  ],
});
await openAs('host1', 'roster', withBreak());
await step('roster: a break shows as one "Break" row, not empty rounds', async () => {
  await shown('6:15pm – 6:45pm · Break');
  assert.equal(await page.getByText('6:15pm – 6:45pm · Break', { exact: true }).filter({ visible: true }).count(), 1);
  for (const t of ['6:15pm', '6:30pm']) assert.equal(await page.getByText(t, { exact: true }).filter({ visible: true }).count(), 0, `no empty round at ${t}`);
  await shown('6:45pm');
  // Overview: 2 game rounds (the break isn't counted).
  await page.getByText(/^rounds \(/).filter({ visible: true }).first().waitFor();
  const overview = await page.getByText('games scheduled', { exact: true }).filter({ visible: true }).first().evaluate(el => el.parentElement.parentElement.innerText);
  assert.match(overview, /^4\s+games scheduled\s+2\s+rounds/, overview);
});
await step('no errors on the page', async () => assert.deepEqual(errors, []));

await browser.close();
if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
