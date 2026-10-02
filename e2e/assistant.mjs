/* Browser test for the assistant chat, the Events page sections and the
   draft/new-event changes — with the server simulated in the browser (no
   backend, no AI calls, no real data touched). Checks what the app would
   save by capturing its PUT /api/state.

     npx expo export --platform web --output-dir e2e/web
     cd e2e && npm install && npm run serve        (one terminal)
     cd e2e && npm run test:assistant               (another)

   Uses the installed Edge (or set BROWSER to a Chrome/Chromium path). */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const APP = process.env.APP_URL || 'http://localhost:5055';
const SHOTS = process.env.SHOTS || 'screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

const pad = n => String(n).padStart(2, '0');
const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const me = { id: 'host1', name: 'Hana Host', gender: 'F', claimed: true };
const baseEvent = (id, name, date, published, extra = {}) => ({
  id, name, date, startTime: '18:00', durationMin: 180, courts: 3, gameLenMin: 15,
  segments: [{ start: '18:00', end: '21:00', modes: {} }], rsvps: {}, bookingSlots: [], roster: null, noShows: [],
  currentRoundIndex: 0, published, memberIds: ['host1'], courtNames: {}, createdBy: 'host1', ...extra,
});
let state = {
  players: [me, { id: 'p2', name: 'Cleo', gender: 'F', claimed: false }, { id: 'p3', name: 'Dev', gender: 'M', claimed: false }],
  events: [
    baseEvent('draft1', 'Draft Session', day(4), false),
    baseEvent('pub1', 'League Night', day(2), true, { segments: [
      { start: '18:00', end: '19:00', modes: { 1: 'mixed', 2: 'men' } },
      { start: '19:00', end: '19:15', modes: { 1: 'break', 2: 'break', 3: 'break' } },
      { start: '19:15', end: '21:00', modes: {} },
    ] }),
    baseEvent('old1', 'Last Week Mixer', day(-7), true),
    baseEvent('old2', 'Old Draft', day(-10), false),
  ],
  chats: [], history: {}, flagThreshold: 3, currentEventId: null,
};
const puts = [];

const browser = await chromium.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: 'tok', player: me })]);
const reply = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/state', async route => {
  if (route.request().method() === 'PUT') { const body = JSON.parse(route.request().postData()); puts.push(body); state = body; return reply(route, 200, body); }
  return reply(route, 200, state);
});
await page.route('**/api/auth/me', route => reply(route, 200, { player: me }));
let parseCalls = 0;
await page.route('**/api/ai/parse-event', route => (++parseCalls, /game length/i.test(JSON.parse(route.request().postData()).text)
  ? reply(route, 422, { error: "Couldn't find event details in that. Try something like \"Tuesday 6 to 9pm, 4 courts\"." })
  : reply(route, 200, {
  draft: { name: 'Friday Mixer', date: day(5), startTime: '19:00', durationMin: 120, courts: 2, gameLenMin: 12,
    segments: [{ start: '19:00', end: '20:00', modes: { 1: 'mixed', 2: 'mixed' } }, { start: '20:00', end: '21:00', modes: {} }], memberIds: ['p2', 'p3'] },
  filled: ['name', 'date', 'startTime', 'durationMin', 'courts', 'gameLenMin', 'segments', 'players'], unmatchedNames: [], courtsFrom: 8, aiUsed: true,
})));
let editCalls = 0;
await page.route('**/api/ai/edit-event', route => {
  editCalls++;
  const { text } = JSON.parse(route.request().postData());
  if (/game length/i.test(text)) {
    const { event } = JSON.parse(route.request().postData());
    return reply(route, 200, { changes: { gameLenMin: 20 }, summary: `Games ${event.gameLenMin} → 20 min`, unmatchedNames: [], aiUsed: true });
  }
  if (/weather/i.test(text)) return reply(route, 422, { error: 'That doesn\'t look like a change to this event. Try something like "move it to 7pm" or "add Sam".' });
  return reply(route, 200, { changes: { courts: 4, addIds: ['p3'] }, summary: 'Courts 3 → 4 · Added Dev', unmatchedNames: [], aiUsed: true });
});

