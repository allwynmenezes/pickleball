/* Tests for POST /api/ai/parse-event (src/ai.js) with a fake database and
   a fake model — checks the guard rails (sign-in, input checks, limits,
   off switch) and the fallback when the model fails. No server and no real
   AI calls: run with `npm run test:parse`. */
import assert from 'node:assert/strict';
import { parseEvent, transcribe } from '../src/ai.js';
import { editEvent } from '../src/aiEdit.js';
import { sha256 } from '../src/util.js';

let failures = 0;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message}`); }
};

const TOKEN = 'good-token';
const TOKEN2 = 'other-token';
const sessions = { [await sha256(TOKEN)]: 'p1', [await sha256(TOKEN2)]: 'p2' };

// Just enough of D1 for the statements ai.js and requesterId() run.
function fakeDb() {
  const calls = [];
  const players = [{ id: 'p1', name: 'Priya Shah' }, { id: 'p2', name: 'Ben Ortiz' }];
  const run = (sql, args) => {
    if (sql.includes('FROM sessions')) {
      const id = sessions[args[0]];
      return id ? [{ playerId: id, expiresAt: Date.now() + 60000 }] : [];
    }
    if (sql.startsWith('SELECT COUNT(*) AS n FROM ai_calls WHERE playerId = ? AND ts > ?')) return [{ n: calls.filter(c => c.playerId === args[0] && c.ts > args[1]).length }];
    if (sql.startsWith('SELECT COUNT(*) AS n FROM ai_calls WHERE playerId = ? AND ts >= ?')) return [{ n: calls.filter(c => c.playerId === args[0] && c.ts >= args[1]).length }];
    if (sql.startsWith('SELECT COUNT(*) AS n FROM ai_calls WHERE ts >= ?')) return [{ n: calls.filter(c => c.ts >= args[0]).length }];
    if (sql.startsWith('INSERT INTO ai_calls')) { calls.push({ playerId: args[0], ts: args[1] }); return []; }
    if (sql.startsWith('DELETE FROM ai_calls')) return [];
    if (sql.startsWith('SELECT id, name FROM players')) return players;
    throw new Error(`fake D1 doesn't know: ${sql}`);
  };
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => run(sql, args)[0] || null,
    all: async () => ({ results: run(sql, args) }),
    run: async () => ({ results: run(sql, args) }),
  });
  return { calls, prepare: sql => stmt(sql), batch: async stmts => Promise.all(stmts.map(s => s.all())) };
}

