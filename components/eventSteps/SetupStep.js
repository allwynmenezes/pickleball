import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectionTitle, Card, Field, TextField, DateField, Hint, Btn, Row, GenderChip, EmptyState, Select, Pill } from '../../lib/ui';
import { TimeWheelField, WheelSelectField } from '../WheelPicker';
import { showAlert, showConfirm } from '../../lib/confirm';
import {
  updateEventField, normalizeSegments, addSegment, removeSegment, updateSegment, updateSegmentMode, updateSegmentGameLen,
  addPlayerToEvent, addAllPlayersToEvent, addNewPlayerToEvent, removeEventPlayer, useStore, getPlayerById, editPlayer,
  courtLabelForRange, checkpointEventFlow, playerName,
} from '../../lib/store';
import { fmtClock, offsetToClock, toOffset, timeOptions, gameLen, segmentGameLen, eventStatus, STATUS_BADGE, isBreakSegment } from '../../lib/engine';
import { colors, radius } from '../../lib/theme';

const GENDERS = [{ label: 'Male', value: 'M' }, { label: 'Female', value: 'F' }, { label: 'Other', value: 'O' }];

const MODES = [
  { key: 'open', label: 'Any combination' },
  { key: 'men', label: "Men's only" },
  { key: 'women', label: "Women's only" },
  { key: 'mixed', label: 'Mixed' },
  { key: 'break', label: 'Break (no games)' },
];

function ModeSelect({ value, onChange }) {
  return (
    <Select
      value={value} onValueChange={onChange}
      items={MODES.map(m => ({ label: m.label, value: m.key }))}
      style={{ flex: 1 }}
    />
  );
}

/* Numeric fields that clamp/coerce their value (see updateEventField) must
   not push that clamped value back into the TextInput on every keystroke —
   clearing the field to type a new number would otherwise immediately snap
   back to "1". So the typed text is buffered and committed on blur — and
   also when the field goes away while still focused (tapping Done or
   swiping to another step doesn't blur it first, which used to drop the
   last edit). The text resyncs whenever the committed value changes. */
function useBufferedNumber(committed, commit) {
  const [text, setText] = React.useState(String(committed));
  const latest = React.useRef(null);
  latest.current = { text, committed, commit };
  React.useEffect(() => { setText(String(committed)); }, [committed]);
  React.useEffect(() => () => {
    const { text: t, committed: c, commit: save } = latest.current;
    if (t !== String(c)) save(t);
  }, []);
  return [text, setText, () => commit(text)];
}

function NumberField({ label, ev, field, value }) {
  const [text, setText, onBlur] = useBufferedNumber(value, (t) => updateEventField(ev, field, t));
  return <TextField label={label} value={text} onChangeText={setText} onBlur={onBlur} keyboardType="number-pad" />;
}

/* Per-segment game length: shows the effective value (the event's, unless
   this segment overrides it). */
function SegmentGameLenField({ ev, idx, seg }) {
  const [text, setText, onBlur] = useBufferedNumber(segmentGameLen(ev, seg), (t) => updateSegmentGameLen(ev, idx, t));
  return <TextField label="Game length (min)" value={text} onChangeText={setText} onBlur={onBlur} keyboardType="number-pad" />;
}

/* Setup opens read-only. Only the event's host (the account that created
   it) gets an Edit button — and with it Delete, which lives in edit mode.
   The server enforces the same rule on every save.
   Done keeps the edits for good: it makes them part of the saved event, so
   the event's Cancel (or backing out) no longer undoes them. */

