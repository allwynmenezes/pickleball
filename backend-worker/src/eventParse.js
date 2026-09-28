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
/* Speech-to-text hears "courts" as "codes" or "cords" ("make one of the
   codes mixed"). In this app those words only ever mean courts. */
export function fixCommonMishearings(text) {
  return String(text)
    .replace(/\b(codes|cords|quarts)\b/gi, m => (m[0] === m[0].toUpperCase() ? 'Courts' : 'courts'))
    .replace(/\b(code|cord|quart)\b/gi, m => (m[0] === m[0].toUpperCase() ? 'Court' : 'court'));
}

export function extractFromText(text, opts) {
  return readText(text, opts).out;
}
/* The work behind extractFromText, plus how each value was found (meta),
   which editing needs: in an edit, a lone "7pm" could be the start or the
   end, and "an hour" is often a shift ("push it back an hour"), so only
   unambiguous readings are trusted there. */
function readText(text, { now, tzOffsetMin = 0 } = {}) {
  const out = {};
  const meta = { timeRange: false, durationFrom: null, courtsFrom: null };
  const ref = { instant: now ? new Date(now) : new Date(), timezone: tzOffsetMin };
  // Numbers first. Each phrase found is then blanked out, so chrono doesn't
  // also read "games of 20 minutes" as "20 minutes from now".
  let rest = text;
  const find = re => {
    const m = rest.match(re);
    if (m) rest = rest.replace(m[0], ' ');
    return m;
  };

  // "for 3 hours", "for 90 minutes", "for an hour and a half", "for two
  // and a half hours", or a bare "2hrs" (hours only — a bare "15 min" is
  // usually the game length).
  const HALF = '(\\s+and\\s+a\\s+half)?';
  // Game length: "15-minute games", "games of 12 minutes", "game length
  // (to be) 20 mins", "20 mins each / per game / rounds", "each game 20
  // minutes", "games should be 20 minutes".
  const MINS = '\\s*(?:minutes?|mins?)\\b';
  const game = find(new RegExp(`\\b${NUM}[\\s-]*(?:minutes?|mins?)[\\s-]+(?:games?|rounds?)\\b`, 'i'))
    || find(new RegExp(`\\b(?:games?|rounds?)\\s+(?:of|are|at|last|lasting|should be|to be|will be|be)\\s+${NUM}${MINS}`, 'i'))
    || find(new RegExp(`\\b(?:games?|rounds?)[\\s-]*(?:length|len|time|duration)\\b[^0-9]{0,24}?${NUM}${MINS}`, 'i'))
    || find(new RegExp(`\\b(?:each|every|per)\\s+(?:game|round)\\b[^0-9]{0,16}?${NUM}${MINS}`, 'i'))
    || find(new RegExp(`\\b${NUM}${MINS}\\s*(?:each|per game|a game|per round|a round)\\b`, 'i'));
  if (game) out.gameLenMin = num(game[1]);
  const dur = find(new RegExp(`\\bfor\\s+${NUM}${HALF}\\s*(hours?|hrs?|h|minutes?|mins?)\\b${HALF}`, 'i'))
    || find(new RegExp(`\\b${NUM}${HALF}\\s*(hours?|hrs?)\\b${HALF}`, 'i'));
  const statedDuration = dur ? num(dur[1]) * (/^h/i.test(dur[3]) ? 60 : 1) + (dur[2] || dur[4] ? 30 : 0) : undefined;
  const statedWithFor = !!dur && /^for\b/i.test(dur[0]);
  const courts = find(new RegExp(`\\b${NUM}\\s+courts?\\b`, 'i'));
  if (courts) out.courts = num(courts[1]);
  else {
    // Court numbers rather than a count: "courts 3 and 4", "courts 1-3",
    // "court 1 mixed, court 2 men's" — the count is how many different
    // courts are named anywhere in the text.
    const named = new Set();
    let m;
    const re = /\bcourts?\s*#?\s*(\d{1,2})(?:\s*(?:-|–|to|through|thru)\s*(\d{1,2}))?((?:\s*(?:,|and|&)\s*#?\d{1,2})*)\b/gi;
    while ((m = re.exec(rest))) {
      const a = Number(m[1]);
      if (m[2]) for (let c = Math.min(a, Number(m[2])); c <= Math.max(a, Number(m[2])); c++) named.add(c);
      else named.add(a);
      (m[3].match(/\d{1,2}/g) || []).forEach(n => named.add(Number(n)));
    }
    if (named.size) {
      out.courts = named.size;
      meta.courtsFrom = 'numbers';
      rest = rest.replace(re, ' ');
    }
  }
  // "8 players", "12 people", "16 of us" — used to work out courts when
  // the text doesn't say how many.
  const people = find(new RegExp(`\\b${NUM}\\s+(?:players?|people|persons?|of us|guys|ladies|folks)\\b`, 'i'));
  if (people) out.playerCount = num(people[1]);

  // Wording chrono misses: "7ish", "noon"/"midnight" inside a range
  // ("9 to noon" otherwise loses the 9), and short weekday names.
  const SHORT_DAYS = { tues: 'tuesday', weds: 'wednesday', thur: 'thursday', thurs: 'thursday' };
  // Any other "15 minute" / "an hour" left is the length of something (a
  // break, a segment), never a clock time — chrono would read it as "15
  // minutes from now".
  const cleaned = rest
    .replace(new RegExp(`\\b${NUM}[\\s-]*(?:minutes?|mins?|hours?|hrs?)\\b`, 'gi'), ' ')
    .replace(/\b(?:half|full|all)[\s-]day\b/gi, ' ') // "half day event" is not 10pm
    .replace(/(\d)\s*ish\b/gi, '$1')
    .replace(/\bnoon\b/gi, '12pm')
    .replace(/\bmidnight\b/gi, '12am')
    .replace(/\b(tues|weds|thurs?)\b/gi, m => SHORT_DAYS[m.toLowerCase()]);

  // Date and time. Skip results that are only a duration ("for 3 hours")
  // or relative to now ("the last hour", "in 30 minutes").
  const results = chrono.parse(cleaned, ref, { forwardDate: true })
    .filter(r => !/^\s*for\b/i.test(r.text) && !/\b(hours?|hrs?|minutes?|mins?)\b/i.test(r.text) && !/^\s*(right\s+)?now\s*$/i.test(r.text));
  // Several times can turn up; the best is a range on a named day ("Oct 17
  // from 9 till 1"), then any range, then any time.
  const dayOf = r => r.start.isCertain('day') || r.start.isCertain('weekday');
  const timed = results.filter(r => r.start.isCertain('hour'));
  const hit = timed.find(r => r.end && dayOf(r)) || timed.find(r => r.end) || timed[0] || null;
  // "Friday night, 6:30 till 9" parses as two results: the day comes from
  // one and the time from the other.
  const dayHit = [hit, ...results].find(r => r && (r.start.isCertain('day') || r.start.isCertain('weekday')));
  let day = dayHit ? dayHit.start : null;
  if (!day) {
    // "8pm to midnight on Friday": chrono files the weekday under the end
    // time. Read the weekday phrase on its own instead.
    const wd = cleaned.match(/\b(?:(?:this|next)\s+(?:week\s+)?)?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i);
    const r = wd && chrono.parse(wd[0], ref, { forwardDate: true })[0];
    if (r && (r.start.isCertain('weekday') || r.start.isCertain('day'))) day = r.start;
  }
  if (day) out.date = `${day.get('year')}-${pad(day.get('month'))}-${pad(day.get('day'))}`;
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
        // "9 to 12pm": chrono guesses 9pm for the bare start. When the end is
        // explicitly earlier in the day than that, the start was the morning
        // one. (A bare end, as in "6:30 till 9", is handled below instead.)
        const startMin = toMin(out.startTime);
        if (!s.isCertain('meridiem') && hit.end.isCertain('meridiem') && startMin >= 780 && toMin(endTime) < startMin && toMin(endTime) > startMin - 720) {
          out.startTime = toClock(startMin - 720);
        }
        let d = toMin(endTime) - toMin(out.startTime);
        // "6:30 till 9" — a bare end hour before the start means 9pm, not
        // 9am the next day. Otherwise it genuinely runs past midnight.
        if (d <= 0 && !hit.end.isCertain('meridiem') && d + 720 > 0) d += 720;
        if (d <= 0) d += 1440;
        out.durationMin = d;
        meta.timeRange = true;
        meta.durationFrom = 'range';
      }
    }
  }

  // A start-to-end range beats a stated length: in "men's doubles for an
  // hour, then mixed, 3 to 6pm" the hour is one part of the evening.
  if (out.durationMin === undefined && statedDuration !== undefined) {
    out.durationMin = statedDuration;
    meta.durationFrom = statedWithFor ? 'for' : 'bare';
  }

  // Keep the key order stable for callers and tests.
  const { date, startTime, durationMin, courts: c, gameLenMin, playerCount } = out;
  return { out: Object.fromEntries(Object.entries({ date, startTime, durationMin, courts: c, gameLenMin, playerCount }).filter(([, v]) => v !== undefined)), meta };
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
  if (Number(ai.playerCount) > 0) o.playerCount = Number(ai.playerCount);
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

