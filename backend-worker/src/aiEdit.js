/* ===================== AI: CHANGE AN EXISTING EVENT =====================
   POST /api/ai/edit-event  { text, event, now, tzOffsetMin }
     → { changes, summary, unmatchedNames, aiUsed }

   "Move it to 7pm", "add a court", "mixed for the last hour", "add Sam".
   `event` is the event as the app has it now. Nothing is saved here: the
   app applies the changes through its normal setup editing, so the
   event's Cancel still undoes them, and only the host's save is kept (the
   state endpoint enforces that). Same guard rails as parse-event: signed
   in, rate limits, fixed-purpose prompt, and only checked changes plus a
   summary written by code go back — never the model's own text. */
import { json, err, readJson } from './util.js';
import { requesterId } from './state.js';
import { buildEdit } from './eventParse.js';
import { DEFAULT_MODEL, MAX_TEXT, SCHEMA, checkLimits, clientClock } from './ai.js';

const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    understood: { type: 'boolean' },
    name: { type: 'string' },
    date: { type: 'string' },
    startTime: { type: 'string' },
    endTime: { type: 'string' },
    durationMin: { type: 'integer' },
    courts: { type: 'integer' },
    playerCount: { type: 'integer' },
    gameLenMin: { type: 'integer' },
    segments: SCHEMA.properties.segments,
    addPlayers: { type: 'array', items: { type: 'string' } },
    removePlayers: { type: 'array', items: { type: 'string' } },
    inviteEveryone: { type: 'boolean' },
  },
  required: ['understood', 'name', 'date', 'startTime', 'endTime', 'durationMin', 'courts', 'playerCount', 'gameLenMin',
    'segments', 'addPlayers', 'removePlayers', 'inviteEveryone'],
};

const clock = min => {
  const t = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
};

/* The event as the model sees it. */
export function describeEvent(ev, players) {
  const [h, m] = ev.startTime.split(':').map(Number);
  const weekday = new Date(`${ev.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const segs = (ev.segments || []).map(s => {
    const modes = Array.from({ length: ev.courts }, (_, i) => (s.modes && s.modes[i + 1]) || 'open');
    const same = modes.every(x => x === modes[0]);
    return `${s.start}-${s.end} ${same ? modes[0] : modes.map((x, i) => `court ${i + 1} ${x}`).join(', ')}`;
  });
  const names = (ev.memberIds || []).map(id => (players.find(p => p.id === id) || {}).name).filter(Boolean);
  return [
    `name: ${ev.name}`,
    `date: ${ev.date} (${weekday})`,
    `startTime: ${ev.startTime}, endTime: ${clock(h * 60 + m + ev.durationMin)}, durationMin: ${ev.durationMin}`,
    `courts: ${ev.courts}`,
    `gameLenMin: ${ev.gameLenMin || 15}`,
    `play format: ${segs.join('; ') || 'open play throughout'}`,
    `players: ${names.join(', ') || 'none yet'}`,
  ].join('\n');
}

function editPrompt(today, weekday, current) {
  return `You help change an existing pickleball session. Today is ${weekday} ${today}. The session is currently:
${current}

Read the user's message and give the session's NEW values as JSON. For any field the message does not change, use "" or 0 (or [] / false). Do not repeat current values, and never invent changes.
- understood: false if the message is not a change to this session.
- name, date (YYYY-MM-DD), startTime and endTime (24-hour HH:MM), durationMin, courts, gameLenMin: the new value. Work relative changes out from the current values: "an hour later" moves startTime by an hour and keeps the length; "end at 11" is endTime 23:00; "add a court" is the current courts plus one.
- playerCount: only if the message gives a number of people playing.
- segments: only if the play format changes, and then the WHOLE session in order as mode (open, men, women, mixed, break) and minutes, with minutes 0 for "the rest". Example: "mixed for the last hour" in a 180-minute session is [{"mode":"open","minutes":120},{"mode":"mixed","minutes":0}].
- addPlayers, removePlayers: names exactly as written. inviteEveryone: true for "add everyone".`;
}

/* Only the fields the edit needs, checked — the request comes from the
   app, but anything the app can send a script can too. */
export function sanitizeEvent(e) {
  if (!e || typeof e !== 'object') return null;
  const ok = typeof e.name === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') && /^\d{2}:\d{2}$/.test(e.startTime || '')
    && Number.isFinite(e.durationMin) && Number.isFinite(e.courts);
  if (!ok) return null;
  return {
    name: e.name.slice(0, 60),
    date: e.date,
    startTime: e.startTime,
    durationMin: Math.round(e.durationMin),
    courts: Math.round(e.courts),
    gameLenMin: Number.isFinite(e.gameLenMin) ? Math.round(e.gameLenMin) : 15,
    segments: (Array.isArray(e.segments) ? e.segments : []).slice(0, 30)
      .filter(s => s && /^\d{2}:\d{2}$/.test(s.start) && /^\d{2}:\d{2}$/.test(s.end))
      .map(s => ({ start: s.start, end: s.end, modes: s.modes && typeof s.modes === 'object' ? s.modes : {} })),
    memberIds: (Array.isArray(e.memberIds) ? e.memberIds : []).filter(id => typeof id === 'string').slice(0, 200),
  };
}

export async function editEvent(request, env) {
  if (env.AI_DISABLED === '1' || !env.AI) return err(503, 'The assistant is switched off right now. Make the change in Setup instead.');
  const db = env.DB;
  const playerId = await requesterId(request, db);
  if (!playerId) return err(401, 'Sign in to change this event.');

  const body = await readJson(request);
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length < 2) return err(400, 'Say what to change first.');
  if (text.length > MAX_TEXT) return err(400, `Keep it under ${MAX_TEXT} characters.`);
  const current = sanitizeEvent(body.event);
  if (!current) return err(400, "Couldn't read this event. Close it, open it again and retry.");
  const { today, weekday, nowLocalIso, tzOffsetMin } = clientClock(body, env);

  const limited = await checkLimits(db, playerId, env);
  if (limited) return err(429, limited);

  const players = (await db.prepare('SELECT id, name FROM players').all()).results;
  let ai = null;
  try {
    const out = await env.AI.run(env.AI_MODEL || DEFAULT_MODEL, {
      messages: [
        { role: 'system', content: editPrompt(today, weekday, describeEvent(current, players)) },
        { role: 'user', content: text },
      ],
      response_format: { type: 'json_schema', json_schema: EDIT_SCHEMA },
      max_tokens: 500,
      temperature: 0,
    });
    const r = out && out.response;
    ai = typeof r === 'string' ? JSON.parse(r) : (r && typeof r === 'object' ? r : null);
  } catch (e) {
    console.error('AI edit failed', e);
  }
  if (ai && ai.understood === false) {
    return err(422, 'That doesn\'t look like a change to this event. Try something like "move it to 7pm" or "add Sam".');
  }
  const result = buildEdit(text, ai, current, players, { now: nowLocalIso, tzOffsetMin });
  if (!result) {
    return err(422, ai
      ? 'Nothing to change: the event already looks like that.'
      : 'Couldn\'t work out what to change. Try something like "move it to 7pm" or "add Sam".');
  }
  if (!result.summary) {
    return err(422, `Couldn't find ${result.unmatchedNames.join(', ')} ${result.unmatchedNames.length > 1 ? 'among the players' : 'in the players list'}, so nothing was changed.`);
  }
  return json({ ...result, aiUsed: !!ai });
}
