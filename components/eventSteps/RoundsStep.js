import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SectionTitle, Card, Btn, Hint, EmptyState, GenderDot, LockedNote } from '../../lib/ui';
import { showConfirm } from '../../lib/confirm';
import CourtLine from '../../components/CourtLine';
import Standings from '../../components/Standings';
import { fmtClock, offsetToClock, eventOptions } from '../../lib/engine';
import { advanceRound, setScore, checkInPlayer, playerName, playerGender, playerNameGender, startGames, stopGames } from '../../lib/store';
import { colors, radius } from '../../lib/theme';

/* Event day. The host runs it: start/stop games, move between rounds, and
   check players in. Everyone else follows along and can enter the score of
   a game they're playing in (the server holds non-hosts to that too — see
   enforceEventHosts). Standings show when the event has them turned on. */
export default function RoundsStep({ ev, canEdit, meId }) {
  if (!ev.published) {
    return <EmptyState icon="megaphone">{canEdit ? 'Publish the roster in the Roster step before running event day.' : 'The rounds show here once the host publishes the roster.'}</EmptyState>;
  }

  const idx = ev.currentRoundIndex || 0;
  const round = ev.roster[idx];
  const started = !!ev.started;
  const options = eventOptions(ev);
  // Host: any score. Player: the scores of games they're in.
  const canScore = court => canEdit || (!!meId && [...(court.teamA || []), ...(court.teamB || [])].includes(meId));

  function onStop() {
    showConfirm('Stop games? Setup, RSVPs, courts, the roster and check-in become editable again. Scores already entered are kept.', () => stopGames(ev), 'Stop games');
  }
  function onStart() {
    showConfirm('Start games? Setup, RSVPs, courts, the roster and check-in will all be locked — only scores can be entered from then on.', () => startGames(ev), 'Start games');
  }

  return (
    <View>
      {canEdit ? (
        <Card>
          <View style={styles.pillRow}>
            {started
              ? <Btn title="Stop games" icon="stop" variant="female" onPress={onStop} />
              : <Btn title="Start games" icon="play" onPress={onStart} />}
          </View>
          <Hint style={{ marginTop: 0 }}>
            {started
              ? 'Games are in progress — everything except scores is locked. Stop games to unlock it again.'
              : 'Starting games locks setup, RSVPs, courts, the roster and check-in, leaving only scores editable.'}
          </Hint>
        </Card>
      ) : (
        <Hint style={{ marginTop: 0, marginBottom: 8 }}>The host runs the rounds. You can enter the score of any game you're playing in.</Hint>
      )}

      <SectionTitle>Round {idx + 1} of {ev.roster.length} · {fmtClock(offsetToClock(ev, round.offset))}</SectionTitle>
      <Card lift>
        {canEdit ? (
          <View style={styles.pillRow}>
            <Btn title="Prev round" icon="chevron-back" variant="ghost" small disabled={idx === 0} onPress={() => advanceRound(ev, -1)} />
            <Btn title="Next round" icon="chevron-forward" variant="ghost" small disabled={idx >= ev.roster.length - 1} onPress={() => advanceRound(ev, 1)} />
          </View>
        ) : null}
        {round.courts.map(c => (
          <CourtLine key={c.court} ev={ev} court={c} roundIdx={idx} editable={canScore(c)} onScoreChange={(...args) => setScore(ev, ...args)} />
        ))}
        {round.sitOut && round.sitOut.length ? <Hint>Sitting out this round: {round.sitOut.map(id => playerNameGender(id)).join(', ')}</Hint> : null}
        {idx + 1 < ev.roster.length ? (
          <View>
            <SectionTitle style={{ marginTop: 16 }}>Up next · {fmtClock(offsetToClock(ev, ev.roster[idx + 1].offset))}</SectionTitle>
            {ev.roster[idx + 1].courts.map(c => <CourtLine key={c.court} ev={ev} court={c} roundIdx={idx + 1} editable={false} />)}
          </View>
        ) : null}
      </Card>

      {options.standings !== 'off' ? (
        <View>
          <SectionTitle>Standings</SectionTitle>
          <Standings ev={ev} mode={options.standings} meId={meId} />
        </View>
      ) : null}

      {canEdit ? <CheckIn ev={ev} started={started} /> : null}
    </View>
  );
}

/* Host check-in: everyone who said they're coming (and anyone marked out),
   each with Here / Not here. Not here takes them out of the rounds not yet
   played; Here brings a late arrival back in. */
function CheckIn({ ev, started }) {
  const coming = Object.entries(ev.rsvps || {}).filter(([, r]) => r.status === 'in' || r.status === 'partial').map(([id]) => id);
  const ids = [...new Set([...coming, ...(ev.noShows || [])])].sort((a, b) => playerName(a).localeCompare(playerName(b)));
  const checked = ev.checkedIn || {};
  const out = new Set(ev.noShows || []);
  const hereCount = ids.filter(id => checked[id] === true && !out.has(id)).length;

  return (
    <View>
      <SectionTitle>Check-in ({hereCount} of {ids.length} here)</SectionTitle>
      <Card>
        {started ? <LockedNote>Games have started — check-in is locked. Stop games to change it.</LockedNote> : null}
        <Hint style={{ marginTop: 0 }}>Mark who's here. "Not here" takes a player out of the rounds that haven't been played yet (the next waitlisted player is promoted); "Here" brings a late arrival back in.</Hint>
        {ids.map(id => {
          const state = out.has(id) ? 'out' : checked[id] === true ? 'here' : 'unknown';
          return (
            <View key={id} style={styles.checkRow}>
              <View style={styles.checkName}>
                <Text style={[styles.checkText, state === 'out' && styles.outText]} numberOfLines={1}>{playerName(id)}</Text>
                <GenderDot gender={playerGender(id)} size={14} />
              </View>
              <Choice label="Here" name={playerName(id)} active={state === 'here'} tone="ok" disabled={started} onPress={() => checkInPlayer(ev, id, true)} />
              <Choice label="Not here" name={playerName(id)} active={state === 'out'} tone="bad" disabled={started} onPress={() => checkInPlayer(ev, id, false)} />
            </View>
          );
        })}
      </Card>
    </View>
  );
}

function Choice({ label, name, active, tone, disabled, onPress }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[styles.choice, active && (tone === 'ok' ? styles.choiceOk : styles.choiceBad), disabled && { opacity: 0.45 }]}
      accessibilityRole="button" accessibilityLabel={`${label}: ${name}`} accessibilityState={{ selected: active, disabled }}
    >
      <Text style={[styles.choiceText, active && { color: tone === 'ok' ? colors.ballText : colors.clay }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', gap: 8, marginBottom: 10, justifyContent: 'flex-end' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  checkName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  checkText: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  outText: { color: colors.slate, textDecorationLine: 'line-through' },
  choice: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: colors.white },
  choiceOk: { borderColor: colors.ball, backgroundColor: colors.ballTint },
  choiceBad: { borderColor: colors.clay, backgroundColor: colors.clayTint },
  choiceText: { fontSize: 12.5, fontWeight: '600', color: colors.slate },
});
