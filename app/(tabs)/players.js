import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Row, GenderChip, DuprChip, Hint, EmptyState, Btn, TextField, Banner } from '../../lib/ui';
import { useStore, setPlayerDupr } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { useSocial } from '../../lib/social';
import { pushOnce } from '../../lib/nav';
import FriendButton from '../../components/FriendButton';
import { colors, radius } from '../../lib/theme';

/* Account holders who chose "Visible in search" on their profile, plus your
   friends (whether or not they're visible). Tap a player to see their
   profile. Hosts add, rename and remove players from an event's Setup step
   instead. You can set your own DUPR rating here — it's used to seed
   players in events that seed by rating. */
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
  const mine = allPlayers.find(p => p.id === myId);
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

      {mine ? (
        <>
          <SectionTitle first>You</SectionTitle>
          <Card><MyRow p={mine} /></Card>
          {!meVisible ? (
            <Hint style={{ marginTop: -4, marginBottom: 6 }}>
              You're hidden from search. Turn on "Visible in search" in your profile so others can find you and add you as a friend.
            </Hint>
          ) : null}
        </>
      ) : null}

      {me ? (
        <>
          <SectionTitle first={!mine}>Friends ({friends.length})</SectionTitle>
          <Card>
            {friends.length === 0 ? (
              <EmptyState icon="person-add">{q ? 'No friends match your search.' : 'No friends yet — tap Add friend on a player below.'}</EmptyState>
            ) : friends.map(p => <PlayerRow key={p.id} p={p} onPress={() => open(p.id)} isFriend />)}
          </Card>
        </>
      ) : null}

      <SectionTitle first={!me}>Players ({visible.length})</SectionTitle>
      <Hint style={{ marginTop: -6, marginBottom: 10 }}>
        Everyone who has chosen to be visible in search. Tap a player to see their profile.
      </Hint>
      <Card>
        {visible.length === 0 ? (
          <EmptyState icon="people">{q ? `No players match "${query.trim()}".` : 'No one is visible in search yet.'}</EmptyState>
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

/* Your own row: set or change your DUPR rating. */
function MyRow({ p }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(p.dupr != null ? String(p.dupr) : '');
  const [error, setError] = useState(null);

  function save() {
    const r = setPlayerDupr(p.id, text);
    if (r.error) { setError(r.error); return; }
    setError(null);
    setEditing(false);
  }

  return (
    <View style={styles.mine}>
      <View style={styles.nameRow}>
        <Text style={styles.name} numberOfLines={1}>{p.name} <Text style={styles.you}>(you)</Text></Text>
        <GenderChip gender={p.gender} />
        <DuprChip dupr={p.dupr} />
        {!editing ? <Btn title={p.dupr != null ? 'Edit DUPR' : 'Set my DUPR'} variant="ghost" small onPress={() => { setText(p.dupr != null ? String(p.dupr) : ''); setEditing(true); }} /> : null}
      </View>
      {editing ? (
        <View style={styles.editBox}>
          <TextField label="Your DUPR doubles rating" value={text} onChangeText={setText} keyboardType="decimal-pad" placeholder="e.g. 3.742 — leave empty to clear" autoFocus />
          {error ? <Banner>{error}</Banner> : null}
          <View style={styles.actions}>
            <Btn title="Cancel" variant="ghost" small onPress={() => { setEditing(false); setError(null); }} />
            <Btn title="Save" small onPress={save} />
          </View>
          <Hint style={{ marginTop: 0 }}>Used to seed players in events that seed by rating. It isn't synced with DUPR — update it when your rating changes.</Hint>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' },
  name: { fontWeight: '600', fontSize: 14, flexShrink: 1, color: colors.ink },
  you: { fontWeight: '400', color: colors.slate },
  mine: { paddingVertical: 11, gap: 10 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14, paddingHorizontal: 12,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.white,
  },
  searchInput: { flex: 1, paddingVertical: 9, fontSize: 14, color: colors.ink },
  friendTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: colors.courtTint },
  friendTagText: { fontSize: 11.5, fontWeight: '600', color: colors.courtDeep },
  editBox: { gap: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
