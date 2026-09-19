import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { SectionTitle, Card, Field, Hint, Btn, Row, GenderDot, GenderChip, EmptyState } from '../../lib/ui';
import { showAlert } from '../../lib/confirm';
import {
  updateEventField, normalizeSegments, addSegment, removeSegment, updateSegment, updateSegmentMode,
  addPlayerToEvent, addAllPlayersToEvent, addNewPlayerToEvent, removePlayerFromEvent, useStore, getPlayerById,
} from '../../lib/store';
import { fmtClock, offsetToClock } from '../../lib/engine';
import { colors, radius } from '../../lib/theme';

const MODES = [
  { key: 'open', label: 'Any combination' },
  { key: 'men', label: "Men's only" },
  { key: 'women', label: "Women's only" },
  { key: 'mixed', label: 'Mixed' },
];

function ModeSelect({ value, onChange }) {
  return (
    <View style={styles.modeSelectWrap}>
      <Picker selectedValue={value} onValueChange={onChange} style={styles.modeSelect} itemStyle={styles.modeSelectItem}>
        {MODES.map(m => <Picker.Item key={m.key} label={m.label} value={m.key} />)}
      </Picker>
    </View>
  );
}

export default function SetupStep({ ev, onDeleteEvent }) {
  normalizeSegments(ev);
  const courtOpts = Array.from({ length: ev.courts }, (_, i) => i + 1);

  return (
    <View>
      <SectionTitle first>Event</SectionTitle>
      <Card>
        <Field label="Event name">
          <TextInput value={ev.name} onChangeText={(v) => updateEventField(ev, 'name', v)} style={styles.input} />
        </Field>
        <View style={styles.grid2}>
          <Field label="Date">
            <TextInput value={ev.date} onChangeText={(v) => updateEventField(ev, 'date', v)} placeholder="YYYY-MM-DD" style={styles.input} />
          </Field>
          <Field label="Start time">
            <TextInput value={ev.startTime} onChangeText={(v) => updateEventField(ev, 'startTime', v)} placeholder="HH:MM" style={styles.input} />
          </Field>
        </View>
        <View style={styles.grid2}>
          <Field label="Total duration (min)">
            <TextInput value={String(ev.durationMin)} onChangeText={(v) => updateEventField(ev, 'durationMin', v)} keyboardType="number-pad" style={styles.input} />
          </Field>
          <Field label="Courts available">
            <TextInput value={String(ev.courts)} onChangeText={(v) => updateEventField(ev, 'courts', v)} keyboardType="number-pad" style={styles.input} />
          </Field>
        </View>
        <Hint>Capacity is {ev.courts * 4} players (courts × 4). Game length is fixed at 15 min; the first game doubles as warm-up. Ends at {fmtClock(offsetToClock(ev, ev.durationMin))}.</Hint>
        <Btn title="Delete event" icon="trash" variant="ghost" small dangerText onPress={onDeleteEvent} style={{ marginTop: 10 }} />
      </Card>

      <SectionTitle>Match-mode segments</SectionTitle>
      <Card>
        <Hint style={{ marginTop: 0, marginBottom: 4 }}>Segments always run back-to-back, covering the whole event with no gaps or overlaps. Move a boundary time to reshape the two segments on either side of it.</Hint>
        {ev.segments.map((s, idx) => {
          const isLast = idx === ev.segments.length - 1;
          return (
            <View key={idx} style={styles.segBar}>
              <View style={styles.grid2}>
                <Field label="Starts at"><Text style={styles.disabledInput}>{s.start}</Text></Field>
                <Field label={isLast ? 'Ends at (fixed to event end)' : 'Ends at'}>
                  {isLast ? <Text style={styles.disabledInput}>{s.end}</Text> : (
                    <TextInput value={s.end} onChangeText={(v) => updateSegment(ev, idx, 'end', v)} placeholder="HH:MM" style={styles.input} />
                  )}
                </Field>
              </View>
              <Text style={styles.smallLabel}>Mode per court</Text>
              <View style={styles.pillRow}>
                {courtOpts.map(c => (
                  <View key={c} style={styles.courtModeItem}>
                    <Text style={styles.courtModeLabel}>Ct {c}</Text>
                    <ModeSelect value={(s.modes || {})[c] || 'open'} onChange={(v) => updateSegmentMode(ev, idx, c, v)} />
                  </View>
                ))}
              </View>
              <Pressable onPress={() => { const r = removeSegment(ev, idx); if (r.error) showAlert(r.error); }}>
                <Text style={styles.removeLink}>Remove segment</Text>
              </Pressable>
            </View>
          );
        })}
        <Btn title="Add segment" variant="outline" small onPress={() => { const r = addSegment(ev); if (r.error) showAlert(r.error); }} />
        <Hint>If a Mixed or single-gender court can't be filled with the players actually available, that court falls back to "any combination" for the affected time and gets flagged in the roster.</Hint>
      </Card>

      <EventMembers ev={ev} />
    </View>
  );
}

