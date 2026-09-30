/* ===================== STORE =====================
   A single mutable state object plus a subscribe/notify pair — the same
   architecture the original web app used (module-level `state` + `render()`
   on every change), just swapping `render()` for `notify()`. Screens read
   it with the useStore() hook below (built on React's
   useSyncExternalStore), and call the exported action functions directly —
   there's no reducer/dispatch indirection, on purpose, to keep this as
   close as possible to the original app's logic so it was easy to port
   correctly.

   Persistence: the backend/ API + its SQLite database is the source of
   truth (shared across devices). Every mutation below still applies
   optimistically to the local `state` object exactly as before — no screen
   or action function had to change — and commit() pushes the full snapshot
   to the backend in the background. AsyncStorage is kept as an offline
   cache: hydrate() prefers the backend but falls back to it (and to it
   alone) when the backend can't be reached, so the app still works with no
   server running. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { useSyncExternalStore, useMemo } from 'react';
import {
  uid, ensureMembers, getConfirmedAndWaitlist, generateRoster,
  recomputeFromCurrentRound, recomputeFrom, applyRoundHistory, reconcileBookingPlan,
  toOffset, offsetToClock, GAME_LEN, gameLen, segmentGameLen, localDateStr, isBreakSegment, segmentsWithBreak, eventOptions,
  resultsDriven,
} from './engine';
import { computeStandings } from './standings';
import { formatOptions, normalizeOptions } from './formats';
import { buildBracket, resolvePlayoffs, playoffEntrants, pairsPlayed, playoffMatchLocked } from './playoffs';
import { nextSessionFields, seasonStandings } from './series';
import { fetchState, pushState } from './api';

const STORAGE_KEY = 'thepickleslot/state/v1';
const LEGACY_STORAGE_KEY = 'courtside/state/v1';

function defaultState() {
  return { players: [], events: [], currentEventId: null, history: {}, flagThreshold: 3, chats: [] };
}

let state = defaultState();
let hydrated = false;
let version = 0;
const listeners = new Set();

/* `state` is mutated in place (matching the original web app's imperative
   style), so a mutated object keeps the same reference — plain
   useSyncExternalStore would miss that as "no change". A monotonically
   increasing version number is what's actually subscribed to; useStore()
   below re-derives the selector's value with useMemo only when it ticks. */
function notify() { version++; listeners.forEach(l => l()); }
let saveTimer = null;
/* Live sync: every local change bumps mutationSeq; a server answer (the
   PUT's reply, or a poll) is only applied when nothing changed locally
   since it was asked for and no save is waiting or in flight — so it can
   never undo an edit. */
let mutationSeq = 0;
let inFlight = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(e => console.warn('local cache save failed', e));
    const seq = mutationSeq;
    inFlight++;
    pushState(state)
      .then(remote => { inFlight--; if (seq === mutationSeq && !saveTimer && !inFlight) applyRemote(remote); })
      .catch(e => { inFlight--; console.warn('backend save failed (offline?)', e); });
  }, 150);
}
function commit() { mutationSeq++; persist(); notify(); }

/* ---- Live sync: what others changed (scores, the host moving rounds on)
   shows up without reopening the app. ---- */
const roundListeners = new Set();
/* Called with { eventId, roundIndex, started, playoffs } when a published
   event moves to another round, starts games or starts playoffs — changes
   made on another phone (see components/RoundNotifier.js). */
export function onRoundChange(fn) { roundListeners.add(fn); return () => roundListeners.delete(fn); }
function roundChanges(before, after) {
  const out = [];
  after.events.forEach(e => {
    const b = before.events.find(x => x.id === e.id);
    if (!b || !e.published) return;
    const started = !b.started && !!e.started;
    if (started || (b.currentRoundIndex || 0) !== (e.currentRoundIndex || 0)) out.push({ eventId: e.id, roundIndex: e.currentRoundIndex || 0, started });
    if (!b.playoffs && e.playoffs) out.push({ eventId: e.id, playoffs: true });
  });
  return out;
}
function applyRemote(remote) {
  if (!remote || !Array.isArray(remote.events) || !Array.isArray(remote.players)) return;
  const next = { ...defaultState(), ...remote, currentEventId: state.currentEventId };
  if (!next.chats) next.chats = [];
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  const changes = roundChanges(state, next);
  // An event open in an edit session with no edits of its own yet: its
  // starting point follows the server, so leaving it asks nothing and
  // Cancel doesn't undo what others changed.
  if (flowSnapshot) {
    const id = flowSnapshot.event.id;
    const local = state.events.find(e => e.id === id);
    const fresh = next.events.find(e => e.id === id);
    if (local && fresh && JSON.stringify(local) === JSON.stringify(flowSnapshot.event)) {
      flowSnapshot = { event: JSON.parse(JSON.stringify(fresh)), history: JSON.parse(JSON.stringify(next.history)) };
    }
  }
  state = next;
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  notify();
  changes.forEach(c => roundListeners.forEach(l => { try { l(c); } catch (e) { console.warn(e); } }));
}
export async function refreshFromServer() {
  if (!hydrated || saveTimer || inFlight) return false;
  const seq = mutationSeq;
  let remote;
  try { remote = await fetchState(); } catch (e) { return false; }
  if (seq !== mutationSeq || saveTimer || inFlight) return false;
  applyRemote(remote);
  return true;
}
let syncTimer = null;
/* Polls the server while the app is in front (not in the background). */
export function startLiveSync(intervalMs = 8000) {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    if (AppState.currentState && AppState.currentState !== 'active') return;
    refreshFromServer();
  }, intervalMs);
}
export function stopLiveSync() { clearInterval(syncTimer); syncTimer = null; }

