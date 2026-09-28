/* How well does the assistant change an existing event? Sends each sample
   to /api/ai/edit-event against one fixed event and checks the changes
   exactly — including that nothing ELSE changed. Uses the real model
   (about 22 requests of the free daily allowance). Needs the local
   Worker with test players Ava M, Ben, Cleo, Dev, Fay (backend-worker's
   `npm test` on a fresh DB creates them):

     npx wrangler dev --var AI_USER_PER_MINUTE_LIMIT:100 --var AI_USER_DAILY_LIMIT:200 --var AI_CLOCK_WINDOW_DAYS:3650
     TOKEN=<session token> npm run test:edit-accuracy */
const base = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
const token = process.env.TOKEN;
if (!token) { console.error('Set TOKEN to a signed-in session token.'); process.exit(1); }

const { players } = await (await fetch(`${base}/api/state`)).json();
const id = name => (players.find(p => p.name === name) || {}).id;
const event = {
  name: 'Tuesday Night', date: '2026-09-29', startTime: '18:00', durationMin: 180, courts: 3, gameLenMin: 15,
  segments: [{ start: '18:00', end: '21:00', modes: {} }], memberIds: [id('Ava M'), id('Ben')],
};
const modes = segs => segs.map(s => `${s.start}-${s.end}:${Object.values(s.modes)[0] || 'open'}`);
const others = players.filter(p => !event.memberIds.includes(p.id)).map(p => p.id).sort();

// expect: exactly the changes the message should make. segments are
// compared as start-end:mode; addIds/removeIds as sorted sets.
const SAMPLES = [
  ['move it to 7pm', { startTime: '19:00' }],
  ['push it back an hour', { startTime: '19:00' }],
  ['start half an hour earlier', { startTime: '17:30' }],
  ['end at 10', { durationMin: 240 }],
  ['make it 4 hours long', { durationMin: 240 }],
  ['add a court', { courts: 4 }],
  ['add 2 more courts', { courts: 5 }],
  ['we only have 2 courts now', { courts: 2 }],
  ['move it to Friday', { date: '2026-10-02' }],
  ['change it to Thursday 7 to 10pm', { date: '2026-10-01', startTime: '19:00' }],
  ['make the games 12 minutes', { gameLenMin: 12 }],
  ['mixed for the last hour', { segments: ['18:00-20:00:open', '20:00-21:00:mixed'] }],
  ["women's doubles for the first hour, then open play", { segments: ['18:00-19:00:women', '19:00-21:00:open'] }],
  ['take a 15 minute break at 7:30', { segments: ['18:00-19:30:open', '19:30-19:45:break', '19:45-21:00:open'] }],
  ['add Cleo and Dev', { addIds: [id('Cleo'), id('Dev')] }],
  ['remove Ben', { removeIds: [id('Ben')] }],
  ['add Fay and drop Ava', { addIds: [id('Fay')], removeIds: [id('Ava M')] }],
  ['rename it to Ladder Night', { name: 'Ladder Night' }],
  ['invite everyone', { addIds: others }],
  ['we have 16 players now', { courts: 4 }],
  // Not changes: should be refused (422).
  ['great game everyone!', { refused: true }],
  ['what time is it in London?', { refused: true }],
];

let right = 0, total = 0;
for (const [text, expect] of SAMPLES) {
  const res = await fetch(`${base}/api/ai/edit-event`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ text, event, now: '2026-09-26T17:00:00.000Z', tzOffsetMin: -420 }),
  });
  const body = await res.json().catch(() => ({}));
  const misses = [];
  if (expect.refused) {
    if (res.status !== 422) misses.push(`expected refusal, got ${res.status} ${JSON.stringify(body.changes || body.error)}`);
  } else if (!res.ok) {
    misses.push(`HTTP ${res.status}: ${body.error}`);
  } else {
    const got = { ...body.changes };
    if (got.segments) got.segments = modes(got.segments);
    ['addIds', 'removeIds'].forEach(k => { if (got[k]) got[k] = [...got[k]].sort(); });
    const want = { ...expect };
    ['addIds', 'removeIds'].forEach(k => { if (want[k]) want[k] = [...want[k]].sort(); });
    for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) {
      if (JSON.stringify(got[k]) !== JSON.stringify(want[k])) misses.push(`${k}: expected ${JSON.stringify(want[k])}, got ${JSON.stringify(got[k])}`);
    }
    if (!body.aiUsed) misses.push('(model call failed — text only)');
  }
  total++; if (!misses.length) right++;
  console.log(`${misses.length ? 'MISS' : ' ok '}  ${text}${body.summary ? `  →  ${body.summary}` : ''}${misses.map(m => `\n        ${m}`).join('')}`);
}
console.log(`\n${right}/${total} edits exactly right (${Math.round((100 * right) / total)}%)`);
