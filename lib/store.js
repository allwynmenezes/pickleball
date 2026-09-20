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
import { useSyncExternalStore, useMemo } from 'react';
import {
  uid, ensureMembers, getConfirmedAndWaitlist, generateRoster,
  recomputeFromCurrentRound, applyRoundHistory, reconcileBookingPlan,
  toOffset, offsetToClock, GAME_LEN,
} from './engine';
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
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(e => console.warn('local cache save failed', e));
    pushState(state).catch(e => console.warn('backend save failed (offline?)', e));
  }, 150);
}
function commit() { persist(); notify(); }

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
    date: d.date || new Date().toISOString().slice(0, 10),
    startTime, durationMin, courts: Math.max(1, parseInt(d.courts, 10) || 4),
    segments: [], rsvps: {}, bookingSlots: [], roster: null, noShows: [], currentRoundIndex: 0, published: false,
    memberIds: [],
  };
  ev.segments = [{ start: startTime, end: offsetToClock(ev, durationMin), modes: {} }];
  state.events.push(ev);
  state.currentEventId = ev.id;
  commit();
  return ev;
}
export function deleteEvent(id) {
  state.events = state.events.filter(e => e.id !== id);
  if (state.currentEventId === id) state.currentEventId = state.events.length ? state.events[0].id : null;
  commit();
}
export function updateEventField(ev, field, value) {
  if (['durationMin', 'courts'].includes(field)) value = Math.max(1, parseInt(value) || 1);
  ev[field] = value;
  if (field === 'startTime' || field === 'durationMin') normalizeSegments(ev);
  commit();
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
  let cursor = 0;
  ev.segments.forEach((s, i) => {
    s.start = offsetToClock(ev, cursor);
    if (i === ev.segments.length - 1) {
      s.end = offsetToClock(ev, endOffset);
    } else {
      const remainingAfter = ev.segments.length - 1 - i;
      const minEnd = cursor + GAME_LEN;
      const maxEnd = endOffset - remainingAfter * GAME_LEN;
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
  const last = ev.segments[ev.segments.length - 1];
  const lastStartOff = toOffset(ev, last.start);
  const endOff = ev.durationMin;
  if (endOff - lastStartOff < 2 * GAME_LEN) return { error: 'Not enough time left in the last segment to split it — each segment needs at least 15 minutes.' };
  const rawMid = lastStartOff + Math.round(((endOff - lastStartOff) / 2) / GAME_LEN) * GAME_LEN;
  const mid = Math.max(lastStartOff + GAME_LEN, Math.min(endOff - GAME_LEN, rawMid));
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
export function addAllPlayersToEvent(ev) {
  ensureMembers(ev, state.players);
  state.players.forEach(p => { if (!ev.memberIds.includes(p.id)) ev.memberIds.push(p.id); });
  commit();
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
  const off = toOffset(ev, clock);
  const prevStart = rec.start, prevEnd = rec.end;
  if (which === 'start') {
    rec.start = Math.max(0, Math.min(off, ev.durationMin - GAME_LEN));
    if (rec.end <= rec.start) rec.end = Math.min(ev.durationMin, rec.start + GAME_LEN);
  } else {
    rec.end = Math.max(GAME_LEN, Math.min(off, ev.durationMin));
    if (rec.start >= rec.end) rec.start = Math.max(0, rec.end - GAME_LEN);
  }
  if (ev.published && ev.roster && (rec.start !== prevStart || rec.end !== prevEnd)) recomputeFromCurrentRound(ev, state.history, state.players);
  commit();
}
export function playerDropsOut(ev, playerId) { setRsvp(ev, playerId, 'out'); }
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
export function advanceRound(ev, delta) {
  const n = ev.roster.length;
  ev.currentRoundIndex = Math.max(0, Math.min(n - 1, (ev.currentRoundIndex || 0) + delta));
  commit();
}
export function setScore(ev, roundIdx, court, team, value) {
  const round = ev.roster[roundIdx]; if (!round) return;
  const c = round.courts.find(x => x.court === court); if (!c) return;
  const v = value === '' || value == null ? null : Math.max(0, parseInt(value) || 0);
  if (team === 'A') c.scoreA = v; else c.scoreB = v;
  commit();
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
export function saveEventFlow() {
  flowSnapshot = null; flowIsNew = false;
  commit();
}

/* ===================== CHAT =====================
   "Chatting as" is transient by design (there's no login) — module-level,
   not part of persisted state, same as the web app. */
let chatAsId = null;
export function getChatAsId() { return chatAsId || (state.players[0] && state.players[0].id) || null; }
export function setChatAsId(id) { chatAsId = id; notify(); }

export function startChat(type, participantIds, name) {
  const asId = getChatAsId();
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
export function sendChatMessage(chatId, text) {
  if (!text || !text.trim()) return;
  const chat = state.chats.find(c => c.id === chatId); if (!chat) return;
  chat.messages.push({ id: uid(), senderId: getChatAsId(), text: text.trim(), ts: Date.now() });
  commit();
}

export function setFlagThreshold(value) {
  state.flagThreshold = Math.max(1, parseInt(value) || 1);
  commit();
}

/* ===================== DATA ===================== */
export function resetAllData() {
  state = defaultState();
  commit();
}