let failures = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`  ok  - ${name}`); } catch (e) {
    failures++;
    console.error(`FAIL  - ${name}\n        ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${SHOTS}/FAILED-assistant-${failures}.png` }).catch(() => {});
  }
};
const lastPutEvent = id => { const p = puts[puts.length - 1]; return p && p.events.find(e => e.id === id); };

await page.goto(APP + '/');

console.log('Events page');
await step('Upcoming shows its count; past events are listed under Past', async () => {
  await page.getByText('Upcoming events (2)').waitFor({ timeout: 15000 });
  await page.getByText('Past events (2)').waitFor();
  await page.getByText('Last Week Mixer').waitFor();
});
await step('a published event that has ended is Completed; a past draft stays Draft', async () => {
  await page.getByText('Completed', { exact: true }).waitFor();
  const text = await page.locator('body').innerText();
  assert.ok(text.indexOf('Old Draft') > text.indexOf('Past events'));
  await page.screenshot({ path: `${SHOTS}/a1-events.png`, fullPage: true });
});
await step('Past events collapses and expands', async () => {
  await page.getByText('Past events (2)').click();
  await page.getByText('Last Week Mixer').waitFor({ state: 'detached', timeout: 3000 });
  await page.getByText('Past events (2)').click();
  await page.getByText('Last Week Mixer').waitFor({ timeout: 3000 });
});

