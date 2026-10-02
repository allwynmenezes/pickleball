/* ===================== API CLIENT =====================
   Talks to the backend/ Express server. The base URL is overridable via
   EXPO_PUBLIC_API_URL (inlined at build time by Expo) for real devices,
   which can't reach the dev machine via "localhost" — falls back to
   sensible per-platform defaults for the simulator/emulator/web. */
import { Platform } from 'react-native';

function defaultBaseUrl() {
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || defaultBaseUrl();

const TIMEOUT_MS = 8000;
/* Requests that email a code wait on Google Apps Script actually sending
   it, which regularly takes longer than 8s. Timing those out early showed
   "Aborted" even though the email was on its way. */
const EMAIL_TIMEOUT_MS = 30000;

async function request(path, options, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { ...options, signal: controller.signal }).catch((e) => {
      if (e && e.name === 'AbortError') throw new Error('The server took too long to respond. Check your connection and try again.');
      throw e;
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Request failed with status ${res.status}`);
      err.status = res.status; // lets callers tell "rejected" (e.g. 401) from "unreachable"
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function fetchState() {
  return request('/api/state');
}

/* The signed-in session (kept current by lib/auth.js). State pushes carry
   it so the server knows who's editing — only an event's host may change
   its setup or delete it, and the server enforces that. */
let authToken = null;
export function setApiAuthToken(token) { authToken = token || null; }

export function pushState(state) {
  return request('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify(state),
  });
}

/* "Describe your event" (backend-worker/src/ai.js): text in, a draft for
   the new-event form out. Sends the phone's time and timezone so "next
   Tuesday" means the user's next Tuesday. The model can take a while. */
const AI_TIMEOUT_MS = 25000;
export function parseEventText(text) {
  return request('/api/ai/parse-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify({ text, now: new Date().toISOString(), tzOffsetMin: -new Date().getTimezoneOffset() }),
  }, AI_TIMEOUT_MS);
}

/* Change an existing event by message ("move it to 7pm", "add Sam").
   Sends the event as the app has it; returns { changes, summary,
   unmatchedNames }. Nothing is saved by the server — see applyAiEdit. */
export function editEventText(text, ev) {
  const event = {
    name: ev.name, date: ev.date, startTime: ev.startTime, durationMin: ev.durationMin, courts: ev.courts,
    gameLenMin: ev.gameLenMin, segments: ev.segments, memberIds: ev.memberIds,
  };
  return request('/api/ai/edit-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: JSON.stringify({ text, event, now: new Date().toISOString(), tzOffsetMin: -new Date().getTimezoneOffset() }),
  }, AI_TIMEOUT_MS);
}

/* Voice note → text (backend-worker/src/ai.js, Whisper). `uri` is the
   recording from expo-av: a file:// path on a phone, a blob: URL on web. */
export async function transcribeAudio(uri) {
  const form = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append('audio', blob, 'note.webm');
  } else {
    const ext = (uri.split('.').pop() || 'm4a').toLowerCase();
    form.append('audio', { uri, name: `note.${ext}`, type: ext === '3gp' ? 'audio/3gpp' : 'audio/mp4' });
  }
  // No Content-Type header: fetch sets the multipart boundary itself.
  return request('/api/ai/transcribe', {
    method: 'POST',
    headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    body: form,
  }, AI_TIMEOUT_MS);
}

/* ===================== FRIENDS (backend-worker/src/social.js) =====================
   Each returns { searchable, friends: [{ id, addedAt }], cooldowns: [{ id, until }] }. */
const authed = (options = {}) => ({ ...options, headers: { ...(options.headers || {}), ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) } });
export function fetchSocial() {
  return request('/api/me/social', authed());
}
export function saveSearchable(searchable) {
  return request('/api/me/social', authed({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ searchable }) }));
}
export function addFriendRequest(id) {
  return request(`/api/friends/${encodeURIComponent(id)}`, authed({ method: 'POST' }));
}
export function removeFriendRequest(id) {
  return request(`/api/friends/${encodeURIComponent(id)}/remove`, authed({ method: 'POST' }));
}

/* ===================== AUTH ===================== */
const json = (data) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });

export function createClaimLink(playerId) {
  return request(`/api/players/${playerId}/claim-link`, { method: 'POST' });
}
export function fetchClaimInfo(token) {
  return request(`/api/claim/${token}`);
}
export function requestSignupOtp({ name, gender, email, password, claimToken }) {
  return request('/api/auth/signup/otp', json({ name, gender, email, password, claimToken }), EMAIL_TIMEOUT_MS);
}
export function verifySignupOtp(email, otp) {
  return request('/api/auth/signup/verify', json({ email, otp }));
}
export function loginWithPassword(email, password) {
  return request('/api/auth/login', json({ email, password }));
}
export function requestPasswordReset(email) {
  return request('/api/auth/password/forgot', json({ email }), EMAIL_TIMEOUT_MS);
}
export function resetPassword(email, otp, password) {
  return request('/api/auth/password/reset', json({ email, otp, password }));
}
export function fetchMe(token) {
  return request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
}
export function logoutSession(token) {
  return request('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
}
