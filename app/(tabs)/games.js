import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { pushOnce } from '../../lib/nav';
import { Screen, SectionTitle, Card, EmptyState, Btn } from '../../lib/ui';
import CourtLine from '../../components/CourtLine';
import { useStore } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { fmtClock, offsetToClock } from '../../lib/engine';
import { colors } from '../../lib/theme';

/* The signed-in player's own games across every published roster, newest
   first (by event date, then start time, then round time). */
export default function GamesScreen() {
  const router = useRouter();
  const events = useStore(s => s.events);
  const { player: me } = useAuth();

  if (!me) {
    return (
      <Screen>
        <EmptyState icon="grid">
          <Text style={styles.emptyText}>Log in to see the games you're playing in.</Text>
          <Btn title="Log in" small onPress={() => pushOnce(router, '/login')} style={{ marginTop: 12, alignSelf: 'center' }} />
        </EmptyState>
      </Screen>
    );
  }

  const games = [];
  events.filter(e => e.published && e.roster).forEach(ev => {
    ev.roster.forEach((round, roundIdx) => {
      round.courts.forEach(court => {
        if (court.teamA.includes(me.id) || court.teamB.includes(me.id)) games.push({ ev, round, roundIdx, court });
      });
    });
  });
  games.sort((a, b) =>
    b.ev.date.localeCompare(a.ev.date)
    || b.ev.startTime.localeCompare(a.ev.startTime)
    || b.round.offset - a.round.offset
    || b.court.court - a.court.court);

  if (games.length === 0) {
    return (
      <Screen>
        <EmptyState icon="grid">You're not in any published games yet.</EmptyState>
      </Screen>
    );
  }

  // Group consecutive games from the same event under one heading.
  const groups = [];
  games.forEach(g => {
    const last = groups[groups.length - 1];
    if (last && last.ev.id === g.ev.id) last.games.push(g);
    else groups.push({ ev: g.ev, games: [g] });
  });

  return (
    <Screen>
      {groups.map(({ ev, games: evGames }) => (
        <View key={ev.id}>
          <SectionTitle onPress={() => pushOnce(router, { pathname: '/event/[id]', params: { id: ev.id, step: 'rounds' } })}>
            {ev.name} · {ev.date}
          </SectionTitle>
          <Card style={{ marginBottom: 16 }}>
            {evGames.map(({ round, roundIdx, court }) => (
              <View key={`${roundIdx}-${court.court}`} style={styles.game}>
                <Text style={styles.gameTime}>{roundIdx === 0 ? 'Warm-up · ' : ''}{fmtClock(offsetToClock(ev, round.offset))}</Text>
                <CourtLine ev={ev} court={court} roundIdx={roundIdx} editable={false} />
              </View>
            ))}
          </Card>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emptyText: { color: colors.slate, fontSize: 13, textAlign: 'center' },
  game: { marginBottom: 6 },
  gameTime: { fontWeight: '600', fontSize: 13, color: colors.ink, marginTop: 4 },
});
