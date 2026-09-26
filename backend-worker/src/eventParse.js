/* ===================== EVENT TEXT → DRAFT =====================
   The deterministic half of "describe your event": everything here is plain
   code with no network calls, so it's unit-tested directly
   (test/eventParse.test.mjs). ai.js feeds it the model's guesses.

   Division of labour: dates and times come from chrono-node (reliable, and
   small models are bad at "next Tuesday"); explicit numbers like "4 courts"
   come from patterns; the model fills in what's left (name, segments,
   player names, anything phrased loosely). Every value is then clamped the
   same way lib/store.js's newEvent does, so a bad guess can't produce an
   event the app can't handle. */
import * as chrono from 'chrono-node';

export const MODES = ['open', 'men', 'women', 'mixed', 'break'];
export const LIMITS = {
  courts: [1, 20], gameLenMin: [5, 60], durationMin: [15, 720],
};
const DEFAULTS = { startTime: '18:00', durationMin: 240, courts: 4, gameLenMin: 15 };

const pad = n => String(n).padStart(2, '0');
const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(n)));
const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isClock = s => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toClock = min => { const t = ((min % 1440) + 1440) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };

/* ---- Pass 1: what code can read reliably ---- */

const WORD_NUMS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, fifteen: 15, twenty: 20, thirty: 30 };
const NUM = `(\\d+(?:\\.\\d+)?|${Object.keys(WORD_NUMS).join('|')}|an?|half an?)`;
function num(s) {
  s = s.toLowerCase();
  if (s.startsWith('half')) return 0.5;
  if (s === 'a' || s === 'an') return 1;
  return WORD_NUMS[s] !== undefined ? WORD_NUMS[s] : parseFloat(s);
}

/* now: the user's current time (ISO); tzOffsetMin: minutes east of UTC,
   i.e. -Date#getTimezoneOffset() on the phone. Dates are read in the
   user's timezone, never the server's. */
export function extractFromText(text, { now, tzOffsetMin = 0 } = {}) {
  const out = {};
  const ref = { instant: now ? new Date(now) : new Date(), timezone: tzOffsetMin };

  // Date and time. Skip results that are only a duration ("for 3 hours").
  const results = chrono.parse(text, ref, { forwardDate: true })
    .filter(r => !/^\s*for\b/i.test(r.text));
  const hit = results.find(r => r.start.isCertain('hour'))
    || null;
  // "Friday night, 6:30 till 9" parses as two results: the day comes from
  // one and the time from the other.
  const dayHit = [hit, ...results].find(r => r && (r.start.isCertain('day') || r.start.isCertain('weekday')));
  if (dayHit) {
    const s = dayHit.start;
    out.date = `${s.get('year')}-${pad(s.get('month'))}-${pad(s.get('day'))}`;
  }
  // Nobody means 6:30am by a bare "6:30" — 1 to 7 without am/pm is read as
  // the evening. "7am" or "morning" makes the meridiem certain and is kept.
  const clockOf = c => {
    let h = c.get('hour');
    if (!c.isCertain('meridiem') && h >= 1 && h <= 7) h += 12;
    return `${pad(h)}:${pad(c.get('minute') || 0)}`;
  };
  if (hit) {
    const s = hit.start;
    if (s.isCertain('hour')) {
      out.startTime = clockOf(s);
      if (hit.end && hit.end.isCertain('hour')) {
        const endTime = clockOf(hit.end);
        let d = toMin(endTime) - toMin(out.startTime);
        // "6:30 till 9" — a bare end hour before the start means 9pm, not
        // 9am the next day. Otherwise it genuinely runs past midnight.
        if (d <= 0 && !hit.end.isCertain('meridiem') && d + 720 > 0) d += 720;
        if (d <= 0) d += 1440;
        out.durationMin = d;
      }
    }
  }

  // "for 3 hours", "for 90 minutes", "for an hour and a half"
  const dur = text.match(new RegExp(`\\bfor\\s+${NUM}\\s*(hours?|hrs?|h|minutes?|mins?)\\b(\\s+and\\s+a\\s+half)?`, 'i'));
  if (dur) {
    const isHours = /^h/i.test(dur[2]);
    out.durationMin = num(dur[1]) * (isHours ? 60 : 1) + (dur[3] ? 30 : 0);
  }

  const courts = text.match(new RegExp(`\\b${NUM}\\s+courts?\\b`, 'i'));
  if (courts) out.courts = num(courts[1]);

  // "15-minute games", "15 min games", "games of 12 minutes"
  const game = text.match(new RegExp(`\\b${NUM}[\\s-]*(?:minutes?|mins?)[\\s-]+games?\\b`, 'i'))
    || text.match(new RegExp(`\\bgames?\\s+(?:of|are|at)\\s+${NUM}\\s*(?:minutes?|mins?)\\b`, 'i'));
  if (game) out.gameLenMin = num(game[1]);

  return out;
}

/* ---- Pass 2: merge with the model's guesses and clamp ---- */

// The model's reply uses "" / 0 for "not mentioned" (small models handle
// that more reliably than nulls), so treat those as missing.
function fromModel(ai) {
  if (!ai || typeof ai !== 'object' || ai.isEvent === false) return {};
  const o = {};
  if (typeof ai.name === 'string' && ai.name.trim()) o.name = ai.name.trim().slice(0, 60);
  if (isDate(ai.date)) o.date = ai.date;
  if (isClock(ai.startTime)) o.startTime = ai.startTime;
  if (Number(ai.durationMin) > 0) o.durationMin = Number(ai.durationMin);
  else if (isClock(ai.endTime) && o.startTime) {
    let d = toMin(ai.endTime) - toMin(o.startTime);
    if (d <= 0) d += 1440;
    o.durationMin = d;
  }
  if (Number(ai.courts) > 0) o.courts = Number(ai.courts);
  if (Number(ai.gameLenMin) > 0) o.gameLenMin = Number(ai.gameLenMin);
  if (Array.isArray(ai.segments)) o.segments = ai.segments;
  if (Array.isArray(ai.playerNames)) o.playerNames = ai.playerNames.filter(n => typeof n === 'string' && n.trim()).map(n => n.trim()).slice(0, 60);
  if (ai.inviteEveryone === true) o.inviteEveryone = true;
  return o;
}

