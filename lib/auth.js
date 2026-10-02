/* ===================== AUTH STORE =====================
   Tracks "who am I" — separate from lib/store.js's shared group state,
   since identity is per-device/per-person, not part of the synced blob.

   The session lives in the device's encrypted keystore (expo-secure-store:
   Android Keystore / iOS Keychain), so once you've logged in the app
   remembers you on every launch. On boot the token is re-checked with
   GET /api/auth/me, which also slides its expiry forward — but only a real
   rejection from the server (401: revoked or expired) signs you out. If the
   backend simply can't be reached (offline, server restarting), you stay
   signed in with the cached details. The web build has no keystore, so it
   falls back to AsyncStorage there. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { useSyncExternalStore, useMemo } from 'react';
import {
  fetchMe, logoutSession, fetchClaimInfo,
  requestSignupOtp, verifySignupOtp, loginWithPassword, requestPasswordReset, resetPassword, setApiAuthToken,
} from './api';
import { upsertAccountPlayer } from './store';

const STORAGE_KEY = 'thepickleslot.auth.v2';
const LEGACY_ASYNC_KEY = 'thepickleslot/auth/v1';

const storage = Platform.OS === 'web'
  ? {
    get: (k) => AsyncStorage.getItem(k),
    set: (k, v) => AsyncStorage.setItem(k, v),
    remove: (k) => AsyncStorage.removeItem(k),
  }
  : {
    get: (k) => SecureStore.getItemAsync(k),
    set: (k, v) => SecureStore.setItemAsync(k, v),
    remove: (k) => SecureStore.deleteItemAsync(k),
  };

let auth = { token: null, player: null };
let ready = false;
let version = 0;
const listeners = new Set();
function notify() { setApiAuthToken(auth.token); version++; listeners.forEach(l => l()); }

async function persist() {
  try {
    if (auth.token) await storage.set(STORAGE_KEY, JSON.stringify(auth));
    else await storage.remove(STORAGE_KEY);
  } catch (e) { console.warn('auth save failed', e); }
}

async function readCached() {
  let raw = await storage.get(STORAGE_KEY).catch(() => null);
  if (!raw && Platform.OS !== 'web') {
    // One-time move from the old unencrypted AsyncStorage copy.
    raw = await AsyncStorage.getItem(LEGACY_ASYNC_KEY).catch(() => null);
    if (raw) {
      await storage.set(STORAGE_KEY, raw).catch(() => {});
      await AsyncStorage.removeItem(LEGACY_ASYNC_KEY).catch(() => {});
    }
  }
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

export async function hydrateAuth() {
  if (ready) return;
  const cached = await readCached();
  if (cached && cached.token) {
    auth = { token: cached.token, player: cached.player || null };
    try {
      const { player } = await fetchMe(cached.token);
      auth = { token: cached.token, player };
      await persist();
    } catch (e) {
      if (e.status === 401) {
        auth = { token: null, player: null };
        await persist();
      } else {
        console.warn('could not re-check the session (offline?) — staying signed in', e);
      }
    }
  }
  ready = true;
  notify();
}

export function useAuth() {
  const v = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => version,
    () => version,
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ({ token: auth.token, player: auth.player, ready }), [v]);
}
export function getAuthToken() { return auth.token; }
/* After editing your name or gender in your profile (the shared state holds
   the real copy; this keeps the remembered sign-in in step). */
export async function updateMyDetails(fields) {
  if (!auth.player) return;
  auth = { ...auth, player: { ...auth.player, ...fields } };
  await persist();
  notify();
}
export function getAuthPlayer() { return auth.player; }

/* Every successful sign-up / claim / login / reset also marks that player
   as an account holder in the shared group state, so they appear on the
   Players tab right away instead of after the next full reload. */
async function setSession({ token, player }) {
  upsertAccountPlayer(player);
  auth = { token, player };
  await persist();
  notify();
  return player;
}

export async function logout() {
  const token = auth.token;
  auth = { token: null, player: null };
  await persist();
  notify();
  if (token) logoutSession(token).catch(() => {});
}

/* ---- Invite details (prefills the claim sign-up). ---- */
export function getClaimInfo(token) { return fetchClaimInfo(token); }

/* ---- Sign up (claimToken set when it came from an invite link). ---- */
export function sendSignupCode(details) { return requestSignupOtp(details); }
export async function confirmSignup(email, otp) { return setSession(await verifySignupOtp(email, otp)); }

/* ---- Login / forgot password. ---- */
export async function login(email, password) { return setSession(await loginWithPassword(email, password)); }
export function sendPasswordResetCode(email) { return requestPasswordReset(email); }
export async function confirmPasswordReset(email, otp, password) { return setSession(await resetPassword(email, otp, password)); }
