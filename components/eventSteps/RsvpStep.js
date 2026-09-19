import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SectionTitle, Card, Hint, Badge, GenderDot, EmptyState, Field } from '../../lib/ui';
import { getConfirmedAndWaitlist, getRoundPool, timeOptions, offsetToClock, GAME_LEN } from '../../lib/engine';
import { setRsvp, setRsvpTime, getPlayerById, playerName, playerGender, useStore } from '../../lib/store';
import { colors, radius } from '../../lib/theme';

export default function RsvpStep({ ev }) {
  const players = useStore(s => s.players);
  const memberIds = ev.memberIds || [];
  const members = memberIds.map(getPlayerById).filter(Boolean);

  if (members.length === 0) {
    return <EmptyState icon="people">No players added to this event yet — add players to it from the Setup step first.</EmptyState>;
  }

  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const numRounds = Math.max(1, Math.ceil(ev.durationMin / GAME_LEN));
  const timeline = [];
  for (let i = 0; i < numRounds; i++) timeline.push(getRoundPool(ev, i * GAME_LEN, confirmed, waitlist).length);
  const maxT = Math.max(1, ...timeline);

  return (
    <View>
      <SectionTitle first>Headcount timeline</SectionTitle>
      <Card>
        <View style={styles.timelineBar}>
          {timeline.map((v, i) => (
            <View key={i} style={[styles.timelineBarSeg, { height: `${Math.max(6, v / maxT * 100)}%` }]} />
          ))}
        </View>
        <Hint>Peak: {maxT} players → {Math.ceil(maxT / 4)} courts needed at once. Includes waitlisted players pulled in to fill gaps left by partially-available regulars.</Hint>
      </Card>

      <SectionTitle>Responses (capacity: {ev.courts * 4})</SectionTitle>
      <Card>
        {members.map(p => {
          const r = ev.rsvps[p.id];
          const status = r ? r.status : null;
          const isWaitlisted = waitlist.includes(p.id);
          return (
            <View key={p.id} style={styles.responseRow}>
              <View style={styles.responseTop}>
                <GenderDot gender={p.gender} />
                <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                {isWaitlisted ? <Badge label="Waitlist" kind="wait" /> : null}
              </View>
              <View style={styles.pillRow}>
                <Pressable onPress={() => setRsvp(ev, p.id, 'in')} style={[styles.toggle, status === 'in' && { backgroundColor: colors.court, borderColor: colors.court }]}>
                  <Text style={[styles.toggleText, status === 'in' && { color: '#fff' }]}>In</Text>
                </Pressable>
                <Pressable onPress={() => setRsvp(ev, p.id, 'partial')} style={[styles.toggle, status === 'partial' && { backgroundColor: colors.ball, borderColor: colors.ball }]}>
                  <Text style={[styles.toggleText, status === 'partial' && { color: colors.ink }]}>Partial</Text>
                </Pressable>
                <Pressable onPress={() => setRsvp(ev, p.id, 'out')} style={[styles.toggle, status === 'out' && { backgroundColor: colors.clay, borderColor: colors.clay }]}>
                  <Text style={[styles.toggleText, status === 'out' && { color: '#fff' }]}>Out</Text>
                </Pressable>
              </View>
              {status === 'partial' ? (
                <View style={styles.grid2}>
                  <Field label="From">
                    <View style={styles.pickerWrap}>
                      <Picker selectedValue={offsetToClock(ev, r.start)} onValueChange={(v) => setRsvpTime(ev, p.id, 'start', v)}>
                        {timeOptions(ev, r.start).map(o => <Picker.Item key={o.clock} label={o.label} value={o.clock} />)}
                      </Picker>
                    </View>
                  </Field>
                  <Field label="To">
                    <View style={styles.pickerWrap}>
                      <Picker selectedValue={offsetToClock(ev, r.end)} onValueChange={(v) => setRsvpTime(ev, p.id, 'end', v)}>
                        {timeOptions(ev, r.end).map(o => <Picker.Item key={o.clock} label={o.label} value={o.clock} />)}
                      </Picker>
                    </View>
                  </Field>
                </View>
              ) : null}
            </View>
          );
        })}
      </Card>

      {waitlist.length ? (
        <Card>
          <SectionTitle first style={{ marginTop: 0 }}>Waitlist (FIFO)</SectionTitle>
          {waitlist.map((id, i) => (
            <View key={id} style={styles.flagline}>
              <View style={styles.responseTop}>
                <Text>{i + 1}.</Text>
                <GenderDot gender={playerGender(id)} />
                <Text>{playerName(id)}</Text>
              </View>
              <Text style={styles.metaSmall}>promoted on a drop-out, or pulled into gaps</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  timelineBar: { flexDirection: 'row', alignItems: 'flex-end', height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', gap: 1, padding: 2 },
  timelineBarSeg: { flex: 1, backgroundColor: colors.court, borderRadius: 2, minHeight: 2 },
  responseRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 },
  responseTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontWeight: '600', fontSize: 14, flex: 1, color: colors.ink },
  pillRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  toggle: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  toggleText: { fontSize: 12, fontWeight: '700', color: colors.slate },
  grid2: { flexDirection: 'row', gap: 10 },
  pickerWrap: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden' },
  flagline: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  metaSmall: { fontSize: 11, color: colors.slate },
});
