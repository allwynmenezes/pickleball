import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Hint, GenderDot } from '../lib/ui';
import { playerName, playerGender } from '../lib/store';
import { computeStandings, fmtPct, fmtDiff } from '../lib/standings';
import { colors, radius } from '../lib/theme';

/* Live standings from the scores entered so far (lib/standings.js). `mode`
   is the event's standings option: 'winPct' or 'courtPoints'. The
   signed-in player's row is highlighted. `rows` (already worked out, e.g.
   season standings) replaces the event's own. */
export default function Standings({ ev, mode, meId, throughRound, rows: given }) {
  const rows = given || computeStandings(ev, mode, throughRound);
  const byPoints = mode === 'courtPoints';
  return (
    <Card>
      {rows.length === 0 ? (
        <Hint style={{ marginTop: 0 }}>Standings appear once the first scores are in.</Hint>
      ) : (
        <View>
          <View style={[styles.row, styles.head]}>
            <Text style={[styles.rank, styles.headText]}>#</Text>
            <Text style={[styles.name, styles.headText]}>Player</Text>
            <Text style={[styles.num, styles.headText]}>W–L</Text>
            <Text style={[styles.num, styles.headText]}>{byPoints ? 'Pts' : 'Win %'}</Text>
            <Text style={[styles.num, styles.headText]} accessibilityLabel="Average point difference">+/−</Text>
          </View>
          {rows.map(r => (
            <View key={r.id} style={[styles.row, r.id === meId && styles.me]}>
              <Text style={[styles.rank, r.rank <= 3 && styles.top]}>{r.rank}</Text>
              <View style={[styles.name, styles.nameRow]}>
                <Text style={styles.nameText} numberOfLines={1}>{playerName(r.id)}</Text>
                <GenderDot gender={playerGender(r.id)} size={14} />
              </View>
              <Text style={styles.num}>{r.wins}–{r.losses}</Text>
              <Text style={[styles.num, styles.key]}>{byPoints ? r.courtPoints : fmtPct(r.winPct)}</Text>
              <Text style={styles.num}>{fmtDiff(r.avgDiff)}</Text>
            </View>
          ))}
          <Hint>
            {byPoints
              ? 'Points for wins — the higher the court, the more a win is worth. Ties go to average point difference per game.'
              : 'Ranked by share of games won (sitting out never counts against anyone), then average point difference per game.'}
          </Hint>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 6 },
  head: { paddingTop: 0 },
  headText: { fontSize: 11, fontWeight: '700', color: colors.slate, textTransform: 'uppercase', letterSpacing: 0.5 },
  me: { backgroundColor: colors.courtTint, borderRadius: radius.sm },
  rank: { width: 24, textAlign: 'center', fontWeight: '700', color: colors.slate, fontVariant: ['tabular-nums'] },
  top: { color: colors.court },
  name: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  nameText: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  num: { width: 48, textAlign: 'right', fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  key: { fontWeight: '700' },
});
