/* Browser test for event formats (server simulated): picking a format in
   Setup, King of the Court movement on the Rounds step, playoffs, a clinic,
   fixed pairs, a weekly series, and live sync + round alerts for a player.
   Run like the others (npm run test:formats) against the web export served
   on :5055. */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:5055';
const names = { host1: 'Hana Host', p2: 'Ben Brown', p3: 'Cara Cole', p4: 'Dev Dean', p5: 'Eli Ennis', p6: 'Fay Ford', p7: 'Gus Gray', p8: 'Ivy Ives' };
const players = Object.entries(names).map(([id, name], i) => ({ id, name, gender: i % 2 ? 'M' : 'F', claimed: true, dupr: 5 - i * 0.2 }));
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
let failures = 0, page, puts, server;
const errors = [];
const step = async (name, fn) => {
  try { await fn(); console.log(`  ok  - ${name}`); } catch (e) {
    failures++;
    console.error(`FAIL  - ${name}\n        ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `screenshots/FAILED-formats-${failures}.png` }).catch(() => {});
  }
};
async function openAs(meId, events, path) {
  if (page) await page.close();
  const me = players.find(p => p.id === meId);
  server = { players, events, chats: [], history: {}, flagThreshold: 3, currentEventId: null };
  page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  puts = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: 'tok', player: me })]);
  await page.route('**/api/state', r => {
    if (r.request().method() === 'PUT') { server = JSON.parse(r.request().postData()); puts.push(server); }
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(server) });
  });
  await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ player: me }) }));
  await page.goto(APP + path);
}
const shown = (text, timeout = 8000) => page.getByText(text, { exact: true }).filter({ visible: true }).first().waitFor({ timeout });
const saved = (id = 'e1') => server.events.find(e => e.id === id);
const selectNear = label => page.locator('select').filter({ visible: true }).filter({ has: page.locator(`option:text-is("${label}")`) }).first();
const confirmModal = async (label) => { await page.getByText(label, { exact: true }).filter({ visible: true }).last().click(); await page.waitForTimeout(500); };
const score = label => page.getByLabel(label, { exact: true }).filter({ visible: true }).first();

console.log('formats');
await openAs('host1', [baseEvent()], '/event/e1?step=setup');
await step('choosing a format in Setup fills in its options', async () => {
  await page.getByText('Edit', { exact: true }).filter({ visible: true }).first().click();
  await shown('Format & options');
  await selectNear('King of the Court (Claim the Throne)').selectOption({ label: 'King of the Court (Claim the Throne)' });
  await page.waitForTimeout(600);
  const o = saved().options;
  assert.deepEqual([o.format, o.movement, o.standings, o.extras], ['kingOfCourt', 'game', 'courtPoints', 'rotate']);
  await shown('Court movement');
});
await step('changing one option makes the format "Custom"', async () => {
  await selectNear('By DUPR rating').selectOption({ label: 'By DUPR rating' });
  await page.waitForTimeout(600);
  assert.deepEqual([saved().options.format, saved().options.seeding], ['custom', 'dupr']);
});
await step('fixed pairs: tap two players to pair them', async () => {
  await selectNear('Fixed pairs').selectOption({ label: 'Fixed pairs' });
  await page.waitForTimeout(400);
  await page.getByLabel('Pair Ben Brown', { exact: true }).click();
  await page.getByLabel('Pair Cara Cole', { exact: true }).click();
  await page.waitForTimeout(600);
  assert.deepEqual(saved().options.pairs, [['p2', 'p3']]);
  await page.getByText('Auto-pair by DUPR', { exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(saved().options.pairs.length, 4);
  await page.getByLabel('Split Ben Brown and Cara Cole', { exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(saved().options.pairs.length, 3);
});
await step('the summary shows the format', async () => {
  await page.getByText('Done', { exact: true }).filter({ visible: true }).first().click();
  await shown('Custom');
  await shown('How it plays');
});

const kotc = () => {
  const ev = baseEvent({
    published: true, options: { format: 'kingOfCourt', movement: 'game', standings: 'courtPoints', extras: 'rotate' },
    roster: [
      { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: false },
      { offset: 15, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p4']), court(2, ['p5', 'p7'], ['p6', 'p8'])], sitOut: [], played: false, provisional: true },
      { offset: 30, len: 15, courts: [court(1, ['host1', 'p4'], ['p2', 'p3']), court(2, ['p5', 'p8'], ['p6', 'p7'])], sitOut: [], played: false, provisional: true },
    ],
  });
  return ev;
};
await openAs('host1', [kotc()], '/event/e1?step=rounds');
await step('King of the Court: up next is provisional until scores are in', async () => {
  await shown('Provisional — this depends on the scores of the round being played, and updates as they come in.');
});
await step('…scores move winners up and losers down', async () => {
  await score('Score for Hana Host and Ben Brown').fill('11');
  await score('Score for Cara Cole and Dev Dean').fill('4');
  await score('Score for Eli Ennis and Fay Ford').fill('11');
  await score('Score for Gus Gray and Ivy Ives').fill('6');
  await page.waitForTimeout(800);
  const next = saved().roster[1];
  const on = c => [...c.teamA, ...c.teamB].sort();
  assert.deepEqual(on(next.courts[0]), ['host1', 'p2', 'p5', 'p6']);
  assert.deepEqual(on(next.courts[1]), ['p3', 'p4', 'p7', 'p8']);
  assert.ok(!next.provisional, 'decided');
  await page.getByText('Next round', { exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(saved().currentRoundIndex, 1);
  // The recompute lays out every round of the hour (4), not the fixture's 3.
  await shown('Round 2 of 4 · 11:15pm');
});

const pool = () => baseEvent({
  published: true, options: { format: 'poolPlay', partners: 'fixed', groups: 'fixed', standings: 'winPct', playoffs: 'single', playoffTeams: 4, pairs: [['host1', 'p2'], ['p3', 'p4'], ['p5', 'p6'], ['p7', 'p8']] },
  currentRoundIndex: 2,
  roster: [
    { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4'], 11, 3), court(2, ['p5', 'p6'], ['p7', 'p8'], 11, 9)], sitOut: [], played: false },
    { offset: 15, len: 15, courts: [court(1, ['host1', 'p2'], ['p5', 'p6'], 11, 5), court(2, ['p3', 'p4'], ['p7', 'p8'], 11, 7)], sitOut: [], played: false },
    { offset: 30, len: 15, courts: [court(1, ['host1', 'p2'], ['p7', 'p8'], 11, 1), court(2, ['p3', 'p4'], ['p5', 'p6'], 4, 11)], sitOut: [], played: false },
    { offset: 45, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [], played: false },
  ],
});
await openAs('host1', [pool()], '/event/e1?step=rounds');
await step('playoffs: start from the standings; later rounds are dropped', async () => {
  await page.getByText('Start playoffs', { exact: true }).filter({ visible: true }).first().click();
  await confirmModal('Start playoffs');
  await shown('Playoffs · single elimination');
  assert.equal(saved().roster.length, 3);
  assert.deepEqual(saved().playoffs.teams[0], ['host1', 'p2']);
  await shown('Semifinal 1');
});
await step('…semifinal results fill the final; the final crowns a champion', async () => {
  await score('Semifinal 1 score for Hana Host and Ben Brown').fill('11');
  await score('Semifinal 1 score for Gus Gray and Ivy Ives').fill('2');
  await score('Semifinal 2 score for Eli Ennis and Fay Ford').fill('11');
  await score('Semifinal 2 score for Cara Cole and Dev Dean').fill('9');
  await page.waitForTimeout(600);
  await score('Final score for Hana Host and Ben Brown').fill('11');
  await score('Final score for Eli Ennis and Fay Ford').fill('8');
  await page.waitForTimeout(800);
  await page.getByText(/Champions: Hana Host & Ben Brown/).filter({ visible: true }).first().waitFor({ timeout: 5000 });
  assert.equal(saved().playoffs.matches.find(m => m.id === 'W2-1').scoreA, 11);
});

await openAs('host1', [baseEvent({ options: { format: 'clinic', games: 'none' } })], '/event/e1?step=setup');
await step('a clinic has no Roster or Rounds step, and publishes from Setup', async () => {
  await shown('Setup');
  assert.equal(await page.getByText('Roster', { exact: true }).filter({ visible: true }).count(), 0);
  assert.equal(await page.getByText('Rounds', { exact: true }).filter({ visible: true }).count(), 0);
  await page.getByText('Publish event', { exact: true }).click();
  await page.waitForTimeout(600);
  assert.equal(saved().published, true);
});

await openAs('host1', [baseEvent({ published: true, roster: [], options: { format: 'league', repeat: 'weekly', standings: 'winPct' }, seriesId: 'e1' })], '/event/e1?step=setup');
await step('a weekly series: schedule the next session a week later', async () => {
  await page.getByText('Schedule next session', { exact: true }).click();
  await page.waitForTimeout(800);
  const next = server.events.find(e => e.id !== 'e1');
  const [y, m, dd] = today.split('-').map(Number);
  assert.equal(next.date, new Date(Date.UTC(y, m - 1, dd + 7)).toISOString().slice(0, 10));
  assert.deepEqual([next.seriesId, next.published, next.memberIds.length], ['e1', false, 8]);
});

await openAs('p7', [kotc()], '/event/e1?step=rounds');
await step('live sync: a player sees the host move on, with a round alert', async () => {
  await shown('Round 1 of 3 · 11pm');
  const ev = server.events[0];
  ev.roster[0].courts.forEach(c => { c.scoreA = 11; c.scoreB = 3; c.scoredAt = Date.now(); });
  ev.currentRoundIndex = 1;
  await shown('Round 2 of 3 · 11:15pm', 15000);
  await page.getByText(/Round 2: Court 2 with/).filter({ visible: true }).first().waitFor({ timeout: 3000 });
});
await step('no errors on the page', async () => assert.deepEqual(errors, []));

await browser.close();
if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
