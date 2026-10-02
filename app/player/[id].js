import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Btn, Hint, GenderChip, DuprChip, EmptyState } from '../../lib/ui';
import { useStore } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { useSocial } from '../../lib/social';
import FriendButton from '../../components/FriendButton';
import { colors } from '../../lib/theme';

/* Another player's profile, read-only: who they are, and Add friend /
   Unfriend. Friends can be messaged one-on-one from here. */
export default function PlayerProfileScreen() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const player = useStore(s => s.players.find(p => p.id === id));
  const { player: me } = useAuth();
  const { friendIds } = useSocial();
  const isMe = !!me && !!player && me.id === player.id;
  const isFriend = !!player && friendIds.has(player.id);

  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        {!player ? (
          <Card><EmptyState icon="person">This player isn't in the group any more.</EmptyState></Card>
        ) : (
          <>
            <SectionTitle first>Player profile</SectionTitle>
            <Card style={{ gap: 12 }}>
              <Text style={styles.name}>{player.name}{isMe ? <Text style={styles.you}> (you)</Text> : null}</Text>
              <View style={styles.facts}>
                <GenderChip gender={player.gender} />
                <DuprChip dupr={player.dupr} />
                {player.dupr == null ? <Text style={styles.muted}>No DUPR rating</Text> : null}
                {isFriend ? <Text style={styles.friend}>Friend</Text> : null}
              </View>
              {isMe ? (
                <Hint style={{ marginTop: 0 }}>This is how others see you. Change your visibility in your profile, and your DUPR rating on the Players tab.</Hint>
              ) : !me ? (
                <Hint style={{ marginTop: 0 }}>Log in to add {player.name} as a friend.</Hint>
              ) : (
                <View style={styles.actions}>
                  {isFriend ? <Btn title="Message" icon="chatbubble-ellipses" small onPress={() => router.navigate(`/chat?with=${encodeURIComponent(player.id)}`)} /> : null}
                  <FriendButton player={player} allowUnfriend />
                </View>
              )}
              {me && !isMe && !isFriend ? <Hint style={{ marginTop: 0 }}>Add {player.name} as a friend to message them one-on-one.</Hint> : null}
            </Card>
          </>
        )}
        <Btn title="Close" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '700', color: colors.ink },
  you: { fontSize: 15, fontWeight: '400', color: colors.slate },
  facts: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  muted: { fontSize: 12, color: colors.slate },
  friend: { fontSize: 12, fontWeight: '600', color: colors.courtDeep },
  actions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end', alignItems: 'flex-start', flexWrap: 'wrap' },
});