/* Segments from the model as clock times: [{ start, end, mode, courtModes:
   [{ court, mode }] }]. `mode` applies to every court in that part and
   courtModes overrides single courts ("court 1 mixed, court 2 men's").
   Clock times rather than minutes, because the model miscounts running
   totals ("a break every hour" drifted to 7:00, 8:15, …) but lists clock
   times reliably. Parts are sorted and clipped to the event, overlaps
   trimmed, gaps filled with open play, and neighbours with identical
   modes merged. Returns null when nothing usable was given. */
export function buildTimedSegments(raw, { startTime, durationMin, courts }) {
  if (!Array.isArray(raw) || !raw.length) return null;
  const start = toMin(startTime);
  // Minutes from the event's start. A time shortly before the start (e.g.
  // 17:30 for an 18:00 event) comes out near 1440 and is clamped to 0.
  const off = hhmm => {
    if (!isClock(hhmm)) return null;
    const o = (toMin(hhmm) - start + 1440) % 1440;
    return o > durationMin && o > 1440 - 180 ? 0 : o;
  };
  const modesFor = (mode, courtModes) => {
    const out = {};
    for (let c = 1; c <= courts; c++) if (MODES.includes(mode) && mode !== 'open') out[c] = mode;
    (Array.isArray(courtModes) ? courtModes : []).forEach(cm => {
      const c = Math.round(Number(cm && cm.court));
      if (c >= 1 && c <= courts && MODES.includes(cm.mode)) { if (cm.mode === 'open') delete out[c]; else out[c] = cm.mode; }
    });
    return out;
  };
  const parts = raw
    .map(s => {
      const a = off(s && s.start);
      let b = off(s && s.end);
      if (a === null || b === null) return null;
      if (b === 0 && a > 0) b = 1440; // an end at the event's start time means "until midnight-ish" wrap
      return { a, b: Math.min(b, durationMin), modes: modesFor(s.mode, s.courtModes) };
    })
    .filter(p => p && p.a < durationMin && p.b > p.a)
    .sort((x, y) => x.a - y.a);
  if (!parts.length) return null;
  const clockAt = o => toClock(start + o);
  const out = [];
  let cursor = 0;
  for (const p of parts) {
    const a = Math.max(p.a, cursor);
    if (p.b <= a) continue;
    if (a > cursor) out.push({ start: clockAt(cursor), end: clockAt(a), modes: {} });
    out.push({ start: clockAt(a), end: clockAt(p.b), modes: p.modes });
    cursor = p.b;
  }
  if (cursor < durationMin) out.push({ start: clockAt(cursor), end: clockAt(durationMin), modes: {} });
  return out.reduce((acc, s) => {
    const prev = acc[acc.length - 1];
    if (prev && JSON.stringify(prev.modes) === JSON.stringify(s.modes)) prev.end = s.end;
    else acc.push(s);
    return acc;
  }, []);
}

