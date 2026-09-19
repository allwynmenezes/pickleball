/* A confirm()/alert() replacement, same idea as the web app's in-page modal
   (native Alert works fine on iOS/Android, but is inconsistent on web —
   this one custom component behaves the same everywhere). */
import { useSyncExternalStore } from 'react';

let modalState = null;
const listeners = new Set();
function notify() { listeners.forEach(l => l()); }

export function showConfirm(message, onConfirm, confirmLabel) {
  modalState = { message, onConfirm, showCancel: true, confirmLabel: confirmLabel || 'Delete' };
  notify();
}
export function showAlert(message) {
  modalState = { message, onConfirm: null, showCancel: false, confirmLabel: 'OK' };
  notify();
}
export function confirmYes() {
  const cb = modalState && modalState.onConfirm;
  modalState = null;
  notify();
  if (cb) cb();
}
export function confirmCancel() {
  modalState = null;
  notify();
}
export function useModalState() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => modalState,
    () => modalState,
  );
}