/* Falls back to the pre-rename storage key so nobody's existing local data
   disappears just because the app was renamed from Courtside — once loaded
   from there, the very next commit() persists it under the new key. */
async function hydrateFromCache() {
  try {
    let raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) raw = await AsyncStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { ...defaultState(), ...parsed };
      if (!state.chats) state.chats = [];
    }
  } catch (e) { console.warn('local cache load failed', e); }
}
export async function hydrate() {
  if (hydrated) return;
  try {
    const fromBackend = await fetchState();
    state = { ...defaultState(), ...fromBackend };
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  } catch (e) {
    console.warn('backend unreachable, falling back to local cache', e);
    await hydrateFromCache();
  }
  hydrated = true;
  notify();
}

export function useStore(selector) {
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => version,
    () => version,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => selector(state), [v]);
}
export function getState() { return state; }
export function isHydrated() { return hydrated; }

/* ---- Derived lookups ---- */
export function getEventById(id) { return state.events.find(e => e.id === id) || null; }
export function getPlayerById(id) { return state.players.find(p => p.id === id) || null; }
export function playerName(id) { const p = getPlayerById(id); return p ? p.name : '—'; }
export function playerGender(id) { const p = getPlayerById(id); return p ? p.gender : 'O'; }
export function playerNameGender(id) { const p = getPlayerById(id); return p ? `${p.name} (${p.gender})` : '—'; }

/* ===================== EVENT CRUD ===================== */
export function newEvent(details) {
  const d = details || {};
  const startTime = d.startTime || '18:00';
  const durationMin = Math.max(1, parseInt(d.durationMin, 10) || 240);
  const ev = {
    id: uid(), name: (d.name && d.name.trim()) || 'Tuesday Night',
    date: d.date || localDateStr(),
    startTime, durationMin, courts: Math.max(1, parseInt(d.courts, 10) || 4),
    gameLenMin: Math.max(1, parseInt(d.gameLenMin, 10) || GAME_LEN),
    courtNames: {},
    segments: [], rsvps: {}, bookingSlots: [], roster: null, noShows: [], currentRoundIndex: 0, published: false,
    memberIds: Array.isArray(d.memberIds) ? d.memberIds.filter(id => state.players.some(p => p.id === id)) : [],
    createdBy: d.createdBy || null,
    // The assistant chat that created it (see appendAiMessages).
    aiMessages: Array.isArray(d.aiMessages) ? d.aiMessages.slice(-AI_MESSAGE_LIMIT) : [],
  };
  /* segmentPlan ([{minutes, modes}], from "describe your event") is laid
     out from the start time as it is now — the user may have changed the
     time or length after the description filled them in. */
  const plan = Array.isArray(d.segmentPlan) ? d.segmentPlan.filter(s => s && s.minutes > 0) : [];
  if (plan.length > 1 || (plan.length === 1 && Object.keys(plan[0].modes || {}).length)) {
    let cursor = 0;
    ev.segments = plan.map(s => {
      const seg = { start: offsetToClock(ev, cursor), end: offsetToClock(ev, Math.min(durationMin, cursor + s.minutes)), modes: { ...(s.modes || {}) } };
      cursor += s.minutes;
      return seg;
    }).filter((s, i) => i === 0 || toOffset(ev, s.start) < durationMin);
    // Drop modes for courts that no longer exist.
    ev.segments.forEach(s => Object.keys(s.modes).forEach(c => { if (Number(c) > ev.courts) delete s.modes[c]; }));
    normalizeSegments(ev);
  } else {
    ev.segments = [{ start: startTime, end: offsetToClock(ev, durationMin), modes: {} }];
  }
  state.events.push(ev);
  state.currentEventId = ev.id;
  commit();
  return ev;
}
/* ===================== ASSISTANT CHAT (per event) =====================
   Each event keeps its assistant conversation: the description that
   created it, then every change asked for, each as its own message. It's
   part of the event, so it syncs with it, and Cancel undoes it along with
   the changes. Only the most recent messages are kept. */
const AI_MESSAGE_LIMIT = 60;
export function aiMessage(role, text, extra) {
  return { id: uid(), role, text, ts: Date.now(), ...(extra || {}) };
}
export function appendAiMessages(ev, messages) {
  ev.aiMessages = [...(ev.aiMessages || []), ...messages].slice(-AI_MESSAGE_LIMIT);
  commit();
}
/* Applies a checked change from the assistant (backend-worker/src/
   aiEdit.js) through the same functions as editing Setup by hand, so
   segments, rosters and RSVPs stay consistent exactly as they do there. */
