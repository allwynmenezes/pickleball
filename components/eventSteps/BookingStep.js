import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SectionTitle, Card, Btn, Banner, Badge, BigNum, GenderDot } from '../../lib/ui';
import { isBookingPlanStale, fmtClock, offsetToClock } from '../../lib/engine';
import { recalcBooking, claimSlot, confirmSlot, releaseSlot, getPlayerById, playerName, playerGender, useStore } from '../../lib/store';
import { colors, radius } from '../../lib/theme';

export default function BookingStep({ ev }) {
  const players = useStore(s => s.players);
  const [claimPicks, setClaimPicks] = useState({});
  const memberIds = ev.memberIds || [];
  const members = memberIds.map(getPlayerById).filter(Boolean);

  if (!ev.bookingSlots || ev.bookingSlots.length === 0) {
    return (
      <View>
        <SectionTitle first>Court booking plan</SectionTitle>
        <Card>
          <Text style={styles.hint}>Since the club only allows 2-hour bookings per person, The Pickle Slot works out how many separate bookings are needed to cover the event, court by court, based on who's confirmed so far.</Text>
          <Btn title="Compute booking plan" onPress={() => recalcBooking(ev)} style={{ marginTop: 10 }} />
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
      {stale ? <Banner>RSVPs or event settings have changed since this plan was last updated — the counts below may no longer match who's actually confirmed. Update the plan to refresh it (any slot already claimed or confirmed is kept).</Banner> : null}
      <SectionTitle first>Booking coverage</SectionTitle>
      <Card lift>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <BigNum value={`${confirmedCt}/${total}`} label="bookings confirmed" />
        </View>
        <Btn title={stale ? 'Update plan' : 'Refresh plan'} variant="ghost" small onPress={() => recalcBooking(ev)} style={{ marginTop: 8 }} />
      </Card>

      <SectionTitle>Open booking slots</SectionTitle>
      <Card>
        {sortedSlots.map(s => (
          <View key={s.id} style={styles.slotBlock}>
            <View style={styles.slotHead}>
              <Text style={styles.slotTitle}>Court {s.court}, {fmtClock(offsetToClock(ev, s.start))}–{fmtClock(offsetToClock(ev, s.end))}</Text>
              <Badge label={s.status} kind={s.status === 'confirmed' ? 'ok' : s.status === 'claimed' ? 'wait' : 'flag'} />
              {s.claimedBy ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <GenderDot gender={playerGender(s.claimedBy)} size={16} />
                  <Text style={styles.metaSmall}>{playerName(s.claimedBy)}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.pillRow}>
              {s.status === 'open' ? (
                <>
                  <View style={styles.pickerWrap}>
                    <Picker selectedValue={claimPicks[s.id] || ''} onValueChange={(v) => setClaimPicks({ ...claimPicks, [s.id]: v })}>
                      <Picker.Item label="Claim as…" value="" />
                      {members.map(p => <Picker.Item key={p.id} label={`${p.name} (${p.gender})`} value={p.id} />)}
                    </Picker>
                  </View>
                  <Btn title="Claim" small onPress={() => { const v = claimPicks[s.id]; if (v) claimSlot(ev, s.id, v); }} />
                </>
              ) : null}
              {s.status === 'claimed' ? (
                <>
                  <Btn title="Mark confirmed" small onPress={() => confirmSlot(ev, s.id)} />
                  <Btn title="Release" variant="ghost" small onPress={() => releaseSlot(ev, s.id)} />
                </>
              ) : null}
              {s.status === 'confirmed' ? <Btn title="Release" variant="ghost" small onPress={() => releaseSlot(ev, s.id)} /> : null}
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12.5, color: colors.slate, lineHeight: 18 },
  slotBlock: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 9 },
  slotHead: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  slotTitle: { fontWeight: '600', fontSize: 14, color: colors.ink },
  metaSmall: { fontSize: 12, color: colors.slate },
  pillRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  pickerWrap: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, minWidth: 150, overflow: 'hidden' },
});
