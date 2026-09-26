/* ===================== SERVER =====================
   REST API in front of the SQLite-backed state. The core of the app is
   still just two endpoints: GET /api/state (hydrate) and PUT /api/state
   (persist the latest snapshot after every client-side mutation) —
   mirroring exactly what lib/store.js used to do against AsyncStorage, now
   against a shared database so every device sees the same data. Auth
   (auth.js) is layered on top for per-player identity — email-OTP signup
   and login — without changing that shared-state model. */
const express = require('express');
const cors = require('cors');
const { readState, writeState } = require('./state');
const { db } = require('./db');
const { router: authRouter, claimLandingPage } = require('./auth');
const { router: migrateRouter } = require('./migrate');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/api', authRouter);
app.use('/api', migrateRouter);

function isValidState(body) {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object.';
  if (!Array.isArray(body.players)) return '"players" must be an array.';
  if (!Array.isArray(body.events)) return '"events" must be an array.';
  if (body.chats !== undefined && !Array.isArray(body.chats)) return '"chats" must be an array.';
  if (body.history !== undefined && (typeof body.history !== 'object' || body.history === null)) return '"history" must be an object.';
  if (body.players.some(p => !p || typeof p.id !== 'string')) return 'Every player needs a string "id".';
  if (body.events.some(e => !e || typeof e.id !== 'string')) return 'Every event needs a string "id".';
  if ((body.chats || []).some(c => !c || typeof c.id !== 'string')) return 'Every chat needs a string "id".';
  return null;
}

// Who's saving (from their session), so only an event's host can change
// its setup or delete it — see state.js.
function requesterId(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  const hash = require('node:crypto').createHash('sha256').update(token).digest('hex');
  const session = db.prepare('SELECT playerId, expiresAt FROM sessions WHERE tokenHash = ?').get(hash);
  return session && Date.now() <= session.expiresAt ? session.playerId : null;
}

app.get('/api/health', (req, res) => res.json({ ok: true }));

// The link people actually tap in WhatsApp etc. — a real http(s) page that
// hands off to the app (see auth.js).
app.get('/claim/:token', claimLandingPage);

app.get('/api/state', (req, res) => {
  res.json(readState());
});

app.put('/api/state', (req, res) => {
  const error = isValidState(req.body);
  if (error) return res.status(400).json({ error });
  try {
    res.json(writeState(req.body, requesterId(req)));
  } catch (e) {
    console.error('writeState failed', e);
    res.status(500).json({ error: 'Failed to persist state.' });
  }
});


if (require.main === module) {
  // Only a real start loads .env (email settings, PUBLIC_URL). Tests require
  // this module without it, so they never send real email.
  try { process.loadEnvFile(require('node:path').join(__dirname, '.env')); } catch (e) { /* no .env — fine, see .env.example */ }
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`The Pickle Slot backend listening on :${PORT}`));
}

module.exports = { app };
