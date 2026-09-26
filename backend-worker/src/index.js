/* ===================== THE PICKLE SLOT — CLOUDFLARE WORKER =====================
   The app's API on Cloudflare's free plan (Workers + D1). Same endpoints and
   behaviour as the local Node backend in backend/ — the app can point at
   either. Routes:
     GET/PUT /api/state                          shared group state
     /api/players/:id/claim-link, /api/claim/:t  invites
     /api/auth/...                               sign up, login, passwords
     POST /api/admin/import                      one-time data move
     GET /claim/:token                           the invite page people tap */
import { json, err, readJson, tokensEqual } from './util.js';
import { getState, putState } from './state.js';
import {
  createClaimLink, claimInfo, signupOtp, signupVerify, login, forgotPassword, resetPassword, me, logout,
  getPlayerByClaimToken, claimProblem, publicBaseUrl,
} from './auth.js';

const ROUTES = [
  ['GET', '/api/health', () => json({ ok: true })],
  ['GET', '/api/state', getState],
  ['PUT', '/api/state', putState],
  ['POST', '/api/players/:id/claim-link', createClaimLink],
  ['GET', '/api/claim/:token', claimInfo],
  ['POST', '/api/auth/signup/otp', signupOtp],
  ['POST', '/api/auth/signup/verify', signupVerify],
  ['POST', '/api/auth/login', login],
  ['POST', '/api/auth/password/forgot', forgotPassword],
  ['POST', '/api/auth/password/reset', resetPassword],
  ['GET', '/api/auth/me', me],
  ['POST', '/api/auth/logout', logout],
  ['POST', '/api/admin/import', importData],
  ['GET', '/claim/:token', claimLandingPage],
].map(([method, pattern, handler]) => {
  const keys = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}$`);
  return { method, re, keys, handler };
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Migration-Token',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const { pathname } = new URL(request.url);
    let response;
    try {
      const route = ROUTES.find(r => r.method === request.method && r.re.test(pathname));
      if (!route) {
        response = err(404, 'Not found.');
      } else {
        const m = pathname.match(route.re);
        const params = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        response = await route.handler(request, env, params);
      }
    } catch (e) {
      console.error('request failed', pathname, e);
      response = err(500, 'Server error.');
    }
    const headers = new Headers(response.headers);
    Object.entries(CORS).forEach(([k, v]) => headers.set(k, v));
    return new Response(response.body, { status: response.status, headers });
  },
};

/* ---- One-time data import (see backend/scripts/export-to-server.js) ----
   Exists only while the MIGRATION_TOKEN secret is set, needs that token, and
   only writes into an EMPTY database. Delete the secret afterwards. */
const IMPORT_TABLES = ['players', 'events', 'chats', 'history', 'config'];
async function importData(request, env) {
  if (!env.MIGRATION_TOKEN) return err(404, 'Not found.');
  if (!tokensEqual(request.headers.get('X-Migration-Token'), env.MIGRATION_TOKEN)) return err(403, 'Bad token.');
  const db = env.DB;
  const [p, e] = await db.batch([db.prepare('SELECT COUNT(*) AS n FROM players'), db.prepare('SELECT COUNT(*) AS n FROM events')]);
  if (p.results[0].n + e.results[0].n > 0) return err(409, 'This database already has data — refusing to overwrite it.');

  const body = await readJson(request);
  const stmts = [];
  const counts = {};
  for (const table of IMPORT_TABLES) {
    const columns = new Set((await db.prepare(`PRAGMA table_info(${table})`).all()).results.map(c => c.name));
    const rows = Array.isArray(body[table]) ? body[table] : [];
    for (const row of rows) {
      const keys = Object.keys(row).filter(k => columns.has(k));
      stmts.push(db.prepare(`INSERT OR REPLACE INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
        .bind(...keys.map(k => (row[k] === undefined ? null : row[k]))));
    }
    counts[table] = rows.length;
  }
  if (stmts.length) await db.batch(stmts);
  return json({ ok: true, imported: counts });
}

/* ---- The page a shared invite link opens ----
   Chat apps (WhatsApp included) only make http(s) links tappable, so the
   invite is a real web page that hands off to the installed app — on
   Android via an intent:// link, which falls back to this page (?noapp=1)
   when the app isn't installed. */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function claimLandingPage(request, env, { token }) {
  const player = await getPlayerByClaimToken(env.DB, token);
  const problem = claimProblem(player);
  const url = new URL(request.url);
  const appPath = `claim/${encodeURIComponent(token)}`;
  const pageUrl = `${publicBaseUrl(request, env)}/claim/${encodeURIComponent(token)}`;
  const isAndroid = /android/i.test(request.headers.get('User-Agent') || '');
  const openHref = isAndroid
    ? `intent://${appPath}#Intent;scheme=thepickleslot;package=com.thepickleslot.app;S.browser_fallback_url=${encodeURIComponent(`${pageUrl}?noapp=1`)};end`
    : `thepickleslot://${appPath}`;
  const noApp = url.searchParams.get('noapp') === '1';

  const body = problem
    ? `<h1>Invite unavailable</h1><p>${escapeHtml(problem.error)}</p>`
    : `<h1>You're invited!</h1>
       <p>Join The Pickle Slot as <strong>${escapeHtml(player.name)}</strong>.</p>
       ${noApp
    ? '<p class="note">The Pickle Slot app isn\'t installed on this phone yet. Install it, then tap this invite link again.</p>'
    : `<a class="btn" href="${escapeHtml(openHref)}">Open in The Pickle Slot</a>
          <p class="note">You'll set up your account with your name already filled in.</p>`}`;

  return new Response(`<!doctype html>
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
<body><header>THE PICKLE <span>SLOT</span></header><main>${body}</main></body></html>`, {
    status: problem ? problem.status : 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
