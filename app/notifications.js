import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Btn, EmptyState, Hint } from '../lib/ui';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useSocial, acceptFriendRequest, declineFriendRequest, dismissNotification } from '../lib/social';
import { pushOnce } from '../lib/nav';
import { showAlert } from '../lib/confirm';
import { colors, radius } from '../lib/theme';

/* Friend requests (Accept / Decline — each disappears once answered) and
   notices that someone answered yours (× to clear). A player's name opens
   their profile. */
export default function NotificationsScreen() {
  const router = useRouter();
  const { player: me } = useAuth();
  const { loaded, incoming, notifications } = useSocial();
  const players = useStore(s => s.players);
  const nameOf = id => (players.find(p => p.id === id) || {}).name || 'A player';
  const openPlayer = id => pushOnce(router, `/player/${id}`);
  const empty = loaded && incoming.length === 0 && notifications.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        <SectionTitle first>Notifications</SectionTitle>
        {!me ? (
          <Card><Hint style={{ marginTop: 0 }}>Log in to see friend requests.</Hint></Card>
        ) : empty ? (
          <Card><EmptyState icon="notifications-outline">You're all caught up.</EmptyState></Card>
        ) : (
          <Card>
            {incoming.map(r => (
              <RequestRow key={`r-${r.id}`} id={r.id} name={nameOf(r.id)} onOpen={() => openPlayer(r.id)} />
            ))}
            {notifications.map(n => (
              <NoticeRow key={n.id} note={n} name={nameOf(n.otherId)} onOpen={() => openPlayer(n.otherId)} />
            ))}
          </Card>
        )}
        <Btn title="Close" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Screen>
    </View>
  );
}

function RequestRow({ id, name, onOpen }) {
  const [busy, setBusy] = useState(false);
  async function act(fn) {
    setBusy(true);
    const error = await fn(id);
    setBusy(false);
    if (error) showAlert(error);
  }
  return (
    <View style={styles.row}>
      <Ionicons name="person-add" size={18} color={colors.court} />
      <Pressable onPress={onOpen} style={styles.text} accessibilityRole="link">
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.sub}>wants to be friends</Text>
      </Pressable>
      <Btn title="Decline" variant="ghost" small disabled={busy} onPress={() => act(declineFriendRequest)} />
      <Btn title="Accept" small disabled={busy} onPress={() => act(acceptFriendRequest)} />
    </View>
  );
}

function NoticeRow({ note, name, onOpen }) {
  const accepted = note.type === 'friend_accepted';
  return (
    <View style={styles.row}>
      <Ionicons name={accepted ? 'people' : 'close-circle-outline'} size={18} color={accepted ? colors.court : colors.slate} />
      <Pressable onPress={onOpen} style={styles.text} accessibilityRole="link">
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <Text style={styles.sub}>{accepted ? 'accepted your friend request' : 'declined your friend request'}</Text>
      </Pressable>
      <Pressable
        onPress={() => dismissNotification(note.id).then(e => { if (e) showAlert(e); })}
        style={styles.dismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss"
      >
        <Ionicons name="close" size={16} color={colors.slate} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 14, fontWeight: '600', color: colors.ink },
  sub: { fontSize: 12, color: colors.slate, marginTop: 1 },
  dismiss: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
});
