import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SectionTitle, Card, Hint, Badge, GenderDot, EmptyState, Pill, IconBtn, LockedNote, DashedLine } from '../../lib/ui';
import { WheelSelectField } from '../WheelPicker';
import { getConfirmedAndWaitlist, getRoundPool, roundTimeOptions, roundSlots, offsetToClock, fmtClock } from '../../lib/engine';
import { setRsvp, setRsvpTime, getPlayerById, playerName, playerGender, useStore } from '../../lib/store';
import { createClaimLink } from '../../lib/api';
import { shareClaimLink } from '../../lib/share';
import { showAlert } from '../../lib/confirm';
import { colors, radius } from '../../lib/theme';

async function shareInvite(player) {
  try {
    const { url } = await createClaimLink(player.id);
    const result = await shareClaimLink(url, player.name);
    if (result.copied) showAlert(`Invite link for ${player.name} copied to clipboard.`);
    else if (!result.shared && result.url) showAlert(`Invite link for ${player.name}:\n${result.url}`);
  } catch (e) {
    showAlert(e.message || `Couldn't create an invite link for ${player.name}.`);
  }
}

export default function RsvpStep({ ev }) {
  const players = useStore(s => s.players);
  const memberIds = ev.memberIds || [];
  const members = memberIds.map(getPlayerById).filter(Boolean);

  if (members.length === 0) {
    return <EmptyState icon="people">No players added to this event yet — add players to it from the Setup step first.</EmptyState>;
  }

  const { confirmed, waitlist } = getConfirmedAndWaitlist(ev, players);
  const locked = !!ev.started;
  const timeline = roundSlots(ev).map(({ offset }) => ({ offset, count: getRoundPool(ev, offset, confirmed, waitlist).length }));
  const maxT = Math.max(1, ...timeline.map(t => t.count));
  const capacity = ev.courts * 4;
  // Scale so the capacity line always sits inside the chart, with headroom.
  const scaleMax = Math.max(maxT, capacity) * 1.1;

  return (
    <View>
      {locked ? <LockedNote /> : null}
      <SectionTitle first>Headcount timeline</SectionTitle>
      <Card>
        <View style={styles.timelineHead}>
          <Text style={styles.timelineHeadLabel}>Players on court, by round</Text>
          <Text style={styles.timelineHeadMax}>capacity {ev.courts * 4}</Text>
        </View>
        {/* Bars are coloured by situation — purple when every court is full,
            the RSVP "Out" pink when a court would sit empty — with the number
            of available players printed in each. The mint capacity line is
            drawn last, on top of the bars, so it's never hidden behind them. */}
        <View style={styles.timelineChart}>
          <View style={styles.timelineBar}>
            {timeline.map((t, i) => {
              const full = t.count >= capacity;
              return (
                <View
                  key={i}
                  style={[
                    styles.timelineBarSeg,
                    { height: `${Math.max(18, t.count / scaleMax * 100)}%` },
                    full ? styles.timelineBarFull : styles.timelineBarShort,
                  ]}
                >
                  <Text style={styles.timelineBarCount}>{t.count}</Text>
                </View>
              );
            })}
            <DashedLine color={colors.ball} thickness={2.5} style={[styles.timelineCapLine, { bottom: `${capacity / scaleMax * 100}%` }]} />
          </View>
        </View>
        <View style={styles.timelineAxis}>
          <Text style={styles.timelineAxisLabel}>{fmtClock(offsetToClock(ev, timeline[0].offset))}</Text>
          <Text style={styles.timelineAxisLabel}>{fmtClock(offsetToClock(ev, timeline[timeline.length - 1].offset))}</Text>
        </View>
        <View style={styles.timelineLegend}>
          <View style={styles.timelineLegendItem}><View style={[styles.timelineSwatch, styles.timelineBarFull]} /><Text style={styles.timelineLegendText}>All courts full</Text></View>
          <View style={styles.timelineLegendItem}><View style={[styles.timelineSwatch, styles.timelineBarShort]} /><Text style={styles.timelineLegendText}>A court sits empty</Text></View>
          <View style={styles.timelineLegendItem}><DashedLine color={colors.ball} thickness={2.5} style={{ width: 16 }} /><Text style={styles.timelineLegendText}>Capacity</Text></View>
        </View>
        <Hint style={{ marginTop: 0 }}>
          Peak: {maxT} players → {Math.ceil(maxT / 4)} courts needed at once. Each bar shows how many players are available that round; purple bars fill every court (capacity {capacity}), pink ones leave a court empty. Includes waitlisted players pulled in to fill gaps left by partially-available regulars.
        </Hint>
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
                <View style={styles.nameBlock}>
                  <View style={styles.nameLine}>
                    <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
                    <GenderDot gender={p.gender} />
                    {!p.claimed ? <IconBtn icon="share-social-outline" onPress={() => shareInvite(p)} /> : null}
                  </View>
                  {isWaitlisted ? <Badge label="Waitlist" kind="wait" /> : null}
                </View>
                <View style={styles.pillRow}>
                  <Pill label="In" active={status === 'in'} activeColor={colors.court} disabled={locked} onPress={() => setRsvp(ev, p.id, 'in')} />
                  <Pill label="Partial" active={status === 'partial'} activeColor={colors.ball} activeTextColor={colors.ink} disabled={locked} onPress={() => setRsvp(ev, p.id, 'partial')} />
                  <Pill label="Out" active={status === 'out'} activeColor={colors.female} disabled={locked} onPress={() => setRsvp(ev, p.id, 'out')} />
                </View>
              </View>
              {status === 'partial' ? (
                <View style={styles.grid2}>
                  <WheelSelectField
                    disabled={locked}
                    label="From" value={offsetToClock(ev, r.start)} onValueChange={(v) => setRsvpTime(ev, p.id, 'start', v)}
                    items={roundTimeOptions(ev, r.start).map(o => ({ label: o.label, value: o.clock }))}
                  />
                  <WheelSelectField
                    disabled={locked}
                    label="To" value={offsetToClock(ev, r.end)} onValueChange={(v) => setRsvpTime(ev, p.id, 'end', v)}
                    items={roundTimeOptions(ev, r.end).map(o => ({ label: o.label, value: o.clock }))}
                  />
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
                <Text>{playerName(id)}</Text>
                <GenderDot gender={playerGender(id)} />
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
  timelineHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  timelineHeadLabel: { fontSize: 11.5, color: colors.slate, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  timelineHeadMax: { fontSize: 11, color: colors.slate },
  timelineChart: { height: 96, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: 4 },
  timelineCapLine: { position: 'absolute', left: 0, right: 0 },
  timelineBar: { flexDirection: 'row', alignItems: 'flex-end', height: '100%', gap: 2, position: 'relative' },
  timelineBarSeg: { flex: 1, borderRadius: 3, alignItems: 'center', paddingTop: 2 },
  timelineBarFull: { backgroundColor: colors.court },
  timelineBarShort: { backgroundColor: colors.female },
  timelineBarCount: { fontSize: 9.5, fontWeight: '700', color: colors.white },
  timelineLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 6, marginBottom: 6 },
  timelineLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  timelineSwatch: { width: 10, height: 10, borderRadius: 2 },
  timelineLegendText: { fontSize: 10.5, color: colors.slate },
  timelineAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  timelineAxisLabel: { fontSize: 10, color: colors.slate },
  responseRow: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8 },
  responseTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameBlock: { flex: 1, minWidth: 0, gap: 4, alignItems: 'flex-start' },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  name: { fontWeight: '600', fontSize: 14, flexShrink: 1, color: colors.ink },
  pillRow: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  grid2: { flexDirection: 'row', gap: 10 },
  flagline: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  metaSmall: { fontSize: 12, color: colors.slate },
});
