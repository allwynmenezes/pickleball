import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, EmptyState } from '../../lib/ui';
import CourtLine from '../../components/CourtLine';
import { useStore } from '../../lib/store';
import { fmtClock, offsetToClock } from '../../lib/engine';
import { colors } from '../../lib/theme';

export default function GamesScreen() {
  const router = useRouter();
  const events = useStore(s => s.events);
  const published = events.filter(e => e.published && e.roster).sort((a, b) => b.date.localeCompare(a.date));

  if (published.length === 0) {
    return (
      <Screen>
        <EmptyState icon="grid">No games yet — publish a roster from an event (in its Roster step) to see its games here.</EmptyState>
      </Screen>
    );
  }

  return (
    <Screen>
      {published.map(ev => {
        const totalGames = ev.roster.reduce((s, r) => s + r.courts.length, 0);
        return (
          <View key={ev.id}>
            <SectionTitle onPress={() => router.push({ pathname: '/event/[id]', params: { id: ev.id, step: 'games' } })}>
              {ev.name} · {ev.date}
            </SectionTitle>
            <Card lift style={{ marginBottom: 8 }}>
              <Text style={styles.meta}>{totalGames} games · {ev.roster.length} rounds</Text>
            </Card>
            <Card style={{ marginBottom: 16 }}>
              {ev.roster.map((r, idx) => (
                <View key={idx} style={styles.roundBlock}>
                  <Text style={styles.roundHead}>{idx === 0 ? 'Warm-up · ' : ''}{fmtClock(offsetToClock(ev, r.offset))}</Text>
                  {r.courts.map(c => <CourtLine key={c.court} court={c} roundIdx={idx} editable={false} />)}
                </View>
              ))}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: 12, color: colors.slate },
  roundBlock: { marginBottom: 10 },
  roundHead: { fontWeight: '600', fontSize: 14, marginBottom: 6, color: colors.ink },
});
