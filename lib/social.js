/* ===================== FRIENDS STORE =====================
   The signed-in account's friends, friend requests (sent and received),
   notifications, and "visible in search" setting — per account, like
   lib/auth.js, not part of the shared group state. The server
   (backend-worker/src/social.js) is what enforces it all.
   Friends are mutual: a request has to be accepted. After unfriending
   someone, or having your request declined, you wait 24 hours before
   sending that player a request. */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { fetchSocial, saveSearchable, friendAction, dismissNotificationRequest } from './api';
import { useAuth, getAuthToken } from './auth';

const EMPTY = { searchable: true, friends: [], incoming: [], outgoing: [], waits: [], notifications: [] };
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
  social = { ...EMPTY, ...data, owner, loaded: true };
  clearTimeout(expiryTimer);
  const next = Math.min(...social.waits.map(w => w.until));
  if (Number.isFinite(next)) {
    expiryTimer = setTimeout(() => {
      apply(owner, { ...social, waits: social.waits.filter(w => w.until > Date.now()) });
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

/* Keeps requests and notifications current while the app is in front.
   Mounted once, by the header. */
export function useSocialSync(intervalMs = 20000) {
  const { token } = useAuth();
  useEffect(() => {
    if (!token) { refreshSocial(); return undefined; }
    refreshSocial();
    const timer = setInterval(() => {
      if (!AppState.currentState || AppState.currentState === 'active') refreshSocial();
    }, intervalMs);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') refreshSocial(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [token, intervalMs]);
}

/* Everything about the signed-in account's friends:
   { loaded, searchable, friendIds, incomingIds, outgoingIds, waitUntil(id),
     incoming, notifications, badge }. */
export function useSocial() {
  const { token } = useAuth();
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => version,
    () => version,
  );
  useEffect(() => { if (token && (social.owner !== token || !social.loaded)) refreshSocial(); }, [token]);
  return useMemo(() => {
    const mine = token && social.owner === token ? social : { ...EMPTY, loaded: false };
    const waitUntil = (id) => {
      const w = mine.waits.find(x => x.id === id);
      return w && w.until > Date.now() ? w.until : 0;
    };
    return {
      loaded: !!mine.loaded,
      searchable: mine.searchable,
      friendIds: new Set(mine.friends.map(f => f.id)),
      incomingIds: new Set(mine.incoming.map(r => r.id)),
      outgoingIds: new Set(mine.outgoing.map(r => r.id)),
      waitUntil,
      incoming: mine.incoming,
      notifications: mine.notifications,
      badge: mine.incoming.length + mine.notifications.length,
    };
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
export const sendFriendRequest = id => run(() => friendAction(id));
export const acceptFriendRequest = id => run(() => friendAction(id, 'accept'));
export const declineFriendRequest = id => run(() => friendAction(id, 'decline'));
export const removeFriend = id => run(() => friendAction(id, 'remove'));
export const dismissNotification = id => run(() => dismissNotificationRequest(id));

/* "in 23 hours" / "in 40 minutes" — until a player can be sent a request again. */
export function waitLabel(until) {
  const mins = Math.max(1, Math.ceil((until - Date.now()) / 60000));
  if (mins >= 60) { const h = Math.ceil(mins / 60); return `in ${h} hour${h === 1 ? '' : 's'}`; }
  return `in ${mins} minute${mins === 1 ? '' : 's'}`;
}
