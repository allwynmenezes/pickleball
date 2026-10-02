import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectionTitle, Card, Field, TextField, DateField, Hint, Btn, Row, GenderChip, DuprChip, EmptyState, Select, Pill } from '../../lib/ui';
import { TimeWheelField, WheelSelectField } from '../WheelPicker';
import { showAlert, showConfirm } from '../../lib/confirm';
import {
  updateEventField, normalizeSegments, addSegment, addBreak, removeSegment, updateSegment, updateSegmentMode, updateSegmentGameLen,
  addPlayerToEvent, addAllPlayersToEvent, addNewPlayerToEvent, removeEventPlayer, useStore, getPlayerById, editPlayer, setPlayerDupr,
  courtLabelForRange, playerName, playerBlurb, moveBreak, setEventTimes,
} from '../../lib/store';
import { fmtClock, offsetToClock, toOffset, timeOptions, gameLen, segmentGameLen, eventStatus, STATUS_BADGE, isBreakSegment, perCourt, playerCapacity, fmtDuration } from '../../lib/engine';
import { EventOptionsEditor, EventOptionsSummary } from '../EventOptions';
import { colors, radius } from '../../lib/theme';

const GENDERS = [
  { label: 'Male', value: 'M', description: "Plays on men's and mixed courts." },
  { label: 'Female', value: 'F', description: "Plays on women's and mixed courts." },
  { label: 'Other', value: 'O', description: 'Plays on any-combination courts.' },
];

const MODES = [
  { key: 'open', label: 'Any combination', description: 'Anyone can play anyone on this court.' },
  { key: 'men', label: "Men's only", description: 'Only men play on this court.' },
  { key: 'women', label: "Women's only", description: 'Only women play on this court.' },
  { key: 'mixed', label: 'Mixed', description: 'Each team is one man and one woman.' },
  { key: 'break', label: 'Break (no games)', description: 'This court rests for the segment.' },
];

