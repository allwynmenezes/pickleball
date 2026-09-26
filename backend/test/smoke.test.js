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
const { db } = require('../db');

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

/* PUT only ever sends {id, name, gender} — `claimed` is server-derived (see
   state.js) from the auth-only `email` column, so it only ever appears on
   what comes back out of GET/PUT, never in what a client pushes in. */
function withClaimed(players) {
  return players.map(p => ({ ...p, claimed: false }));
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
    assert.deepEqual(putBody, { ...sample, players: withClaimed(players) });
  });

  res = await fetch(`${base}/api/state`);
  body = await res.json();
  check('GET after PUT returns exactly what was written', () => {
    assert.deepEqual(body, { ...sample, players: withClaimed(players) });
  });

  // 3b. Auth. No APPS_SCRIPT_URL is set in this test env (and .env is never
  // loaded by tests), so email.js logs each code instead of sending it.
  // captureOtp runs fn (expected to trigger one code email) and returns
  // { result, otp } — "otp" is the 6-digit code pulled out of that log.
  async function captureOtp(fn) {
    const original = console.log;
    let otp = null;
    console.log = (...args) => {
      const m = args.join(' ').match(/OTP for [^:]+: (\d{6})/);
      if (m) otp = m[1];
      original(...args);
    };
    let result;
    try { result = await fn(); } finally { console.log = original; }
    return { result, otp };
  }
  const post = (url, data, headers = {}) => fetch(`${base}${url}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data || {}),
  });

  res = await post('/api/players/p1/claim-link');
  const claimLink = await res.json();
  check('claim-link mints a token and a tappable http(s) invite URL', () => {
    assert.equal(res.status, 200);
    assert.equal(claimLink.name, 'Ava');
    assert.ok(claimLink.token);
    assert.match(claimLink.url, new RegExp(`^https?://[^/]+/claim/${claimLink.token}$`));
  });

  res = await fetch(`${base}/claim/${claimLink.token}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' } });
  const html = await res.text();
  check('the invite page names the player and hands off to the app', () => {
    assert.equal(res.status, 200);
    assert.match(html, /Ava/);
    assert.match(html, /intent:\/\/claim\//);
  });

  res = await fetch(`${base}/api/claim/${claimLink.token}`);
  const claimInfo = await res.json();
  check('GET api/claim/:token returns the name/category to prefill sign-up', () => {
    assert.equal(res.status, 200);
    assert.deepEqual(claimInfo, { playerId: 'p1', name: 'Ava', gender: 'F' });
  });

  res = await post('/api/auth/signup/otp', { name: 'Ava', gender: 'F', email: 'ava@example.com', password: 'short', claimToken: claimLink.token });
  check('sign-up rejects a password under 8 characters', () => { assert.equal(res.status, 400); });

  const { result: otpRes, otp } = await captureOtp(() => post('/api/auth/signup/otp', {
    name: 'Ava M', gender: 'F', email: 'ava@example.com', password: 'correct horse', claimToken: claimLink.token,
  }));
  check('claim sign-up sends a code', () => { assert.equal(otpRes.status, 200); assert.ok(otp); });

  // Asking again (e.g. the first request timed out on the phone while the
  // email was still sent) issues a second code — and the first stays valid.
  const { otp: secondOtp } = await captureOtp(() => post('/api/auth/signup/otp', {
    name: 'Ava M', gender: 'F', email: 'ava@example.com', password: 'correct horse', claimToken: claimLink.token,
  }));
  check('asking for a code again sends a fresh one', () => { assert.ok(secondOtp); });

  const wrongOtp = ['000000', '111111', '222222'].find(c => c !== otp && c !== secondOtp);
  res = await post('/api/auth/signup/verify', { email: 'ava@example.com', otp: wrongOtp });
  body = await res.json();
  check('sign-up verify rejects a wrong code', () => { assert.equal(res.status, 400); assert.equal(body.error, 'Incorrect code.'); });

  res = await post('/api/auth/signup/verify', { email: 'ava@example.com', otp });
  const claimed = await res.json();
  check('the FIRST code still verifies, turning the invited player into the account', () => {
    assert.equal(res.status, 200);
    assert.ok(claimed.token);
    assert.deepEqual(claimed.player, { id: 'p1', name: 'Ava M', gender: 'F', email: 'ava@example.com' });
  });

  res = await fetch(`${base}/api/claim/${claimLink.token}`);
  check("a claimed invite link can't be reused", () => { assert.equal(res.status, 410); });

  res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${claimed.token}` } });
  body = await res.json();
  check('auth/me resolves the session from the claim', () => { assert.equal(res.status, 200); assert.equal(body.player.id, 'p1'); });

  res = await post('/api/players/p2/claim-link');
  const p2Link = await res.json();
  res = await post('/api/auth/signup/otp', { name: 'Ben', gender: 'M', email: 'ava@example.com', password: 'another one', claimToken: p2Link.token });
  check("a second player can't claim with an email already in use", () => { assert.equal(res.status, 409); });

  res = await post('/api/auth/login', { email: 'ava@example.com', password: 'wrong password' });
  check('login rejects a wrong password', () => { assert.equal(res.status, 401); });
  res = await post('/api/auth/login', { email: 'AVA@example.com', password: 'correct horse' });
  const loggedIn = await res.json();
  check('login with email + password issues a session', () => { assert.equal(res.status, 200); assert.equal(loggedIn.player.id, 'p1'); });

  res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${claimed.token}` } });
  check('logging in on another device keeps the first session valid', () => { assert.equal(res.status, 200); });

  res = await post('/api/auth/logout', {}, { Authorization: `Bearer ${claimed.token}` });
  check('logout succeeds', () => { assert.equal(res.status, 200); });
  res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${claimed.token}` } });
  check('the logged-out session is no longer valid', () => { assert.equal(res.status, 401); });
  res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${loggedIn.token}` } });
  check('logging out one device leaves the other signed in', () => { assert.equal(res.status, 200); });

  const { result: forgotRes, otp: resetOtp } = await captureOtp(() => post('/api/auth/password/forgot', { email: 'ava@example.com' }));
  check('forgot password emails a code', () => { assert.equal(forgotRes.status, 200); assert.ok(resetOtp); });
  res = await post('/api/auth/password/reset', { email: 'ava@example.com', otp: resetOtp, password: 'brand new pass' });
  const reset = await res.json();
  check('reset sets the new password and signs in', () => { assert.equal(res.status, 200); assert.ok(reset.token); });
  res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${loggedIn.token}` } });
  check('a password reset signs out other devices', () => { assert.equal(res.status, 401); });
  res = await post('/api/auth/login', { email: 'ava@example.com', password: 'correct horse' });
  check('the old password no longer works', () => { assert.equal(res.status, 401); });
  res = await post('/api/auth/login', { email: 'ava@example.com', password: 'brand new pass' });
  check('the new password works', () => { assert.equal(res.status, 200); });

  res = await fetch(`${base}/api/state`);
  body = await res.json();
  check('the shared state sync exposes "claimed" but never email/password/OTP columns', () => {
    const p1 = body.players.find(p => p.id === 'p1');
    assert.equal(p1.claimed, true);
    assert.equal('email' in p1, false);
    assert.equal('passwordHash' in p1, false);
    assert.equal('otpHash' in p1, false);
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

  // 4b. Account holders (claimed players — p1 was claimed above) are never
  // deleted by the sync, even when a client's state leaves them out.
  const withoutAva = { ...trimmed, players: trimmed.players.filter(p => p.id !== 'p1') };
  res = await fetch(`${base}/api/state`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withoutAva) });
  body = await res.json();
  check('PUT never deletes a claimed (account) player', () => {
    assert.equal(res.status, 200);
    assert.ok(body.players.some(p => p.id === 'p1' && p.claimed));
    assert.equal(body.players.length, 7);
  });

  // 4b2. Only an event's host can change its setup or delete it.
  const ava = await (await post('/api/auth/login', { email: 'ava@example.com', password: 'brand new pass' })).json();
  const putAs = (token, data) => fetch(`${base}/api/state`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data),
  });
  const hosted = {
    id: 'ev-host', name: 'Ava Night', date: '2026-10-01', startTime: '18:00', durationMin: 120, courts: 1,
    segments: [{ start: '18:00', end: '20:00', modes: {} }], rsvps: {}, memberIds: ['p1', 'p2'], createdBy: 'p2',
  };
  let current = await (await fetch(`${base}/api/state`)).json();
  body = await (await putAs(ava.token, { ...current, events: [...current.events, hosted] })).json();
  check("a new event's host is whoever saves it, not whoever it names", () => {
    assert.equal(body.events.find(e => e.id === 'ev-host').createdBy, 'p1');
  });
  const tampered = body.events.map(e => (e.id === 'ev-host'
    ? { ...e, name: 'Hijacked', courts: 9, createdBy: 'p3', rsvps: { p2: { status: 'in', start: 0, end: 120, ts: 1 } } }
    : e));
  body = await (await putAs(null, { ...body, events: tampered })).json();
  const hostedNow = body.events.find(e => e.id === 'ev-host');
  check("a non-host can't change the event's setup (or its host), but can RSVP", () => {
    assert.equal(hostedNow.name, 'Ava Night');
    assert.equal(hostedNow.courts, 1);
    assert.equal(hostedNow.createdBy, 'p1');
    assert.equal(hostedNow.rsvps.p2.status, 'in');
  });
  body = await (await putAs(null, { ...body, events: body.events.filter(e => e.id !== 'ev-host') })).json();
  check("a non-host can't delete the event", () => assert.ok(body.events.some(e => e.id === 'ev-host')));
  body = await (await putAs(ava.token, { ...body, events: body.events.filter(e => e.id !== 'ev-host') })).json();
  check('the host can delete the event', () => assert.ok(!body.events.some(e => e.id === 'ev-host')));

  // 4c. Sign-up without an invite: a brand-new account, created only once
  // the code verifies.
  res = await post('/api/auth/signup/otp', { name: 'Zed', gender: 'M', email: 'ava@example.com', password: 'zed password' });
  check('sign-up refuses an email that already has an account', () => { assert.equal(res.status, 409); });

  const { result: signupOtpRes, otp: signupOtp } = await captureOtp(() => post('/api/auth/signup/otp', {
    name: 'Zed', gender: 'M', email: 'Zed@Example.com', password: 'zed password',
  }));
  check('sign-up sends a code without creating a player yet', () => {
    assert.equal(signupOtpRes.status, 200);
    assert.ok(signupOtp);
  });
  res = await fetch(`${base}/api/state`);
  body = await res.json();
  check('a pending sign-up is not a player', () => { assert.ok(!body.players.some(p => p.name === 'Zed')); });

  res = await post('/api/auth/signup/verify', { email: 'zed@example.com', otp: signupOtp });
  const signedUp = await res.json();
  check('sign-up verify creates a claimed player and a session', () => {
    assert.equal(res.status, 200);
    assert.ok(signedUp.token);
    assert.equal(signedUp.player.name, 'Zed');
    assert.equal(signedUp.player.email, 'zed@example.com');
  });
  res = await post('/api/auth/login', { email: 'zed@example.com', password: 'zed password' });
  check('the new account can log in with its password', () => { assert.equal(res.status, 200); });
  res = await fetch(`${base}/api/state`);
  body = await res.json();
  check('the new account shows up in the shared state as claimed', () => {
    assert.ok(body.players.some(p => p.id === signedUp.player.id && p.claimed));
  });

  // 5. There's no endpoint that wipes the group's data.
  res = await fetch(`${base}/api/reset`, { method: 'POST' });
  check('there is no reset endpoint', () => { assert.equal(res.status, 404); });

  // 6. "Describe your event" is Worker-only; this backend says so clearly.
  res = await fetch(`${base}/api/ai/parse-event`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":"Tuesday 6pm"}' });
  body = await res.json();
  check('describe-your-event explains it needs the Cloudflare backend', () => { assert.equal(res.status, 501); assert.match(body.error, /Cloudflare/); });

  server.close();
  db.close();
  fs.rmSync(TEST_DB, { force: true });

  if (failures) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll smoke checks passed.');
}

main().catch(e => { console.error(e); process.exit(1); });
