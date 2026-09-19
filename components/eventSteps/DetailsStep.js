import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { SectionTitle, Card, Hint, EmptyState, Field, GenderDot, Badge } from '../../lib/ui';
import { getHist } from '../../lib/engine';
import { useStore, setFlagThreshold } from '../../lib/store';
import { colors } from '../../lib/theme';

/* This step is intentionally global, not scoped to the current event — it
   mirrors the original app's History tab, which reports rolling pairing
   coverage and past sessions across the whole group. */
export default function DetailsStep() {
  const players = useStore(s => s.players);
  const history = useStore(s => s.history);
  const flagThreshold = useStore(s => s.flagThreshold);
  const events = useStore(s => s.events);

  if (players.length < 2) return <EmptyState icon="stats-chart">Add at least two players to see pairing coverage.</EmptyState>;

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
      <SectionTitle first>Rolling coverage across {sessionCount} published session(s)</SectionTitle>
      <Card lift>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={styles.bignum}>{relDone}</Text>
          <Text style={styles.meta}>of {relTotal} partner+opponent relationships completed</Text>
        </View>
        <Hint>{fullyCovered} pairs fully covered (partnered and opposed at least once) · {partial} partially · {none} not yet.</Hint>
      </Card>

      <SectionTitle>Nudge threshold</SectionTitle>
      <Card>
        <Field label="Flag a pair after this many sessions with zero games together">
          <TextInput
            value={String(flagThreshold)} keyboardType="number-pad" style={styles.input}
            onChangeText={setFlagThreshold}
          />
        </Field>
      </Card>

      <SectionTitle>Pairs to steer toward ({flagged.length})</SectionTitle>
      <Card>
        {flagged.length === 0 ? (
          <EmptyState icon="checkmark-circle">None yet — either everyone has met, or you haven't hit the session threshold.</EmptyState>
        ) : flagged.map(([a, b], i) => (
          <View key={i} style={styles.flagline}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <GenderDot gender={a.gender} /><Text>{a.name}</Text><Text> & </Text><GenderDot gender={b.gender} /><Text>{b.name}</Text>
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
  bignum: { fontWeight: '700', fontSize: 32, color: colors.courtDeep },
  meta: { fontSize: 12, color: colors.slate },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: 7, padding: 9, fontSize: 14, backgroundColor: '#fff' },
  flagline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
});
