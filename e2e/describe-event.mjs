/* Browser test for "Describe your event": drives the web build like a
   user — describe an event, check the form fills in, create and save it —
   then checks what the server stored. Makes 2 real Workers AI calls.

   Needs the local Worker with players named Cleo and Dev (run
   backend-worker's `npm test` on a fresh DB first — it creates them):
     cd backend-worker && npm run db:fresh:local && npx wrangler dev
     (other terminal) cd backend-worker && npm test
   Then build and serve the web app against it, and run this:
     EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 npx expo export --platform web --output-dir e2e/web
     cd e2e && npm install && npm run serve        (one terminal)
     cd e2e && npm test                             (another)
   Uses the installed Edge (or set BROWSER to a Chrome/Chromium path). */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const API = 'http://127.0.0.1:8787';
const APP = 'http://localhost:5055';
const SHOTS = process.env.SHOTS || 'screenshots';
await import('node:fs').then(fs => fs.mkdirSync(SHOTS, { recursive: true }));
const post = (p, b, h = {}) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) }).then(r => r.json());

// A signed-in account, set up through the API (the UI sign-up needs a real email).
const email = `e2e${Date.now()}@example.com`;
const { devOtp } = await post('/api/auth/signup/otp', { name: 'E2E Host', gender: 'O', email, password: 'e2e password 1' });
const session = await post('/api/auth/signup/verify', { email, otp: devOtp });
assert.ok(session.token, 'got a session');

const browser = await chromium.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 412, height: 915 } }); // phone-sized
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('status of 422')) consoleErrors.push(m.text()); }); // 422 = the off-topic step, expected
page.on('pageerror', e => consoleErrors.push(String(e)));
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: session.token, player: session.player })]);

let failures = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message.split('\n')[0]}`); }
};

await page.goto(APP + '/');
await page.waitForTimeout(1500);
await page.goto(APP + '/event/new');
const box = page.getByLabel('Describe your event');

await step('the describe box is shown on the new-event screen', async () => {
  await box.waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${SHOTS}/1-empty.png` });
});

await step('an off-topic request shows a helpful message and fills nothing', async () => {
  await box.fill('can you remind me to buy milk');
  await page.getByText('Fill in form').click();
  await page.getByText("Couldn't find event details").waitFor({ timeout: 30000 });
  assert.equal(await page.getByLabel('Event name').inputValue().catch(() => page.locator('input').first().inputValue()), '');
});

const text = 'Next Tuesday 6 to 9pm, 3 courts, 12 minute games, mixed for the first hour then open, add Cleo, Dev and Priya';
await step('a description fills in the form', async () => {
  await box.fill(text);
  await page.getByText('Fill in form').click();
  await page.getByText(/^Filled in /).waitFor({ timeout: 30000 });
  await page.screenshot({ path: `${SHOTS}/2-filled.png`, fullPage: true });
  const inputs = await page.locator('input').evaluateAll(els => els.map(e => e.value));
  assert.ok(inputs.includes('180'), `duration 180 in ${JSON.stringify(inputs)}`);
  assert.ok(inputs.includes('3'), `courts 3 in ${JSON.stringify(inputs)}`);
});

await step('an unknown player name is flagged, not guessed', async () => {
  await page.getByText(/Couldn't find a player named Priya/).waitFor({ timeout: 5000 });
});

await step('Create event opens the event, and Save stores it', async () => {
  await page.getByText('Create event', { exact: true }).click();
  await page.getByText('Save', { exact: true }).waitFor({ timeout: 10000 });
  await page.screenshot({ path: `${SHOTS}/3-setup.png`, fullPage: true });
  await page.getByText('Save', { exact: true }).click();
  await page.waitForTimeout(2500); // state sync to the server
});

await step('the saved event matches the description', async () => {
  const state = await fetch(API + '/api/state').then(r => r.json());
  const ev = state.events.find(e => e.createdBy === session.player.id);
  assert.ok(ev, 'event saved with this host');
  const names = ev.memberIds.map(id => state.players.find(p => p.id === id).name).sort();
  assert.deepEqual(
    { date: ev.date, startTime: ev.startTime, durationMin: ev.durationMin, courts: ev.courts, gameLenMin: ev.gameLenMin, names },
    { date: nextTuesday(), startTime: '18:00', durationMin: 180, courts: 3, gameLenMin: 12, names: ['Cleo', 'Dev'] },
  );
  assert.deepEqual(ev.segments.map(s => [s.start, s.end, s.modes['1'] || 'open', s.modes['3'] || 'open']), [['18:00', '19:00', 'mixed', 'mixed'], ['19:00', '21:00', 'open', 'open']]);
});

await step('no errors in the browser console', async () => assert.deepEqual(consoleErrors, [], consoleErrors.join(' || ')));

await browser.close();
function nextTuesday() {
  const d = new Date(); d.setHours(12);
  do { d.setDate(d.getDate() + 1); } while (d.getDay() !== 2);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
