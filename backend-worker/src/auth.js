/* Accounts on the Worker — same behaviour and endpoints as the local Node
   backend (backend/auth.js):
     - Sign up (optionally from an invite link, which prefills name/category
       and turns that host-added player into the account), verified by an
       emailed code.
     - Login with email + password.
     - Forgot password: emailed code, then a new password.
   Codes and session tokens are stored as SHA-256 hashes; passwords as
   PBKDF2 hashes. One session row per device, with sliding expiry. The last
   two codes sent both work until they expire (emails can arrive late). */
import {
  json, err, readJson, sha256, randomToken, generateOtp, hashPassword, verifyPassword, sendOtpEmail,
} from './util.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const CLAIM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD = 8;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normEmail = v => String(v || '').trim().toLowerCase();
const publicPlayer = p => ({ id: p.id, name: p.name, gender: p.gender, email: p.email || null });

export function publicBaseUrl(request, env) {
  return (env.PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

const getPlayer = (db, id) => db.prepare('SELECT * FROM players WHERE id = ?').bind(id).first();
const getPlayerByEmail = (db, email) => db.prepare('SELECT * FROM players WHERE email = ?').bind(email).first();
export const getPlayerByClaimToken = (db, token) => db.prepare('SELECT * FROM players WHERE claimToken = ?').bind(token).first();

function passwordError(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `Password must be at least ${MIN_PASSWORD} characters.`;
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

export function claimProblem(player) {
  if (!player) return { status: 404, error: 'This invite link is invalid.' };
  if (player.email) return { status: 410, error: 'This invite has already been claimed.' };
  if (Date.now() > player.claimTokenExpiresAt) return { status: 410, error: 'This invite link has expired — ask your host to send a new one.' };
  return null;
}

async function issueSession(db, playerId) {
  const raw = randomToken();
  await db.prepare('INSERT INTO sessions (tokenHash, playerId, expiresAt) VALUES (?, ?, ?)')
    .bind(await sha256(raw), playerId, Date.now() + SESSION_TTL_MS).run();
  return raw;
}

async function checkOtp(db, row, otp, table, keyCol, keyVal) {
  if (!row.otpHash || !row.otpExpiresAt) return 'No code was requested — request a new one.';
  if (row.otpAttempts >= OTP_MAX_ATTEMPTS) return 'Too many incorrect attempts — request a new code.';
  const given = await sha256(String(otp || ''));
  const now = Date.now();
  if ((given === row.otpHash && now <= row.otpExpiresAt)
    || (row.prevOtpHash && given === row.prevOtpHash && now <= row.prevOtpExpiresAt)) return null;
  if (given === row.otpHash || given === row.prevOtpHash) return 'That code expired — request a new one.';
  await db.prepare(`UPDATE ${table} SET otpAttempts = otpAttempts + 1 WHERE ${keyCol} = ?`).bind(keyVal).run();
  return 'Incorrect code.';
}

async function emailCode(env, email, otp) {
  try {
    const { devOtp } = await sendOtpEmail(env, email, otp);
    return { ok: true, devOtp };
  } catch (e) {
    console.error('sendOtpEmail failed', e);
    return { ok: false, response: err(502, 'Could not send the verification email — try again shortly.') };
  }
}
const sent = (devOtp) => json(devOtp ? { ok: true, devOtp } : { ok: true });

function bearerToken(request) {
  const [scheme, token] = (request.headers.get('Authorization') || '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

/* ---------------- routes ---------------- */

export async function createClaimLink(request, env, { id }) {
  const db = env.DB;
  const player = await getPlayer(db, id);
  if (!player) return err(404, 'Player not found.');
  if (player.email) return err(400, `${player.name} already has an account.`);
  const token = randomToken(16);
  const expiresAt = Date.now() + CLAIM_TOKEN_TTL_MS;
  await db.prepare('UPDATE players SET claimToken = ?, claimTokenExpiresAt = ? WHERE id = ?').bind(token, expiresAt, id).run();
  return json({ token, name: player.name, expiresAt, url: `${publicBaseUrl(request, env)}/claim/${token}` });
}

export async function claimInfo(request, env, { token }) {
  const player = await getPlayerByClaimToken(env.DB, token);
  const problem = claimProblem(player);
  if (problem) return err(problem.status, problem.error);
  return json({ playerId: player.id, name: player.name, gender: player.gender });
}

export async function signupOtp(request, env) {
  const db = env.DB;
  const body = await readJson(request);
  const name = String(body.name || '').trim();
  const gender = String(body.gender || '');
  const email = normEmail(body.email);
  const claimToken = body.claimToken ? String(body.claimToken) : null;
  if (!name || name.length > 60) return err(400, 'Enter your name (up to 60 characters).');
  if (!['M', 'F', 'O'].includes(gender)) return err(400, 'Choose a category.');
  if (!EMAIL_RE.test(email)) return err(400, 'Enter a valid email address.');
  const pwErr = passwordError(body.password);
  if (pwErr) return err(400, pwErr);

  let claimPlayerId = null;
  if (claimToken) {
    const player = await getPlayerByClaimToken(db, claimToken);
    const problem = claimProblem(player);
    if (problem) return err(problem.status, problem.error);
    claimPlayerId = player.id;
  }
  if (await getPlayerByEmail(db, email)) return err(409, 'An account already exists for that email — log in instead.');

  const otp = generateOtp();
  const now = Date.now();
  await db.prepare(`
    INSERT INTO signups (email, name, gender, otpHash, otpExpiresAt, otpAttempts, passwordHash, claimPlayerId)
    VALUES (?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, gender = excluded.gender,
      prevOtpHash = CASE WHEN signups.otpExpiresAt > ? THEN signups.otpHash END,
      prevOtpExpiresAt = CASE WHEN signups.otpExpiresAt > ? THEN signups.otpExpiresAt END,
      otpHash = excluded.otpHash, otpExpiresAt = excluded.otpExpiresAt, otpAttempts = 0,
      passwordHash = excluded.passwordHash, claimPlayerId = excluded.claimPlayerId
  `).bind(email, name, gender, await sha256(otp), now + OTP_TTL_MS, await hashPassword(body.password), claimPlayerId, now, now).run();
  const r = await emailCode(env, email, otp);
  return r.ok ? sent(r.devOtp) : r.response;
}

export async function signupVerify(request, env) {
  const db = env.DB;
  const body = await readJson(request);
  const email = normEmail(body.email);
  const pending = await db.prepare('SELECT * FROM signups WHERE email = ?').bind(email).first();
  if (!pending) return err(404, 'No sign-up in progress for that email — start again.');
  const problem = await checkOtp(db, pending, body.otp, 'signups', 'email', email);
  if (problem) return err(400, problem);
  const clearSignup = db.prepare('DELETE FROM signups WHERE email = ?').bind(email);
  if (await getPlayerByEmail(db, email)) {
    await clearSignup.run();
    return err(409, 'An account already exists for that email — log in instead.');
  }

  let playerId = pending.claimPlayerId;
  if (playerId) {
    const player = await getPlayer(db, playerId);
    if (!player || player.email) {
      await clearSignup.run();
      return err(410, 'This invite has already been claimed.');
    }
    // claimToken stays, so re-opening the link says "already claimed".
    await db.batch([
      db.prepare('UPDATE players SET name = ?, gender = ?, email = ?, passwordHash = ?, accountCreatedAt = ? WHERE id = ? AND email IS NULL')
        .bind(pending.name, pending.gender, email, pending.passwordHash, Date.now(), playerId),
      clearSignup,
    ]);
  } else {
    playerId = randomToken(6);
    await db.batch([
      db.prepare('INSERT INTO players (id, name, gender, email, passwordHash, accountCreatedAt) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(playerId, pending.name, pending.gender, email, pending.passwordHash, Date.now()),
      clearSignup,
    ]);
  }
  return json({ token: await issueSession(db, playerId), player: publicPlayer(await getPlayer(db, playerId)) });
}

export async function login(request, env) {
  const db = env.DB;
  const body = await readJson(request);
  const player = await getPlayerByEmail(db, normEmail(body.email));
  if (player && !player.passwordHash) {
    return err(400, "This account doesn't have a password yet — use Forgot password to set one.");
  }
  if (!player || !(await verifyPassword(body.password, player.passwordHash))) return err(401, 'Incorrect email or password.');
  return json({ token: await issueSession(db, player.id), player: publicPlayer(player) });
}

export async function forgotPassword(request, env) {
  const db = env.DB;
  const email = normEmail((await readJson(request)).email);
  if (!EMAIL_RE.test(email)) return err(400, 'Enter a valid email address.');
  const player = await getPlayerByEmail(db, email);
  if (!player) return err(404, 'No account found for that email.');
  const otp = generateOtp();
  const now = Date.now();
  await db.prepare(`
    UPDATE players SET
      prevOtpHash = CASE WHEN otpExpiresAt > ? THEN otpHash END,
      prevOtpExpiresAt = CASE WHEN otpExpiresAt > ? THEN otpExpiresAt END,
      otpHash = ?, otpExpiresAt = ?, otpAttempts = 0
    WHERE id = ?
  `).bind(now, now, await sha256(otp), now + OTP_TTL_MS, player.id).run();
  const r = await emailCode(env, email, otp);
  return r.ok ? sent(r.devOtp) : r.response;
}

export async function resetPassword(request, env) {
  const db = env.DB;
  const body = await readJson(request);
  const player = await getPlayerByEmail(db, normEmail(body.email));
  if (!player) return err(404, 'No account found for that email.');
  const problem = await checkOtp(db, player, body.otp, 'players', 'id', player.id);
  if (problem) return err(400, problem);
  const pwErr = passwordError(body.password);
  if (pwErr) return err(400, pwErr);
  // A reset signs the account out everywhere else, then in on this device.
  await db.batch([
    db.prepare('UPDATE players SET passwordHash = ?, otpHash = NULL, otpExpiresAt = NULL, prevOtpHash = NULL, prevOtpExpiresAt = NULL, otpAttempts = 0 WHERE id = ?')
      .bind(await hashPassword(body.password), player.id),
    db.prepare('DELETE FROM sessions WHERE playerId = ?').bind(player.id),
  ]);
  return json({ token: await issueSession(db, player.id), player: publicPlayer(await getPlayer(db, player.id)) });
}

export async function me(request, env) {
  const db = env.DB;
  const raw = bearerToken(request);
  if (!raw) return err(401, 'Not signed in.');
  const hash = await sha256(raw);
  const session = await db.prepare('SELECT * FROM sessions WHERE tokenHash = ?').bind(hash).first();
  if (!session) return err(401, 'Session expired.');
  if (Date.now() > session.expiresAt) {
    await db.prepare('DELETE FROM sessions WHERE tokenHash = ?').bind(hash).run();
    return err(401, 'Session expired.');
  }
  await db.prepare('UPDATE sessions SET expiresAt = ? WHERE tokenHash = ?').bind(Date.now() + SESSION_TTL_MS, hash).run();
  const player = await getPlayer(db, session.playerId);
  if (!player) return err(401, 'Session expired.');
  return json({ player: publicPlayer(player) });
}

export async function logout(request, env) {
  const raw = bearerToken(request);
  if (raw) await env.DB.prepare('DELETE FROM sessions WHERE tokenHash = ?').bind(await sha256(raw)).run();
  return json({ ok: true });
}
