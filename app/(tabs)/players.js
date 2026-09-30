import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, SectionTitle, Card, Row, GenderChip, DuprChip, Hint, EmptyState, Btn, TextField, Banner } from '../../lib/ui';
import { useStore, setPlayerDupr } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

/* Only people who have an account (they claimed the spot their host added)
   are listed here. Hosts add, rename and remove players from an event's
   Setup step instead. You can set your own DUPR rating here — it's used to
   seed players in events that seed by rating. */
export default function PlayersScreen() {
  const players = useStore(s => s.players.filter(p => p.claimed));
  const { player: me } = useAuth();

  return (
    <Screen>
      <SectionTitle first>Players ({players.length})</SectionTitle>
      <Hint style={{ marginTop: -6, marginBottom: 10 }}>
        Everyone who has claimed their account. To add or change players, edit an event's Setup.
      </Hint>
      <Card>
        {players.length === 0 ? (
          <EmptyState icon="people">No one has claimed an account yet — share an invite link from an event's RSVP step.</EmptyState>
        ) : players.map(p => (
          p.id === (me && me.id) ? <MyRow key={p.id} p={p} /> : (
            <Row key={p.id}>
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                <GenderChip gender={p.gender} />
                <DuprChip dupr={p.dupr} />
              </View>
            </Row>
          )
        ))}
      </Card>
    </Screen>
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
  mine: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 10 },
  editBox: { gap: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