export function applyAiEdit(ev, changes) {
  const c = changes || {};
  if (c.name !== undefined) updateEventField(ev, 'name', c.name);
  if (c.date !== undefined) updateEventField(ev, 'date', c.date);
  if (c.startTime !== undefined) updateEventField(ev, 'startTime', c.startTime);
  if (c.durationMin !== undefined) updateEventField(ev, 'durationMin', c.durationMin);
  if (c.gameLenMin !== undefined) updateEventField(ev, 'gameLenMin', c.gameLenMin);
  if (c.courts !== undefined) updateEventField(ev, 'courts', c.courts);
  if (Array.isArray(c.segments) && c.segments.length) {
    ev.segments = c.segments.map(s => ({ start: s.start, end: s.end, modes: { ...(s.modes || {}) } }));
    normalizeSegments(ev);
    refreshRoster(ev);
    commit();
  }
  (c.addIds || []).forEach(id => { if (getPlayerById(id)) addPlayerToEvent(ev, id); });
  (c.removeIds || []).forEach(id => removePlayerFromEvent(ev, id));
}
export function deleteEvent(id) {
  state.events = state.events.filter(e => e.id !== id);
  if (state.currentEventId === id) state.currentEventId = state.events.length ? state.events[0].id : null;
  commit();
}
/* Round timing changed (event/segment game length, duration): rebuild the
   roster the same way a player change does — only rounds not yet played
   are touched once it's published. */
function refreshRoster(ev) {
  if (!ev.roster) return;
  if (ev.published) recomputeFromCurrentRound(ev, state.history, state.players);
  else { ev.roster = generateRoster(ev, state.history, 0, state.players); ev.currentRoundIndex = 0; }
}
export function updateEventField(ev, field, value) {
  if (['durationMin', 'courts', 'gameLenMin'].includes(field)) value = Math.max(1, parseInt(value) || 1);
  const changed = ev[field] !== value;
  ev[field] = value;
  if (field === 'startTime' || field === 'durationMin' || field === 'gameLenMin') normalizeSegments(ev);
  if (changed && (field === 'durationMin' || field === 'gameLenMin')) refreshRoster(ev);
  commit();
}
/* ---- Event options (lib/engine.js DEFAULT_OPTIONS; lib/formats.js). ----
   Options that change how rounds are made rebuild the roster the same way
   any other setup change does (rounds already played are kept). */
const ROSTER_OPTIONS = ['seeding', 'seedOrder', 'reseed', 'groups', 'movement', 'partners', 'pairs', 'games', 'extras'];
const DATA_OPTIONS = ['seedOrder', 'pairs', 'playoffTeams', 'thirdPlace', 'playoffSeedFrom'];
function applyOptions(ev, next) {
  const before = eventOptions(ev);
  ev.options = next;
  if (next.repeat !== 'none' && !ev.seriesId) ev.seriesId = ev.id;
  if (next.repeat === 'none' && ev.seriesId === ev.id && !state.events.some(e => e.id !== ev.id && e.seriesId === ev.id)) delete ev.seriesId;
  if (ROSTER_OPTIONS.some(k => JSON.stringify(before[k]) !== JSON.stringify(next[k]))) refreshRoster(ev);
  commit();
}
export function setEventOption(ev, key, value) {
  const cur = eventOptions(ev);
  const custom = key === 'format' || DATA_OPTIONS.includes(key) ? {} : { format: 'custom' };
  applyOptions(ev, normalizeOptions({ ...cur, [key]: value, ...custom }));
}
/* A named format (lib/formats.js FORMATS) fills in all the options. */
export function applyFormat(ev, key) {
  applyOptions(ev, normalizeOptions(formatOptions(ev, key)));
}
/* The players an option list is about: everyone coming (incl. waitlist). */
function comingIds(ev) {
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, state.players);
  return [...confirmed, ...waitlist];
}
const duprOf = id => { const p = getPlayerById(id); const n = p ? Number(p.dupr) : NaN; return Number.isFinite(n) && n > 0 ? n : -1; };
/* Seeding order for "Manual order": the saved order (players no longer
   coming dropped), then everyone else coming, best DUPR first. */
export function seedList(ev) {
  const coming = comingIds(ev);
  const saved = (eventOptions(ev).seedOrder || []).filter(id => coming.includes(id));
  const rest = coming.filter(id => !saved.includes(id)).sort((a, b) => duprOf(b) - duprOf(a));
  return [...saved, ...rest];
}
export function moveSeed(ev, id, delta) {
  const list = seedList(ev);
  const i = list.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  setEventOption(ev, 'seedOrder', list);
}
/* Fixed pairs. */
export function pairPlayers(ev, a, b) {
  if (!a || !b || a === b) return;
  const pairs = (eventOptions(ev).pairs || []).filter(p => !p.includes(a) && !p.includes(b));
  setEventOption(ev, 'pairs', [...pairs, [a, b]]);
}
export function unpair(ev, index) {
  setEventOption(ev, 'pairs', (eventOptions(ev).pairs || []).filter((_, i) => i !== index));
}
/* Pairs everyone coming who isn't paired yet: 'balanced' puts the best
   DUPR with the lowest, 'rsvp' pairs in the order people said yes. */
