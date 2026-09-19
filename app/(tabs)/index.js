import React, { useState } from 'react';
import { View, Text, StyleSheet, Platform, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Btn, Row, Badge, EmptyState } from '../../lib/ui';
import Calendar from '../../components/Calendar';
import { useStore } from '../../lib/store';
import { fmtClock } from '../../lib/engine';
import { colors } from '../../lib/theme';

const WIDE_BREAKPOINT = 760;

function fmtDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function EventsScreen() {
  const router = useRouter();
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
    </Card>
  );

  const selectedDayBlock = selectedDate ? (
    <View>
      <SectionTitle first={isWideWeb}>{fmtDateLong(selectedDate)}</SectionTitle>
      <Card>
        {dayEvents.length === 0 ? (
          <Text style={styles.emptyHint}>No events on this day yet.</Text>
        ) : dayEvents.map(e => (
          <Row key={e.id} onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.id } })}>
            <Text style={styles.name} numberOfLines={1}>{e.name}</Text>
            <Badge label={e.published ? 'Published' : 'Draft'} kind={e.published ? 'ok' : 'wait'} />
            <Text style={styles.meta}>{fmtClock(e.startTime)}</Text>
          </Row>
        ))}
        <Btn
          title="New event on this day" icon="add" variant="outline" small
          style={{ marginTop: dayEvents.length ? 10 : 0 }}
          onPress={() => router.push({ pathname: '/event/[id]', params: { id: 'new', date: selectedDate } })}
        />
      </Card>
    </View>
  ) : null;

  const allEventsBlock = events.length > 0 ? (
    <View>
      <SectionTitle first={isWideWeb && !selectedDate}>All events</SectionTitle>
      <Card>
        {sortedAll.map(e => (
          <Row key={e.id} onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.id } })}>
            <Text style={styles.name} numberOfLines={1}>{e.name}</Text>
            <Badge label={e.published ? 'Published' : 'Draft'} kind={e.published ? 'ok' : 'wait'} />
            <Text style={styles.meta}>{e.date}</Text>
          </Row>
        ))}
      </Card>
    </View>
  ) : null;

  const emptyBlock = (!selectedDate && events.length === 0) ? (
    <Card><EmptyState icon="calendar">No events yet — use the + button to create one.</EmptyState></Card>
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
        onPress={() => router.push({ pathname: '/event/[id]', params: { id: 'new', date: selectedDate || undefined } })}
        style={({ pressed, hovered }) => [styles.fab, (pressed || hovered) && styles.fabPressed]}
      >
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  name: { fontWeight: '600', fontSize: 14, flex: 1, color: colors.ink },
  meta: { fontSize: 12, color: colors.slate },
  emptyHint: { fontSize: 13, color: colors.slate },
  webRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 20 },
  webCalCol: { width: 300 },
  webListCol: { flex: 1, minWidth: 0 },
  calCardWide: { padding: 14 },
  fab: {
    position: 'absolute', right: 20, bottom: 90,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.court, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#320078', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPressed: { backgroundColor: colors.courtDeep },
});
