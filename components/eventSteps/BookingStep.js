import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SectionTitle, Card, Btn, Banner, Badge, BigNum, GenderDot, Hint, Select, LockedNote } from '../../lib/ui';
import { isBookingPlanStale, fmtClock, offsetToClock } from '../../lib/engine';
import {
  recalcBooking, claimSlot, confirmSlot, releaseSlot, getPlayerById, playerName, playerGender,
  slotLabel, updateSlotName, useStore, playerBlurb,
} from '../../lib/store';
import { colors, radius } from '../../lib/theme';

export default function BookingStep({ ev }) {
  const players = useStore(s => s.players);
  const [claimPicks, setClaimPicks] = useState({});
  const [editingSlotId, setEditingSlotId] = useState(null);
  const [courtNameDraft, setCourtNameDraft] = useState('');
  const memberIds = ev.memberIds || [];
  const members = memberIds.map(getPlayerById).filter(Boolean);
  const locked = !!ev.started;

  /* Each booking slot carries its own court name - back-to-back bookings
     are often on different physical courts, so renaming one slot never
     renames another. */
  function startEditCourt(s) {
    setEditingSlotId(s.id);
    setCourtNameDraft(slotLabel(ev, s) === `Court ${s.court}` ? '' : slotLabel(ev, s));
  }
  function saveEditCourt(s) {
    updateSlotName(ev, s.id, courtNameDraft);
    setEditingSlotId(null);
  }

  // Called as a plain function (not <CourtTitle />): a component defined in
  // render is a new type every render, which remounted the TextInput on each
  // keystroke and dropped focus.
  function renderCourtTitle(s) {
    if (editingSlotId === s.id) {
      return (
        <View style={styles.courtEditRow}>
          <TextInput
            value={courtNameDraft} onChangeText={setCourtNameDraft} placeholder={`Court ${s.court}`}
            style={styles.courtEditInput} autoFocus onSubmitEditing={() => saveEditCourt(s)} onBlur={() => saveEditCourt(s)}
          />
          <Pressable onPress={() => saveEditCourt(s)} style={styles.courtEditSave} hitSlop={8}>
            <Ionicons name="checkmark" size={16} color={colors.court} />
          </Pressable>
        </View>
      );
    }
    return (
      <>
        <Text style={styles.slotTitle} numberOfLines={1}>{slotLabel(ev, s)}</Text>
        {locked ? null : (
          <Pressable onPress={() => startEditCourt(s)} style={styles.editBtn}>
            <Ionicons name="pencil" size={15} color={colors.slate} />
          </Pressable>
        )}
      </>
    );
  }

  if (!ev.bookingSlots || ev.bookingSlots.length === 0) {
    return (
      <View>
        <SectionTitle first>Court booking plan</SectionTitle>
        <Card>
          <Hint style={{ marginTop: 0 }}>Since the club only allows 2-hour bookings per person, The Pickle Slot works out how many separate bookings are needed to cover the event, court by court, based on who's confirmed so far.</Hint>
          <Btn title="Compute booking plan" disabled={locked} onPress={() => recalcBooking(ev)} style={{ marginTop: 10, alignSelf: 'flex-end' }} />
        </Card>
      </View>
    );
  }

  const stale = isBookingPlanStale(ev);
  const total = ev.bookingSlots.length;
  const confirmedCt = ev.bookingSlots.filter(s => s.status === 'confirmed').length;
  const sortedSlots = [...ev.bookingSlots].sort((a, b) => a.start - b.start || a.court - b.court);

  return (
    <View>
      {locked ? <LockedNote /> : null}
      {stale && !locked ? <Banner>RSVPs or event settings have changed since this plan was last updated — the counts below may no longer match who's actually confirmed. Update the plan to refresh it (any slot already claimed or confirmed is kept).</Banner> : null}
      <SectionTitle first>Booking coverage</SectionTitle>
      <Card lift>
        <BigNum value={`${confirmedCt}/${total}`} label="bookings confirmed" />
        <Btn title={stale ? 'Update plan' : 'Refresh plan'} variant="ghost" small disabled={locked} onPress={() => recalcBooking(ev)} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Card>

      <SectionTitle>Open booking slots</SectionTitle>
      <Card>
        <Hint style={{ marginTop: 0, marginBottom: 4 }}>Tap the pencil next to a court to give that booking its club-specific court name.</Hint>
        {sortedSlots.map(s => (
          <View key={s.id} style={styles.slotBlock}>
            <View style={styles.slotLine}>
              {renderCourtTitle(s)}
              <Text style={styles.sep}>•</Text>
              <Text style={styles.metaSmall}>{fmtClock(offsetToClock(ev, s.start))}–{fmtClock(offsetToClock(ev, s.end))}</Text>
            </View>
            <View style={styles.slotLine}>
              <Badge label={s.status} kind={s.status === 'confirmed' ? 'wait' : s.status === 'claimed' ? 'ok' : 'flag'} />
              {s.claimedBy ? (
                <>
                  <Text style={styles.sep}>•</Text>
                  <Text style={styles.claimedName} numberOfLines={1}>{playerName(s.claimedBy)}</Text>
                  <GenderDot gender={playerGender(s.claimedBy)} size={16} />
                </>
              ) : null}
            </View>
            <View style={styles.slotActions}>
              {s.status === 'open' ? (
                <>
                  <Select
                    disabled={locked}
                    value={claimPicks[s.id] || ''} onValueChange={(v) => setClaimPicks({ ...claimPicks, [s.id]: v })}
                    placeholder="Claim as…" items={members.map(p => ({ label: p.name, value: p.id, description: playerBlurb(p) }))}
                    style={{ flex: 0, width: 150 }}
                  />
                  <Btn title="Claim" small disabled={locked} onPress={() => { const v = claimPicks[s.id]; if (v) claimSlot(ev, s.id, v); }} />
                </>
              ) : null}
              {s.status === 'claimed' ? (
                <>
                  <Btn title="Mark confirmed" small disabled={locked} onPress={() => confirmSlot(ev, s.id)} />
                  <Btn title="Release" variant="ghost" small disabled={locked} onPress={() => releaseSlot(ev, s.id)} />
                </>
              ) : null}
              {s.status === 'confirmed' ? <Btn title="Release" variant="ghost" small disabled={locked} onPress={() => releaseSlot(ev, s.id)} /> : null}
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  slotBlock: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 10 },
  slotLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 6 },
  slotTitle: { fontWeight: '600', fontSize: 14, color: colors.ink, flexShrink: 1 },
  // Same size/border as the Players page edit button.
  editBtn: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  sep: { fontSize: 12, color: colors.slate },
  metaSmall: { fontSize: 12, color: colors.slate },
  claimedName: { fontSize: 13, color: colors.ink, flexShrink: 1 },
  slotActions: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'flex-end' },
  courtEditRow: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '100%' },
  courtEditInput: {
    borderWidth: 1, borderColor: colors.court, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8,
    fontSize: 14, color: colors.ink, backgroundColor: colors.white, flex: 1, minWidth: 0,
  },
  courtEditSave: {
    width: 26, height: 26, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.court, backgroundColor: colors.courtTint,
  },
});