/* The model's segments, either as clock-time parts (current) or as
   lengths (older replies) — null if there's nothing usable. */
function segmentsFromModel(raw, ev) {
  if (!Array.isArray(raw) || !raw.length) return null;
  if (raw.some(s => s && isClock(s.start))) return buildTimedSegments(raw, ev);
  if (raw.some(s => s && s.minutes !== undefined)) return buildSegmentsByLength(raw, ev);
  return null;
}
const buildSegmentsByLength = (raw, ev) => buildSegments(raw, ev);

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
  // "What's the weather tomorrow" has a date in it, but it isn't an event.
  // When the model says so, that's final. (Without the model — AI down —
  // anything with a date or number still counts.)
  if (ai && ai.isEvent === false) return null;
  const today = opts.now ? opts.now.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const fromText = extractFromText(text, opts);
  const model = fromModel(ai);
  // The model sometimes guesses the wrong year for named days ("Christmas
  // Eve"). Events are planned ahead, so a past date means the next one.
  if (model.date && model.date < today) {
    const sameDay = `${today.slice(0, 4)}${model.date.slice(4)}`;
    const next = sameDay >= today ? sameDay : `${Number(today.slice(0, 4)) + 1}${model.date.slice(4)}`;
    model.date = isDate(next) ? next : undefined;
  }
  const pick = key => (fromText[key] !== undefined ? fromText[key] : model[key]);

  const filled = [];
  const take = (key, fallback) => {
    const v = pick(key);
    if (v === undefined) return fallback;
    filled.push(key);
    return v;
  };

  const date = take('date', today);
  const startTime = take('startTime', DEFAULTS.startTime);
  const durationMin = clamp(take('durationMin', DEFAULTS.durationMin), LIMITS.durationMin);
  const gameLenMin = clamp(take('gameLenMin', DEFAULTS.gameLenMin), LIMITS.gameLenMin);
  let name = model.name;
  if (name) filled.push('name');
  else name = defaultName(filled.includes('date') ? date : null, startTime);

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

  /* Courts: as stated; otherwise worked out from how many are playing —
     4 to a court, rounded down, since a court needs 4 and anyone extra
     rotates in (10 players → 2 courts). The count is a stated number ("8
     players"), else everyone in the group, else the named players when
     at least 4 are named (a couple of names alone says little about the
     turnout). Otherwise the usual default. */
  let courts = pick('courts');
  let courtsFrom = null;
  if (courts !== undefined) filled.push('courts');
  else {
    const named = memberIds.length + unmatchedNames.length;
    const count = pick('playerCount') || (model.inviteEveryone ? players.length : named >= 4 ? named : 0);
    if (count >= 4) { courts = Math.floor(count / 4); courtsFrom = count; filled.push('courts'); }
    else courts = DEFAULTS.courts;
  }
  courts = clamp(courts, LIMITS.courts);

  const planned = segmentsFromModel(model.segments, { startTime, durationMin, courts });
  const hasSegments = !!planned && planned.some(s => Object.keys(s.modes).length);
  if (hasSegments) filled.push('segments');
  const segments = hasSegments ? planned : buildSegments([], { startTime, durationMin, courts });

  if (!filled.length) return null;
  return { draft: { name, date, startTime, durationMin, courts, gameLenMin, segments, memberIds }, filled, unmatchedNames, courtsFrom };
}

