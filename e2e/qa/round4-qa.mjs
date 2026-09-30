/* QA round 4 (browser, cfac9ce5): RSVP controls by role (FR-11) — a player
   can change only their own row, the host anyone's, anyone in a hostless
   event — with saves routed through the real server rules; plus a repeat
   refused save shows its message each time (R3-5). Run from e2e/ against
   the web export on :5055: node qa/round4-qa.mjs */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { enforceEventHosts } from '../../backend-worker/src/state.js';

const APP = process.env.APP_URL || 'http://localhost:5055';
const names = { host1: 'Hana Host', p2: 'Ben Brown', p3: 'Cara Cole', p4: 'Dev Dean', p5: 'Eli Ennis', p6: 'Fay Ford', p7: 'Gus Gray', p8: 'Ivy Ives' };
const players = Object.entries(names).map(([id, name], i) => ({ id, name, gender: i % 2 ? 'M' : 'F', claimed: true, dupr: +(5 - i * 0.2).toFixed(1) }));
const pad = n => String(n).padStart(2, '0');
const d = new Date();
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const ids = Object.keys(names);
const court = (n, teamA, teamB) => ({ court: n, mode: 'open', flagged: false, teamA, teamB, scoreA: null, scoreB: null });
const baseEvent = (over = {}) => ({
  id: 'e1', name: 'Tuesday night', date: today, startTime: '23:00', durationMin: 60, courts: 2, gameLenMin: 15,
  segments: [{ start: '23:00', end: '00:00', modes: {} }],
  rsvps: Object.fromEntries(ids.map((id, i) => [id, { status: i === 6 ? 'partial' : 'in', start: 0, end: i === 6 ? 30 : 60, ts: i }])), noShows: [], memberIds: ids,
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
    await page.screenshot({ path: `screenshots/FAILED-qa4-${failures}.png` }).catch(() => {});
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
/* The In/Partial/Out pill of a member's row. */
const rowPill = (name, pill) => page.getByText(name, { exact: true }).filter({ visible: true }).first()
  .locator(`xpath=ancestor::div[.//div[normalize-space(text())="${pill}"]][1]`).getByRole('button', { name: pill, exact: true }).first();
// Pill (lib/ui.js:108) marks a disabled, not-selected pill with opacity 0.45 only (no aria-disabled on web).
const isDisabled = async loc => ((await loc.getAttribute('style')) || '').includes('opacity: 0.45');
const allDisabled = async name => { const r = []; for (const p of ['In', 'Partial', 'Out']) r.push(await isDisabled(rowPill(name, p))); return r; };

console.log('R4 · RSVP controls by role');
await openAs('p2', [baseEvent()], '/event/e1?step=rsvp');
await step('player: own row enabled, other rows disabled', async () => {
  await shown('Ben Brown');
  assert.deepEqual(await allDisabled('Ben Brown'), [false, false, false]);
  assert.deepEqual(await allDisabled('Gus Gray'), [true, false, true], 'Gus: In and Out dimmed (Partial is his selected one)');
  assert.deepEqual(await allDisabled('Hana Host'), [false, true, true], 'Hana: Partial and Out dimmed (In is selected)');
});
await step('player: another player\'s partial time pickers are disabled', async () => {
  const row = page.getByText('Gus Gray', { exact: true }).filter({ visible: true }).first().locator('xpath=ancestor::div[.//*[normalize-space(text())="From"]][1]');
  await row.getByText('11:30pm', { exact: true }).first().click({ force: true });
  await page.waitForTimeout(800);
  const dialogs = await page.getByText('Done', { exact: true }).filter({ visible: true }).count();
  assert.equal(dialogs, 0, 'a time picker opened for another player');
  assert.equal(saved().rsvps.p7.end, 30);
});
await step('player: tapping another player\'s "Out" does nothing, locally or on the server', async () => {
  await rowPill('Gus Gray', 'Out').click({ force: true });
  await page.waitForTimeout(1200);
  assert.equal(saved().rsvps.p7.status, 'partial');
});
await step('player: own "Out" is saved', async () => {
  await rowPill('Ben Brown', 'Out').click();
  await page.waitForTimeout(1200);
  assert.equal(saved().rsvps.p2.status, 'out');
});
await openAs('host1', [baseEvent()], '/event/e1?step=rsvp');
await step('host: another player\'s time picker opens (control for the check above)', async () => {
  await shown('Gus Gray');
  const row = page.getByText('Gus Gray', { exact: true }).filter({ visible: true }).first().locator('xpath=ancestor::div[.//*[normalize-space(text())="From"]][1]');
  await row.getByText('11:30pm', { exact: true }).first().click({ force: true });
  await page.waitForTimeout(800);
  assert.ok(await page.getByText('Done', { exact: true }).filter({ visible: true }).count() > 0, 'no picker opened for the host either: the check above is vacuous');
  await page.getByText('Cancel', { exact: true }).filter({ visible: true }).last().click().catch(() => {});
  await page.waitForTimeout(400);
});
await step('host: every row enabled; marking a player Out is saved', async () => {
  await shown('Gus Gray');
  assert.deepEqual(await allDisabled('Gus Gray'), [false, false, false]);
  await rowPill('Gus Gray', 'Out').click();
  await page.waitForTimeout(1200);
  assert.equal(saved().rsvps.p7.status, 'out');
});
await openAs('p2', [baseEvent({ createdBy: undefined })], '/event/e1?step=rsvp');
await step('hostless event: a player can set anyone\'s RSVP', async () => {
  await shown('Gus Gray');
  assert.deepEqual(await allDisabled('Gus Gray'), [false, false, false]);
  await rowPill('Gus Gray', 'In').click();
  await page.waitForTimeout(1200);
  assert.equal(saved().rsvps.p7.status, 'in');
});
await openAs('p2', [baseEvent({ started: true, published: true, roster: [{ offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [] }] })], '/event/e1?step=rsvp');
await step('games started: even the player\'s own row is locked', async () => {
  await shown('Ben Brown');
  assert.deepEqual(await allDisabled('Ben Brown'), [false, true, true], 'In is selected; Partial and Out dimmed');
});

console.log('R4 · repeated refusals (R3-5)');
const plain = () => baseEvent({ published: true, started: true, roster: [
  { offset: 0, len: 15, courts: [court(1, ['host1', 'p2'], ['p3', 'p4']), court(2, ['p5', 'p6'], ['p7', 'p8'])], sitOut: [] },
  { offset: 15, len: 15, courts: [court(1, ['host1', 'p3'], ['p2', 'p4']), court(2, ['p5', 'p7'], ['p6', 'p8'])], sitOut: [] }] });
await openAs('host1', [plain()], '/event/e1?step=rounds');
await step('three refused saves in a row (two while the message is still showing) each end with the message showing', async () => {
  await shown('Round 1 of 2 · 11pm');
  putStatus = 400;
  for (const l of ['Score for Hana Host and Ben Brown', 'Score for Cara Cole and Dev Dean', 'Score for Eli Ennis and Fay Ford']) {
    await page.getByLabel(l, { exact: true }).filter({ visible: true }).first().fill('9');
    await page.waitForTimeout(1500);
    assert.ok(await page.getByText(/couldn.t be saved and was undone/).filter({ visible: true }).count() > 0, `no message after ${l}`);
  }
  putStatus = 200;
});

await step('no errors on the page', async () => assert.deepEqual(errors, []));
await browser.close();
console.log(`\n${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
console.log('all passed');