console.log('Event screen layout');
await step('steps are a numbered indicator on top; name, mode and actions at the bottom', async () => {
  await page.getByText('League Night').first().click();
  const stepOne = page.getByLabel('Step 1 of 6: Setup');
  await stepOne.waitFor({ timeout: 10000 });
  // An event opens in view mode: Close and Edit, no Save yet.
  const edit = page.getByText('Edit', { exact: true }).last();
  const [s1, ed] = [await stepOne.boundingBox(), await edit.boundingBox()];
  assert.ok(s1.y < 250, `steps near the top (y=${s1.y})`);
  assert.ok(ed.y > 915 - 110, `Edit at the bottom (y=${ed.y})`);
  await page.getByText('View mode', { exact: true }).waitFor();
  assert.equal(await page.getByText('Save', { exact: true }).filter({ visible: true }).count(), 0, 'no Save in view mode');
  await page.screenshot({ path: `${SHOTS}/a0-event-layout.png` });
});
await step('a break segment is highlighted in mint', async () => {
  const tag = page.getByText('Break', { exact: true }).first();
  await tag.waitFor({ timeout: 5000 });
  const bg = await tag.evaluate(el => { let n = el; for (let i = 0; i < 6 && n; i++, n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c === 'rgb(231, 253, 247)') return c; } return null; });
  assert.equal(bg, 'rgb(231, 253, 247)', 'break segment sits on the mint tint');
  await page.getByText('No games on any court.').waitFor();
});
await step('Add break: one tap adds a 15-minute break on the hour mark, with its times right there', async () => {
  // Leave League Night (view mode: Close asks nothing) and open the plain draft.
  await page.getByText('Close', { exact: true }).last().click();
  await page.waitForTimeout(1000);
  await page.getByText('Draft Session').click();
  await page.getByText('Edit', { exact: true }).last().click();
  await page.getByText('Edit mode', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('Add game segment').waitFor({ timeout: 5000 });
  await page.getByText('Add break', { exact: true }).first().click();
  await page.getByText('No games on any court from 7pm to 7:15pm.').waitFor({ timeout: 5000 });
  await page.getByText(/^To rest just one court/).first().waitFor();
  await page.screenshot({ path: `${SHOTS}/a0-add-break.png`, fullPage: true });
  await page.getByText('Save', { exact: true }).last().click();
  await page.waitForTimeout(800);
  await page.getByText('View mode', { exact: true }).waitFor({ timeout: 5000 });
  const ev = lastPutEvent('draft1');
  assert.deepEqual(ev.segments.map(x => `${x.start}-${x.end} ${JSON.stringify(x.modes)}`), [
    '18:00-19:00 {}',
    '19:00-19:15 {"1":"break","2":"break","3":"break"}',
    '19:15-21:00 {}',
  ]);
  await page.getByText('Close', { exact: true }).last().click();
  await page.waitForTimeout(1000);
});

console.log('Deleting a draft');
await step('the host can delete a draft from its Setup page', async () => {
  await page.getByText('Draft Session').click();
  await page.getByText('Delete draft').click();
  await page.getByText('Delete', { exact: true }).last().click(); // the in-app confirm
  await page.getByText('Upcoming events (1)').waitFor({ timeout: 10000 });
  await page.waitForTimeout(600);
  assert.ok(!puts[puts.length - 1].events.some(e => e.id === 'draft1'), 'draft removed from the saved state');
});

console.log('New event with the assistant');
await step('the new-event form has a Game length field', async () => {
  // Just back from the deleted draft: wait out the app's double-tap guard
  // (lib/nav.js ignores a new push while the last one is animating).
  await page.waitForTimeout(1000);
  await page.getByText('New Event').click();
  await page.getByText('Game length (min)').waitFor({ timeout: 10000 });
});
await step('a description becomes a message with the assistant\'s reply, and fills the form', async () => {
  await page.getByLabel('Message the assistant').fill('Friday 7 to 9pm, 8 players, 12 minute games, mixed first hour, add Cleo and Dev');
  await page.getByLabel('Send').click();
  await page.getByText(/Filled in .*courts \(2, for 8 players\)/).waitFor({ timeout: 10000 });
  await page.getByText('Friday 7 to 9pm, 8 players', { exact: false }).waitFor();
  const list = await page.getByText('Friday 7 to 9pm, 8 players', { exact: false }).evaluate(el => { let n = el; while (n && !(n.scrollHeight && getComputedStyle(n).overflowY !== 'visible' && getComputedStyle(n).height === '260px')) n = n.parentElement; return n ? n.getBoundingClientRect().height : null; });
  assert.equal(Math.round(list), 260, 'the chat sits in a fixed-height scroll area');
  const values = await page.locator('input').evaluateAll(els => els.map(e => e.value));
  assert.ok(values.includes('Friday Mixer') && values.includes('12') && values.includes('2'), JSON.stringify(values));
  // 7 to 9pm: shown as start and end times, with the length worked out.
  await page.getByText('9pm', { exact: true }).waitFor();
  await page.getByText('Duration: 2 hr', { exact: true }).waitFor();
  await page.screenshot({ path: `${SHOTS}/a2-new-event.png`, fullPage: true });
});
await step('a follow-up changes the form instead of starting over', async () => {
  const before = parseCalls;
  await page.getByLabel('Message the assistant').fill('Can you update the game length to be 20mins each?');
  await page.getByLabel('Send').click();
  await page.getByText(/Games 12 → 20 min. Check the details below/).waitFor({ timeout: 10000 });
  assert.equal(parseCalls, before, 'a follow-up is a change, not a new description');
  const values = await page.locator('input').evaluateAll(els => els.map(e => e.value));
  assert.ok(values.includes('20') && values.includes('Friday Mixer'), JSON.stringify(values));
});
let newId;
await step('Create keeps the conversation with the event', async () => {
  await page.getByText('Create event', { exact: true }).click();
  // A new event opens in edit mode; Save keeps it and switches to view mode.
  await page.getByText('Edit mode', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(800);
  const ev = puts[puts.length - 1].events.find(e => e.name === 'Friday Mixer');
  assert.ok(ev, 'event saved');
  newId = ev.id;
  assert.deepEqual(ev.aiMessages.map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(ev.gameLenMin, 20);
  assert.equal(ev.durationMin, 120);
  await page.getByText('Close', { exact: true }).last().click();
  await page.waitForTimeout(1000);
});

await step("a first message that isn't a description changes the form", async () => {
  await page.getByText('Friday Mixer').first().waitFor();
  await page.waitForTimeout(1000);
  await page.getByText('New Event', { exact: true }).last().click();
  await page.getByText('Game length (min)').waitFor({ timeout: 10000 });
  await page.getByLabel('Message the assistant').fill('set the game length to 20 mins');
  await page.getByLabel('Send').click();
  await page.getByText(/Games 15 → 20 min. Check the details below/).waitFor({ timeout: 10000 });
  const values = await page.locator('input').evaluateAll(els => els.map(e => e.value));
  assert.ok(values.includes('20'), JSON.stringify(values));
  await page.getByText('Cancel', { exact: true }).last().click();
  await page.waitForTimeout(1000);
});

console.log('Changing an event with the assistant');
await step('the assistant button opens the event\'s chat, with its history', async () => {
  await page.getByText('Friday Mixer').first().click();
  await page.getByLabel('Open the assistant').click();
  await page.getByText(/Filled in .*courts/).waitFor({ timeout: 5000 });
});
await step('a change is a new message; the reply says what changed; it applies to the event', async () => {
  await page.getByLabel('Message the assistant').last().fill('add a court and add Dev');
  await page.getByLabel('Send').last().click();
  await page.getByText(/Courts 3 → 4 · Added Dev\. Tap Save/).waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/a3-assistant.png` });
});
await step('something that isn\'t a change gets a reply, kept in the chat', async () => {
  await page.getByLabel('Message the assistant').last().fill('nice weather today');
  await page.getByLabel('Send').last().click();
  await page.getByText(/doesn't look like a change/).waitFor({ timeout: 10000 });
});
await step('Save keeps the change and the whole conversation', async () => {
  // Opening the assistant put the event in edit mode, so its changes are
  // kept with Save, like any other edit.
  await page.getByLabel('Close', { exact: true }).last().click();
  await page.waitForTimeout(400);
  await page.getByText('Edit mode', { exact: true }).waitFor();
  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(800);
  const ev = lastPutEvent(newId);
  assert.equal(ev.courts, 4);
  assert.ok(ev.memberIds.includes('p3'));
  assert.deepEqual(ev.aiMessages.map(m => m.role), ['user', 'assistant', 'user', 'assistant', 'user', 'assistant', 'user', 'assistant']);
  assert.equal(editCalls, 4); // 2 form changes on New event + 2 in the event's assistant
  await page.getByText('Close', { exact: true }).last().click();
  await page.waitForTimeout(1000);
});
await step('the assistant is on every step (e.g. Roster)', async () => {
  await page.getByText('Friday Mixer').first().click();
  await page.getByText('Roster', { exact: true }).click();
  await page.getByLabel('Open the assistant').waitFor({ timeout: 5000 });
  await page.getByText('Close', { exact: true }).last().click();
  await page.waitForTimeout(800);
});
await step('Cancel undoes what the assistant changed', async () => {
  await page.getByText('Friday Mixer').first().click();
  await page.getByLabel('Open the assistant').click();
  await page.getByLabel('Message the assistant').last().fill('update the game length');
  await page.getByLabel('Send').last().click();
  await page.getByText(/Games 20 → 20 min\. Tap Save/).waitFor({ timeout: 10000 });
  await page.getByLabel('Close', { exact: true }).last().click();
  await page.waitForTimeout(400);
  await page.getByText('Cancel', { exact: true }).last().click();
  await page.getByText('Discard', { exact: true }).click();
  await page.getByText('View mode', { exact: true }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  assert.equal(lastPutEvent(newId).aiMessages.length, 8, 'the discarded exchange is gone too');
});

await step('no errors on the page', async () => assert.deepEqual(errors, []));
await browser.close();
if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
