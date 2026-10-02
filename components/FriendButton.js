import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Btn } from '../lib/ui';
import { useAuth } from '../lib/auth';
import { useSocial, sendFriendRequest, acceptFriendRequest, removeFriend, waitLabel } from '../lib/social';
import { showAlert, showConfirm } from '../lib/confirm';
import { colors } from '../lib/theme';

/* The friend button for another player:
   - Add friend → sends a request; Requested (disabled) while it waits;
   - Accept, when they've asked you;
   - Add friend disabled for 24 hours after unfriending them or them declining;
   - for a friend: nothing on the Players list, Unfriend on their profile
     (`allowUnfriend`). */
export default function FriendButton({ player, allowUnfriend, small = true }) {
  const { player: me } = useAuth();
  const { loaded, friendIds, incomingIds, outgoingIds, waitUntil } = useSocial();
  const [busy, setBusy] = useState(false);
  if (!me || !player || player.id === me.id || !player.claimed || !loaded) return null;

  async function act(fn) {
    setBusy(true);
    const error = await fn(player.id);
    setBusy(false);
    if (error) showAlert(error);
  }

  if (friendIds.has(player.id)) {
    if (!allowUnfriend) return null;
    return (
      <Btn
        title="Unfriend" icon="person-remove" variant="ghost" small={small} dangerText disabled={busy}
        onPress={() => showConfirm(
          `You are removing ${player.name} as a friend. You'll not be able to add as a friend again until 24 hours.`,
          () => act(removeFriend), 'Unfriend',
        )}
      />
    );
  }
  if (incomingIds.has(player.id)) {
    return <Btn title="Accept" icon="checkmark" small={small} disabled={busy} onPress={() => act(acceptFriendRequest)} />;
  }
  if (outgoingIds.has(player.id)) {
    return <Btn title="Requested" icon="time" variant="outline" small={small} disabled onPress={() => {}} />;
  }
  const until = waitUntil(player.id);
  return (
    <View style={styles.wrap}>
      <Btn title="Add friend" icon="person-add" variant="outline" small={small} disabled={busy || !!until} onPress={() => act(sendFriendRequest)} />
      {until ? <Text style={styles.wait}>Can add again {waitLabel(until)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', gap: 2 },
  wait: { fontSize: 11, color: colors.slate },
});
