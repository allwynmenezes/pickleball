/* ===================== SERVER =====================
   Minimal REST API in front of the SQLite-backed state. Two endpoints carry
   the whole app: GET /api/state (hydrate) and PUT /api/state (persist the
   latest snapshot after every client-side mutation) — mirroring exactly
   what lib/store.js used to do against AsyncStorage, now against a shared
   database so every device sees the same data. */
const express = require('express');
const cors = require('cors');
const { readState, writeState, resetState } = require('./state');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

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

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/state', (req, res) => {
  res.json(readState());
});

app.put('/api/state', (req, res) => {
  const error = isValidState(req.body);
  if (error) return res.status(400).json({ error });
  try {
    res.json(writeState(req.body));
  } catch (e) {
    console.error('writeState failed', e);
    res.status(500).json({ error: 'Failed to persist state.' });
  }
});

app.post('/api/reset', (req, res) => {
  res.json(resetState());
});

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`The Pickle Slot backend listening on :${PORT}`));
}

module.exports = { app };
