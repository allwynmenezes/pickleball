import React, { useLayoutEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Animated, PanResponder, Easing, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/auth';
import { localDateStr } from '../lib/engine';
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

const monthShift = ({ year, month }, delta) => {
  let m = month + delta, y = year;
  while (m < 0) { m += 12; y--; }
  while (m > 11) { m -= 12; y++; }
  return { year: y, month: m };
};

const SWIPE_DISTANCE = 0.25; // of the width, to change month on release
const SWIPE_VELOCITY = 0.5;  // px/ms — a quick flick changes month too
const SLIDE_MS = 240;

/* Swipe left/right (or tap the arrows) to change month. The current month
   is laid out normally — so the calendar is its height — with the previous
   and next months just out of view either side; dragging slides all three
   with the finger. On release it either finishes the slide or springs
   back, animated on the native UI thread. Only once the slide has finished
   does it call onShift — the same call the arrows always made — so the
   parent's month state and everything built on it are unchanged. A drag
   only takes over when it's clearly sideways, so day taps and scrolling
   the page work as before. */
export default function Calendar({ cursor, onShift, events, selectedDate, onSelectDate }) {
  const { player: me } = useAuth();
  const { year, month } = cursor;
  const monthLabel = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const todayStr = localDateStr();

  const eventsByDate = {};
  events.forEach(e => {
    const role = roleFor(e, me);
    if (role) (eventsByDate[e.date] = eventsByDate[e.date] || []).push({ ev: e, role });
  });

  const [width, setWidth] = useState(0);
  const drag = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);
  const resetAfterShift = useRef(false);
  const latest = useRef({});
  /* On the web a drag that ends over the day it started on also counts as
     a click on that day (the grid moves with the pointer), which picked
     the day and closed the date picker. A tap that lands as a drag ends is
     part of the drag, not a choice. Touch on a phone cancels the tap. */
  const dragEndedAt = useRef(0);
  latest.current = { width, onShift };

  // After the parent moves to the new month, put the strip back in the
  // middle before that frame is drawn, so the new month shows in place.
  useLayoutEffect(() => {
    if (resetAfterShift.current) {
      resetAfterShift.current = false;
      drag.setValue(0);
      animating.current = false;
    }
  }, [year, month, drag]);

  function slideTo(delta, velocity = 0) {
    const w = latest.current.width;
    if (animating.current) return;
    if (!w) { latest.current.onShift(delta); return; } // not laid out yet: just change month
    animating.current = true;
    Animated.timing(drag, {
      toValue: -delta * w,
      duration: velocity > 1.5 ? SLIDE_MS * 0.6 : SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (!finished) { animating.current = false; return; }
      resetAfterShift.current = true;
      latest.current.onShift(delta);
    });
  }
  function springBack() {
    Animated.spring(drag, { toValue: 0, useNativeDriver: Platform.OS !== 'web', bounciness: 0, speed: 18 }).start();
  }

  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !animating.current && Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { dragEndedAt.current = Infinity; },
    onPanResponderMove: (_, g) => drag.setValue(g.dx),
    onPanResponderRelease: (_, g) => {
      dragEndedAt.current = Date.now();
      const w = latest.current.width || 1;
      if (g.dx < -w * SWIPE_DISTANCE || g.vx < -SWIPE_VELOCITY) slideTo(1, Math.abs(g.vx));
      else if (g.dx > w * SWIPE_DISTANCE || g.vx > SWIPE_VELOCITY) slideTo(-1, Math.abs(g.vx));
      else springBack();
    },
    onPanResponderTerminate: () => { dragEndedAt.current = Date.now(); springBack(); },
  })).current;

  const selectDay = (d) => { if (Date.now() - dragEndedAt.current > 300) onSelectDate(d); };
  const gridProps = { eventsByDate, todayStr, selectedDate, onSelectDate: selectDay };
  return (
    <View>
      <View style={styles.head}>
        <Pressable onPress={() => slideTo(-1)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel="Previous month">
          <Ionicons name="chevron-back" size={16} color={colors.slate} />
        </Pressable>
        <Text style={styles.monthLabel}>{monthLabel}</Text>
        <Pressable onPress={() => slideTo(1)} style={styles.navBtn} accessibilityRole="button" accessibilityLabel="Next month">
          <Ionicons name="chevron-forward" size={16} color={colors.slate} />
        </Pressable>
      </View>
      <View style={styles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.wd}>{w}</Text>
        ))}
      </View>
      <View style={styles.viewport} onLayout={e => setWidth(e.nativeEvent.layout.width)} {...pan.panHandlers}>
        <Animated.View style={{ transform: [{ translateX: drag }] }}>
          <MonthGrid {...monthShift(cursor, 0)} {...gridProps} />
          {width ? (
            <>
              <View style={[styles.side, { left: -width, width }]} pointerEvents="none">
                <MonthGrid {...monthShift(cursor, -1)} {...gridProps} />
              </View>
              <View style={[styles.side, { left: width, width }]} pointerEvents="none">
                <MonthGrid {...monthShift(cursor, 1)} {...gridProps} />
              </View>
            </>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

/* One month's day grid (unchanged from before the swipe). */
function MonthGrid({ year, month, eventsByDate, todayStr, selectedDate, onSelectDate }) {
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

  return (
    <View>
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
  viewport: { overflow: 'hidden' },
  side: { position: 'absolute', top: 0 },
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
