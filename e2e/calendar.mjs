/* Browser test for the swipeable calendar, with the server simulated:
   swipe both ways, a short drag springs back, arrows still work, a day
   tap still selects, and the date picker's calendar swipes too. Run like
   assistant.mjs (npm run test:calendar). */
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';

const APP = process.env.APP_URL || 'http://localhost:5055';
const monthLabel = (offset) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); return d.toLocaleString('en-US', { month: 'long', year: 'numeric' }); };
const me = { id: 'host1', name: 'Hana Host', gender: 'F', claimed: true };
// Enough past events that the list scrolls.
const pad = n => String(n).padStart(2, '0');
const past = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - 3 - i * 4); return { id: 'e' + i, name: `Session ${i + 1}`, date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, startTime: '18:00', durationMin: 120, courts: 2, segments: [], rsvps: {}, memberIds: [], published: true, createdBy: 'host1' }; });
const state = { players: [me], events: past, chats: [], history: {}, flagThreshold: 3, currentEventId: null };

const browser = await chromium.launch({ executablePath: process.env.BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, hasTouch: false });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(([k, v]) => localStorage.setItem(k, v), ['thepickleslot.auth.v2', JSON.stringify({ token: 'tok', player: me })]);
await page.route('**/api/state', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) }));
await page.route('**/api/auth/me', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ player: me }) }));

let failures = 0;
const step = async (name, fn) => {
  try { await fn(); console.log(`  ok  - ${name}`); } catch (e) {
    failures++;
    console.error(`FAIL  - ${name}\n        ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `screenshots/FAILED-calendar-${failures}.png` }).catch(() => {});
  }
};
// A finger drag across the calendar grid: press on a day, move in steps, release.
async function swipe(dx, { steps = 12, anchor = '15' } = {}) {
  // The neighbouring months sit just off-screen either side (clipped) and
  // the screen underneath stays mounted, so use the copy of the day that is
  // actually on top at its own position — what a finger would touch.
  let box = null;
  for (const l of await page.getByText(anchor, { exact: true }).all()) {
    const onTop = await l.evaluate(el => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
    });
    if (onTop) { box = await l.boundingBox(); break; }
  }
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(x + (dx * i) / steps, y + i * 0.3);
  await page.mouse.up();
  await page.waitForTimeout(500); // slide animation
}
// Only visible text counts: screens underneath stay mounted but hidden.
const shown = async (label) => page.getByText(label, { exact: true }).filter({ visible: true }).first().waitFor({ timeout: 3000 });

await page.goto(APP + '/');
await shown(monthLabel(0));

await step('scrolling moves the lists; the calendar stays put', async () => {
  const label = page.getByText(monthLabel(0), { exact: true }).filter({ visible: true }).first();
  const before = (await label.boundingBox()).y;
  const listItem = page.getByText('Session 3', { exact: true });
  const itemBefore = (await listItem.boundingBox()).y;
  const box = await page.getByText('Past events (14)').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 40);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(500);
  assert.equal((await label.boundingBox()).y, before, 'calendar did not move');
  assert.ok((await listItem.boundingBox()).y < itemBefore - 100, 'list scrolled');
  await page.mouse.wheel(0, -2000);
  await page.waitForTimeout(300);
});
await step('swipe left shows the next month', async () => { await swipe(-260); await shown(monthLabel(1)); });
await step('swipe right twice goes back two months', async () => { await swipe(260); await swipe(260); await shown(monthLabel(-1)); });
await step('a short drag springs back to the same month', async () => { await swipe(-50); await shown(monthLabel(-1)); });
await step('the arrows still change month', async () => {
  await page.getByLabel('Next month').click(); await page.waitForTimeout(400); await shown(monthLabel(0));
  await page.getByLabel('Next month').click(); await page.waitForTimeout(400); await shown(monthLabel(1));
  await page.getByLabel('Previous month').click(); await page.waitForTimeout(400); await shown(monthLabel(0));
});
await step('tapping a day after swiping still selects it', async () => {
  await page.getByText('18', { exact: true }).first().click();
  const d = new Date(); d.setDate(18);
  await page.getByText(d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })).waitFor({ timeout: 3000 });
});
await step('the date picker calendar swipes too', async () => {
  await page.getByText('New Event', { exact: true }).last().click();
  await page.getByText('Game length (min)').waitFor({ timeout: 10000 });
  // The Date field shows the full date with the year (list rows don't).
  await page.locator(String.raw`text=/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}, \d{4}$/`).filter({ visible: true }).last().click();
  await page.waitForTimeout(600);
  await shown(monthLabel(0));
  await swipe(-260, { anchor: '20' });
  await shown(monthLabel(1));
});
await step('no errors on the page', async () => assert.deepEqual(errors, []));

await browser.close();
if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
