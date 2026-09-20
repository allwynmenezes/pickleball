/* ===================== SMOKE TEST =====================
   Exercises the backend's actual job — persisting and faithfully returning
   a full app-state snapshot, including deletions — against a throwaway
   SQLite file, using data shaped like what a real event produces (players,
   RSVPs, a generated roster with scores, booking slots, chats, pairing
   history). Run with: npm test (from backend/). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TEST_DB = path.join(__dirname, 'smoke.sqlite');
fs.rmSync(TEST_DB, { force: true });
process.env.PICKLE_DB_PATH = TEST_DB;

const { app } = require('../server');

function buildSamplePlayers() {
  return [
    { id: 'p1', name: 'Ava', gender: 'F' },
    { id: 'p2', name: 'Ben', gender: 'M' },
    { id: 'p3', name: 'Cleo', gender: 'F' },
    { id: 'p4', name: 'Dev', gender: 'M' },
    { id: 'p5', name: 'Eli', gender: 'O' },
    { id: 'p6', name: 'Fay', gender: 'F' },
    { id: 'p7', name: 'Gus', gender: 'M' },
    { id: 'p8', name: 'Hana', gender: 'F' },
  ];
}

function buildSampleEvent(players) {
  const ids = players.map(p => p.id);
  const rsvps = {};
  ids.forEach((id, i) => { rsvps[id] = { status: 'in', start: 0, end: 240, ts: 1700000000000 + i }; });
  return {
    id: 'ev1',
    name: 'Tuesday Night',
    date: '2026-09-22',
    startTime: '18:00',
    durationMin: 240,
    courts: 2,
    segments: [{ start: '18:00', end: '22:00', modes: {} }],
    rsvps,
    bookingSlots: [{ id: 'slot1', court: 1, start: 0, end: 120, status: 'confirmed', claimedBy: 'p1' }],
    roster: [{
      offset: 0,
      played: true,
      sitOut: [],
      courts: [
        { court: 1, mode: 'open', flagged: false, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], scoreA: 11, scoreB: 7 },
        { court: 2, mode: 'open', flagged: false, teamA: ['p5', 'p6'], teamB: ['p7', 'p8'], scoreA: 9, scoreB: 11 },
      ],
    }],
    noShows: [],
    currentRoundIndex: 0,
    published: true,
    memberIds: ids,
  };
}

function buildSampleChats() {
  return [{
    id: 'c1', type: 'dm', name: '', participantIds: ['p1', 'p2'],
    messages: [{ id: 'm1', senderId: 'p1', text: 'See you at 6!', ts: 1700000001000 }],
  }];
}

function buildSampleHistory() {
  return { 'p1|p2': { partner: 1, opponent: 0 }, 'p3|p4': { partner: 0, opponent: 1 } };
}

async function main() {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://localhost:${server.address().port}`;
  let failures = 0;
  const check = (name, fn) => {
    try { fn(); console.log(`  ok  - ${name}`); }
    catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message}`); }
  };

  // 1. Fresh state is empty.
  let res = await fetch(`${base}/api/state`);
  let body = await res.json();
  check('fresh GET /api/state returns default shape', () => {
    assert.equal(res.status, 200);
    assert.deepEqual(body, { players: [], events: [], chats: [], history: {}, flagThreshold: 3, currentEventId: null });
  });

  // 2. Reject malformed writes.
  res = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ players: 'nope', events: [] }) });
  check('PUT rejects non-array players with 400', () => { assert.equal(res.status, 400); });

  // 3. Round-trip a realistic snapshot.
  const players = buildSamplePlayers();
  const event = buildSampleEvent(players);
  const chats = buildSampleChats();
  const history = buildSampleHistory();
  const sample = { players, events: [event], chats, history, flagThreshold: 4, currentEventId: 'ev1' };

  res = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample) });
  const putBody = await res.json();
  check('PUT accepts a realistic snapshot (players, RSVPs, roster+scores, booking, chats, history)', () => {
    assert.equal(res.status, 200);
    assert.deepEqual(putBody, sample);
  });

  res = await fetch(`${base}/api/state`);
  body = await res.json();
  check('GET after PUT returns exactly what was written', () => {
    assert.deepEqual(body, sample);
  });

  // 4. Deletion diffing: drop a player and the event, keep the chat.
  const trimmed = { players: players.filter(p => p.id !== 'p8'), events: [], chats, history, flagThreshold: 4, currentEventId: null };
  res = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trimmed) });
  body = await res.json();
  check('PUT with fewer entities deletes what dropped out, keeps the rest', () => {
    assert.equal(res.status, 200);
    assert.equal(body.players.length, 7);
    assert.ok(!body.players.some(p => p.id === 'p8'));
    assert.deepEqual(body.events, []);
    assert.deepEqual(body.chats, chats);
  });

  // 5. Reset clears everything.
  res = await fetch(`${base}/api/reset`, { method: 'POST' });
  body = await res.json();
  res = await fetch(`${base}/api/state`);
  const afterReset = await res.json();
  check('POST /api/reset clears all tables', () => {
    assert.deepEqual(afterReset, { players: [], events: [], currentEventId: null, history: {}, flagThreshold: 3, chats: [] });
  });

  server.close();
  fs.rmSync(TEST_DB, { force: true });

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed.');
}

main().catch(e => { console.error(e); process.exit(1); });
