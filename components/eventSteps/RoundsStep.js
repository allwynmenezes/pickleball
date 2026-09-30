import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SectionTitle, Card, Btn, Hint, EmptyState, GenderDot, LockedNote, Banner } from '../../lib/ui';
import { showConfirm, showAlert } from '../../lib/confirm';
import CourtLine from '../../components/CourtLine';
import Standings from '../../components/Standings';
import Bracket from '../../components/Bracket';
import { fmtClock, offsetToClock, eventOptions } from '../../lib/engine';
import { seasonStandings, seriesEvents } from '../../lib/series';
import {
  advanceRound, setScore, checkInPlayer, playerName, playerGender, playerNameGender, startGames, stopGames,
  startPlayoffs, undoPlayoffs, useStore,
} from '../../lib/store';
import { colors } from '../../lib/theme';

/* Event day. The host runs it: start/stop games, move between rounds, start
   the playoffs and check players in. Everyone else follows along (live —
   see startLiveSync in lib/store.js) and can enter the score of a game
   they're playing in (the server holds non-hosts to that too — see
   enforceEventHosts). Standings show when the event has them turned on. */
export default function RoundsStep({ ev, canEdit, meId }) {
  const events = useStore(s => s.events);
  const options = eventOptions(ev);
  if (options.games === 'none') {
    return <EmptyState icon="school-outline">This event has no games (a clinic or lesson) — there are no rounds to run.</EmptyState>;
  }
  if (!ev.published) {
    return <EmptyState icon="megaphone">{canEdit ? 'Publish the roster in the Roster step before running event day.' : 'The rounds show here once the host publishes the roster.'}</EmptyState>;
  }

  const idx = ev.currentRoundIndex || 0;
  const round = ev.roster[idx];
  const next = ev.roster[idx + 1];
  const started = !!ev.started;
  const standingsMode = options.standings !== 'off' ? options.standings : (options.playoffs !== 'none' ? 'winPct' : null);
  const series = options.repeat !== 'none' ? seriesEvents(events, ev.seriesId || ev.id) : [];
  // Host: any score. Player: the scores of games they're in.
  const canScore = court => canEdit || (!!meId && [...(court.teamA || []), ...(court.teamB || [])].includes(meId));

  function onStop() {
    showConfirm('Stop games? Setup, RSVPs, courts, the roster and check-in become editable again. Scores already entered are kept.', () => stopGames(ev), 'Stop games');
  }
  function onStart() {
    showConfirm('Start games? Setup, RSVPs, courts, the roster and check-in will all be locked — only scores can be entered from then on.', () => startGames(ev), 'Start games');
  }
  function onStartPlayoffs() {
    const left = ev.roster.length - idx - 1;
    showConfirm(`End pool play${left ? ` after round ${idx + 1} (the ${left} round${left > 1 ? 's' : ''} not yet played will be dropped)` : ''} and seed a ${options.playoffs === 'double' ? 'double' : 'single'}-elimination bracket of up to ${options.playoffTeams} teams from the standings?`, () => {
      const r = startPlayoffs(ev);
      if (r.error) showAlert(r.error);
    }, 'Start playoffs');
  }
  function onUndoPlayoffs() {
    showConfirm('Go back to pool play? The bracket is removed and the rest of the event is scheduled again.', () => {
      const r = undoPlayoffs(ev);
      if (r.error) showAlert(r.error);
    }, 'Back to pool play');
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

      {ev.playoffs ? (
        <View>
          <Bracket ev={ev} canEdit={canEdit} meId={meId} />
          {canEdit && !ev.playoffs.matches.some(m => m.scoreA != null || m.scoreB != null) ? (
            <Btn title="Back to pool play" icon="arrow-undo" variant="ghost" small onPress={onUndoPlayoffs} style={{ alignSelf: 'flex-end', marginTop: 8 }} />
          ) : null}
        </View>
      ) : round ? (
        <View>
          <SectionTitle>Round {idx + 1} of {ev.roster.length} · {fmtClock(offsetToClock(ev, round.offset))}</SectionTitle>
          <Card lift>
            {canEdit ? (
              <View style={styles.pillRow}>
                <Btn title="Prev round" icon="chevron-back" variant="ghost" small disabled={idx === 0} onPress={() => advanceRound(ev, -1)} />
                <Btn title="Next round" icon="chevron-forward" variant="ghost" small disabled={idx >= ev.roster.length - 1} onPress={() => advanceRound(ev, 1)} />
              </View>
            ) : null}
            {round.groupSet && round.groupSet.pools ? <Text style={styles.note}>Pools · round {round.groupSet.n + 1} of this set</Text> : round.groupSet ? <Text style={styles.note}>Groups{new Set(round.groupSet.ns || [round.groupSet.n]).size === 1 ? ` · game ${round.groupSet.n + 1} of ${round.groupSet.len || 3}` : ' · each group plays every combination'}</Text> : null}
            {round.courts.length === 0 ? <Hint style={{ marginTop: 0 }}>Break — no games this round.</Hint> : null}
            {round.courts.map(c => (
              <CourtLine key={c.court} ev={ev} court={c} roundIdx={idx} editable={canScore(c)} onScoreChange={(...args) => setScore(ev, ...args)} />
            ))}
            {round.sitOut && round.sitOut.length ? <Hint>Sitting out this round: {round.sitOut.map(id => playerNameGender(id)).join(', ')}</Hint> : null}
            {next ? (
              <View>
                <SectionTitle style={{ marginTop: 16 }}>Up next · {fmtClock(offsetToClock(ev, next.offset))}</SectionTitle>
                {next.provisional ? <Banner kind="info">Provisional — this depends on the scores of the round being played, and updates as they come in.</Banner> : null}
                {next.courts.map(c => <CourtLine key={c.court} ev={ev} court={c} roundIdx={idx + 1} editable={false} />)}
                {next.courts.length === 0 ? <Hint>Break.</Hint> : null}
              </View>
            ) : null}
          </Card>
        </View>
      ) : null}

      {canEdit && options.playoffs !== 'none' && !ev.playoffs ? (
        <Card style={{ marginTop: 12 }}>
          <Btn title="Start playoffs" icon="trophy-outline" variant="outline" onPress={onStartPlayoffs} style={{ alignSelf: 'flex-end' }} />
          <Hint>When pool play is done: the top {options.playoffTeams} {options.partners === 'rotating' ? 'teams (the best players paired with the lowest-ranked of the top group)' : options.partners === 'singles' ? 'players' : 'pairs'} go into a {options.playoffs === 'double' ? 'double' : 'single'}-elimination bracket{options.playoffSeedFrom === 'season' && ev.seriesId ? ', seeded by season standings' : ''}.</Hint>
        </Card>
      ) : null}

      {standingsMode ? (
        <View>
          <SectionTitle>{ev.playoffs ? 'Pool play standings' : 'Standings'}</SectionTitle>
          <Standings ev={ev} mode={standingsMode} meId={meId} />
        </View>
      ) : null}

      {series.length > 1 ? (
        <View>
          <SectionTitle>Season standings · {series.length} sessions</SectionTitle>
          <Standings ev={ev} mode={standingsMode || 'winPct'} meId={meId} rows={seasonStandings(events, ev.seriesId, standingsMode || 'winPct')} />
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
  note: { fontSize: 12, fontWeight: '700', color: colors.court, marginBottom: 2 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  checkName: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  checkText: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  outText: { color: colors.slate, textDecorationLine: 'line-through' },
  choice: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: colors.white },
  choiceOk: { borderColor: colors.ball, backgroundColor: colors.ballTint },
  choiceBad: { borderColor: colors.clay, backgroundColor: colors.clayTint },
  choiceText: { fontSize: 12.5, fontWeight: '600', color: colors.slate },
});
