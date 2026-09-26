import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectionTitle, Card, Btn, Hint, EmptyState, Select, GenderDot, LockedNote } from '../../lib/ui';
import { showConfirm } from '../../lib/confirm';
import CourtLine from '../../components/CourtLine';
import { fmtClock, offsetToClock } from '../../lib/engine';
import { advanceRound, setScore, playerDropsOut, bringBackPlayer, playerNameGender, playerName, playerGender, startGames, stopGames } from '../../lib/store';
import { colors } from '../../lib/theme';

export default function RoundsStep({ ev }) {
  const [pid, setPid] = useState('');
  if (!ev.published) return <EmptyState icon="megaphone">Publish the roster in the Roster step before running event day.</EmptyState>;

  const idx = ev.currentRoundIndex || 0;
  const round = ev.roster[idx];
  const activePlayers = Object.entries(ev.rsvps).filter(([, r]) => r.status === 'in' || r.status === 'partial').map(([id]) => id);

  const started = !!ev.started;
  function onStop() {
    showConfirm('Stop games? Setup, RSVPs, courts, the roster and no-shows become editable again. Scores already entered are kept.', () => stopGames(ev), 'Stop games');
  }
  function onStart() {
    showConfirm('Start games? Setup, RSVPs, courts, the roster and no-shows will all be locked — only scores can be entered from then on.', () => startGames(ev), 'Start games');
  }

  return (
    <View>
      <Card>
        <View style={styles.pillRow}>
          {started
            ? <Btn title="Stop games" icon="stop" variant="female" onPress={onStop} />
            : <Btn title="Start games" icon="play" onPress={onStart} />}
        </View>
        <Hint style={{ marginTop: 0 }}>
          {started
            ? 'Games are in progress — everything except scores is locked. Stop games to unlock it again.'
            : 'Starting games locks setup, RSVPs, courts, the roster and no-shows, leaving only the scores below editable.'}
        </Hint>
      </Card>
      <SectionTitle>Round {idx + 1} of {ev.roster.length} · {fmtClock(offsetToClock(ev, round.offset))}</SectionTitle>
      <Card lift>
        <View style={styles.pillRow}>
          <Btn title="Prev round" icon="chevron-back" variant="ghost" small disabled={idx === 0} onPress={() => advanceRound(ev, -1)} />
          <Btn title="Next round" icon="chevron-forward" variant="ghost" small disabled={idx >= ev.roster.length - 1} onPress={() => advanceRound(ev, 1)} />
        </View>
        {round.courts.map(c => (
          <CourtLine key={c.court} ev={ev} court={c} roundIdx={idx} editable onScoreChange={(...args) => setScore(ev, ...args)} />
        ))}
        {round.sitOut && round.sitOut.length ? <Hint>Left over this round: {round.sitOut.map(id => playerNameGender(id)).join(', ')}</Hint> : null}
        {idx + 1 < ev.roster.length ? (
          <View>
            <SectionTitle style={{ marginTop: 16 }}>Up next · {fmtClock(offsetToClock(ev, ev.roster[idx + 1].offset))}</SectionTitle>
            {ev.roster[idx + 1].courts.map(c => <CourtLine key={c.court} ev={ev} court={c} roundIdx={idx + 1} editable={false} />)}
          </View>
        ) : null}
      </Card>

      <SectionTitle>No-show / drop-out</SectionTitle>
      <Card>
        {started ? <LockedNote>Games have started — no-shows are locked.</LockedNote> : null}
        <Hint style={{ marginTop: 0 }}>Marking someone out recomputes only the rounds that haven't been played or announced yet. Games already shown above (before the current round) are never altered. The next waitlisted player is promoted automatically if there is one.</Hint>
        <View style={styles.grid2}>
          <Select
            disabled={started}
            value={pid} onValueChange={setPid} placeholder="Select a player…"
            items={activePlayers.map(id => ({ label: playerNameGender(id), value: id }))}
          />
          <Btn
            title="Mark no-show / out" icon="person-remove" variant="ghost" small dangerText
            onPress={() => { if (pid) { playerDropsOut(ev, pid); setPid(''); } }}
            disabled={started}
            style={{ height: 38, paddingVertical: 0 }}
          />
        </View>
        {ev.noShows.length ? (
          <View>
            <Hint>Already marked out today — bring one back if they turn up after all:</Hint>
            {ev.noShows.map(id => (
              <View key={id} style={styles.flagline}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text>{playerName(id)}</Text>
                  <GenderDot gender={playerGender(id)} />
                </View>
                <Btn title="Bring back" variant="outline" small disabled={started} onPress={() => bringBackPlayer(ev, id)} style={{ height: 38, paddingVertical: 0 }} />
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 10, justifyContent: 'flex-end' },
  grid2: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 10 },
  flagline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
});