/* Segments arrive as [{mode, minutes}] in order. They're laid end to end
   from the start; the last one always runs to the end of the event, and
   anything past the end is dropped. Each segment's mode applies to every
   court — the app stores modes per court ({1: 'mixed', 2: 'mixed'}), and
   "open" is the app's default so it's left out. */
export function buildSegments(rawSegments, { startTime, durationMin, courts }) {
  const segs = (Array.isArray(rawSegments) ? rawSegments : [])
    .map(s => ({ mode: MODES.includes(s && s.mode) ? s.mode : 'open', minutes: Math.round(Number(s && s.minutes) || 0) }));
  const start = toMin(startTime);
  const clockAt = off => toClock(start + off);
  const modesFor = mode => (mode === 'open' ? {} : Object.fromEntries(Array.from({ length: courts }, (_, i) => [i + 1, mode])));

  const out = [];
  let cursor = 0;
  for (let i = 0; i < segs.length && cursor < durationMin; i++) {
    const last = i === segs.length - 1;
    const len = last || segs[i].minutes <= 0 ? durationMin - cursor : Math.min(segs[i].minutes, durationMin - cursor);
    out.push({ start: clockAt(cursor), end: clockAt(cursor + len), modes: modesFor(segs[i].mode) });
    cursor += len;
  }
  if (!out.length) return [{ start: clockAt(0), end: clockAt(durationMin), modes: {} }];
  // Merge neighbours that ended up with the same mode.
  return out.reduce((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && JSON.stringify(prev.modes) === JSON.stringify(s.modes)) prev.end = s.end;
    else acc.push(s);
    return acc;
  }, []);
}

function defaultName(date, startTime) {
  const day = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : '';
  const h = Number((startTime || '18:00').split(':')[0]);
  const part = h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 20 ? 'Evening' : 'Night';
  return `${day} ${part}`.trim();
}

/* ---- Player names → player ids ---- */

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

/* Tries, in order: exact name, exact first name, name prefix, then a close
   spelling (voice typing mangles names). A step only counts when it points
   at exactly one player — an ambiguous "Sam" is reported, not guessed. */
export function matchPlayers(names, players) {
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const list = players.map(p => ({ id: p.id, full: norm(p.name), first: norm(p.name).split(' ')[0] }));
  const matched = [];
  const unmatched = [];
  for (const raw of names) {
    const n = norm(raw);
    if (!n) continue;
    const tries = [
      p => p.full === n,
      p => p.first === n,
      p => p.full.startsWith(n) && n.length >= 3,
      p => editDistance(p.full, n) <= (n.length > 5 ? 2 : 1) || editDistance(p.first, n) <= (n.length > 5 ? 2 : 1),
    ];
    let found = null;
    for (const t of tries) {
      const hits = list.filter(t);
      if (hits.length === 1) { found = hits[0]; break; }
      if (hits.length > 1) break; // ambiguous — stop, don't guess
    }
    if (found) { if (!matched.includes(found.id)) matched.push(found.id); } else unmatched.push(raw);
  }
  return { matched, unmatched };
}

/* ---- Put it together ---- */

/* Returns { draft, filled, unmatchedNames } or null when the text had
   nothing event-like in it. `filled` lists the fields that came from the
   text, so the app can say what it filled in versus left as a default. */
export function buildDraft(text, ai, players, opts = {}) {
  const fromText = extractFromText(text, opts);
  const model = fromModel(ai);
  const pick = key => (fromText[key] !== undefined ? fromText[key] : model[key]);

  const filled = [];
  const take = (key, fallback) => {
    const v = pick(key);
    if (v === undefined) return fallback;
    filled.push(key);
    return v;
  };

  const today = opts.now ? opts.now.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const date = take('date', today);
  const startTime = take('startTime', DEFAULTS.startTime);
  const durationMin = clamp(take('durationMin', DEFAULTS.durationMin), LIMITS.durationMin);
  const courts = clamp(take('courts', DEFAULTS.courts), LIMITS.courts);
  const gameLenMin = clamp(take('gameLenMin', DEFAULTS.gameLenMin), LIMITS.gameLenMin);
  let name = model.name;
  if (name) filled.push('name');
  else name = defaultName(filled.includes('date') ? date : null, startTime);

  const hasSegments = Array.isArray(model.segments) && model.segments.some(s => s && s.mode && s.mode !== 'open');
  if (hasSegments) filled.push('segments');
  const segments = buildSegments(hasSegments ? model.segments : [], { startTime, durationMin, courts });

  let memberIds = [];
  let unmatchedNames = [];
  if (model.inviteEveryone) {
    memberIds = players.map(p => p.id);
    filled.push('players');
  } else if (model.playerNames && model.playerNames.length) {
    const r = matchPlayers(model.playerNames, players);
    memberIds = r.matched;
    unmatchedNames = r.unmatched;
    if (memberIds.length) filled.push('players');
  }

  if (!filled.length) return null;
  return { draft: { name, date, startTime, durationMin, courts, gameLenMin, segments, memberIds }, filled, unmatchedNames };
}
