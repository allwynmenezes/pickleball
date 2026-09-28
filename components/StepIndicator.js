import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../lib/theme';

/* The event's steps as a numbered progress line — 1 Setup → 2 RSVP → … —
   so it reads as an order to work through rather than a row of separate
   tabs. Steps before the current one sit on the filled part of the line,
   the current one is solid, the rest are outlined. Any step can be tapped.

   steps: [[key, label]], current: key, onSelect(key) */
export default function StepIndicator({ steps, current, onSelect }) {
  const currentIdx = Math.max(0, steps.findIndex(([key]) => key === current));
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {steps.map(([key, label], i) => {
        const state = i < currentIdx ? 'before' : i === currentIdx ? 'current' : 'after';
        return (
          <Pressable
            key={key}
            onPress={() => onSelect(key)}
            style={styles.step}
            hitSlop={{ top: 6, bottom: 6 }}
            accessibilityRole="tab"
            accessibilityState={{ selected: state === 'current' }}
            accessibilityLabel={`Step ${i + 1} of ${steps.length}: ${label}`}
          >
            <View style={styles.track}>
              <View style={[styles.line, i === 0 && styles.hidden, i <= currentIdx && styles.lineOn]} />
              <View style={[styles.dot, styles[state]]}>
                <Text style={[styles.num, state === 'current' && styles.numCurrent, state === 'before' && styles.numBefore]}>{i + 1}</Text>
              </View>
              <View style={[styles.line, i === steps.length - 1 && styles.hidden, i < currentIdx && styles.lineOn]} />
            </View>
            <Text style={[styles.label, state === 'current' && styles.labelCurrent]} numberOfLines={1}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const DOT = 26;
const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 12, paddingBottom: 10 },
  step: { flex: 1, alignItems: 'center', gap: 5 },
  track: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  line: { flex: 1, height: 2, backgroundColor: colors.line },
  lineOn: { backgroundColor: colors.court },
  hidden: { opacity: 0 },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  before: { backgroundColor: colors.courtTint, borderColor: colors.court },
  current: { backgroundColor: colors.court, borderColor: colors.court, transform: [{ scale: 1.12 }] },
  after: { backgroundColor: colors.white, borderColor: colors.line },
  num: { fontSize: 12, fontWeight: '700', color: colors.slate },
  numBefore: { color: colors.court },
  numCurrent: { color: colors.white },
  label: { fontSize: 11, color: colors.slate, fontWeight: '500' },
  labelCurrent: { color: colors.court, fontWeight: '700' },
});
