import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Row, GenderChip, DuprChip, Hint, EmptyState } from '../../lib/ui';
import { useStore } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { useSocial } from '../../lib/social';
import { pushOnce } from '../../lib/nav';
import FriendButton from '../../components/FriendButton';
import { colors, radius } from '../../lib/theme';

/* Your friends, and everyone visible in search (on unless a player turns it
   off in their profile). Tap a player to see their profile. Your own
   details — name, gender, DUPR — are edited in your profile. Hosts add,
   rename and remove event players from an event's Setup step. */
export default function PlayersScreen() {
  const router = useRouter();
  const allPlayers = useStore(s => s.players);
  const { player: me } = useAuth();
  const { searchable: meVisible, friendIds } = useSocial();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = p => !q || p.name.toLowerCase().includes(q);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const myId = me ? me.id : null;
  const friends = allPlayers.filter(p => p.claimed && friendIds.has(p.id) && matches(p)).sort(byName);
  const visible = allPlayers.filter(p => p.claimed && p.searchable && p.id !== myId && matches(p)).sort(byName);
  const open = id => pushOnce(router, `/player/${id}`);

  return (
    <Screen>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.slate} />
        <TextInput
          value={query} onChangeText={setQuery} placeholder="Search players by name"
          placeholderTextColor={colors.slate} style={styles.searchInput} autoCorrect={false} returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8}>
            <Ionicons name="close-circle" size={16} color={colors.slate} />
          </Pressable>
        ) : null}
      </View>

      {me ? (
        <>
          <SectionTitle first>Friends ({friends.length})</SectionTitle>
          <Card>
            {friends.length === 0 ? (
              <EmptyState icon="person-add">{q ? 'No friends match your search.' : 'No friends yet — tap Add friend on a player below.'}</EmptyState>
            ) : friends.map(p => <PlayerRow key={p.id} p={p} onPress={() => open(p.id)} isFriend />)}
          </Card>
        </>
      ) : null}

      <SectionTitle first={!me}>Players ({visible.length})</SectionTitle>
      <Hint style={{ marginTop: -6, marginBottom: 10 }}>
        Everyone visible in search. Tap a player to see their profile.
        {me && !meVisible ? ' You\'re hidden from search — you can change that in your profile.' : ''}
      </Hint>
      <Card>
        {visible.length === 0 ? (
          <EmptyState icon="people">{q ? `No players match "${query.trim()}".` : 'No one else is visible in search yet.'}</EmptyState>
        ) : visible.map(p => <PlayerRow key={p.id} p={p} onPress={() => open(p.id)} isFriend={friendIds.has(p.id)} />)}
      </Card>
    </Screen>
  );
}

/* A player: name, gender, rating, then Add friend — or a Friend tag once added. */
function PlayerRow({ p, onPress, isFriend }) {
  return (
    <Row onPress={onPress}>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
        <GenderChip gender={p.gender} />
        <DuprChip dupr={p.dupr} />
      </View>
      {isFriend ? (
        <View style={styles.friendTag}>
          <Ionicons name="people" size={12} color={colors.courtDeep} />
          <Text style={styles.friendTagText}>Friend</Text>
        </View>
      ) : <FriendButton player={p} />}
      <Ionicons name="chevron-forward" size={14} color={colors.slate} />
    </Row>
  );
}

const styles = StyleSheet.create({
  nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' },
  name: { fontWeight: '600', fontSize: 14, flexShrink: 1, color: colors.ink },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.white,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: colors.ink },
  friendTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.courtTint },
  friendTagText: { fontSize: 11.5, fontWeight: '600', color: colors.courtDeep },
});
