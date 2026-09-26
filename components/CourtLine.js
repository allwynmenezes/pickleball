import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { GenderDot, Banner, DashedLine } from '../lib/ui';
import { playerName, playerGender, courtLabel } from '../lib/store';
import { colors, radius } from '../lib/theme';

export const MODE_LABEL = { open: 'Any combination', men: "Men's", women: "Women's", mixed: 'Mixed', break: 'Break' };

function TeamRow({ team, score, editable, onChangeScore }) {
  return (
    <View style={styles.teamRow}>
      <View style={styles.teamNames}>
        {team.map(id => (
          <View key={id} style={styles.teamNameItem}>
            <Text style={styles.teamName}>{playerName(id)}</Text>
            <GenderDot gender={playerGender(id)} size={16} />
          </View>
        ))}
      </View>
      {editable ? (
        <TextInput
          keyboardType="number-pad" style={styles.scoreInput}
          value={score == null ? '' : String(score)}
          placeholder="–"
          onChangeText={onChangeScore}
        />
      ) : (
        // Read-only rounds (Up next, the Games tab) still show a score box so
        // the layout matches the editable one — just greyed out and locked.
        <TextInput
          editable={false} style={[styles.scoreInput, styles.scoreInputDisabled]}
          value={score == null ? '' : String(score)} placeholder="–" placeholderTextColor={colors.slate}
        />
      )}
    </View>
  );
}

export default function CourtLine({ ev, court, roundIdx, editable, onScoreChange }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Text style={styles.courtNo}>{courtLabel(ev, court.court, ev.roster && ev.roster[roundIdx] ? ev.roster[roundIdx].offset : null)}</Text>
        <Text style={styles.meta}>({MODE_LABEL[court.mode]}{court.flagged ? ' · fallback' : ''})</Text>
      </View>
      <View style={styles.matchup}>
        <TeamRow
          team={court.teamA} score={court.scoreA} editable={editable}
          onChangeScore={(v) => onScoreChange(roundIdx, court.court, 'A', v)}
        />
        <View style={styles.vsRow}>
          <DashedLine color={colors.line} style={styles.vsLine} />
          <Text style={styles.vs}>vs</Text>
          <DashedLine color={colors.line} style={styles.vsLine} />
        </View>
        <TeamRow
          team={court.teamB} score={court.scoreB} editable={editable}
          onChangeScore={(v) => onScoreChange(roundIdx, court.court, 'B', v)}
        />
      </View>
      {court.flagged ? <Banner>Not enough eligible players for the planned mode — this court fell back to any combination.</Banner> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  courtNo: { fontWeight: '600', color: colors.ink, fontSize: 13 },
  meta: { fontSize: 12, color: colors.slate },
  matchup: { gap: 4 },
  teamRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  teamNames: { flex: 1, gap: 2 },
  teamNameItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  teamName: { fontSize: 13, color: colors.ink },
  vsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 2 },
  vsLine: { flex: 1 },
  vs: { color: colors.slate, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', textAlign: 'center' },
  scoreInput: { width: 40, textAlign: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 4, fontWeight: '700', color: colors.ink, backgroundColor: colors.white },
  scoreInputDisabled: { backgroundColor: colors.chalk, color: colors.slate },
});
