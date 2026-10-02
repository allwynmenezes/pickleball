import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SectionTitle, Card, Hint, EmptyState, TextField, GenderDot, Badge, BigNum } from '../../lib/ui';
import { getHist } from '../../lib/engine';
import { useStore, setFlagThreshold } from '../../lib/store';
import { colors } from '../../lib/theme';

/* Pairing coverage uses the whole group's history (every published
   session), but only for the players in this event — a pair that never
   met only matters if both are here to be steered together. */
export default function DetailsStep({ ev }) {
  const allPlayers = useStore(s => s.players);
  const memberIds = (ev && ev.memberIds) || [];
  const players = allPlayers.filter(p => memberIds.includes(p.id));
  const history = useStore(s => s.history);
  const flagThreshold = useStore(s => s.flagThreshold);
  const events = useStore(s => s.events);

  if (players.length < 2) return <EmptyState icon="stats-chart">Add at least two players to this event to see their pairing coverage.</EmptyState>;

  let fullyCovered = 0, partial = 0, none = 0, totalPairs = 0;
  const flagged = [];
  const sessionCount = events.filter(e => e.published).length;
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    totalPairs++;
    const h = getHist(history, players[i].id, players[j].id);
    const hasPartner = h.partner > 0, hasOpp = h.opponent > 0;
    if (hasPartner && hasOpp) fullyCovered++;
    else if (hasPartner || hasOpp) partial++;
    else { none++; if (sessionCount >= flagThreshold) flagged.push([players[i], players[j]]); }
  }
  const relDone = fullyCovered * 2 + partial;
  const relTotal = totalPairs * 2;
  const publishedEvents = events.filter(e => e.published).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <View>
      <SectionTitle first>Coverage for this event's {players.length} players across {sessionCount} published session(s)</SectionTitle>
      <Card lift>
        <BigNum value={relDone} label={`of ${relTotal} partner+opponent relationships completed`} />
        <Hint>{fullyCovered} pairs fully covered (partnered and opposed at least once) · {partial} partially · {none} not yet.</Hint>
      </Card>

      <SectionTitle>Nudge threshold</SectionTitle>
      <Card>
        <TextField
          label="Flag a pair after this many sessions with zero games together"
          value={String(flagThreshold)} keyboardType="number-pad" onChangeText={setFlagThreshold}
        />
      </Card>

      <SectionTitle>Pairs to steer toward ({flagged.length})</SectionTitle>
      <Card>
        {flagged.length === 0 ? (
          <EmptyState icon="checkmark-circle">None yet — either everyone has met, or you haven't hit the session threshold.</EmptyState>
        ) : flagged.map(([a, b], i) => (
          <View key={i} style={styles.flagline}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text>{a.name}</Text><GenderDot gender={a.gender} /><Text> & </Text><Text>{b.name}</Text><GenderDot gender={b.gender} />
            </View>
            <Badge label="never matched" kind="flag" />
          </View>
        ))}
      </Card>

      <SectionTitle>Past events</SectionTitle>
      <Card>
        {publishedEvents.length === 0 ? (
          <EmptyState icon="calendar">No published events yet.</EmptyState>
        ) : publishedEvents.map(e => (
          <View key={e.id} style={styles.flagline}>
            <Text>{e.name}</Text>
            <Text style={styles.meta}>{e.date} · {e.roster.reduce((s, r) => s + r.courts.length, 0)} games</Text>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  meta: { fontSize: 12, color: colors.slate },
  flagline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
});
