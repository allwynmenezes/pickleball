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
export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const MAX_TEXT = 500;

const intVar = (v, fallback) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : fallback);

export const SCHEMA = {
  type: 'object',
  properties: {
    isEvent: { type: 'boolean' },
    name: { type: 'string' },
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    durationMin: { type: 'integer' },
    courts: { type: 'integer' },
    playerCount: { type: 'integer' },
    gameLenMin: { type: 'integer' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          end: { type: 'string' },
          mode: { type: 'string', enum: MODES },
          courtModes: {
            type: 'array',
            items: { type: 'object', properties: { court: { type: 'integer' }, mode: { type: 'string', enum: MODES } }, required: ['court', 'mode'] },
          },
        },
        required: ['start', 'end', 'mode', 'courtModes'],
      },
    },
    playerNames: { type: 'array', items: { type: 'string' } },
    inviteEveryone: { type: 'boolean' },
  },
  required: ['isEvent', 'name', 'date', 'startTime', 'endTime', 'durationMin', 'courts', 'playerCount', 'gameLenMin', 'segments', 'playerNames', 'inviteEveryone'],
};

function systemPrompt(today, weekday) {
  return `You read a short description of a pickleball session and extract its details as JSON. Today is ${weekday} ${today}.

Fields (use "" or 0 for anything not mentioned; never invent details):
- isEvent: false if the text is not describing a pickleball session or game night.
- name: a short event name only if the text gives one or clearly implies one (e.g. "ladies' night"), else "".
- date: YYYY-MM-DD, resolving words like "next Tuesday" from today.
- startTime, endTime: 24-hour HH:MM. Evening is assumed when am/pm is missing and the hour is 1-7.
- durationMin: length in minutes, if said as a duration ("for 3 hours").
- courts: how many courts, only if the text says how many. Court numbers are not a count: "courts 3 and 4" is 2 courts, "court 5" is 1. Use 0 if not said — never guess it from the number of players.
- playerCount: how many people are playing, if the text gives a number ("8 players", "12 of us"), else 0.
- gameLenMin: length of each game in minutes.
- segments: how play is organised, only if the text says. Each part has start and end (24-hour HH:MM, within the session), a mode for all courts, and courtModes for any court that differs, e.g. {"court":2,"mode":"men"}. Modes: open (any combination), men (men's doubles), women (women's doubles), mixed (mixed doubles), break (no games). List every occurrence of something that repeats ("a 15 minute break every hour" in 18:00-22:00 is breaks 19:00-19:15, 20:00-20:15 and 21:00-21:15). Time not covered is open play. Use [] if the text doesn't say.
- playerNames: people named as coming or to be invited, exactly as written.
- inviteEveryone: true if the text says everyone / all players / the whole group.`;
}

export async function checkLimits(db, playerId, env) {
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

/* The user's local "now" from the request, so "tomorrow" means their
   tomorrow. The phone's clock is only trusted within a day of the
   server's (AI_CLOCK_WINDOW_DAYS widens that for the accuracy tests,
   which replay a fixed date). */
export function clientClock(body, env = {}) {
  const tzOffsetMin = Number.isFinite(body.tzOffsetMin) && Math.abs(body.tzOffsetMin) <= 840 ? Math.round(body.tzOffsetMin) : 0;
  const clientNow = typeof body.now === 'string' ? Date.parse(body.now) : NaN;
  const nowMs = Number.isFinite(clientNow) && Math.abs(clientNow - Date.now()) < 86400000 * (Number(env.AI_CLOCK_WINDOW_DAYS) || 1) ? clientNow : Date.now();
  const local = new Date(nowMs + tzOffsetMin * 60000);
  const offset = `${tzOffsetMin < 0 ? '-' : '+'}${String(Math.floor(Math.abs(tzOffsetMin) / 60)).padStart(2, '0')}:${String(Math.abs(tzOffsetMin) % 60).padStart(2, '0')}`;
  return {
    tzOffsetMin,
    today: local.toISOString().slice(0, 10),
    weekday: local.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    nowLocalIso: `${local.toISOString().slice(0, 19)}${offset}`,
  };
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
  const { today, weekday, nowLocalIso, tzOffsetMin } = clientClock(body, env);

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

/* ---- Voice: POST /api/ai/transcribe (multipart form, field "audio") ----
   The app records a short voice note (the phone's own mic permission, asked
   by the app) and this turns it into text with Whisper on Workers AI. The
   text goes back into the "Describe your event" box, where the user can
   check it before it's read as an event. Same sign-in and limits as
   parse-event; a voice note counts as one request. */
const TRANSCRIBE_MODEL = '@cf/openai/whisper-large-v3-turbo';
const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // ~8 minutes at the app's 32 kbps; notes are capped at 60 s

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function transcribe(request, env) {
  if (env.AI_DISABLED === '1' || !env.AI) return err(503, 'Voice input is switched off right now. Type the description instead.');
  const db = env.DB;
  const playerId = await requesterId(request, db);
  if (!playerId) return err(401, 'Sign in to describe an event.');

  let file = null;
  try { file = (await request.formData()).get('audio'); } catch { /* not multipart */ }
  if (!file || typeof file.arrayBuffer !== 'function') return err(400, 'No recording was received. Try again.');
  if (file.size > MAX_AUDIO_BYTES) return err(413, 'That recording is too long. Keep it under a minute.');
  if (file.size < 1000) return err(400, "That recording was empty. Hold the mic button and speak, then tap it again.");

  const limited = await checkLimits(db, playerId, env);
  if (limited) return err(429, limited);

  try {
    const out = await env.AI.run(TRANSCRIBE_MODEL, { audio: toBase64(await file.arrayBuffer()), language: 'en', vad_filter: true });
    const text = String((out && out.text) || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
    if (!text) return err(422, "Couldn't hear anything in that. Try again a little closer to the phone.");
    return json({ text });
  } catch (e) {
    console.error('transcribe failed', e);
    return err(502, "Couldn't turn that recording into text. Try again, or type it instead.");
  }
}