export function autoPair(ev, how = 'balanced') {
  const coming = comingIds(ev);
  const pairs = (eventOptions(ev).pairs || []).filter(p => p.every(id => coming.includes(id)));
  const taken = new Set(pairs.flat());
  let loose = coming.filter(id => !taken.has(id));
  if (how === 'balanced') {
    loose = [...loose].sort((a, b) => duprOf(b) - duprOf(a));
    while (loose.length >= 2) pairs.push([loose.shift(), loose.pop()]);
  } else {
    for (let i = 0; i + 1 < loose.length; i += 2) pairs.push([loose[i], loose[i + 1]]);
  }
  setEventOption(ev, 'pairs', pairs);
}
/* Blank, or the same as the event's game length, means "inherit" — so a
   later change to the event's game length still flows into this segment. */
export function setSwitchAfterWarmup(ev, value) {
  ev.switchAfterWarmup = !!value;
  refreshRoster(ev);
  commit();
}
export function updateSegmentGameLen(ev, idx, value) {
  const seg = ev.segments[idx];
  if (!seg) return;
  const before = segmentGameLen(ev, seg);
  const v = parseInt(value, 10);
  if (!v || v === gameLen(ev)) delete seg.gameLenMin;
  else seg.gameLenMin = Math.max(1, v);
  if (segmentGameLen(ev, seg) !== before) refreshRoster(ev);
  commit();
}
export function updateCourtName(ev, courtNum, name) {
  if (!ev.courtNames) ev.courtNames = {};
  const trimmed = (name || '').trim();
  if (trimmed) ev.courtNames[courtNum] = trimmed; else delete ev.courtNames[courtNum];
  commit();
}
/* Names live on each booking slot, not the court number: back-to-back
   2-hour bookings for "court 1" are often on different physical courts at
   the club. Older events stored one name per court number in courtNames —
   the first rename on such a court copies that name onto its other slots
   so they keep it, then drops the shared entry. */
export function updateSlotName(ev, slotId, name) {
  const slot = (ev.bookingSlots || []).find(s => s.id === slotId);
  if (!slot) return;
  const legacy = ev.courtNames && ev.courtNames[slot.court];
  if (legacy) {
    ev.bookingSlots.forEach(s => { if (s.court === slot.court && !s.name) s.name = legacy; });
    delete ev.courtNames[slot.court];
  }
  const trimmed = (name || '').trim();
  if (trimmed) slot.name = trimmed; else delete slot.name;
  commit();
}
export function slotLabel(ev, slot) {
  return slot.name || courtLabel(ev, slot.court);
}
/* Every name a court number goes by across a time range (a segment can
   span back-to-back bookings on different physical courts). */
export function courtLabelForRange(ev, courtNum, startOffset, endOffset) {
  const names = [];
  (ev.bookingSlots || [])
    .filter(s => s.court === courtNum && s.start < endOffset && s.end > startOffset)
    .sort((a, b) => a.start - b.start)
    .forEach(s => { const n = slotLabel(ev, s); if (!names.includes(n)) names.push(n); });
  return names.length ? names.join(' / ') : courtLabel(ev, courtNum);
}
/* With an offset (minutes into the event), resolves the name of whichever
   booking slot covers that court at that time. */
export function courtLabel(ev, courtNum, offset) {
  if (offset != null) {
    const slot = (ev.bookingSlots || []).find(s => s.court === courtNum && s.name && s.start <= offset && offset < s.end);
    if (slot) return slot.name;
  }
  return (ev.courtNames && ev.courtNames[courtNum]) || `Court ${courtNum}`;
}

/* ---- Segments: always a contiguous, non-overlapping partition of the
   event's full duration. Editing only ever moves a shared boundary,
   clamped so every segment keeps at least one game-length of room. ---- */
