import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Screen, SectionTitle, Card, Row, GenderChip, Hint, EmptyState } from '../../lib/ui';
import { useStore } from '../../lib/store';
import { colors } from '../../lib/theme';

/* Only people who have an account (they claimed the spot their host added)
   are listed here, read-only. Hosts add, rename and remove players from an
   event's Setup step instead. */
export default function PlayersScreen() {
  const players = useStore(s => s.players.filter(p => p.claimed));

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
          <Row key={p.id}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
              <GenderChip gender={p.gender} />
            </View>
          </Row>
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  nameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  name: { fontWeight: '600', fontSize: 14, flexShrink: 1, color: colors.ink },
});
