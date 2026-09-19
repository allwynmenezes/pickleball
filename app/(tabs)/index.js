import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Btn, Row, Badge } from '../../lib/ui';
import Calendar from '../../components/Calendar';
import { useStore, getState } from '../../lib/store';
import { fmtClock } from '../../lib/engine';
import { colors } from '../../lib/theme';

function fmtDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function EventsScreen() {
  const router = useRouter();
  const events = useStore(s => s.events);
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

  return (
    <Screen>
      <SectionTitle first>Events</SectionTitle>
      <Card>
        <Calendar cursor={cursor} onShift={shift} events={events} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
      </Card>
      <Btn title="New event" icon="add" onPress={() => router.push({ pathname: '/event/[id]', params: { id: 'new' } })} />

      {selectedDate ? (
        <View>
          <SectionTitle>{fmtDateLong(selectedDate)}</SectionTitle>
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
      ) : null}

      {events.length > 0 ? (
        <View>
          <SectionTitle>All events</SectionTitle>
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
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontWeight: '600', fontSize: 14, flex: 1, color: colors.ink },
  meta: { fontSize: 12, color: colors.slate },
  emptyHint: { fontSize: 13, color: colors.slate },
});
