import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../lib/theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function Calendar({ cursor, onShift, events, selectedDate, onSelectDate }) {
  const { year, month } = cursor;
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const eventsByDate = {};
  events.forEach(e => { (eventsByDate[e.date] = eventsByDate[e.date] || []).push(e); });

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View>
      <View style={styles.head}>
        <Pressable onPress={() => onShift(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={16} color={colors.slate} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable onPress={() => onShift(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={16} color={colors.slate} />
        </Pressable>
      </View>
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.wd}>{w}</Text>
        ))}
      </View>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.weekRow}>
          {row.map((d, di) => {
            if (d === null) return <View key={di} style={styles.cell} />;
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const dayEvents = eventsByDate[dateStr] || [];
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            return (
              <Pressable
                key={di}
                onPress={() => onSelectDate(dateStr)}
                style={[
                  styles.cell, styles.cellTouchable,
                  dayEvents.length > 0 && !isSelected && { backgroundColor: colors.courtTint },
                  isSelected && { backgroundColor: colors.court },
                ]}
              >
                <Text style={[
                  styles.dayNum,
                  isToday && !isSelected && { color: colors.court, fontWeight: '800' },
                  isSelected && { color: '#fff' },
                ]}>{d}</Text>
                {dayEvents.length > 0 ? (
                  <View style={[styles.dot, isSelected && { backgroundColor: '#fff' }]} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  monthLabel: { fontWeight: '700', fontSize: 13, color: colors.ink },
  navBtn: { width: 24, height: 24, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  weekRow: { flexDirection: 'row' },
  wd: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '700', color: colors.slate, textTransform: 'uppercase', marginBottom: 3 },
  cell: { flex: 1, aspectRatio: 1, margin: 1, alignItems: 'center', justifyContent: 'center' },
  cellTouchable: { borderRadius: radius.sm },
  dayNum: { fontSize: 11, color: colors.ink },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.court, marginTop: 2 },
});
