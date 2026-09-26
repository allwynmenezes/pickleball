/* ===================== AUTH =====================
   Email + password accounts, layered onto the `players` table (see db.js).
     - Sign up: name, category, email and password. The email is verified
       with a one-time code before the account exists.
     - Claim: the same sign-up, started from an invite link a host shared
       for a player they already added. The name/category come prefilled,
       and verifying turns that existing player into the account.
     - Login: email + password.
     - Forgot password: a code emailed to the account, then a new password.
   Passwords are stored as salted scrypt hashes; codes and session tokens as
   SHA-256 hashes — never in the clear. Sessions live one row per device in
   `sessions`, and their expiry slides forward every time the app starts,
   so a regular user stays signed in. Email goes out through a Google Apps
   Script web app (see email.js). */
const crypto = require('node:crypto');
const os = require('node:os');
const express = require('express');
const { db } = require('./db');
const { sendOtpEmail } = require('./email');

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const CLAIM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function randomToken(bytes = 20) { return crypto.randomBytes(bytes).toString('base64url'); }
function generateOtp() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }
function normEmail(v) { return String(v || '').trim().toLowerCase(); }

function publicPlayer(p) { return { id: p.id, name: p.name, gender: p.gender, email: p.email || null }; }

function getPlayer(id) { return db.prepare('SELECT * FROM players WHERE id = ?').get(id); }
function getPlayerByEmail(email) { return db.prepare('SELECT * FROM players WHERE email = ?').get(email); }
function getPlayerByClaimToken(token) { return db.prepare('SELECT * FROM players WHERE claimToken = ?').get(token); }

/* ---- Passwords ---- */
function passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  return null;
}
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(String(pw || ''), Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

/* ---- Sessions (one per device, sliding expiry) ---- */
function issueSession(playerId) {
  const raw = randomToken();
  db.prepare('INSERT INTO sessions (tokenHash, playerId, expiresAt) VALUES (?, ?, ?)')
    .run(sha256(raw), playerId, Date.now() + SESSION_TTL_MS);
  return raw;
}
function playerForSession(raw) {
  const hash = sha256(raw);
  const row = db.prepare('SELECT * FROM sessions WHERE tokenHash = ?').get(hash);
  if (!row) return null;
  if (Date.now() > row.expiresAt) {
    db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(hash);
    return null;
  }
  db.prepare('UPDATE sessions SET expiresAt = ? WHERE tokenHash = ?').run(Date.now() + SESSION_TTL_MS, hash);
  return getPlayer(row.playerId) || null;
}

/* ---- One-time codes on an existing account (forgot password) ---- */
function startOtp(playerId) {
  const otp = generateOtp();
  db.prepare(`
    UPDATE players SET
      prevOtpHash = CASE WHEN otpExpiresAt > ? THEN otpHash END,
      prevOtpExpiresAt = CASE WHEN otpExpiresAt > ? THEN otpExpiresAt END,
      otpHash = ?, otpExpiresAt = ?, otpAttempts = 0
    WHERE id = ?
  `).run(Date.now(), Date.now(), sha256(otp), Date.now() + OTP_TTL_MS, playerId);
  return otp;
}
/* Returns an error string, or null when the code is right. Asking for a new
   code doesn't cancel the one before it: emails can arrive slowly or out of
   order, so whichever of the last two codes someone types (while it's
   still unexpired) works. A wrong guess only bumps the attempt count — it
   doesn't reset the expiry window. */
function checkOtp(row, otp, table, keyCol, keyVal) {
  if (!row.otpHash || !row.otpExpiresAt) return 'No code was requested — request a new one.';
  if (row.otpAttempts >= OTP_MAX_ATTEMPTS) return 'Too many incorrect attempts — request a new code.';
  const given = sha256(String(otp || ''));
  const now = Date.now();
  const currentOk = given === row.otpHash && now <= row.otpExpiresAt;
  const previousOk = row.prevOtpHash && given === row.prevOtpHash && now <= row.prevOtpExpiresAt;
  if (currentOk || previousOk) return null;
  if (given === row.otpHash || given === row.prevOtpHash) return 'That code expired — request a new one.';
  db.prepare(`UPDATE ${table} SET otpAttempts = otpAttempts + 1 WHERE ${keyCol} = ?`).run(keyVal);
  return 'Incorrect code.';
}

async function emailCode(res, email, otp) {
  try {
    await sendOtpEmail(email, otp);
    return true;
  } catch (e) {
    console.error('sendOtpEmail failed', e);
    res.status(502).json({ error: 'Could not send the verification email — try again shortly.' });
    return false;
  }
}

/* ---- Where shared invite links point ----
   PUBLIC_URL (e.g. an https tunnel or deployed address) when set; otherwise
   this machine's Wi-Fi/LAN address, which phones on the same network can
   reach. Wi-Fi adapters win, then other real network cards; virtual ones
   (VirtualBox's 192.168.56.x host-only net, Hyper-V/WSL vEthernet, VMware,
   VPNs) come last since other phones can't reach them. */
const VIRTUAL_ADAPTER = /virtualbox|vethernet|vmware|hyper-v|wsl|docker|vpn|tailscale|zerotier|loopback/i;
function adapterRank(name, ip) {
  if (/wi-?fi|wlan|wireless/i.test(name)) return 0;
  if (VIRTUAL_ADAPTER.test(name) || ip.startsWith('192.168.56.') || ip.startsWith('172.')) return 3;
  return ip.startsWith('192.168.') || ip.startsWith('10.') ? 1 : 2;
}
function publicBaseUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const port = process.env.PORT || 4000;
  const candidates = Object.entries(os.networkInterfaces())
    .flatMap(([name, addrs]) => (addrs || [])
      .filter(a => a.family === 'IPv4' && !a.internal)
      .map(a => ({ ip: a.address, rank: adapterRank(name, a.address) })));
  candidates.sort((a, b) => a.rank - b.rank);
  return `http://${candidates.length ? candidates[0].ip : 'localhost'}:${port}`;
}

