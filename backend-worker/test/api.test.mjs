/* End-to-end API test for the Worker, mirroring backend/test/smoke.test.js.
   Runs against a local `npm run dev` (which reads .dev.vars; EXPOSE_DEV_OTP=1
   there makes code-sending endpoints return the code as `devOtp`, since no
   email is sent locally). It needs an EMPTY database and refuses to run
   otherwise — there's deliberately no API to wipe data, so start fresh:

     npm run db:fresh:local   (wipe + recreate the local D1)
     npm run dev              (in one terminal)
     npm test                 (in another)

   Never point it at the live Worker: it writes test players and events. */
import assert from 'node:assert/strict';

const base = (process.env.BASE_URL || 'http://127.0.0.1:8787').replace(/\/+$/, '');
let failures = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok  - ${name}`); } catch (e) { failures++; console.error(`FAIL  - ${name}\n        ${e.message}`); }
};
const post = (url, data, headers = {}) => fetch(`${base}${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data || {}),
});
const put = (url, data) => fetch(`${base}${url}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

const players = [['p1', 'Ava', 'F'], ['p2', 'Ben', 'M'], ['p3', 'Cleo', 'F'], ['p4', 'Dev', 'M'], ['p5', 'Eli', 'O'], ['p6', 'Fay', 'F'], ['p7', 'Gus', 'M'], ['p8', 'Hana', 'F']]
  .map(([id, name, gender]) => ({ id, name, gender }));
const event = {
  id: 'ev1', name: 'Tuesday Night', date: '2026-09-22', startTime: '18:00', durationMin: 240, courts: 2,
  segments: [{ start: '18:00', end: '22:00', modes: {} }],
  rsvps: Object.fromEntries(players.map((p, i) => [p.id, { status: 'in', start: 0, end: 240, ts: 1700000000000 + i }])),
  bookingSlots: [{ id: 'slot1', court: 1, start: 0, end: 120, status: 'confirmed', claimedBy: 'p1' }],
  roster: [{ offset: 0, played: true, sitOut: [], courts: [{ court: 1, mode: 'open', flagged: false, teamA: ['p1', 'p2'], teamB: ['p3', 'p4'], scoreA: 11, scoreB: 7 }] }],
  noShows: [], currentRoundIndex: 0, published: true, memberIds: players.map(p => p.id),
};
const chats = [{ id: 'c1', type: 'dm', name: '', participantIds: ['p1', 'p2'], messages: [{ id: 'm1', senderId: 'p1', text: 'See you at 6!', ts: 1700000001000 }] }];
const history = { 'p1|p2': { partner: 1, opponent: 0 } };
const withClaimed = ps => ps.map(p => ({ ...p, claimed: false }));

let res = await fetch(`${base}/api/state`);
let body = await res.json();
if (body.players && (body.players.length || body.events.length)) {
  console.error('Refusing to run: this database already has data. Use a fresh local database (npm run db:fresh:local).');
  process.exit(1);
}
check('fresh state has the default shape', () => {
  assert.deepEqual(body, { players: [], events: [], chats: [], history: {}, flagThreshold: 3, currentEventId: null });
});

res = await put('/api/state', { players: 'nope', events: [] });
check('PUT rejects malformed state', () => assert.equal(res.status, 400));

const sample = { players, events: [event], chats, history, flagThreshold: 4, currentEventId: 'ev1' };
res = await put('/api/state', sample);
body = await res.json();
check('PUT round-trips a realistic snapshot', () => {
  assert.equal(res.status, 200);
  assert.deepEqual(body, { ...sample, players: withClaimed(players) });
});

res = await post('/api/players/p1/claim-link');
const claimLink = await res.json();
check('claim-link returns a tappable http(s) invite URL', () => {
  assert.equal(res.status, 200);
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
body = await res.json();
check('claim info prefills name and category', () => assert.deepEqual(body, { playerId: 'p1', name: 'Ava', gender: 'F' }));

res = await post('/api/auth/signup/otp', { name: 'Ava', gender: 'F', email: 'ava@example.com', password: 'short', claimToken: claimLink.token });
check('short password rejected', () => assert.equal(res.status, 400));

const first = await (await post('/api/auth/signup/otp', { name: 'Ava M', gender: 'F', email: 'ava@example.com', password: 'correct horse', claimToken: claimLink.token })).json();
const second = await (await post('/api/auth/signup/otp', { name: 'Ava M', gender: 'F', email: 'ava@example.com', password: 'correct horse', claimToken: claimLink.token })).json();
check('sign-up sends codes (twice)', () => { assert.ok(first.devOtp); assert.ok(second.devOtp); });

const wrong = ['000000', '111111', '222222'].find(c => c !== first.devOtp && c !== second.devOtp);
res = await post('/api/auth/signup/verify', { email: 'ava@example.com', otp: wrong });
body = await res.json();
check('wrong code rejected', () => { assert.equal(res.status, 400); assert.equal(body.error, 'Incorrect code.'); });

res = await post('/api/auth/signup/verify', { email: 'ava@example.com', otp: first.devOtp });
const claimed = await res.json();
check('the FIRST code still verifies and claims the invited player', () => {
  assert.equal(res.status, 200);
  assert.ok(claimed.token);
  assert.deepEqual(claimed.player, { id: 'p1', name: 'Ava M', gender: 'F', email: 'ava@example.com' });
});

res = await fetch(`${base}/api/claim/${claimLink.token}`);
check('a claimed invite can\'t be reused', () => assert.equal(res.status, 410));

res = await post('/api/auth/login', { email: 'ava@example.com', password: 'wrong password' });
check('wrong password rejected', () => assert.equal(res.status, 401));
res = await post('/api/auth/login', { email: 'AVA@example.com', password: 'correct horse' });
const loggedIn = await res.json();
check('login with email + password works', () => { assert.equal(res.status, 200); assert.equal(loggedIn.player.id, 'p1'); });

res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${claimed.token}` } });
check('both devices stay signed in', () => assert.equal(res.status, 200));
await post('/api/auth/logout', {}, { Authorization: `Bearer ${claimed.token}` });
res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${claimed.token}` } });
check('logout ends that session', () => assert.equal(res.status, 401));
res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${loggedIn.token}` } });
check('the other device is still signed in', () => assert.equal(res.status, 200));