function ModeSelect({ value, onChange }) {
  return (
    <Select
      value={value} onValueChange={onChange}
      items={MODES.map(m => ({ label: m.label, value: m.key, description: m.description }))}
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
   it) gets the Edit button in the event's action bar — and with it Delete,
   which lives in edit mode. The server enforces the same rule on every
   save. Edit mode belongs to the event screen (app/event/[id].js), so it
   survives the pager rebuilding when the steps change. */

export default function SetupStep({ ev, onDeleteEvent, canEdit, editing }) {
  normalizeSegments(ev);
  if (!editing || !canEdit || ev.started) return <SetupSummary ev={ev} canEdit={canEdit && !ev.started} onDelete={onDeleteEvent} />;
  const courtOpts = Array.from({ length: ev.courts }, (_, i) => i + 1);
  const endClock = offsetToClock(ev, ev.durationMin);

  return (
    <View>
      <SectionTitle first>Event</SectionTitle>
      <Card style={styles.fieldStack}>
        <TextField label="Event name" value={ev.name} onChangeText={(v) => updateEventField(ev, 'name', v)} />
        <View style={styles.fieldRow}>
          <DateField label="Date" value={ev.date} onChange={(v) => updateEventField(ev, 'date', v)} />
          <NumberField label="Number of courts" ev={ev} field="courts" value={ev.courts} />
        </View>
        <View style={styles.fieldRow}>
          <TimeWheelField label="Start time" value={ev.startTime} onChange={(v) => setEventTimes(ev, v, endClock)} />
          <TimeWheelField label="End time" value={endClock} onChange={(v) => setEventTimes(ev, ev.startTime, v)} />
        </View>
        <Text style={styles.duration}>Duration: {fmtDuration(ev.durationMin)}</Text>
        <NumberField label="Game length (min per round)" ev={ev} field="gameLenMin" value={gameLen(ev)} />
        <Hint style={{ marginTop: 0 }}>Capacity is {playerCapacity(ev) === Infinity ? 'unlimited (extra players sit out in turns)' : `${playerCapacity(ev)} players (courts × ${perCourt(ev)})`}. Each round is {gameLen(ev)} min unless a segment below sets its own game length; the first game doubles as warm-up.</Hint>
        <Btn title="Delete event" icon="trash" variant="ghost" small dangerText onPress={onDeleteEvent} style={{ alignSelf: 'flex-end' }} />
      </Card>

      <EventOptionsEditor ev={ev} />

      <SectionTitle>Match-mode segments</SectionTitle>
      <Card>
        <Hint style={{ marginTop: 0, marginBottom: 4 }}>Segments always run back-to-back, covering the whole event with no gaps or overlaps. Move a boundary time to reshape the two segments on either side of it.</Hint>
        {ev.segments.map((s, idx) => {
          const isLast = idx === ev.segments.length - 1;
          if (isBreakSegment(ev, s)) {
            return (
              <React.Fragment key={idx}>
                {idx > 0 ? <View style={styles.segDivider} /> : null}
                <BreakEditor ev={ev} idx={idx} seg={s} />
              </React.Fragment>
            );
          }
          return (
            <React.Fragment key={idx}>
            {idx > 0 ? <View style={styles.segDivider} /> : null}
            <View style={styles.segBar}>
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
        <View style={styles.addRow}>
          <Btn title="Add game segment" icon="add" variant="outline" small onPress={() => { const r = addSegment(ev); if (r.error) showAlert(r.error); }} />
          <Btn title="Add break" icon="cafe-outline" variant="outline" small onPress={() => { const r = addBreak(ev, defaultBreakStart(ev), 15); if (r.error) showAlert(r.error); }} />
        </View>
        <Hint>A break stops games on every court. To rest just one court, set it to "Break" in a game segment's mode per court. If a Mixed or single-gender court can't be filled with the players actually available, that court falls back to "any combination" for the affected time and gets flagged in the roster.</Hint>
      </Card>

      <EventMembers ev={ev} />
    </View>
  );
}

function SetupSummary({ ev, canEdit, onDelete }) {
  const players = useStore(s => s.players);
  const members = (ev.memberIds || []).map(getPlayerById).filter(Boolean);
  const courtOpts = Array.from({ length: ev.courts }, (_, i) => i + 1);
  const dateLabel = new Date(ev.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const modeLabel = (k) => (MODES.find(m => m.key === k) || MODES[0]).label;

  return (
    <View>
      {canEdit ? null : (
        <View style={styles.modeBar}>
          <Hint style={{ marginTop: 0, flex: 1 }}>
            {ev.started
              ? 'Games have started — setup is read-only.'
              : `Only the host${ev.createdBy ? `, ${playerName(ev.createdBy)},` : ''} can edit or delete this event.`}
          </Hint>
        </View>
      )}

      <SectionTitle first>Event</SectionTitle>
      <Card>
        <Text style={styles.summaryName}>{ev.name}</Text>
        <InfoRow label="Status" value={STATUS_BADGE[eventStatus(ev)].label} />
        <InfoRow label="Host" value={ev.createdBy ? playerName(ev.createdBy) : '—'} />
        <InfoRow label="Date" value={dateLabel} />
        <InfoRow label="Time" value={`${fmtClock(ev.startTime)} – ${fmtClock(offsetToClock(ev, ev.durationMin))} (${ev.durationMin} min)`} />
        <InfoRow label="Courts" value={String(ev.courts)} />
        <InfoRow label="Game length" value={`${gameLen(ev)} min per round (default)`} last />
      </Card>

      <EventOptionsSummary ev={ev} canEdit={canEdit} />

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
              <DuprChip dupr={p.dupr} />
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

/* Where "Add break" puts a new 15-minute break: on the first hour mark
   (a third of the way into a short event) — or, if that isn't free game
   time, halfway through the longest game segment. The host moves it from
   there. */
function defaultBreakStart(ev) {
  const round5 = m => Math.max(5, Math.min(ev.durationMin - 20, Math.round(m / 5) * 5));
  const pick = round5(ev.durationMin >= 80 ? 60 : ev.durationMin / 3);
  const games = ev.segments.filter(s => !isBreakSegment(ev, s)).map(s => [toOffset(ev, s.start), toOffset(ev, s.end) || ev.durationMin]);
  if (games.some(([a, b]) => a <= pick && pick + 15 <= b)) return pick;
  const [a, b] = games.reduce((best, g) => (g[1] - g[0] > best[1] - best[0] ? g : best), [0, 0]);
  return round5(a + (b - a - 15) / 2);
}

/* A break (every court rests): pick when it starts and ends, right in the
   segment list. It covers all courts, so there's no per-court list. See
   moveBreak in lib/store.js. */
function BreakEditor({ ev, idx, seg }) {
  const start = toOffset(ev, seg.start);
  const end = idx === ev.segments.length - 1 ? ev.durationMin : toOffset(ev, seg.end);
  const starts = [];
  for (let off = 0; off <= ev.durationMin - 5; off += 5) starts.push(off);
  const ends = [];
  for (let off = start + 5; off <= ev.durationMin; off += 5) ends.push(off);
  const move = (a, b) => { const r = moveBreak(ev, idx, a, b); if (r.error) showAlert(r.error); };
  const clock = off => fmtClock(offsetToClock(ev, off));

  return (
    <View style={[styles.segBar, styles.breakSeg]}>
      <BreakTag style={{ marginBottom: 6 }} />
      <View style={styles.grid2}>
        <WheelSelectField
          label="Starts at" value={start}
          onValueChange={(v) => { const a = Number(v); move(a, Math.min(ev.durationMin, a + (end - start))); }}
          items={starts.map(off => ({ label: clock(off), value: off }))}
        />
        <WheelSelectField
          label="Ends at" value={end}
          onValueChange={(v) => move(start, Number(v))}
          items={ends.map(off => ({ label: clock(off), value: off }))}
        />
      </View>
      <Text style={styles.breakNote}>No games on any court from {clock(start)} to {clock(end)}.</Text>
      <Hint style={{ marginTop: 4 }}>To rest just one court, set it to "Break (no games)" under Mode per court in a game segment.</Hint>
      <Btn
        title="Remove break" icon="trash" variant="ghost" small dangerText
        onPress={() => { const r = removeSegment(ev, idx); if (r.error) showAlert(r.error); }}
        style={{ marginTop: 6, alignSelf: 'flex-end' }}
      />
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
  const [editDupr, setEditDupr] = React.useState('');

  function startEdit(p) { setEditingId(p.id); setEditName(p.name); setEditGender(p.gender); setEditDupr(p.dupr != null ? String(p.dupr) : ''); }
  function saveEdit() {
    const r = setPlayerDupr(editingId, editDupr);
    if (r.error) { showAlert(r.error); return; }
    editPlayer(editingId, editName, editGender);
    setEditingId(null);
  }

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
            <TextField label="DUPR rating (optional)" value={editDupr} onChangeText={setEditDupr} keyboardType="decimal-pad" placeholder="e.g. 3.742" />
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
              <DuprChip dupr={p.dupr} />
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
                items={nonMembers.map(p => ({ label: p.name, value: p.id, description: playerBlurb(p) }))}
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
  summaryName: { fontSize: 16, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  infoLabel: { fontSize: 12.5, color: colors.slate, fontWeight: '600' },
  infoValue: { fontSize: 13.5, color: colors.ink, flexShrink: 1, textAlign: 'right' },
  summarySeg: { borderLeftWidth: 3, borderLeftColor: colors.court, paddingLeft: 12, gap: 3 },
  addRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' },
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
  duration: { fontSize: 13, color: colors.ink, fontWeight: '600', marginTop: -2 },
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
