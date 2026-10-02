import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Btn } from '../lib/ui';
import { useAuth } from '../lib/auth';
import { useSocial, addFriend, removeFriend, waitLabel } from '../lib/social';
import { showAlert, showConfirm } from '../lib/confirm';
import { colors } from '../lib/theme';

/* Add friend / Unfriend for another player. On the Players list a friend
   gets no button (`allowUnfriend` off); on their profile it's Unfriend.
   After unfriending, Add friend stays disabled for 24 hours. */
export default function FriendButton({ player, allowUnfriend, small = true }) {
  const { player: me } = useAuth();
  const { loaded, friendIds, cooldownUntil } = useSocial();
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
          `Unfriend ${player.name}? You'll only be able to add ${player.name} as a friend again after 24 hours.`,
          () => act(removeFriend), 'Unfriend',
        )}
      />
    );
  }

  const until = cooldownUntil(player.id);
  return (
    <View style={styles.wrap}>
      <Btn title="Add friend" icon="person-add" variant="outline" small={small} disabled={busy || !!until} onPress={() => act(addFriend)} />
      {until ? <Text style={styles.wait}>Can add again {waitLabel(until)}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end', gap: 2 },
  wait: { fontSize: 11, color: colors.slate },
});