const modelReply = { isEvent: true, name: '', date: '', startTime: '', endTime: '', durationMin: 0, courts: 0, gameLenMin: 0, segments: [{ mode: 'mixed', minutes: 60 }], playerNames: ['Priya'], inviteEveryone: false };
const env = (over = {}) => ({ DB: fakeDb(), AI: { run: async () => ({ response: modelReply }) }, ...over });
const req = (body, token = TOKEN) => new Request('https://x/api/ai/parse-event', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const now = new Date().toISOString();
const ok = { text: 'Tuesday 6 to 9pm, 3 courts, mixed first hour, Priya coming', now, tzOffsetMin: 0 };

await check('signed-out request is refused before any AI call', async () => {
  let called = false;
  const res = await parseEvent(req(ok, null), env({ AI: { run: async () => { called = true; } } }));
  assert.equal(res.status, 401);
  assert.equal(called, false);
});
await check('bad token is refused', async () => assert.equal((await parseEvent(req(ok, 'nope'), env())).status, 401));
await check('empty and overlong text are refused', async () => {
  assert.equal((await parseEvent(req({ ...ok, text: ' ' }), env())).status, 400);
  assert.equal((await parseEvent(req({ ...ok, text: 'x'.repeat(501) }), env())).status, 400);
});
await check('AI_DISABLED switches it off', async () => assert.equal((await parseEvent(req(ok), env({ AI_DISABLED: '1' }))).status, 503));
await check('returns a draft with text and model fields merged', async () => {
  const res = await parseEvent(req(ok), env());
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.aiUsed, true);
  assert.equal(body.draft.startTime, '18:00');
  assert.equal(body.draft.courts, 3);
  assert.deepEqual(body.draft.memberIds, ['p1']);
  assert.deepEqual(body.draft.segments[0].modes, { 1: 'mixed', 2: 'mixed', 3: 'mixed' });
  assert.equal(JSON.stringify(body).includes('"response"'), false, 'raw model output must not be returned');
});
await check('model failure still returns what the text gave', async () => {
  const res = await parseEvent(req(ok), env({ AI: { run: async () => { throw new Error('down'); } } }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.aiUsed, false);
  assert.equal(body.draft.courts, 3);
});
await check('off-topic text gets a 422', async () => {
  const res = await parseEvent(req({ ...ok, text: 'write me a poem about cats' }), env({ AI: { run: async () => ({ response: { ...modelReply, isEvent: false } }) } }));
  assert.equal(res.status, 422);
});
await check('burst limit: 6th request in a minute is refused', async () => {
  const e = env();
  for (let i = 0; i < 5; i++) assert.equal((await parseEvent(req(ok), e)).status, 200);
  assert.equal((await parseEvent(req(ok), e)).status, 429);
});
await check('daily limit per player, and other players unaffected', async () => {
  const e = env({ AI_USER_DAILY_LIMIT: '2' });
  e.DB.calls.push({ playerId: 'p1', ts: Date.now() - 120000 }, { playerId: 'p1', ts: Date.now() - 120000 });
  assert.equal((await parseEvent(req(ok), e)).status, 429);
  assert.equal((await parseEvent(req(ok, TOKEN2), e)).status, 200);
});
await check('daily limit for the whole app', async () => {
  const e = env({ AI_TOTAL_DAILY_LIMIT: '1' });
  e.DB.calls.push({ playerId: 'p2', ts: Date.now() - 120000 });
  assert.equal((await parseEvent(req(ok), e)).status, 429);
});

// ---- Voice: POST /api/ai/transcribe ----
const voiceReq = (bytes, token = TOKEN) => {
  const form = new FormData();
  if (bytes) form.append('audio', new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' }), 'note.m4a');
  return new Request('https://x/api/ai/transcribe', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
};
const whisper = (reply) => ({ run: async (model, input) => { whisper.last = { model, input }; if (reply instanceof Error) throw reply; return reply; } });
await check('voice: signed-out request is refused', async () => assert.equal((await transcribe(voiceReq(5000, null), env({ AI: whisper({ text: 'x' }) }))).status, 401));
await check('voice: missing or empty recording is refused', async () => {
  assert.equal((await transcribe(voiceReq(null), env({ AI: whisper({ text: 'x' }) }))).status, 400);
  assert.equal((await transcribe(voiceReq(10), env({ AI: whisper({ text: 'x' }) }))).status, 400);
});
await check('voice: an over-long recording is refused before any AI call', async () => {
  const ai = whisper({ text: 'x' }); whisper.last = null;
  assert.equal((await transcribe(voiceReq(3 * 1024 * 1024), env({ AI: ai }))).status, 413);
  assert.equal(whisper.last, null);
});
await check('voice: returns the transcript, sending the audio as base64 to Whisper', async () => {
  const res = await transcribe(voiceReq(5000), env({ AI: whisper({ text: '  Tuesday 6 to 9pm,\n 3 courts ' }) }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { text: 'Tuesday 6 to 9pm, 3 courts' });
  assert.match(whisper.last.model, /whisper/);
  assert.equal(typeof whisper.last.input.audio, 'string');
  assert.equal(Buffer.from(whisper.last.input.audio, 'base64').length, 5000);
});
await check('voice: silence gets a helpful 422', async () => assert.equal((await transcribe(voiceReq(5000), env({ AI: whisper({ text: '' }) }))).status, 422));
await check('voice: a Whisper failure gets a 502, not a crash', async () => assert.equal((await transcribe(voiceReq(5000), env({ AI: whisper(new Error('down')) }))).status, 502));
await check('voice: counts toward the same limits', async () => {
  const e = env({ AI: whisper({ text: 'x' }), AI_USER_DAILY_LIMIT: '1' });
  assert.equal((await transcribe(voiceReq(5000), e)).status, 200);
  assert.equal((await transcribe(voiceReq(5000), e)).status, 429);
});

// ---- Editing: POST /api/ai/edit-event ----
const curEvent = { name: 'Tuesday Night', date: '2026-09-29', startTime: '18:00', durationMin: 180, courts: 3, gameLenMin: 15, segments: [{ start: '18:00', end: '21:00', modes: {} }], memberIds: ['p1'] };
const blankEdit = { understood: true, name: '', date: '', startTime: '', endTime: '', durationMin: 0, courts: 0, playerCount: 0, gameLenMin: 0, segments: [], addPlayers: [], removePlayers: [], inviteEveryone: false };
const editAI = reply => ({ run: async (model, input) => { editAI.last = input; return { response: { ...blankEdit, ...reply } }; } });
const editReq = (body, token = TOKEN) => new Request('https://x/api/ai/edit-event', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ now: new Date().toISOString(), tzOffsetMin: 0, ...body }),
});
await check('edit: signed-out request is refused', async () => assert.equal((await editEvent(editReq({ text: 'add a court', event: curEvent }, null), env({ AI: editAI({}) }))).status, 401));
await check('edit: a malformed event is refused before any AI call', async () => {
  editAI.last = null;
  assert.equal((await editEvent(editReq({ text: 'add a court', event: { name: 'x' } }), env({ AI: editAI({}) }))).status, 400);
  assert.equal(editAI.last, null);
});
await check('edit: returns checked changes and a summary written by code', async () => {
  const res = await editEvent(editReq({ text: 'add a court and add Ben', event: curEvent }), env({ AI: editAI({ courts: 4, addPlayers: ['Ben'] }) }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.changes, { courts: 4, addIds: ['p2'] });
  assert.equal(body.summary, 'Courts 3 → 4 · Added Ben Ortiz');
  assert.match(editAI.last.messages[0].content, /courts: 3/);
  assert.match(editAI.last.messages[0].content, /players: Priya Shah/);
});
await check('edit: something that isn\'t a change gets a helpful 422', async () => {
  assert.equal((await editEvent(editReq({ text: 'what a game!', event: curEvent }), env({ AI: editAI({ understood: false }) }))).status, 422);
});
await check('edit: only unknown names → 422 naming them', async () => {
  const res = await editEvent(editReq({ text: 'add Zed', event: curEvent }), env({ AI: editAI({ addPlayers: ['Zed'] }) }));
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /Zed/);
});
await check('edit: counts toward the same limits', async () => {
  const e = env({ AI: editAI({ courts: 4 }), AI_USER_DAILY_LIMIT: '1' });
  assert.equal((await editEvent(editReq({ text: 'add a court', event: curEvent }), e)).status, 200);
  assert.equal((await editEvent(editReq({ text: 'add a court', event: curEvent }), e)).status, 429);
});

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log('\nall passed');