/* ===================== EDITING AN EXISTING EVENT =====================
   "Move it to 7pm", "add a court", "mixed for the last hour", "add Sam,
   drop Ben". The model sees the event as it is now and says what should
   change; code then checks every value the same way as for a new event
   and keeps only real changes. Returns { changes, summary, unmatchedNames }
   or null when nothing in the message changes the event.

   changes: { name?, date?, startTime?, durationMin?, courts?, gameLenMin?,
   segments?, addIds?, removeIds? } — segments are laid out for the event's
   new start and length, like a new event's. */
const RELATIVE_COURTS = /\b(add(ing)?|another|more|extra|fewer|less|remove|drop|take away|lose|minus|plus)\b[^.;]*\bcourts?\b/i;

const fmtTime = hhmm => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}${m ? `:${pad(m)}` : ''}${h < 12 ? 'am' : 'pm'}`;
};
const fmtDay = ymd => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const MODE_WORDS = { open: 'any combination', men: "men's", women: "women's", mixed: 'mixed', break: 'break' };

const MENTIONS_DATE = /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\b(today|tonight|tomorrow|tmrw|yesterday|week|weekend|date|day|christmas|eve|holiday)\b|\d{1,2}(st|nd|rd|th)\b|\d{1,2}\/\d{1,2}/i;

/* "mixed" when every court is the same, else "court 1 mixed, court 2 any
   combination" — so the reply shows per-court setups as they are. */
export function describeModes(modes, courts) {
  const list = Array.from({ length: courts }, (_, i) => (modes && modes[i + 1]) || 'open');
  if (list.every(m => m === list[0])) return MODE_WORDS[list[0]];
  return list.map((m, i) => `court ${i + 1} ${MODE_WORDS[m]}`).join(', ');
}

export function buildEdit(text, ai, current, players, opts = {}) {
  if (ai && ai.understood === false && ai.isEvent === false) return null;
  if (ai) {
    /* The model sometimes repeats current values back, and a repeated end
       time next to a new start would silently change the length ("push it
       back an hour" became a 2-hour event). Drop anything equal to what the
       event already has, and a date change the message never asked for
       ("we only have 2 courts now" moved it to today). */
    const [h, m] = current.startTime.split(':').map(Number);
    const curEnd = toClock(h * 60 + m + current.durationMin);
    ai = { ...ai };
    if (ai.startTime === current.startTime) ai.startTime = '';
    if (ai.endTime === curEnd) ai.endTime = '';
    if (Number(ai.durationMin) === current.durationMin) ai.durationMin = 0;
    if (ai.date === current.date || !MENTIONS_DATE.test(text)) ai.date = '';
    if (Number(ai.courts) === current.courts) ai.courts = 0;
    if (Number(ai.gameLenMin) === (current.gameLenMin || DEFAULTS.gameLenMin)) ai.gameLenMin = 0;
    if (ai.name === current.name) ai.name = '';
  }
  const today = opts.now ? opts.now.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const { out: fromText, meta } = readText(text, opts);
  // Trust only readings that can't be a relative change: a start–end range
  // (a lone "7pm" could be the start or the end), "for 3 hours" (a bare
  // "an hour" is often a shift), and a court count that isn't "add 2".
  if (!meta.timeRange) delete fromText.startTime;
  if (meta.durationFrom !== 'range' && meta.durationFrom !== 'for') delete fromText.durationMin;
  if (RELATIVE_COURTS.test(text)) delete fromText.courts;
  // In an edit, "court 2" says which court, not how many.
  if (meta.courtsFrom === 'numbers') delete fromText.courts;
  if (!MENTIONS_DATE.test(text)) delete fromText.date;
  const model = fromModel(ai ? { ...ai, isEvent: true } : null);
  if (model.date && model.date < today) {
    const sameDay = `${today.slice(0, 4)}${model.date.slice(4)}`;
    const next = sameDay >= today ? sameDay : `${Number(today.slice(0, 4)) + 1}${model.date.slice(4)}`;
    model.date = isDate(next) ? next : undefined;
  }
  const pick = key => (fromText[key] !== undefined ? fromText[key] : model[key]);

  const next = {
    name: model.name || current.name,
    date: pick('date') || current.date,
    startTime: pick('startTime') || current.startTime,
    durationMin: clamp(pick('durationMin') || current.durationMin, LIMITS.durationMin),
    courts: pick('courts'),
    gameLenMin: clamp(pick('gameLenMin') || current.gameLenMin || DEFAULTS.gameLenMin, LIMITS.gameLenMin),
  };
  // "End at 11": a new end time keeps the start and changes the length.
  if (fromText.durationMin === undefined && ai && Number(ai.durationMin) <= 0 && isClock(ai.endTime)) {
    let d = toMin(ai.endTime) - toMin(next.startTime);
    if (d <= 0) d += 1440;
    next.durationMin = clamp(d, LIMITS.durationMin);
  }
  if (next.courts === undefined) {
    const count = pick('playerCount');
    next.courts = count >= 4 ? Math.floor(count / 4) : current.courts;
  }
  next.courts = clamp(next.courts, LIMITS.courts);

  // Players: add from the whole group, remove from this event's members.
  const members = new Set(current.memberIds || []);
  const addIds = [], removeIds = [], unmatchedNames = [];
  if (ai && ai.inviteEveryone === true) players.forEach(p => { if (!members.has(p.id)) addIds.push(p.id); });
  const addNames = Array.isArray(ai && ai.addPlayers) ? ai.addPlayers.filter(n => typeof n === 'string' && n.trim()) : [];
  const removeNames = Array.isArray(ai && ai.removePlayers) ? ai.removePlayers.filter(n => typeof n === 'string' && n.trim()) : [];
  if (addNames.length) {
    const r = matchPlayers(addNames, players);
    r.matched.forEach(id => { if (!members.has(id) && !addIds.includes(id)) addIds.push(id); });
    unmatchedNames.push(...r.unmatched);
  }
  if (removeNames.length) {
    const r = matchPlayers(removeNames, players.filter(p => members.has(p.id)));
    removeIds.push(...r.matched);
    unmatchedNames.push(...r.unmatched);
  }

  const changes = {};
  const said = [];
  if (next.name !== current.name) { changes.name = next.name; said.push(`Renamed to "${next.name}"`); }
  if (next.date !== current.date) { changes.date = next.date; said.push(`Date ${fmtDay(current.date)} → ${fmtDay(next.date)}`); }
  if (next.startTime !== current.startTime) { changes.startTime = next.startTime; said.push(`Start ${fmtTime(current.startTime)} → ${fmtTime(next.startTime)}`); }
  if (next.durationMin !== current.durationMin) { changes.durationMin = next.durationMin; said.push(`Length ${current.durationMin} → ${next.durationMin} min`); }
  if (next.courts !== current.courts) { changes.courts = next.courts; said.push(`Courts ${current.courts} → ${next.courts}`); }
  if (next.gameLenMin !== (current.gameLenMin || DEFAULTS.gameLenMin)) { changes.gameLenMin = next.gameLenMin; said.push(`Games ${current.gameLenMin || DEFAULTS.gameLenMin} → ${next.gameLenMin} min`); }
  const hasSegments = Array.isArray(model.segments) && model.segments.length > 0;
  const buildSegments = (raw, ev) => segmentsFromModel(raw, ev) || buildSegmentsByLength(raw, ev);
  // The model may repeat the current format back; only a real change counts.
  const sameSegments = (a, b) => JSON.stringify((a || []).map(s => [s.start, s.end, s.modes || {}])) === JSON.stringify((b || []).map(s => [s.start, s.end, s.modes || {}]));
  const newSegments = hasSegments ? buildSegments(model.segments, next) : null;
  if (newSegments && !sameSegments(newSegments, current.segments)) {
    changes.segments = newSegments;
    said.push(`Play format: ${changes.segments.map(s => `${fmtTime(s.start)}–${fmtTime(s.end)} ${describeModes(s.modes, next.courts)}`).join('; ')}`);
  }
  const nameOf = id => (players.find(p => p.id === id) || {}).name;
  if (addIds.length) { changes.addIds = addIds; said.push(`Added ${addIds.map(nameOf).join(', ')}`); }
  if (removeIds.length) { changes.removeIds = removeIds; said.push(`Removed ${removeIds.map(nameOf).join(', ')}`); }

  // Nothing changed but names didn't match: say so rather than nothing.
  if (!said.length) return unmatchedNames.length ? { changes: {}, summary: '', unmatchedNames } : null;
  return { changes, summary: said.join(' · '), unmatchedNames };
}
