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

async function request(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { ...options, signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed with status ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function fetchState() {
  return request('/api/state');
}

export function pushState(state) {
  return request('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  });
}

export function resetBackend() {
  return request('/api/reset', { method: 'POST' });
}