function claimProblem(player) {
  if (!player) return { status: 404, error: 'This invite link is invalid.' };
  if (player.email) return { status: 410, error: 'This invite has already been claimed.' };
  if (Date.now() > player.claimTokenExpiresAt) return { status: 410, error: 'This invite link has expired — ask your host to send a new one.' };
  return null;
}

const router = express.Router();

/* ---- Host action: mint a shareable invite link for a player they added. ---- */
router.post('/players/:id/claim-link', (req, res) => {
  const player = getPlayer(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found.' });
  if (player.email) return res.status(400).json({ error: `${player.name} already has an account.` });
  const token = randomToken(16);
  const expiresAt = Date.now() + CLAIM_TOKEN_TTL_MS;
  db.prepare('UPDATE players SET claimToken = ?, claimTokenExpiresAt = ? WHERE id = ?').run(token, expiresAt, player.id);
  res.json({ token, name: player.name, expiresAt, url: `${publicBaseUrl()}/claim/${token}` });
});

/* ---- Invite details, for prefilling the sign-up form. ---- */
router.get('/claim/:token', (req, res) => {
  const player = getPlayerByClaimToken(req.params.token);
  const problem = claimProblem(player);
  if (problem) return res.status(problem.status).json({ error: problem.error });
  res.json({ playerId: player.id, name: player.name, gender: player.gender });
});

/* ---- Sign up (optionally from an invite): details now, account on verify. ---- */
router.post('/auth/signup/otp', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const gender = String(req.body.gender || '');
  const email = normEmail(req.body.email);
  const claimToken = req.body.claimToken ? String(req.body.claimToken) : null;
  if (!name || name.length > 60) return res.status(400).json({ error: 'Enter your name (up to 60 characters).' });
  if (!['M', 'F', 'O'].includes(gender)) return res.status(400).json({ error: 'Choose a category.' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const pwErr = passwordError(req.body.password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  let claimPlayerId = null;
  if (claimToken) {
    const player = getPlayerByClaimToken(claimToken);
    const problem = claimProblem(player);
    if (problem) return res.status(problem.status).json({ error: problem.error });
    claimPlayerId = player.id;
  }
  if (getPlayerByEmail(email)) return res.status(409).json({ error: 'An account already exists for that email — log in instead.' });

  const otp = generateOtp();
  db.prepare(`
    INSERT INTO signups (email, name, gender, otpHash, otpExpiresAt, otpAttempts, passwordHash, claimPlayerId)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, gender = excluded.gender,
      prevOtpHash = CASE WHEN signups.otpExpiresAt > ? THEN signups.otpHash END,
      prevOtpExpiresAt = CASE WHEN signups.otpExpiresAt > ? THEN signups.otpExpiresAt END,
      otpHash = excluded.otpHash, otpExpiresAt = excluded.otpExpiresAt, otpAttempts = 0,
      passwordHash = excluded.passwordHash, claimPlayerId = excluded.claimPlayerId
  `).run(email, name, gender, sha256(otp), Date.now() + OTP_TTL_MS, hashPassword(req.body.password), claimPlayerId, Date.now(), Date.now());
  if (!(await emailCode(res, email, otp))) return;
  res.json({ ok: true });
});

router.post('/auth/signup/verify', (req, res) => {
  const email = normEmail(req.body.email);
  const pending = db.prepare('SELECT * FROM signups WHERE email = ?').get(email);
  if (!pending) return res.status(404).json({ error: 'No sign-up in progress for that email — start again.' });
  const err = checkOtp(pending, req.body.otp, 'signups', 'email', email);
  if (err) return res.status(400).json({ error: err });
  if (getPlayerByEmail(email)) {
    db.prepare('DELETE FROM signups WHERE email = ?').run(email);
    return res.status(409).json({ error: 'An account already exists for that email — log in instead.' });
  }

  let playerId = pending.claimPlayerId;
  db.exec('BEGIN');
  try {
    if (playerId) {
      const player = getPlayer(playerId);
      if (!player || player.email) {
        db.exec('ROLLBACK');
        db.prepare('DELETE FROM signups WHERE email = ?').run(email);
        return res.status(410).json({ error: 'This invite has already been claimed.' });
      }
      /* claimToken is left in place so re-opening the link later answers
         "already claimed" rather than a generic "invalid". */
      db.prepare('UPDATE players SET name = ?, gender = ?, email = ?, passwordHash = ?, accountCreatedAt = ? WHERE id = ?')
        .run(pending.name, pending.gender, email, pending.passwordHash, Date.now(), playerId);
    } else {
      playerId = randomToken(6);
      db.prepare('INSERT INTO players (id, name, gender, email, passwordHash, accountCreatedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .run(playerId, pending.name, pending.gender, email, pending.passwordHash, Date.now());
    }
    db.prepare('DELETE FROM signups WHERE email = ?').run(email);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  res.json({ token: issueSession(playerId), player: publicPlayer(getPlayer(playerId)) });
});

/* ---- Login: email + password. ---- */
router.post('/auth/login', (req, res) => {
  const player = getPlayerByEmail(normEmail(req.body.email));
  if (player && !player.passwordHash) {
    return res.status(400).json({ error: "This account doesn't have a password yet — use Forgot password to set one." });
  }
  if (!player || !verifyPassword(req.body.password, player.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  res.json({ token: issueSession(player.id), player: publicPlayer(player) });
});

/* ---- Forgot password: emailed code, then a new password. ---- */
router.post('/auth/password/forgot', async (req, res) => {
  const email = normEmail(req.body.email);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  const player = getPlayerByEmail(email);
  if (!player) return res.status(404).json({ error: 'No account found for that email.' });
  const otp = startOtp(player.id);
  if (!(await emailCode(res, email, otp))) return;
  res.json({ ok: true });
});

router.post('/auth/password/reset', (req, res) => {
  const email = normEmail(req.body.email);
  const player = getPlayerByEmail(email);
  if (!player) return res.status(404).json({ error: 'No account found for that email.' });
  const err = checkOtp(player, req.body.otp, 'players', 'id', player.id);
  if (err) return res.status(400).json({ error: err });
  const pwErr = passwordError(req.body.password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  // A reset signs the account out everywhere else, then in on this device.
  db.prepare('UPDATE players SET passwordHash = ?, otpHash = NULL, otpExpiresAt = NULL, prevOtpHash = NULL, prevOtpExpiresAt = NULL, otpAttempts = 0 WHERE id = ?')
    .run(hashPassword(req.body.password), player.id);
  db.prepare('DELETE FROM sessions WHERE playerId = ?').run(player.id);
  res.json({ token: issueSession(player.id), player: publicPlayer(getPlayer(player.id)) });
});

function bearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

router.get('/auth/me', (req, res) => {
  const raw = bearerToken(req);
  if (!raw) return res.status(401).json({ error: 'Not signed in.' });
  const player = playerForSession(raw);
  if (!player) return res.status(401).json({ error: 'Session expired.' });
  res.json({ player: publicPlayer(player) });
});

router.post('/auth/logout', (req, res) => {
  const raw = bearerToken(req);
  if (raw) db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(sha256(raw));
  res.json({ ok: true });
});

/* ---- The page a shared invite link opens ----
   Chat apps (WhatsApp included) only make http(s) links tappable, so the
   invite is a real web page. It hands off to the installed app through its
   URL scheme — on Android via an intent:// link, which Chrome follows from
   a tap and which falls back to this page (?noapp=1) if the app is
   missing. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function claimLandingPage(req, res) {
  const token = String(req.params.token || '');
  const player = getPlayerByClaimToken(token);
  const problem = claimProblem(player);
  const appPath = `claim/${encodeURIComponent(token)}`;
  const pageUrl = `${publicBaseUrl()}/claim/${encodeURIComponent(token)}`;
  const isAndroid = /android/i.test(req.headers['user-agent'] || '');
  const openHref = isAndroid
    ? `intent://${appPath}#Intent;scheme=thepickleslot;package=com.thepickleslot.app;S.browser_fallback_url=${encodeURIComponent(`${pageUrl}?noapp=1`)};end`
    : `thepickleslot://${appPath}`;
  const noApp = req.query.noapp === '1';

  const body = problem
    ? `<h1>Invite unavailable</h1><p>${escapeHtml(problem.error)}</p>`
    : `<h1>You're invited!</h1>
       <p>Join The Pickle Slot as <strong>${escapeHtml(player.name)}</strong>.</p>
       ${noApp
    ? '<p class="note">The Pickle Slot app isn\'t installed on this phone yet. Install it, then tap this invite link again.</p>'
    : `<a class="btn" href="${escapeHtml(openHref)}">Open in The Pickle Slot</a>
          <p class="note">You'll set up your account with your name already filled in.</p>`}`;

  res.status(problem ? problem.status : 200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Pickle Slot invite</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, Roboto, sans-serif; background: #FBF9FE; color: #1A0F2E; }
  header { background: linear-gradient(135deg, #3D0091, #6200EA 45%, #F4EEFE); padding: 22px 20px; color: #fff; font-weight: 700; font-size: 20px; letter-spacing: .5px; }
  header span { color: #36FFC6; }
  main { max-width: 420px; margin: 28px auto; padding: 0 20px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  p { line-height: 1.5; color: #6B6478; }
  strong { color: #1A0F2E; }
  .btn { display: block; text-align: center; margin: 22px 0 12px; padding: 14px; border-radius: 999px; background: #6200EA; color: #F4EEFE; font-weight: 700; text-decoration: none; }
  .note { font-size: 13px; }
</style></head>
<body><header>THE PICKLE <span>SLOT</span></header><main>${body}</main></body></html>`);
}

module.exports = { router, claimLandingPage };