const forgot = await (await post('/api/auth/password/forgot', { email: 'ava@example.com' })).json();
check('forgot password sends a code', () => assert.ok(forgot.devOtp));
res = await post('/api/auth/password/reset', { email: 'ava@example.com', otp: forgot.devOtp, password: 'brand new pass' });
check('reset sets the new password', () => assert.equal(res.status, 200));
res = await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${loggedIn.token}` } });
check('reset signs out other devices', () => assert.equal(res.status, 401));
res = await post('/api/auth/login', { email: 'ava@example.com', password: 'brand new pass' });
check('the new password works', () => assert.equal(res.status, 200));

res = await put('/api/state', { ...sample, players: players.filter(p => p.id !== 'p1' && p.id !== 'p8') });
body = await res.json();
check('sync deletes dropped players but never an account holder', () => {
  assert.ok(body.players.some(p => p.id === 'p1' && p.claimed));
  assert.ok(!body.players.some(p => p.id === 'p8'));
});
check('state never exposes email/password columns', () => {
  const p1 = body.players.find(p => p.id === 'p1');
  assert.equal('email' in p1, false);
  assert.equal('passwordHash' in p1, false);
});

// ---- Only an event's host can change its setup or delete it ----
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

current = body;
const tampered = current.events.map(e => (e.id === 'ev-host'
  ? { ...e, name: 'Hijacked', courts: 9, createdBy: 'p3', rsvps: { p2: { status: 'in', start: 0, end: 120, ts: 1 } } }
  : e));
body = await (await putAs(null, { ...current, events: tampered })).json();
let hostedNow = body.events.find(e => e.id === 'ev-host');
check("a non-host can't change the event's setup (or its host)", () => {
  assert.equal(hostedNow.name, 'Ava Night');
  assert.equal(hostedNow.courts, 1);
  assert.equal(hostedNow.createdBy, 'p1');
});
check('…but can still RSVP', () => assert.equal(hostedNow.rsvps.p2.status, 'in'));

body = await (await putAs(null, { ...body, events: body.events.filter(e => e.id !== 'ev-host') })).json();
check("a non-host can't delete the event", () => assert.ok(body.events.some(e => e.id === 'ev-host')));

body = await (await putAs(ava.token, { ...body, events: body.events.map(e => (e.id === 'ev-host' ? { ...e, name: 'Ava Night II' } : e)) })).json();
check('the host can edit the setup', () => assert.equal(body.events.find(e => e.id === 'ev-host').name, 'Ava Night II'));
body = await (await putAs(ava.token, { ...body, events: body.events.filter(e => e.id !== 'ev-host') })).json();
check('the host can delete the event', () => assert.ok(!body.events.some(e => e.id === 'ev-host')));

const zed = await (await post('/api/auth/signup/otp', { name: 'Zed', gender: 'M', email: 'zed@example.com', password: 'zed password' })).json();
res = await post('/api/auth/signup/verify', { email: 'zed@example.com', otp: zed.devOtp });
body = await res.json();
check('plain sign-up creates a new account', () => { assert.equal(res.status, 200); assert.equal(body.player.name, 'Zed'); });

res = await post('/api/admin/import', {}, { 'X-Migration-Token': 'anything' });
check('import endpoint is hidden without MIGRATION_TOKEN', () => assert.equal(res.status, 404));

res = await post('/api/reset');
check('there is no reset endpoint', () => assert.equal(res.status, 404));

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll Worker API checks passed.');
