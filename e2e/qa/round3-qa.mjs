/* QA round 3 (browser, f842f888): saves go through the real server rules
   (enforceEventHosts from backend-worker/src/state.js). Checks the sync
   strip (retrying, refused), the merge while saves fail (host offline taps
   "Next round"), and RSVP taps for another player against the stricter
   roster rule. Run from e2e/ against the web export on :5055:
     node qa/round3-qa.mjs */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { enforceEventHosts } from '../../backend-worker/src/state.js';

const APP = process.env.APP_URL || 'http://localhost:5055';
const names = { host1: 'Hana Host', p2: 'Ben Brown', p3: 'Cara Cole', p4: 'Dev Dean', p5: 'Eli Ennis', p6: 'Fay Ford', p7: 'Gus Gray', p8: 'Ivy Ives', p9: 'Jo Jones', p10: 'Kim Kerr' };
const players = Object.entries(names).map(([id, name], i) => ({ id, name, gender: i % 2 ? 'M' : 'F', claimed: true, dupr: +(5 - i * 0.2).toFixed(1) }));
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const court = (n, teamA, teamB, scoreA = null, scoreB = null) => ({ court: n, mode: 'open', flagged: false, teamA, teamB, scoreA, scoreB });
const on = c => [...c.teamA, ...c.teamB];
const ids = Object.keys(names);
const baseEvent = (over = {}, list = ids) => ({
  id: 'e1', name: 'Tuesday night', date: today, startTime: '23:00', durationMin: 60, courts: 2, gameLenMin: 15,
  segments: [{ start: '23:00', end: '00:00', modes: {} }],
  rsvps: Object.fromEntries(list.map((id, i) => [id, { status: 'in', start: 0, end: 60, ts: i }])), noShows: [], memberIds: list,
  roster: null, currentRoundIndex: 0, published: false, started: false, createdBy: 'host1', checkedIn: {},
  ...over,
});

const browser = await chromium.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
let failures = 0, passes = 0, page, server, meId, putStatus = 200;
const errors = [];
const step = async (name, fn) => {
  try { await fn(); passes++; console.log(`  ok  - ${name}`); } catch (e) {
    failures++;
    console.error(`FAIL  - ${name}\n        ${String(e.message).split('\n').slice(0, 4).join('\n        ')}`);
    await page.screenshot({ path: `screenshots/FAILED-qa3-${failures}.png` }).catch(() => {});
  }
};
async function openAs(me, events, path) {
  if (page) await page.close();
  meId = me;
  const player = players.find(p => p.id === me);
  server = { players, events, chats: [], history: {}, flagThreshold: 3, currentEventId: null };
  putStatus = 200;
  page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: 'tok', player })]);
  await page.route('**/api/state', r => {
    if (r.request().method() === 'PUT') {
      if (putStatus !== 200) return r.fulfill({ status: putStatus, contentType: 'application/json', body: JSON.stringify({ error: 'nope' }) });
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
const rowPill = (name, pill) => page.getByText(name, { exact: true }).filter({ visible: true }).first()
  .locator(`xpath=ancestor::div[.//div[normalize-space(text())="${pill}"]][1]`).getByText(pill, { exact: true }).first();
const strip = re => page.getByText(re).filter({ visible: true });

const plain = () => baseEvent({ published: true, started: true, options: { standings: 'winPct' }, roster: [
  { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: ['p9', 'p10'], played: false },
  { offset: 15, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p9']), court(2, ['p5', 'p7'], ['p10', 'p8'])], sitOut: ['p4', 'p6'], played: false },
  { offset: 30, len: 15, courts: [court(1, ['host1', 'p10'], ['p2', 'p6']), court(2, ['p4', 'p7'], ['p9', 'p8'])], sitOut: ['p3', 'p5'], played: false }] }, ids);

console.log('R3 · sync strip');
await openAs('host1', [plain()], '/event/e1?step=rounds');
await step('a failing save (503) shows "Not saved yet … Retrying"; it clears once the save goes through', async () => {
  await shown('Round 1 of 3 · 11pm');
  putStatus = 503;
  await byLabel('Score for Hana Host and Ben Brown').fill('11');
  await strip(/Not saved yet/).first().waitFor({ timeout: 5000 });
  putStatus = 200;
  await page.waitForTimeout(12000);
  assert.equal(await strip(/Not saved yet/).count(), 0, 'strip still shown');
  assert.equal(saved().roster[0].courts[0].scoreA, 11);
});
await step('a refused save (400) says it was undone, and the screen goes back to the server\'s copy', async () => {
  putStatus = 400;
  await byLabel('Score for Cara Cole and Dev Dean').fill('7');
  await strip(/couldn.t be saved and was undone/).first().waitFor({ timeout: 5000 });
  putStatus = 200;
  await page.waitForTimeout(1500);
  assert.equal(await byLabel('Score for Cara Cole and Dev Dean').inputValue(), '');
  await page.waitForTimeout(9000);
  assert.equal(await strip(/couldn.t be saved/).count(), 0, 'message hides');
});
await step('a second refused save (after the first message has hidden) is reported too', async () => {
  // syncProblem stays 'rejected' until a save succeeds, and the strip only
  // reacts to a change of state (lib/store.js setSyncProblem).
  putStatus = 400;
  await byLabel('Score for Eli Ennis and Fay Ford').fill('11');
  await page.waitForTimeout(1500);
  const said = await strip(/couldn.t be saved and was undone/).count();
  const v = await byLabel('Score for Eli Ennis and Fay Ford').inputValue();
  putStatus = 200;
  assert.ok(said > 0 || v === '11', `the score was ${v === '' ? 'undone' : 'kept'} with no message`);
});

console.log('R3 · merge while a save fails');
await openAs('host1', [plain()], '/event/e1?step=rounds');
await step('host offline taps "Next round" while a player\'s score reaches the server: after reconnecting the server is on round 2', async () => {
  await shown('Round 1 of 3 · 11pm');
  putStatus = 503;
  await page.getByText('Next round', { exact: true }).click();
  await shown('Round 2 of 3 · 11:15pm');
  Object.assign(server.events[0].roster[0].courts[1], { scoreA: 11, scoreB: 6, scoredAt: Date.now(), scoredBy: 'p5' });
  await page.waitForTimeout(10000); // a poll merges while the save still fails
  putStatus = 200;
  await page.waitForTimeout(10000);
  const ev = saved();
  assert.deepEqual([ev.currentRoundIndex, ev.roster[0].courts[1].scoreA], [1, 11], `server: round index ${ev.currentRoundIndex}`);
  assert.equal(await page.getByText('Round 2 of 3 · 11:15pm', { exact: true }).filter({ visible: true }).count(), 1, 'host screen went back to round 1');
});

console.log('R3 · RSVP taps for someone else');
const unstarted = () => {
  const e = plain(); e.started = false; return e;
};
await openAs('p2', [unstarted()], '/event/e1?step=rsvp');
await step('a player taps "Out" for another player (the app allows it): the stored event stays consistent', async () => {
  await shown('Gus Gray');
  await rowPill('Gus Gray', 'Out').click();
  await page.waitForTimeout(1500);
  const ev = saved();
  const scheduled = ev.roster.some(r => r.courts.some(c => on(c).includes('p7')));
  assert.ok(!(ev.rsvps.p7.status === 'out' && scheduled), `server: p7 is "${ev.rsvps.p7.status}" but still scheduled in ${ev.roster.filter(r => r.courts.some(c => on(c).includes('p7'))).length} round(s)`);
});

await step('no errors on the page', async () => assert.deepEqual(errors, []));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
