import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { SectionTitle, Card, Btn, Hint, EmptyState, Field } from '../../lib/ui';
import CourtLine from '../../components/CourtLine';
import { fmtClock, offsetToClock } from '../../lib/engine';
import { advanceRound, setScore, playerDropsOut, bringBackPlayer, playerNameGender, playerName, playerGender } from '../../lib/store';
import { colors, radius } from '../../lib/theme';

export default function GamesStep({ ev }) {
  const [pid, setPid] = useState('');
  if (!ev.published) return <EmptyState icon="megaphone">Publish the roster in the Roster step before running event day.</EmptyState>;

  const idx = ev.currentRoundIndex || 0;
  const round = ev.roster[idx];
  const activePlayers = Object.entries(ev.rsvps).filter(([, r]) => r.status === 'in' || r.status === 'partial').map(([id]) => id);

  return (
    <View>
      <SectionTitle first>Round {idx + 1} of {ev.roster.length} · {fmtClock(offsetToClock(ev, round.offset))}</SectionTitle>
      <Card lift>
        <View style={styles.pillRow}>
          <Btn title="Prev round" icon="chevron-back" variant="ghost" small disabled={idx === 0} onPress={() => advanceRound(ev, -1)} />
          <Btn title="Next round" icon="chevron-forward" variant="ghost" small disabled={idx >= ev.roster.length - 1} onPress={() => advanceRound(ev, 1)} />
        </View>
        {round.courts.map(c => (
          <CourtLine key={c.court} court={c} roundIdx={idx} editable onScoreChange={(...args) => setScore(ev, ...args)} />
        ))}
        {round.sitOut && round.sitOut.length ? <Hint>Left over this round: {round.sitOut.map(id => playerNameGender(id)).join(', ')}</Hint> : null}
        {idx + 1 < ev.roster.length ? (
          <View>
            <SectionTitle style={{ marginTop: 16 }}>Up next · {fmtClock(offsetToClock(ev, ev.roster[idx + 1].offset))}</SectionTitle>
            {ev.roster[idx + 1].courts.map(c => <CourtLine key={c.court} court={c} roundIdx={idx + 1} editable={false} />)}
          </View>
        ) : null}
      </Card>

      <SectionTitle>No-show / drop-out</SectionTitle>
      <Card>
        <Hint style={{ marginTop: 0 }}>Marking someone out recomputes only the rounds that haven't been played or announced yet. Games already shown above (before the current round) are never altered. The next waitlisted player is promoted automatically if there is one.</Hint>
        <View style={styles.grid2}>
          <Field label="Player">
            <View style={styles.pickerWrap}>
              <Picker selectedValue={pid} onValueChange={setPid}>
                <Picker.Item label="Select…" value="" />
                {activePlayers.map(id => <Picker.Item key={id} label={playerNameGender(id)} value={id} />)}
              </Picker>
            </View>
          </Field>
          <Btn title="Mark no-show / out" variant="clay" onPress={() => { if (pid) { playerDropsOut(ev, pid); setPid(''); } }} />
        </View>
        {ev.noShows.length ? (
          <View>
            <Hint>Already marked out today — bring one back if they turn up after all:</Hint>
            {ev.noShows.map(id => (
              <View key={id} style={styles.flagline}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text>{playerName(id)}</Text>
                </View>
                <Btn title="Bring back" variant="outline" small onPress={() => bringBackPlayer(ev, id)} />
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  grid2: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', marginTop: 10 },
  pickerWrap: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden' },
  flagline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
});
