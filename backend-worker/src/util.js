/* Shared helpers for the Worker: JSON responses, hashing, random tokens and
   codes, password hashing and OTP email. Workers run on Web Crypto, not
   Node's crypto module, so these are the Web Crypto equivalents of what the
   local Node backend (backend/auth.js) does. */

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
export const err = (status, error) => json({ error }, status);

export async function readJson(request) {
  try { return (await request.json()) || {}; } catch (e) { return {}; }
}

const enc = new TextEncoder();
function hex(bytes) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }
function unhex(s) { return new Uint8Array((s.match(/../g) || []).map(h => parseInt(h, 16))); }

export async function sha256(s) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));
}

export function randomToken(bytes = 20) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Uniform 6-digit code (rejection sampling avoids modulo bias).
export function generateOtp() {
  const limit = Math.floor(0x100000000 / 1000000) * 1000000;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
  return String(buf[0] % 1000000).padStart(6, '0');
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
export function tokensEqual(a, b) {
  return timingSafeEqual(enc.encode(String(a || '')), enc.encode(String(b || '')));
}

/* ---- Passwords: PBKDF2-SHA256 (Workers have no scrypt) ----
   The iteration count is stored in each hash, so it can be raised later
   without breaking existing passwords. It's kept moderate because the free
   Workers plan allows only ~10ms of CPU per request. */
const PBKDF2_ITERATIONS = 25000;
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex(salt)}$${hex(bits)}`;
}
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, iter, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iter || !saltHex || !hashHex) return false;
  const bits = await pbkdf2(String(password || ''), unhex(saltHex), parseInt(iter, 10));
  return timingSafeEqual(bits, unhex(hashHex));
}

/* ---- OTP email through the Google Apps Script web app ----
   Without APPS_SCRIPT_URL/SECRET configured, the code is only logged (and,
   when EXPOSE_DEV_OTP=1 in local .dev.vars, returned so local tests can read
   it). Only an explicit { ok: true } from the script counts as sent. */
export async function sendOtpEmail(env, email, otp) {
  if (!env.APPS_SCRIPT_URL || !env.APPS_SCRIPT_SECRET) {
    console.log(`[email:dev-stub] OTP for ${email}: ${otp}`);
    return { devOtp: env.EXPOSE_DEV_OTP === '1' ? otp : undefined };
  }
  const startedAt = Date.now();
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: env.APPS_SCRIPT_SECRET, email, otp }),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Apps Script responded with ${res.status}`);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch (e) { /* not JSON: an Apps Script error page */ }
  if (!body || body.ok !== true) {
    throw new Error((body && body.error) || 'Apps Script did not confirm the email was sent.');
  }
  console.log(`[email] code sent to ${email} in ${Date.now() - startedAt}ms`);
  return {};
}
