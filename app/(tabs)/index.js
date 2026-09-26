import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { pushOnce } from '../../lib/nav';
import { Screen, SectionTitle, Card, Row, Badge, EmptyState, BoldPlus } from '../../lib/ui';
import Calendar, { CalendarLegend } from '../../components/Calendar';
import { useStore } from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { showConfirm } from '../../lib/confirm';
import { fmtClock } from '../../lib/engine';
import { colors } from '../../lib/theme';

const WIDE_BREAKPOINT = 760;

function fmtDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function EventsScreen() {
  const router = useRouter();
  const { player: me } = useAuth();
  const events = useStore(s => s.events);
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && width >= WIDE_BREAKPOINT;
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [selectedDate, setSelectedDate] = useState(null);

  function shift(delta) {
    setCursor(({ year, month }) => {
      let m = month + delta, y = year;
      if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
      return { year: y, month: m };
    });
  }

  const dayEvents = selectedDate ? events.filter(e => e.date === selectedDate) : [];
  const sortedAll = [...events].sort((a, b) => b.date.localeCompare(a.date));

  const calendarBlock = (
    <Card style={isWideWeb ? styles.calCardWide : null}>
      <Calendar cursor={cursor} onShift={shift} events={events} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      <CalendarLegend />
    </Card>
  );

  const selectedDayBlock = selectedDate ? (
    <View>
      <SectionTitle first={isWideWeb}>{fmtDateLong(selectedDate)}</SectionTitle>
      <Card>
        {dayEvents.length === 0 ? (
          <Text style={styles.emptyHint}>No events on this day yet. Tap <Text style={styles.emptyHintStrong}>+ New Event</Text> to create one.</Text>
        ) : dayEvents.map(e => (
          <Row key={e.id} onPress={() => pushOnce(router, { pathname: '/event/[id]', params: { id: e.id } })}>
            <Text style={styles.name} numberOfLines={1}>{e.name}</Text>
            <Badge label={e.published ? 'Published' : 'Draft'} kind={e.published ? 'ok' : 'wait'} />
            <Text style={styles.meta}>{fmtClock(e.startTime)}</Text>
          </Row>
        ))}
      </Card>
    </View>
  ) : null;

  const allEventsBlock = events.length > 0 ? (
    <View>
      <SectionTitle first={isWideWeb && !selectedDate}>All events</SectionTitle>
      <Card>
        {sortedAll.map(e => (
          <Row key={e.id} onPress={() => pushOnce(router, { pathname: '/event/[id]', params: { id: e.id } })}>
            <Text style={styles.name} numberOfLines={1}>{e.name}</Text>
            <Badge label={e.published ? 'Published' : 'Draft'} kind={e.published ? 'ok' : 'wait'} />
            <Text style={styles.meta}>{e.date}</Text>
          </Row>
        ))}
      </Card>
    </View>
  ) : null;

  const emptyBlock = (!selectedDate && events.length === 0) ? (
    <Card><EmptyState icon="calendar">No events yet — use the New Event button to create one.</EmptyState></Card>
  ) : null;

  return (
    <View style={styles.wrap}>
      <Screen contentStyle={isWideWeb ? { paddingBottom: 60 } : null}>
        <SectionTitle first={!isWideWeb}>Events</SectionTitle>
        {isWideWeb ? (
          <View style={styles.webRow}>
            <View style={styles.webCalCol}>{calendarBlock}</View>
            <View style={styles.webListCol}>
              {selectedDayBlock}
              {allEventsBlock}
              {emptyBlock}
            </View>
          </View>
        ) : (
          <View>
            {calendarBlock}
            {selectedDayBlock}
            {allEventsBlock}
            {emptyBlock}
          </View>
        )}
      </Screen>

      <Pressable
        onPress={() => {
          if (!me) {
            showConfirm("Log in to create an event — you'll be its host, the only one who can edit or delete it.", () => pushOnce(router, '/login'), 'Log in');
            return;
          }
          pushOnce(router, { pathname: '/event/[id]', params: { id: 'new', date: selectedDate || undefined } });
        }}
        style={({ pressed, hovered }) => [styles.fab, (pressed || hovered) && styles.fabPressed]}
      >
        <BoldPlus size={20} color={colors.courtTint} />
        <Text style={styles.fabText}>New Event</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  name: { fontWeight: '600', fontSize: 14, flex: 1, color: colors.ink },
  meta: { fontSize: 12, color: colors.slate },
  emptyHint: { fontSize: 13, color: colors.slate },
  emptyHintStrong: { fontWeight: '700', color: colors.court },
  webRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  webCalCol: { width: 300 },
  webListCol: { flex: 1, minWidth: 0 },
  calCardWide: { padding: 14 },
  fab: {
    position: 'absolute', right: 20, bottom: 90,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    // A fully-rounded capsule: radius larger than half the height, so the
    // ends are true semicircles with no flat run where the curve meets.
    height: 48, borderRadius: 999, paddingLeft: 18, paddingRight: 22,
    backgroundColor: colors.court,
    shadowColor: colors.courtDeep, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { backgroundColor: colors.courtDeep },
  fabText: { color: colors.courtTint, fontSize: 14.5, fontWeight: '700' },
});
