import { Share, Platform } from 'react-native';

/* The invite URL comes from the backend (POST /api/players/:id/claim-link):
   a plain http(s) link to the backend's own invite page, at an address
   other phones can reach — PUBLIC_URL when configured, otherwise this
   machine's Wi-Fi address. Chat apps like WhatsApp only make http(s) links
   tappable; custom app schemes or the dev server's 127.0.0.1 address show
   up as dead text. The page then opens the app to a prefilled sign-up. */
export async function shareClaimLink(url, playerName) {
  const message = `You're invited to join The Pickle Slot as ${playerName}! Tap to create your account:\n${url}`;

  if (Platform.OS === 'web') {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: 'The Pickle Slot', text: message, url }); return { shared: true }; }
      catch (e) { if (e && e.name === 'AbortError') return { shared: false }; }
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(message);
      return { shared: true, copied: true };
    }
    return { shared: false, url, message };
  }

  // Android ignores Share's separate `url` field, so the link rides in the
  // message text (where WhatsApp etc. detect and linkify it).
  const result = await Share.share(Platform.OS === 'ios' ? { message, url } : { message });
  return { shared: result.action !== Share.dismissedAction };
}