export function normalizeSegments(ev) {
  if (!ev.segments || ev.segments.length === 0) {
    ev.segments = [{ start: ev.startTime, end: offsetToClock(ev, ev.durationMin), modes: {} }];
    return;
  }
  const endOffset = ev.durationMin;
  const step = gameLen(ev);
  /* A segment is at least one game long — except a break on every court,
     which holds no games and may be as short as 5 minutes (a 15-minute
     break with 20-minute games used to be stretched to 20). */
  const minLen = s => (isBreakSegment(ev, s) ? Math.min(5, step) : step);
  let cursor = 0;
  ev.segments.forEach((s, i) => {
    s.start = offsetToClock(ev, cursor);
    if (i === ev.segments.length - 1) {
      s.end = offsetToClock(ev, endOffset);
    } else {
      const minEnd = cursor + minLen(s);
      const maxEnd = endOffset - ev.segments.slice(i + 1).reduce((n, later) => n + minLen(later), 0);
      let segEndOffset = toOffset(ev, s.end);
      if (!Number.isFinite(segEndOffset)) segEndOffset = minEnd;
      segEndOffset = Math.max(minEnd, Math.min(maxEnd, segEndOffset));
      s.end = offsetToClock(ev, segEndOffset);
    }
    cursor = toOffset(ev, s.end);
    if (!s.modes) s.modes = {};
  });
}
export function addSegment(ev) {
  normalizeSegments(ev);
  const step = gameLen(ev);
  const last = ev.segments[ev.segments.length - 1];
  const lastStartOff = toOffset(ev, last.start);
  const endOff = ev.durationMin;
  if (endOff - lastStartOff < 2 * step) return { error: `Not enough time left in the last segment to split it — each segment needs at least ${step} minutes.` };
  const rawMid = lastStartOff + Math.round(((endOff - lastStartOff) / 2) / step) * step;
  const mid = Math.max(lastStartOff + step, Math.min(endOff - step, rawMid));
  last.end = offsetToClock(ev, mid);
  ev.segments.push({ start: offsetToClock(ev, mid), end: offsetToClock(ev, endOff), modes: {} });
  normalizeSegments(ev);
  commit();
  return { error: null };
}
export function removeSegment(ev, idx) {
  if (ev.segments.length <= 1) return { error: 'At least one segment is required to cover the whole event.' };
  ev.segments.splice(idx, 1);
  normalizeSegments(ev);
  commit();
  return { error: null };
}
/* Inserts a break (every court on break) from startOff for `minutes`,
   carving it out of whatever segments it overlaps; the parts before and
   after keep their segments' modes. A game piece left shorter than one
   game is folded into its neighbour rather than squeezed. */
export function addBreak(ev, startOff, minutes) {
  normalizeSegments(ev);
  const segments = segmentsWithBreak(ev, startOff, minutes);
  if (!segments) return { error: 'Choose when the break starts and how long it lasts.' };
  ev.segments = segments;
  normalizeSegments(ev);
  refreshRoster(ev);
  commit();
  return { error: null };
}
export function updateSegment(ev, idx, field, value) {
  if (field === 'end') ev.segments[idx].end = value;
  normalizeSegments(ev);
  commit();
}
export function updateSegmentMode(ev, idx, court, mode) {
  if (!ev.segments[idx].modes) ev.segments[idx].modes = {};
  ev.segments[idx].modes[court] = mode;
  commit();
}

/* ===================== PLAYERS (standalone list) ===================== */
export function addPlayer(name, gender) {
  if (!name || !name.trim()) return null;
  const p = { id: uid(), name: name.trim(), gender };
  state.players.push(p);
  commit();
  return p;
}
export function upsertAccountPlayer(account) {
  if (!account || !account.id) return;
  const p = getPlayerById(account.id);
  if (p) {
    if (p.claimed) return;
    p.claimed = true;
  } else {
    state.players.push({ id: account.id, name: account.name, gender: account.gender, claimed: true });
  }
  commit();
}
/* A player's DUPR doubles rating, typed in (2.000–8.000; empty clears it).
   Used to seed players; not synced with DUPR. */
export function setPlayerDupr(id, value) {
  const p = getPlayerById(id);
  if (!p) return { error: null };
  const text = String(value == null ? '' : value).trim();
  if (!text) { delete p.dupr; commit(); return { error: null }; }
  const n = Number(text);
  if (!Number.isFinite(n) || n < 2 || n > 8) return { error: 'A DUPR rating is a number from 2.000 to 8.000.' };
  p.dupr = Math.round(n * 1000) / 1000;
  commit();
  return { error: null };
}
export function editPlayer(id, name, gender) {
  const p = getPlayerById(id);
  if (!p) return;
  const newName = (name || '').trim();
  if (!newName) return;
  p.name = newName;
  if (gender) p.gender = gender;
  commit();
}
export function affectedEventsForPlayer(id) {
  return state.events.filter(ev => { ensureMembers(ev, state.players); return ev.memberIds.includes(id); });
}
/* Deleting a player here is the ONLY thing that removes them from the
   standalone list — and it cascades everywhere they were a member. */
export function deletePlayerEverywhere(id) {
  state.players = state.players.filter(p => p.id !== id);
  state.events.forEach(ev => {
    ensureMembers(ev, state.players);
    if (!ev.memberIds.includes(id)) return;
    ev.memberIds = ev.memberIds.filter(pid => pid !== id);
    delete ev.rsvps[id];
    ev.noShows = (ev.noShows || []).filter(pid => pid !== id);
    (ev.bookingSlots || []).forEach(s => { if (s.claimedBy === id) { s.claimedBy = null; s.status = 'open'; } });
    if (ev.roster) {
      if (ev.published) recomputeFromCurrentRound(ev, state.history, state.players);
      else { ev.roster = generateRoster(ev, state.history, 0, state.players); ev.currentRoundIndex = 0; }
    }
  });
  commit();
}

/* ---- Event membership: adding/removing a player from ONE event, never
   the standalone Players list. ---- */
