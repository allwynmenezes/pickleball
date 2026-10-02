import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectionTitle, Card, Btn, Banner, EmptyState, Hint, BigNum, GenderDot, LockedNote, Checkbox } from '../../lib/ui';
import { MODE_LABEL } from '../../components/CourtLine';
import { getConfirmedAndWaitlist, fmtClock, offsetToClock, gameLen, segmentGameLen, perCourt, usesFormatEngine, resultsDriven, isBreakRound } from '../../lib/engine';
import { formatLabel } from '../../lib/formats';
import { previewRoster, publishRoster, useStore, playerNameGender, playerName, playerGender, courtLabel, setSwitchAfterWarmup } from '../../lib/store';

import { colors } from '../../lib/theme';

function MatchupRow({ ev, court, offset }) {
  return (
    <View style={styles.matchWrap}>
      <View style={styles.matchHead}>
        <Text style={styles.courtNo}>{courtLabel(ev, court.court, offset)}</Text>
        <Text style={styles.courtMeta}>({MODE_LABEL[court.mode]}{court.flagged ? ' · fallback' : ''})</Text>
      </View>
      <View style={styles.matchRow}>
        <View style={styles.teamLeft}>
          {court.teamA.map(id => (
            <View key={id} style={styles.teamItemLeft}>
              <Text style={styles.teamNameLeft} numberOfLines={1}>{playerName(id)}</Text>
              <GenderDot gender={playerGender(id)} size={16} />
            </View>
          ))}
        </View>
        <Text style={styles.vs}>vs</Text>
        <View style={styles.teamRight}>
          {court.teamB.map(id => (
            <View key={id} style={styles.teamItemRight}>
              <Text style={styles.teamNameRight} numberOfLines={1}>{playerName(id)}</Text>
              <GenderDot gender={playerGender(id)} size={16} />
            </View>
          ))}
        </View>
      </View>
      {court.flagged ? <Banner>Not enough eligible players for the planned mode — this court fell back to any combination.</Banner> : null}
    </View>
  );
}

/* The roster as rows to show: game rounds one by one, and each run of
   break rounds (every court resting) folded into a single "Break" row. */
function rosterRows(ev) {
  const rows = [];
  ev.roster.forEach((r, idx) => {
    const last = rows[rows.length - 1];
    if (!isBreakRound(ev, r)) rows.push({ kind: 'round', round: r, idx });
    else if (last && last.kind === 'break') last.idxs.push(idx);
    else rows.push({ kind: 'break', idxs: [idx] });
  });
  rows.forEach(row => {
    if (row.kind !== 'break') return;
    const after = ev.roster[row.idxs[row.idxs.length - 1] + 1];
    row.start = ev.roster[row.idxs[0]].offset;
    row.end = after ? after.offset : ev.durationMin;
  });
  return rows;
}

function roundLenLabel(ev) {
  const lens = Array.from(new Set((ev.segments || []).map(s => segmentGameLen(ev, s))));
  if (lens.length <= 1) return `rounds (${lens[0] || gameLen(ev)} min each)`;
  return `rounds (${lens.join(' / ')} min, by segment)`;
}

