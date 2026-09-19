import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { GenderDot, Banner } from '../lib/ui';
import { playerName, playerGender } from '../lib/store';
import { colors } from '../lib/theme';

const MODE_LABEL = { open: 'Any combination', men: "Men's", women: "Women's", mixed: 'Mixed' };

function Side({ team }) {
  return (
    <View style={styles.side}>
      {team.map(id => (
        <View key={id} style={styles.sideItem}>
          <GenderDot gender={playerGender(id)} size={16} />
          <Text style={styles.sideName}>{playerName(id)}</Text>
        </View>
      ))}
    </View>
  );
}

export default function CourtLine({ court, roundIdx, editable, onScoreChange }) {
  return (
    <View>
      <View style={styles.line}>
        <Text style={styles.courtNo}>Ct {court.court}</Text>
        <Text style={styles.meta}>({MODE_LABEL[court.mode]}{court.flagged ? ' · fallback' : ''})</Text>
        <View style={styles.matchup}>
          <Side team={court.teamA} />
          <Text style={styles.vs}>vs</Text>
          <Side team={court.teamB} />
        </View>
      </View>
      {editable ? (
        <View style={styles.scoreRow}>
          <TextInput
            keyboardType="number-pad" style={styles.scoreInput}
            value={court.scoreA == null ? '' : String(court.scoreA)}
            placeholder="–"
            onChangeText={(v) => onScoreChange(roundIdx, court.court, 'A', v)}
          />
          <Text style={styles.scoreSep}>–</Text>
          <TextInput
            keyboardType="number-pad" style={styles.scoreInput}
            value={court.scoreB == null ? '' : String(court.scoreB)}
            placeholder="–"
            onChangeText={(v) => onScoreChange(roundIdx, court.court, 'B', v)}
          />
        </View>
      ) : null}
      {court.flagged ? <Banner>Not enough eligible players for the planned mode — this court fell back to any combination.</Banner> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, borderStyle: 'dashed', flexWrap: 'wrap', gap: 8 },
  courtNo: { fontWeight: '600', color: colors.ink, fontSize: 13 },
  meta: { fontSize: 12, color: colors.slate },
  matchup: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, flex: 1, justifyContent: 'flex-end' },
  side: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  sideItem: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sideName: { fontSize: 12.5, color: colors.ink },
  vs: { color: colors.slate, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginHorizontal: 3 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  scoreInput: { width: 40, textAlign: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: 6, padding: 4, fontWeight: '600' },
  scoreSep: { color: colors.slate, fontWeight: '700' },
});