export function addPlayerToEvent(ev, playerId) {
  ensureMembers(ev, state.players);
  if (!ev.memberIds.includes(playerId)) ev.memberIds.push(playerId);
  commit();
}
/* Two kinds of player share state.players:
   - account players (claimed: true) — real people who claimed an invite;
     these are the Players tab, and any event can add them;
   - event players (unclaimed) — names a host types into one event's Setup.
     They're only a stand-in until someone claims them from the RSVP invite
     link, at which point the same record becomes an account player. */
export function addAllPlayersToEvent(ev) {
  ensureMembers(ev, state.players);
  state.players.forEach(p => { if (p.claimed && !ev.memberIds.includes(p.id)) ev.memberIds.push(p.id); });
  commit();
}
/* The Setup bin: an account player is only taken out of this event; an
   event player that no other event uses is deleted outright. */
export function removeEventPlayer(ev, playerId) {
  const p = getPlayerById(playerId);
  const usedElsewhere = state.events.some(e => e.id !== ev.id && (e.memberIds || []).includes(playerId));
  if (p && !p.claimed && !usedElsewhere) deletePlayerEverywhere(playerId);
  else removePlayerFromEvent(ev, playerId);
}
export function removePlayerFromEvent(ev, playerId) {
  ensureMembers(ev, state.players);
  ev.memberIds = ev.memberIds.filter(id => id !== playerId);
  delete ev.rsvps[playerId];
  ev.noShows = (ev.noShows || []).filter(id => id !== playerId);
  (ev.bookingSlots || []).forEach(s => { if (s.claimedBy === playerId) { s.claimedBy = null; s.status = 'open'; } });
  if (ev.roster) {
    if (ev.published) recomputeFromCurrentRound(ev, state.history, state.players);
    else { ev.roster = generateRoster(ev, state.history, 0, state.players); ev.currentRoundIndex = 0; }
  }
  commit();
}
export function addNewPlayerToEvent(ev, name, gender) {
  if (!name || !name.trim()) return null;
  ensureMembers(ev, state.players);
  const p = { id: uid(), name: name.trim(), gender: gender || 'M' };
  state.players.push(p);
  ev.memberIds.push(p.id);
  commit();
  return p;
}

/* ===================== RSVP ===================== */
export function setRsvp(ev, playerId, status) {
  const prev = ev.rsvps[playerId];
  const prevStatus = prev ? prev.status : null;
  const wasActive = prev && (prev.status === 'in' || prev.status === 'partial');
  const nowActive = status === 'in' || status === 'partial';
  const rec = prev || { start: 0, end: ev.durationMin, ts: Date.now() };
  rec.status = status;
  if (nowActive && !wasActive) rec.ts = Date.now();
  if (status === 'in') { rec.start = 0; rec.end = ev.durationMin; }
  if (status === 'partial' && (!prev || prev.status !== 'partial')) { rec.start = 0; rec.end = ev.durationMin; }
  ev.rsvps[playerId] = rec;
  if (status === 'out') { if (!ev.noShows) ev.noShows = []; if (!ev.noShows.includes(playerId)) ev.noShows.push(playerId); }
  else { ev.noShows = (ev.noShows || []).filter(id => id !== playerId); }
  if (ev.published && ev.roster && prevStatus !== status) recomputeFromCurrentRound(ev, state.history, state.players);
  commit();
}
export function setRsvpTime(ev, playerId, which, clock) {
  const rec = ev.rsvps[playerId]; if (!rec) return;
  const step = gameLen(ev);
  const off = toOffset(ev, clock);
  const prevStart = rec.start, prevEnd = rec.end;
  if (which === 'start') {
    rec.start = Math.max(0, Math.min(off, ev.durationMin - step));
    if (rec.end <= rec.start) rec.end = Math.min(ev.durationMin, rec.start + step);
  } else {
    rec.end = Math.max(step, Math.min(off, ev.durationMin));
    if (rec.start >= rec.end) rec.start = Math.max(0, rec.end - step);
  }
  if (ev.published && ev.roster && (rec.start !== prevStart || rec.end !== prevEnd)) recomputeFromCurrentRound(ev, state.history, state.players);
  commit();
}
export function playerDropsOut(ev, playerId) { setRsvp(ev, playerId, 'out'); }
/* Host check-in on the day. "Here" confirms a player (and brings back one
   marked out — a late arrival); "Not here" marks them out through the same
   path as a no-show, so the rounds not yet played are recomputed exactly as
   before. The confirmations themselves are kept for the host's list. */
export function checkInPlayer(ev, playerId, here) {
  ev.checkedIn = { ...(ev.checkedIn || {}), [playerId]: !!here };
  const isOut = (ev.noShows || []).includes(playerId);
  if (here && isOut) return setRsvp(ev, playerId, 'in');
  if (!here && !isOut) return setRsvp(ev, playerId, 'out');
  commit();
}
export function bringBackPlayer(ev, playerId) { setRsvp(ev, playerId, 'in'); }