function EventMembers({ ev }) {
  const players = useStore(s => s.players);
  const [name, setName] = React.useState('');
  const [gender, setGender] = React.useState('M');
  const [pickedExisting, setPickedExisting] = React.useState('');

  const memberIds = ev.memberIds || [];
  const members = memberIds.map(getPlayerById).filter(Boolean);
  const nonMembers = players.filter(p => !memberIds.includes(p.id));

  return (
    <View>
      <SectionTitle>Players in this event ({members.length})</SectionTitle>
      <Hint style={{ marginTop: -6, marginBottom: 10 }}>Only players added here show up in this event's RSVP and scheduling — removing someone here only takes them out of this event, never the standalone Players list.</Hint>
      <Card>
        {members.length === 0 ? <EmptyState icon="people">No players added to this event yet — add some below.</EmptyState> : members.map(p => (
          <Row key={p.id}>
            <GenderDot gender={p.gender} />
            <Text style={styles.memberName} numberOfLines={1}>{p.name}</Text>
            <GenderChip gender={p.gender} />
            <Pressable onPress={() => removePlayerFromEvent(ev, p.id)} style={styles.removeBtn}>
              <Ionicons name="close" size={15} color={colors.clay} />
            </Pressable>
          </Row>
        ))}
      </Card>
      <Card>
        {nonMembers.length ? (
          <View>
            <Text style={styles.smallLabel}>Add an existing player to this event</Text>
            <View style={styles.addExistingRow}>
              <View style={styles.pickerWrap}>
                <Picker selectedValue={pickedExisting} onValueChange={setPickedExisting}>
                  <Picker.Item label="Choose…" value="" />
                  {nonMembers.map(p => <Picker.Item key={p.id} label={`${p.name} (${p.gender})`} value={p.id} />)}
                </Picker>
              </View>
              <Btn title="Add" small onPress={() => { if (pickedExisting) { addPlayerToEvent(ev, pickedExisting); setPickedExisting(''); } }} />
            </View>
            <Btn title={`Add all ${nonMembers.length} remaining`} variant="ghost" small onPress={() => addAllPlayersToEvent(ev)} style={{ marginTop: 8 }} />
          </View>
        ) : <Hint style={{ marginTop: 0 }}>Every player in your standalone list is already part of this event.</Hint>}
        <Hint>Or add a brand-new player (this also adds them to your standalone Players list):</Hint>
        <View style={styles.grid2}>
          <Field label="Name"><TextInput value={name} onChangeText={setName} placeholder="Player name" style={styles.input} /></Field>
          <Field label="Category">
            <View style={styles.pickerWrap}>
              <Picker selectedValue={gender} onValueChange={setGender}>
                <Picker.Item label="Male" value="M" /><Picker.Item label="Female" value="F" /><Picker.Item label="Other" value="O" />
              </Picker>
            </View>
          </Field>
        </View>
        <Btn title="Add" icon="add" onPress={() => { if (name.trim()) { addNewPlayerToEvent(ev, name, gender); setName(''); } }} style={{ marginTop: 10 }} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: '#fff' },
  disabledInput: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: colors.chalk, color: colors.slate },
  grid2: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  segBar: { borderLeftWidth: 3, borderLeftColor: colors.court, paddingLeft: 12, marginBottom: 14 },
  smallLabel: { fontSize: 11.5, color: colors.slate, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  pillRow: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  courtModeItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  courtModeLabel: { fontSize: 12 },
  modeSelectWrap: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, overflow: 'hidden', minWidth: 130 },
  modeSelect: { height: 36 },
  modeSelectItem: { fontSize: 12 },
  removeLink: { color: colors.clay, fontSize: 12, fontWeight: '600', marginTop: 6 },
  memberName: { fontWeight: '600', fontSize: 14, flex: 1, color: colors.ink },
  removeBtn: { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  addExistingRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  pickerWrap: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, overflow: 'hidden' },
});
