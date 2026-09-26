/* ===================== AI: DESCRIBE YOUR EVENT =====================
   POST /api/ai/parse-event  { text, now, tzOffsetMin }
     → { draft, filled, unmatchedNames, aiUsed }

   Turns a typed or dictated description into a pre-filled new-event draft.
   Nothing is saved here — the app shows the draft in its normal form and
   the user creates the event from there.

   Guard rails, because anything the app can call a script can call too:
   - signed-in players only (same session check as saving state)
   - per-player limits (a burst limit and a daily limit) plus one daily
     limit for the whole app, kept under Workers AI's free allowance
   - a short, fixed-purpose prompt whose reply must match a JSON schema,
     and only the checked event fields ever go back to the caller — the
     model's own text never does, so this is useless as a general chatbot
   - AI_DISABLED=1 switches it off without a deploy of new code

   If the model call fails, the draft still comes back with whatever the
   code-based parsing found (dates, times, "4 courts"). */
import { json, err, readJson } from './util.js';
import { requesterId } from './state.js';
import { buildDraft, MODES } from './eventParse.js';

// Llama 3.3 70B supports Workers AI's JSON mode and is accurate enough for
// loose phrasing. About 60 neurons a request → ~160 a day on the free plan.
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TEXT = 500;

const intVar = (v, fallback) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback);

const SCHEMA = {
  type: 'object',
  properties: {
    isEvent: { type: 'boolean' },
    name: { type: 'string' },
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    durationMin: { type: 'integer' },
    courts: { type: 'integer' },
    gameLenMin: { type: 'integer' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: { mode: { type: 'string', enum: MODES }, minutes: { type: 'integer' } },
        required: ['mode', 'minutes'],
      },
    },
    playerNames: { type: 'array', items: { type: 'string' } },
    inviteEveryone: { type: 'boolean' },
  },
  required: ['isEvent', 'name', 'date', 'startTime', 'endTime', 'durationMin', 'courts', 'gameLenMin', 'segments', 'playerNames', 'inviteEveryone'],
};

function systemPrompt(today, weekday) {
  return `You read a short description of a pickleball session and extract its details as JSON. Today is ${weekday} ${today}.

Fields (use "" or 0 for anything not mentioned; never invent details):
- isEvent: false if the text is not describing a pickleball session or game night.
- name: a short event name only if the text gives one or clearly implies one (e.g. "ladies' night"), else "".
- date: YYYY-MM-DD, resolving words like "next Tuesday" from today.
- startTime, endTime: 24-hour HH:MM. Evening is assumed when am/pm is missing and the hour is 1-7.
- durationMin: length in minutes, if said as a duration ("for 3 hours").
- courts: number of courts.
- gameLenMin: length of each game in minutes.
- segments: how play is organised over time, in order. mode is one of: open (any combination), men (men's doubles), women (women's doubles), mixed (mixed doubles), break (no games). minutes is how long that part lasts; use 0 for "the rest of the session". Use [] if the text doesn't say.
- playerNames: people named as coming or to be invited, exactly as written.
- inviteEveryone: true if the text says everyone / all players / the whole group.`;
}

async function checkLimits(db, playerId, env) {
  const now = Date.now();
  const dayStart = now - (now % 86400000);
  const [minute, mine, all] = await db.batch([
    db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE playerId = ? AND ts > ?').bind(playerId, now - 60000),
    db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE playerId = ? AND ts >= ?').bind(playerId, dayStart),
    db.prepare('SELECT COUNT(*) AS n FROM ai_calls WHERE ts >= ?').bind(dayStart),
  ]);
  if (minute.results[0].n >= intVar(env.AI_USER_PER_MINUTE_LIMIT, 5)) return 'Too many requests — wait a minute and try again.';
  if (mine.results[0].n >= intVar(env.AI_USER_DAILY_LIMIT, 30)) return "You've reached today's limit for describing events. Fill in the form instead, or try again tomorrow.";
  if (all.results[0].n >= intVar(env.AI_TOTAL_DAILY_LIMIT, 150)) return 'Event descriptions are unavailable for the rest of today. Fill in the form instead.';
  // Count this call now, so failed or slow calls still use up the limit.
  // Rows older than two days are no longer needed by any check.
  await db.batch([
    db.prepare('INSERT INTO ai_calls (playerId, ts) VALUES (?, ?)').bind(playerId, now),
    db.prepare('DELETE FROM ai_calls WHERE ts < ?').bind(dayStart - 86400000),
  ]);
  return null;
}

async function askModel(env, text, today, weekday) {
  try {
    const out = await env.AI.run(env.AI_MODEL || DEFAULT_MODEL, {
      messages: [
        { role: 'system', content: systemPrompt(today, weekday) },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      max_tokens: 400,
      temperature: 0,
    });
    const r = out && out.response;
    return typeof r === 'string' ? JSON.parse(r) : (r && typeof r === 'object' ? r : null);
  } catch (e) {
    console.error('AI call failed', e);
    return null;
  }
}

export async function parseEvent(request, env) {
  if (env.AI_DISABLED === '1' || !env.AI) return err(503, 'Event descriptions are switched off right now. Fill in the form instead.');
  const db = env.DB;
  const playerId = await requesterId(request, db);
  if (!playerId) return err(401, 'Sign in to describe an event.');

  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 3) return err(400, 'Describe the event in a few words first.');
  if (text.length > MAX_TEXT) return err(400, `Keep the description under ${MAX_TEXT} characters.`);
  const tzOffsetMin = Number.isFinite(body.tzOffsetMin) && Math.abs(body.tzOffsetMin) <= 840 ? Math.round(body.tzOffsetMin) : 0;
  // The user's local "now", so "tomorrow" means their tomorrow. Only
  // trusted within a day of the server clock.
  const clientNow = typeof body.now === 'string' ? Date.parse(body.now) : NaN;
  const nowMs = Number.isFinite(clientNow) && Math.abs(clientNow - Date.now()) < 86400000 ? clientNow : Date.now();
  const local = new Date(nowMs + tzOffsetMin * 60000);
  const today = local.toISOString().slice(0, 10);
  const weekday = local.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const nowLocalIso = `${local.toISOString().slice(0, 19)}${tzOffsetMin < 0 ? '-' : '+'}${String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(tzOffsetMin) % 60).padStart(2, '0')}`;

  const limited = await checkLimits(db, playerId, env);
  if (limited) return err(429, limited);

  const [ai, players] = await Promise.all([
    askModel(env, text, today, weekday),
    db.prepare('SELECT id, name FROM players').all().then(r => r.results),
  ]);
  const result = buildDraft(text, ai, players, { now: nowLocalIso, tzOffsetMin });
  if (!result) return err(422, "Couldn't find event details in that. Try something like \"Tuesday 6 to 9pm, 4 courts\".");
  return json({ ...result, aiUsed: !!ai });
}