/* ===================== BOOKING ===================== */
export function recalcBooking(ev) { reconcileBookingPlan(ev, state.players); commit(); }
export function claimSlot(ev, slotId, playerId) {
  const s = ev.bookingSlots.find(x => x.id === slotId);
  s.claimedBy = playerId; s.status = 'claimed'; commit();
}
export function confirmSlot(ev, slotId) {
  const s = ev.bookingSlots.find(x => x.id === slotId);
  s.status = 'confirmed'; commit();
}
export function releaseSlot(ev, slotId) {
  const s = ev.bookingSlots.find(x => x.id === slotId);
  s.claimedBy = null; s.status = 'open'; commit();
}

/* ===================== ROSTER ===================== */
export function previewRoster(ev) {
  if (ev.published) recomputeFromCurrentRound(ev, state.history, state.players);
  else { ev.roster = generateRoster(ev, state.history, 0, state.players); ev.currentRoundIndex = 0; }
  commit();
}
export function publishRoster(ev) {
  if (!ev.roster) ev.roster = generateRoster(ev, state.history, 0, state.players);
  if (!ev.published) {
    ev.roster.forEach(r => applyRoundHistory(state.history, r, 1));
    ev.published = true; ev.currentRoundIndex = 0;
  }
  commit();
}
/* Once games start, everything that shapes the event (setup, RSVPs, courts,
   roster, no-shows) is frozen — only scores stay editable. */
export function startGames(ev) {
  ev.started = true;
  ev.startedAt = Date.now();
  commit();
}
export function stopGames(ev) {
  ev.started = false;
  delete ev.startedAt;
  commit();
}
/* Moving on in a results-driven event (re-seeding, movement) makes the new
   round from the latest scores — unless it already has scores (the host
   went back and forward again). */
export function advanceRound(ev, delta) {
  const n = ev.roster.length;
  const cur = ev.currentRoundIndex || 0;
  const next = Math.max(0, Math.min(n - 1, cur + delta));
  ev.currentRoundIndex = next;
  const scored = r => (r.courts || []).some(c => c.scoreA != null || c.scoreB != null);
  if (next > cur && ev.published && resultsDriven(ev) && !scored(ev.roster[next])) recomputeFrom(ev, next, state.history, state.players);
  commit();
}
/* A score, stamped with when it was entered: the server keeps the newest
   of two phones' scores for the same game. In a results-driven event the
   rounds after the current one are remade as scores come in. */
export function setScore(ev, roundIdx, court, team, value) {
  const round = ev.roster[roundIdx]; if (!round) return;
  const c = round.courts.find(x => x.court === court); if (!c) return;
  const v = value === '' || value == null ? null : Math.max(0, parseInt(value) || 0);
  if (team === 'A') c.scoreA = v; else c.scoreB = v;
  c.scoredAt = Date.now();
  const cur = ev.currentRoundIndex || 0;
  if (ev.published && resultsDriven(ev) && roundIdx <= cur && ev.roster.length > cur + 1) recomputeFrom(ev, cur + 1, state.history, state.players);
  commit();
}

/* ===================== PLAYOFFS (lib/playoffs.js) ===================== */
export function playoffRows(ev) {
  const o = eventOptions(ev);
  const mode = o.standings === 'courtPoints' ? 'courtPoints' : 'winPct';
  if (o.playoffSeedFrom === 'season' && ev.seriesId) return seasonStandings(state.events, ev.seriesId, mode);
  return computeStandings(ev, mode, (ev.roster || []).length);
}
/* Ends pool play after the current round (rounds not yet played are
   dropped) and seeds the bracket from the standings. */
export function startPlayoffs(ev) {
  const o = eventOptions(ev);
  const seen = new Set();
  const pairs = [...(o.pairs || []), ...pairsPlayed(ev)].filter(p => { const k = [...p].sort().join('+'); if (seen.has(k)) return false; seen.add(k); return true; });
  const { size, teams } = playoffEntrants({ rows: playoffRows(ev), partners: o.partners, pairs, requested: o.playoffTeams });
  if (!size) return { error: 'Not enough results to seed a playoff yet — enter some scores first.' };
  const cur = ev.currentRoundIndex || 0;
  if (ev.roster) {
    if (ev.published) ev.roster.slice(cur + 1).forEach(r => applyRoundHistory(state.history, r, -1));
    ev.roster = ev.roster.slice(0, cur + 1);
  }
  const type = o.playoffs === 'double' && size >= 4 ? 'double' : 'single';
  ev.playoffs = { type, teams, matches: buildBracket(type, size, !!o.thirdPlace), startedAt: Date.now() };
  resolvePlayoffs(ev.playoffs);
  commit();
  return { error: null };
}
/* Back to pool play (only before any playoff score): the rounds left in the
   event are made again. */
