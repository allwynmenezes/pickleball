import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MAX_PADDLES = 3;

/* Paddle colours when logged in: events you're hosting (you created them)
   and events you're playing in (you're one of its players) — events you're
   not part of don't get a paddle at all. Logged out, every event gets a
   plain paddle. Selected days sit on solid purple, so they get a light set. */
const PADDLE = {
  host: { normal: colors.court, selected: colors.courtTint },
  play: { normal: colors.ball, selected: colors.ball },
  any: { normal: colors.court, selected: colors.courtTint },
};
function roleFor(ev, me) {
  if (!me) return 'any';
  if (ev.createdBy === me.id) return 'host';
  if ((ev.memberIds || []).includes(me.id)) return 'play';
  return null;
}

/* A tiny pickleball paddle drawn from two shapes (no icon font has one):
   a rounded face and a short handle, tilted like it's mid-swing. */
function Paddle({ color }) {
  return (
    <View style={styles.paddle}>
      <View style={[styles.paddleFace, { backgroundColor: color }]} />
      <View style={[styles.paddleHandle, { backgroundColor: color }]} />
    </View>
  );
}

export function CalendarLegend() {
  const { player: me } = useAuth();
  if (!me) return null;
  return (
    <View style={styles.legend}>
      {[['host', 'Hosting'], ['play', 'Playing']].map(([role, label]) => (
        <View key={role} style={styles.legendItem}>
          <Paddle color={PADDLE[role].normal} />
          <Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function Calendar({ cursor, onShift, events, selectedDate, onSelectDate }) {
  const { player: me } = useAuth();
  const { year, month } = cursor;
  const first = new Date(year, month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = first.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const todayStr = new Date().toISOString().slice(0, 10);

  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const eventsByDate = {};
  events.forEach(e => {
    const role = roleFor(e, me);
    if (role) (eventsByDate[e.date] = eventsByDate[e.date] || []).push({ ev: e, role });
  });

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
                  isSelected && { color: colors.white },
                ]}>{d}</Text>
                {dayEvents.length > 0 ? (
                  <View style={styles.paddleRow}>
                    {dayEvents.slice(0, MAX_PADDLES).map(({ ev, role }) => (
                      <Paddle key={ev.id} color={PADDLE[role][isSelected ? 'selected' : 'normal']} />
                    ))}
                    {dayEvents.length > MAX_PADDLES ? (
                      <Text style={[styles.more, isSelected && { color: colors.courtTint }]}>+{dayEvents.length - MAX_PADDLES}</Text>
                    ) : null}
                  </View>
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
  cell: { flex: 1, aspectRatio: 1, margin: 1.5, alignItems: 'center', justifyContent: 'center' },
  cellTouchable: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  dayNum: { fontSize: 11, color: colors.ink },
  paddleRow: { flexDirection: 'row', alignItems: 'center', gap: 1, marginTop: 2, height: 11 },
  paddle: { width: 7, height: 11, alignItems: 'center', transform: [{ rotate: '-25deg' }] },
  paddleFace: { width: 6, height: 7, borderRadius: 3 },
  paddleHandle: { width: 2, height: 4, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },
  more: { fontSize: 7, fontWeight: '700', color: colors.slate },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: 14, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendText: { fontSize: 10.5, color: colors.slate, fontWeight: '600' },
});
