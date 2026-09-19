import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SectionTitle, Card, Btn, Banner, EmptyState, Hint } from '../../lib/ui';
import CourtLine from '../../components/CourtLine';
import { getConfirmedAndWaitlist, fmtClock, offsetToClock } from '../../lib/engine';
import { previewRoster, publishRoster, useStore, playerNameGender } from '../../lib/store';

import { colors } from '../../lib/theme';

export default function RosterStep({ ev }) {
  const players = useStore(s => s.players);
  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const notEnough = confirmed.length + waitlist.length < 4;

  if (notEnough) return <EmptyState icon="list">Need at least 4 confirmed players (In/Partial) before a roster can be generated.</EmptyState>;

  const totalGames = ev.roster ? ev.roster.reduce((s, r) => s + r.courts.length, 0) : 0;
  const flaggedCount = ev.roster ? ev.roster.reduce((s, r) => s + r.courts.filter(c => c.flagged).length, 0) : 0;
  const sitOutRounds = ev.roster ? ev.roster.filter(r => r.sitOut && r.sitOut.length) : [];

  return (
    <View>
      <Card>
        <View style={styles.pillRow}>
          <Btn title={ev.roster ? 'Regenerate' : 'Generate roster'} variant="outline" onPress={() => previewRoster(ev)} />
          {ev.roster ? <Btn title={ev.published ? 'Re-publish' : 'Publish roster'} onPress={() => publishRoster(ev)} /> : null}
        </View>
        <Hint>
          {ev.published
            ? "Published — rounds already played or announced (before the current round on the Games step) are always kept exactly as they happened; regenerating only rebuilds what's left, and scores can only be entered from the Games step."
            : 'Preview freely; nothing counts toward pairing history until you publish.'}
        </Hint>
      </Card>

      {!ev.roster ? <EmptyState icon="list">No roster generated yet.</EmptyState> : null}

      {ev.roster ? (
        <View>
          <SectionTitle>Overview</SectionTitle>
          <Card lift>
            <View style={styles.grid3}>
              <View><Text style={styles.bignum}>{totalGames}</Text><Text style={styles.meta}>games scheduled</Text></View>
              <View><Text style={styles.bignum}>{ev.roster.length}</Text><Text style={styles.meta}>rounds (15 min each)</Text></View>
              <View><Text style={styles.bignum}>{flaggedCount}</Text><Text style={styles.meta}>mode fallbacks</Text></View>
            </View>
            {sitOutRounds.length ? <Banner>{sitOutRounds.length} round(s) have 1–3 players left over without a full court (uneven headcount) — see rounds marked below.</Banner> : null}
          </Card>

          <SectionTitle>Game-by-game roster</SectionTitle>
          {ev.roster.map((r, idx) => (
            <View key={idx} style={[
              styles.roundBlock,
              idx === (ev.currentRoundIndex || 0) && ev.published && styles.roundCurrent,
              ev.published && idx < (ev.currentRoundIndex || 0) && styles.roundPlayed,
            ]}>
              <Text style={styles.roundHead}>{idx === 0 ? 'Warm-up · ' : ''}{fmtClock(offsetToClock(ev, r.offset))}</Text>
              {r.courts.map(c => <CourtLine key={c.court} court={c} roundIdx={idx} editable={false} />)}
              {r.sitOut && r.sitOut.length ? <Hint>Left over this round: {r.sitOut.map(id => playerNameGender(id)).join(', ')}</Hint> : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  grid3: { flexDirection: 'row', justifyContent: 'space-between' },
  bignum: { fontWeight: '700', fontSize: 28, color: colors.courtDeep },
  meta: { fontSize: 11, color: colors.slate },
  roundBlock: { borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 13, marginBottom: 10, backgroundColor: '#fff' },
  roundCurrent: { borderColor: colors.ball, backgroundColor: colors.ballTint },
  roundPlayed: { opacity: 0.55 },
  roundHead: { fontWeight: '600', fontSize: 14, marginBottom: 8, color: colors.ink },
});