export function undoPlayoffs(ev) {
  if (!ev.playoffs) return { error: null };
  if (ev.playoffs.matches.some(m => m.scoreA != null || m.scoreB != null)) return { error: 'Playoff scores have been entered — clear them first.' };
  delete ev.playoffs;
  if (ev.roster && ev.published) recomputeFrom(ev, (ev.currentRoundIndex || 0) + 1, state.history, state.players);
  commit();
  return { error: null };
}
export function setPlayoffScore(ev, matchId, team, value) {
  const p = ev.playoffs; if (!p) return;
  const m = p.matches.find(x => x.id === matchId); if (!m || playoffMatchLocked(p, matchId)) return;
  const v = value === '' || value == null ? null : Math.max(0, parseInt(value) || 0);
  if (team === 'A') m.scoreA = v; else m.scoreB = v;
  m.scoredAt = Date.now();
  resolvePlayoffs(p);
  commit();
}

/* ===================== SERIES (lib/series.js) ===================== */
export function nextSessionOf(ev) {
  const sid = ev.seriesId || ev.id;
  return state.events.filter(e => e.id !== ev.id && e.seriesId === sid && e.date > ev.date).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}
/* Schedules the next session of a league or ladder a week later. */
export function scheduleNextSession(ev, createdBy) {
  const existing = nextSessionOf(ev);
  if (existing) return existing;
  const f = nextSessionFields(ev);
  ev.seriesId = f.seriesId;
  const next = {
    id: uid(), ...f, rsvps: {}, bookingSlots: [], roster: null, noShows: [], currentRoundIndex: 0, published: false,
    createdBy: createdBy || ev.createdBy || null, aiMessages: [],
  };
  state.events.push(next);
  commit();
  return next;
}

/* ===================== EVENT EDIT FLOW (Cancel/Save rollback) =====================
   Snapshot lives outside `state` on purpose, mirroring the original app —
   it's session scaffolding for the screen, not data to persist. */
let flowSnapshot = null;
let flowIsNew = false;

export function beginNewEventFlow() {
  flowSnapshot = null;
  flowIsNew = true;
}
export function beginEditEventFlow(ev) {
  flowSnapshot = { event: JSON.parse(JSON.stringify(ev)), history: JSON.parse(JSON.stringify(state.history)) };
  flowIsNew = false;
}
/* Cancel discards everything done since the flow was opened. For a
   brand-new event, that means deleting it outright — and first undoing
   whatever its current roster contributed to shared pairing history, so
   nothing is left over for an event that no longer exists. For an
   existing event, it means restoring the exact snapshot taken on entry. */
export function cancelEventFlow(eventId) {
  if (flowIsNew) {
    const ev = getEventById(eventId);
    if (ev) {
      if (ev.published && ev.roster) ev.roster.forEach(r => applyRoundHistory(state.history, r, -1));
      state.events = state.events.filter(e => e.id !== ev.id);
    }
    state.currentEventId = state.events.length ? state.events[0].id : null;
  } else if (flowSnapshot) {
    const idx = state.events.findIndex(e => e.id === flowSnapshot.event.id);
    if (idx >= 0) state.events[idx] = flowSnapshot.event;
    state.history = flowSnapshot.history;
  }
  flowSnapshot = null; flowIsNew = false;
  commit();
}
/* Makes the event's current state the new baseline for this editing
   session, so Cancel / backing out only discards changes made after it
   (used by Setup's Done). */
export function checkpointEventFlow(eventId) {
  const ev = getEventById(eventId);
  if (!ev || !flowSnapshot) return;
  flowSnapshot = { event: JSON.parse(JSON.stringify(ev)), history: JSON.parse(JSON.stringify(state.history)) };
}
export function eventFlowHasChanges(eventId) {
  if (!flowSnapshot) return false;
  const ev = getEventById(eventId);
  return !ev || JSON.stringify(ev) !== JSON.stringify(flowSnapshot.event);
}
export function saveEventFlow() {
  flowSnapshot = null; flowIsNew = false;
  commit();
}

/* ===================== CHAT =====================
   Chats are always sent as the signed-in account (asId). */
export function startChat(asId, type, participantIds, name) {
  if (!asId) return { error: 'Log in to start a chat.' };
  const participants = Array.from(new Set([asId, ...participantIds]));
  if (participants.length < 2) return { error: 'Pick at least one other person to chat with.' };
  if (type === 'dm' && participants.length !== 2) return { error: 'A 1:1 chat needs exactly one other person.' };
  if (type === 'dm') {
    const existing = state.chats.find(c => c.type === 'dm' && c.participantIds.length === 2 && c.participantIds.every(id => participants.includes(id)));
    if (existing) return { chatId: existing.id, error: null };
  }
  const chat = { id: uid(), type, name: type === 'group' ? (name || '').trim() : '', participantIds: participants, messages: [] };
  state.chats.push(chat);
  commit();
  return { chatId: chat.id, error: null };
}
export function sendChatMessage(asId, chatId, text) {
  if (!asId || !text || !text.trim()) return;
  const chat = state.chats.find(c => c.id === chatId); if (!chat) return;
  chat.messages.push({ id: uid(), senderId: asId, text: text.trim(), ts: Date.now() });
  commit();
}

export function setFlagThreshold(value) {
  state.flagThreshold = Math.max(1, parseInt(value) || 1);
  commit();
}