export default function SetupStep({ ev, onDeleteEvent, canEdit, active }) {
  const [editing, setEditing] = React.useState(false);
  const [saveOnClose, setSaveOnClose] = React.useState(false);
  // Leaving the Setup page always ends editing.
  React.useEffect(() => { if (!active) setEditing(false); }, [active]);
  // Runs after the form has unmounted, i.e. after any still-focused field
  // has committed its last value.
  React.useEffect(() => {
    if (saveOnClose && !editing) { checkpointEventFlow(ev.id); setSaveOnClose(false); }
  }, [saveOnClose, editing]);
  normalizeSegments(ev);
  if (!editing || !canEdit || ev.started) return <SetupSummary ev={ev} canEdit={canEdit && !ev.started} onEdit={() => setEditing(true)} onDelete={onDeleteEvent} />;
  const courtOpts = Array.from({ length: ev.courts }, (_, i) => i + 1);

  return (
    <View>
      <View style={styles.modeBar}>
        <Text style={styles.modeBarText}>Editing setup</Text>
        <Btn title="Done" icon="checkmark" small onPress={() => { setSaveOnClose(true); setEditing(false); }} />
      </View>
      <SectionTitle first>Event</SectionTitle>
      <Card style={styles.fieldStack}>
        <TextField label="Event name" value={ev.name} onChangeText={(v) => updateEventField(ev, 'name', v)} />
        <View style={styles.fieldRow}>
          <DateField label="Date" value={ev.date} onChange={(v) => updateEventField(ev, 'date', v)} />
          <TimeWheelField label="Start time" value={ev.startTime} onChange={(v) => updateEventField(ev, 'startTime', v)} />
        </View>
        <View style={styles.fieldRow}>
          <NumberField label="Total duration (min)" ev={ev} field="durationMin" value={ev.durationMin} />
          <NumberField label="Courts available" ev={ev} field="courts" value={ev.courts} />
        </View>
        <NumberField label="Game length (min per round)" ev={ev} field="gameLenMin" value={gameLen(ev)} />
        <Hint style={{ marginTop: 0 }}>Capacity is {ev.courts * 4} players (courts × 4). Each round is {gameLen(ev)} min unless a segment below sets its own game length; the first game doubles as warm-up. Ends at {fmtClock(offsetToClock(ev, ev.durationMin))}.</Hint>
        <Btn title="Delete event" icon="trash" variant="ghost" small dangerText onPress={onDeleteEvent} style={{ alignSelf: 'flex-end' }} />
      </Card>

      <SectionTitle>Match-mode segments</SectionTitle>
      <Card>
        <Hint style={{ marginTop: 0, marginBottom: 4 }}>Segments always run back-to-back, covering the whole event with no gaps or overlaps. Move a boundary time to reshape the two segments on either side of it.</Hint>
        {ev.segments.map((s, idx) => {
          const isLast = idx === ev.segments.length - 1;
          return (
            <React.Fragment key={idx}>
            {idx > 0 ? <View style={styles.segDivider} /> : null}
            <View style={[styles.segBar, isBreakSegment(ev, s) && styles.breakSeg]}>
              {isBreakSegment(ev, s) ? <BreakTag style={{ marginBottom: 6 }} /> : null}
              <View style={styles.grid2}>
                <Field label="Starts at"><Text style={styles.disabledInput}>{fmtClock(s.start)}</Text></Field>
                {isLast ? (
                  <Field label="Ends at (fixed to event end)"><Text style={styles.disabledInput}>{fmtClock(s.end)}</Text></Field>
                ) : (
                  <WheelSelectField
                    label="Ends at" value={s.end} onValueChange={(v) => updateSegment(ev, idx, 'end', v)}
                    items={timeOptions(ev, toOffset(ev, s.end))
                      .filter(o => o.offset > toOffset(ev, s.start))
                      .map(o => ({ label: o.label, value: o.clock }))}
                  />
                )}
              </View>
              <View style={styles.segLenRow}>
                <SegmentGameLenField ev={ev} idx={idx} seg={s} />
                <Hint style={styles.segLenHint}>
                  {s.gameLenMin ? `Overrides the event's ${gameLen(ev)} min` : `Event default (${gameLen(ev)} min)`}
                </Hint>
              </View>
              <Text style={styles.smallLabel}>Mode per court</Text>
              <View style={styles.courtModeList}>
                {courtOpts.map(c => (
                  <View key={c} style={styles.courtModeItem}>
                    <Text style={styles.courtModeLabel}>{courtLabelForRange(ev, c, toOffset(ev, s.start), toOffset(ev, s.end))}</Text>
                    <ModeSelect value={(s.modes || {})[c] || 'open'} onChange={(v) => updateSegmentMode(ev, idx, c, v)} />
                  </View>
                ))}
              </View>
              <Btn
                title="Remove segment" icon="trash" variant="ghost" small dangerText
                onPress={() => { const r = removeSegment(ev, idx); if (r.error) showAlert(r.error); }}
                style={{ marginTop: 6, alignSelf: 'flex-end' }}
              />
            </View>
            </React.Fragment>
          );
        })}
        <View style={styles.segDivider} />
        <Btn title="Add segment" variant="outline" small onPress={() => { const r = addSegment(ev); if (r.error) showAlert(r.error); }} style={{ alignSelf: 'flex-end' }} />
        <Hint>If a Mixed or single-gender court can't be filled with the players actually available, that court falls back to "any combination" for the affected time and gets flagged in the roster.</Hint>
      </Card>

      <EventMembers ev={ev} />
    </View>
  );
}

