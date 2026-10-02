/* ===================== FRIENDS STORE =====================
   The signed-in account's friends, its "visible in search" setting, and the
   players it unfriended in the last 24 hours (who can't be added back until
   then). Per account, like lib/auth.js — not part of the shared group state —
   and the server (backend-worker/src/social.js) is what enforces it.
   Friendship is one-way: adding someone lists them under your Friends. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { fetchSocial, saveSearchable, addFriendRequest, removeFriendRequest } from './api';
import { useAuth, getAuthToken } from './auth';

const EMPTY = { searchable: false, friends: [], cooldowns: [] };
let social = { ...EMPTY, owner: null, loaded: false };
let version = 0;
const listeners = new Set();
let expiryTimer = null;
let loading = null;

function notify() { version++; listeners.forEach(l => l()); }

/* Takes the server's answer for `owner` and, if a 24-hour wait is running,
   re-renders when the earliest one ends so its Add friend button comes back. */
function apply(owner, data) {
  if (owner !== getAuthToken()) return; // signed out or switched account meanwhile
  social = { searchable: !!data.searchable, friends: data.friends || [], cooldowns: data.cooldowns || [], owner, loaded: true };
  clearTimeout(expiryTimer);
  const next = Math.min(...social.cooldowns.map(c => c.until));
  if (Number.isFinite(next)) {
    expiryTimer = setTimeout(() => {
      apply(owner, { ...social, cooldowns: social.cooldowns.filter(c => c.until > Date.now()) });
    }, Math.max(1000, next - Date.now() + 500));
  }
  notify();
}

export function refreshSocial() {
  const owner = getAuthToken();
  if (!owner) {
    if (social.owner) { social = { ...EMPTY, owner: null, loaded: false }; notify(); }
    return Promise.resolve();
  }
  if (loading && loading.owner === owner) return loading.promise;
  const promise = fetchSocial()
    .then(data => apply(owner, data))
    .catch(e => console.warn('could not load friends', e))
    .finally(() => { if (loading && loading.promise === promise) loading = null; });
  loading = { owner, promise };
  return promise;
}

/* { loaded, searchable, friendIds: Set, cooldownUntil(id) → ms or 0 }.
   Loads for the signed-in account, and again whenever that changes. */
export function useSocial() {
  const { token } = useAuth();
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => version,
    () => version,
  );
  useEffect(() => { if (social.owner !== token || !social.loaded) refreshSocial(); }, [token]);
  return useMemo(() => {
    const mine = token && social.owner === token ? social : { ...EMPTY, loaded: false };
    const friendIds = new Set(mine.friends.map(f => f.id));
    const cooldownUntil = (id) => {
      const c = mine.cooldowns.find(x => x.id === id);
      return c && c.until > Date.now() ? c.until : 0;
    };
    return { loaded: !!mine.loaded, searchable: mine.searchable, friendIds, cooldownUntil };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, token]);
}

/* Each of these resolves to null, or an error message to show. */
async function run(call) {
  const owner = getAuthToken();
  if (!owner) return 'Log in first.';
  try { apply(owner, await call()); return null; } catch (e) { return e.message || 'Something went wrong — try again.'; }
}
export function setSearchable(value) {
  // Flip it straight away; the server's answer (or a refresh on failure) settles it.
  social = { ...social, searchable: !!value };
  notify();
  return run(() => saveSearchable(!!value)).then(error => { if (error) refreshSocial(); return error; });
}
export function addFriend(id) { return run(() => addFriendRequest(id)); }
export function removeFriend(id) { return run(() => removeFriendRequest(id)); }

/* "in 23 hours" / "in 40 minutes" — how long until an unfriended player can be added again. */
export function waitLabel(until) {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  if (mins >= 60) { const h = Math.ceil(mins / 60); return `in ${h} hour${h === 1 ? '' : 's'}`; }
  return `in ${mins} minute${mins === 1 ? '' : 's'}`;
}