export default function RosterStep({ ev }) {
  const players = useStore(s => s.players);
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const need = perCourt(ev);
  const notEnough = confirmed.length + waitlist.length < need;
  const formats = usesFormatEngine(ev);

  if (notEnough) return <EmptyState icon="list">Need at least {need} confirmed players (In/Partial) before a roster can be generated.</EmptyState>;

  const totalGames = ev.roster ? ev.roster.reduce((s, r) => s + r.courts.length, 0) : 0;
  const flaggedCount = ev.roster ? ev.roster.reduce((s, r) => s + r.courts.filter(c => c.flagged).length, 0) : 0;
  const sitOutRounds = ev.roster ? ev.roster.filter(r => r.sitOut && r.sitOut.length) : [];
  const gameRounds = ev.roster ? ev.roster.filter(r => !isBreakRound(ev, r)).length : 0;
  const cur = ev.currentRoundIndex || 0;

  return (
    <View>
      {ev.started ? <LockedNote /> : null}
      <Card>
        <View style={styles.pillRow}>
          <Btn title={ev.roster ? 'Regenerate' : 'Generate roster'} variant="outline" disabled={!!ev.started} onPress={() => previewRoster(ev)} />
          {ev.roster ? <Btn title={ev.published ? 'Re-publish' : 'Publish roster'} disabled={!!ev.started} onPress={() => publishRoster(ev)} /> : null}
        </View>
        <Hint>
          {ev.published
            ? "Published — rounds already played or announced (before the current round on the Rounds step) are always kept exactly as they happened; regenerating only rebuilds what's left, and scores can only be entered from the Rounds step."
            : 'Preview freely; nothing counts toward pairing history until you publish.'}
        </Hint>
        {formats ? (
          <Hint style={{ marginTop: 10 }}>
            Format: {formatLabel(ev)}.{resultsDriven(ev) ? ' Later rounds depend on results, so they\'re remade as scores come in — what\'s shown for them now is provisional.' : ''}
          </Hint>
        ) : null}
        {formats ? null : <Checkbox
          label="Switch players after warm-up"
          checked={!!ev.switchAfterWarmup}
          onChange={(v) => setSwitchAfterWarmup(ev, v)}
          disabled={!!ev.started}
          style={{ marginTop: 10 }}
        />}
        {formats ? null : <Hint style={{ marginTop: 2 }}>
          {ev.switchAfterWarmup
            ? 'The round after warm-up gets fresh pairings.'
            : 'The round after warm-up keeps the exact warm-up games (same partners and opponents), as long as everyone is still available.'}
        </Hint>}
      </Card>

      {!ev.roster ? <EmptyState icon="list">No roster generated yet.</EmptyState> : null}

      {ev.roster ? (
        <View>
          <SectionTitle>Overview</SectionTitle>
          <Card lift>
            <View style={styles.grid3}>
              <BigNum value={totalGames} label="games scheduled" />
              <BigNum value={gameRounds} label={roundLenLabel(ev)} />
              <BigNum value={flaggedCount} label="mode fallbacks" />
            </View>
            {sitOutRounds.length ? <Banner>{sitOutRounds.length} round(s) have players sitting out (more players than court spots, or an uneven headcount) — see rounds marked below.</Banner> : null}
          </Card>

          <SectionTitle>Game-by-game roster</SectionTitle>
          {rosterRows(ev).map(row => (row.kind === 'break' ? (
            <View key={`b${row.idxs[0]}`} style={[
              styles.breakRow,
              row.idxs.includes(cur) && styles.breakCurrent,
              ev.published && row.idxs[row.idxs.length - 1] < cur && styles.roundPlayed,
            ]}>
              <Ionicons name="cafe-outline" size={15} color={colors.ballText} />
              <Text style={styles.breakText}>{fmtClock(offsetToClock(ev, row.start))} – {fmtClock(offsetToClock(ev, row.end))} · Break</Text>
              <Text style={styles.breakNote}>no games</Text>
            </View>
          ) : renderRound(row.round, row.idx)))}
        </View>
      ) : null}
    </View>
  );

  function renderRound(r, idx) {
    return (
      <View key={idx} style={[
        styles.roundBlock,
        // Before publishing the current round is the warm-up (round 0).
        idx === cur && styles.roundCurrent,
        ev.published && idx < cur && styles.roundPlayed,
      ]}>
        <Text style={styles.roundHead}>{idx === 0 ? 'Warm-up · ' : ''}{fmtClock(offsetToClock(ev, r.offset))}{r.repeatsWarmup ? <Text style={styles.roundNote}> · same players as warm-up</Text> : null}{r.groupSet && r.groupSet.pools ? <Text style={styles.roundNote}> · pools</Text> : r.groupSet ? <Text style={styles.roundNote}> · groups{new Set(r.groupSet.ns || [r.groupSet.n]).size === 1 ? `, game ${r.groupSet.n + 1} of ${r.groupSet.len || 3}` : ''}</Text> : null}{r.provisional ? <Text style={styles.roundNote}> · provisional</Text> : null}</Text>
        {r.courts.map(c => <MatchupRow key={c.court} ev={ev} court={c} offset={r.offset} />)}
        {r.sitOut && r.sitOut.length ? <Hint>Left over this round: {r.sitOut.map(id => playerNameGender(id)).join(', ')}</Hint> : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' },
  grid3: { flexDirection: 'row', justifyContent: 'space-between' },
  roundBlock: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 13, marginBottom: 10, backgroundColor: colors.white },
  roundCurrent: { borderColor: colors.court, backgroundColor: colors.courtTint },
  roundPlayed: { opacity: 0.55 },
  breakRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 10,
    backgroundColor: colors.ballTint, borderLeftWidth: 3, borderLeftColor: colors.ball,
  },
  breakCurrent: { borderWidth: 1, borderColor: colors.ballText, borderLeftWidth: 3 },
  breakText: { fontWeight: '600', fontSize: 14, color: colors.ballText, flex: 1 },
  breakNote: { fontSize: 12, color: colors.ballText },
  roundHead: { fontWeight: '600', fontSize: 14, marginBottom: 8, color: colors.ink },
  roundNote: { fontWeight: '400', color: colors.slate, fontSize: 12 },
  matchWrap: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 6 },
  matchHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  courtNo: { fontWeight: '600', color: colors.ink, fontSize: 13 },
  courtMeta: { fontSize: 12, color: colors.slate },
  matchRow: { flexDirection: 'row', alignItems: 'center' },
  teamLeft: { flex: 1, gap: 3 },
  teamRight: { flex: 1, gap: 3 },
  teamItemLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  teamItemRight: { flexDirection: 'row', alignItems: 'center', gap: 5, justifyContent: 'flex-end' },
  teamNameLeft: { fontSize: 13, color: colors.ink },
  teamNameRight: { fontSize: 13, color: colors.ink, textAlign: 'right' },
  vs: { color: colors.slate, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginHorizontal: 8 },
});