function SetupSummary({ ev, canEdit, onEdit, onDelete }) {
  const players = useStore(s => s.players);
  const members = (ev.memberIds || []).map(getPlayerById).filter(Boolean);
  const courtOpts = Array.from({ length: ev.courts }, (_, i) => i + 1);
  const dateLabel = new Date(ev.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const modeLabel = (k) => (MODES.find(m => m.key === k) || MODES[0]).label;

  return (
    <View>
      <View style={styles.modeBar}>
        {canEdit ? (
          <>
            <Text style={styles.modeBarText}>Event setup</Text>
            <Btn title="Edit" icon="create-outline" variant="outline" small onPress={onEdit} />
          </>
        ) : (
          <Hint style={{ marginTop: 0, flex: 1 }}>
            {ev.started
              ? 'Games have started — setup is read-only.'
              : `Only the host${ev.createdBy ? `, ${playerName(ev.createdBy)},` : ''} can edit or delete this event.`}
          </Hint>
        )}
      </View>

      <SectionTitle first>Event</SectionTitle>
      <Card>
        <Text style={styles.summaryName}>{ev.name}</Text>
        <InfoRow label="Status" value={STATUS_BADGE[eventStatus(ev)].label} />
        <InfoRow label="Host" value={ev.createdBy ? playerName(ev.createdBy) : '—'} />
        <InfoRow label="Date" value={dateLabel} />
        <InfoRow label="Time" value={`${fmtClock(ev.startTime)} – ${fmtClock(offsetToClock(ev, ev.durationMin))} (${ev.durationMin} min)`} />
        <InfoRow label="Courts" value={`${ev.courts} (capacity ${ev.courts * 4} players)`} />
        <InfoRow label="Game length" value={`${gameLen(ev)} min per round (default)`} last />
      </Card>

      <SectionTitle>Match-mode segments</SectionTitle>
      <Card>
        {ev.segments.map((s, idx) => (
          <React.Fragment key={idx}>
          {idx > 0 ? <View style={styles.segDivider} /> : null}
          <View style={[styles.summarySeg, isBreakSegment(ev, s) && styles.breakSummary]}>
            {isBreakSegment(ev, s) ? (
              <View style={styles.breakHead}>
                <Text style={styles.summarySegTime}>{fmtClock(s.start)} – {fmtClock(s.end)}</Text>
                <BreakTag />
              </View>
            ) : (
              <Text style={styles.summarySegTime}>{fmtClock(s.start)} – {fmtClock(s.end)} · {segmentGameLen(ev, s)} min games</Text>
            )}
            {isBreakSegment(ev, s) ? <Text style={styles.breakNote}>No games on any court.</Text> : courtOpts.map(c => (
              <Text key={c} style={[styles.summarySegMode, (s.modes || {})[c] === 'break' && styles.breakCourt]}>
                {courtLabelForRange(ev, c, toOffset(ev, s.start), toOffset(ev, s.end))} · {modeLabel((s.modes || {})[c] || 'open')}
              </Text>
            ))}
          </View>
          </React.Fragment>
        ))}
      </Card>

      <SectionTitle>Players in this event ({members.length})</SectionTitle>
      <Card>
        {members.length === 0 ? <EmptyState icon="people">No players added to this event yet.</EmptyState> : members.map(p => (
          <Row key={p.id}>
            <View style={styles.memberNameRow}>
              <Text style={styles.memberName} numberOfLines={1}>{p.name}</Text>
              <GenderChip gender={p.gender} />
            </View>
          </Row>
        ))}
      </Card>

      {/* Drafts are often throwaway, so the host can delete one straight from
          here; published events still go through Edit to be deleted. */}
      {canEdit && !ev.published ? (
        <Btn title="Delete draft" icon="trash" variant="ghost" small dangerText onPress={onDelete} style={{ alignSelf: 'flex-end', marginTop: 14 }} />
      ) : null}
    </View>
  );
}

/* Breaks stand out in mint, the app's "ball" colour. */
function BreakTag({ style }) {
  return (
    <View style={[styles.breakTag, style]}>
      <Ionicons name="cafe-outline" size={12} color={colors.ballText} />
      <Text style={styles.breakTagText}>Break</Text>
    </View>
  );
}

function InfoRow({ label, value, last }) {
  return (
    <View style={[styles.infoRow, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function EventMembers({ ev }) {
  const players = useStore(s => s.players);
  const [name, setName] = React.useState('');
  const [gender, setGender] = React.useState('M');
  const [pickedExisting, setPickedExisting] = React.useState('');
  const [editingId, setEditingId] = React.useState(null);
  const [editName, setEditName] = React.useState('');
  const [editGender, setEditGender] = React.useState('M');

  function startEdit(p) { setEditingId(p.id); setEditName(p.name); setEditGender(p.gender); }
  function saveEdit() { editPlayer(editingId, editName, editGender); setEditingId(null); }

  const memberIds = ev.memberIds || [];
  const members = memberIds.map(getPlayerById).filter(Boolean);
  // Only account players can be pulled in from outside this event.
  const nonMembers = players.filter(p => p.claimed && !memberIds.includes(p.id));

  function onRemove(p) {
    if (p.claimed) { removeEventPlayer(ev, p.id); return; }
    showConfirm(`Delete ${p.name}? They were added just for this event, so this also clears their RSVP and any court they claimed here.`, () => removeEventPlayer(ev, p.id), 'Delete');
  }

  return (
    <View>
      <SectionTitle>Players in this event ({members.length})</SectionTitle>
      <Hint style={{ marginTop: -6, marginBottom: 10 }}>Only players added here show up in this event's RSVP and scheduling. Players with an account can only be removed from this event. Players added just for this event can be edited or deleted — until they claim their spot from the RSVP invite link.</Hint>
      <Card>
        {members.length === 0 ? <EmptyState icon="people">No players added to this event yet — add some below.</EmptyState> : members.map(p => editingId === p.id ? (
          <View key={p.id} style={styles.editingRow}>
            <TextField value={editName} onChangeText={setEditName} autoFocus />
            <View style={styles.genderRow}>
              {GENDERS.map(g => (
                <Pill key={g.value} label={g.label} active={editGender === g.value} onPress={() => setEditGender(g.value)} />
              ))}
            </View>
            <View style={styles.editActions}>
              <Pressable onPress={saveEdit} style={styles.iconBtn}><Ionicons name="checkmark-circle" size={18} color={colors.court} /></Pressable>
              <Pressable onPress={() => setEditingId(null)} style={styles.iconBtn}><Ionicons name="close" size={18} color={colors.slate} /></Pressable>
            </View>
          </View>
        ) : (
          <Row key={p.id}>
            <View style={styles.memberNameRow}>
              <Text style={styles.memberName} numberOfLines={1}>{p.name}</Text>
              <GenderChip gender={p.gender} />
            </View>
            {p.claimed ? null : (
              <Pressable onPress={() => startEdit(p)} style={styles.iconBtn}><Ionicons name="pencil" size={15} color={colors.slate} /></Pressable>
            )}
            <Pressable onPress={() => onRemove(p)} style={styles.iconBtn}><Ionicons name="trash" size={15} color={colors.clay} /></Pressable>
          </Row>
        ))}
      </Card>
      <Card>
        {nonMembers.length ? (
          <View>
            <Text style={styles.smallLabel}>Add a player with an account</Text>
            <View style={styles.addExistingRow}>
              <Select
                value={pickedExisting} onValueChange={setPickedExisting} placeholder="Choose…"
                items={nonMembers.map(p => ({ label: `${p.name} (${p.gender})`, value: p.id }))}
              />
              <Btn title="Add" small onPress={() => { if (pickedExisting) { addPlayerToEvent(ev, pickedExisting); setPickedExisting(''); } }} />
            </View>
            <Btn title={`Add all ${nonMembers.length} remaining`} variant="ghost" small onPress={() => addAllPlayersToEvent(ev)} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
          </View>
        ) : <Hint style={{ marginTop: 0 }}>Everyone with an account is already part of this event.</Hint>}
        <Hint>Or add a player just for this event — a name only, not an account. They can claim it later from the RSVP invite link:</Hint>
        <View style={styles.grid2}>
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Player name" />
          <Select
            label="Category" value={gender} onValueChange={setGender}
            items={GENDERS}
          />
        </View>
        <Btn title="Add" icon="add" onPress={() => { if (name.trim()) { addNewPlayerToEvent(ev, name, gender); setName(''); } }} style={{ marginTop: 10, alignSelf: 'flex-end' }} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  disabledInput: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: colors.chalk, color: colors.slate },
  grid2: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  fieldStack: { gap: 10 },
  modeBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 14 },
  modeBarText: { fontSize: 13, fontWeight: '600', color: colors.slate },
  summaryName: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  infoLabel: { fontSize: 12.5, color: colors.slate, fontWeight: '600' },
  infoValue: { fontSize: 13.5, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  summarySeg: { borderLeftWidth: 3, borderLeftColor: colors.court, paddingLeft: 12, gap: 3 },
  breakSeg: { backgroundColor: colors.ballTint, borderRadius: radius.sm, padding: 10, borderLeftWidth: 3, borderLeftColor: colors.ball },
  breakSummary: { backgroundColor: colors.ballTint, borderLeftColor: colors.ball, borderRadius: radius.sm, paddingVertical: 10, paddingRight: 10 },
  breakHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  breakNote: { fontSize: 13, color: colors.ballText },
  breakCourt: { color: colors.ballText, fontWeight: '600' },
  breakTag: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: colors.ball, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  breakTagText: { fontSize: 11, fontWeight: '700', color: colors.ballText, textTransform: 'uppercase', letterSpacing: 0.5 },
  segDivider: { height: 1, backgroundColor: colors.line, marginVertical: 14 },
  segLenRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginBottom: 12 },
  segLenHint: { flex: 1, marginTop: 0, marginBottom: 10 },
  summarySegTime: { fontSize: 14, fontWeight: '600', color: colors.ink, marginBottom: 2 },
  summarySegMode: { fontSize: 13, color: colors.slate },
  fieldRow: { flexDirection: 'row', gap: 10 },
  segBar: { borderLeftWidth: 3, borderLeftColor: colors.court, paddingLeft: 12, marginBottom: 4 },
  smallLabel: { fontSize: 11.5, color: colors.slate, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  courtModeList: { gap: 8 },
  courtModeItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  courtModeLabel: { fontSize: 12.5, color: colors.ink, width: 78 },
  memberNameRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  memberName: { fontWeight: '600', fontSize: 14, flexShrink: 1, color: colors.ink },
  iconBtn: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  editingRow: { backgroundColor: colors.ballTint, borderRadius: radius.sm, padding: 10, marginVertical: 4, gap: 8 },
  genderRow: { flexDirection: 'row', gap: 8 },
  editActions: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  addExistingRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
});
