import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Vibration, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { onRoundChange, getEventById, playerName, courtLabel, onSyncProblem, getSyncProblem } from '../lib/store';
import { useAuth } from '../lib/auth';
import { pushOnce } from '../lib/nav';
import { colors, radius } from '../lib/theme';

/* Round alerts inside the app: when the host (on another phone) starts
   games, moves to the next round or starts the playoffs of an event you're
   in, a banner drops in with where you're playing — tap it for the Rounds
   step. Changes arrive through live sync (lib/store.js), so this works
   while the app is open; alerts with the app closed need push
   notifications (see docs/event-options.md). */
export default function RoundNotifier() {
  const { player: me } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState(null);
  const timer = useRef(null);
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => onRoundChange(change => {
    const meId = meRef.current && meRef.current.id;
    const ev = getEventById(change.eventId);
    if (!meId || !ev || !(ev.memberIds || []).includes(meId) || ev.createdBy === meId) return;
    // Only moving on is news — not the host stepping back a round.
    if (!change.started && !change.playoffs && !change.forward) return;
    const text = describe(ev, change, meId);
    if (!text) return;
    setNote({ eventId: ev.id, title: ev.name, text });
    if (Platform.OS !== 'web') Vibration.vibrate(300);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), 12000);
  }), []);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!note) return null;
  return (
    <View style={[styles.wrap, { top: insets.top + 8 }]} pointerEvents="box-none">
      <Pressable
        style={styles.card}
        accessibilityRole="button" accessibilityLabel={`${note.title}: ${note.text}`}
        onPress={() => { setNote(null); pushOnce(router, { pathname: '/event/[id]', params: { id: note.eventId, step: 'rounds' } }); }}
      >
        <Ionicons name="notifications" size={18} color={colors.courtTint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{note.title}</Text>
          <Text style={styles.text}>{note.text}</Text>
        </View>
        <Pressable onPress={() => setNote(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Ionicons name="close" size={18} color={colors.courtTint} />
        </Pressable>
      </Pressable>
    </View>
  );
}

/* A strip at the bottom while changes aren't reaching the server: kept and
   retried (offline, server trouble), or refused and undone. */
export function SyncStatus() {
  const insets = useSafeAreaInsets();
  const [problem, setProblem] = useState(getSyncProblem());
  const [shownRejected, setShownRejected] = useState(false);
  useEffect(() => onSyncProblem(p => { setProblem(p); if (p === 'rejected') setShownRejected(true); }), []);
  useEffect(() => {
    if (!shownRejected) return undefined;
    const t = setTimeout(() => setShownRejected(false), 8000);
    return () => clearTimeout(t);
  }, [shownRejected]);
  const text = problem === 'retrying' ? 'Not saved yet — no connection to the server. Retrying…'
    : problem === 'rejected' && shownRejected ? "A change couldn't be saved and was undone." : null;
  if (!text) return null;
  return (
    <View style={[styles.sync, { bottom: insets.bottom + 72 }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <Ionicons name={problem === 'retrying' ? 'cloud-offline-outline' : 'alert-circle-outline'} size={16} color="#fff" />
      <Text style={styles.syncText}>{text}</Text>
    </View>
  );
}

function describe(ev, change, meId) {
  if (change.playoffs) {
    const m = (ev.playoffs && ev.playoffs.matches || []).find(x => [...(x.teamA || []), ...(x.teamB || [])].includes(meId));
    return m ? `Playoffs have started — you're in ${m.label}.` : 'Playoffs have started.';
  }
  const idx = change.roundIndex || 0;
  const round = (ev.roster || [])[idx];
  if (!round) return null;
  const lead = change.started ? 'Games have started! ' : '';
  const c = round.courts.find(x => [...x.teamA, ...x.teamB].includes(meId));
  if (!c) return `${lead}Round ${idx + 1}: you're sitting out this one.`;
  const mine = c.teamA.includes(meId) ? c.teamA : c.teamB;
  const them = c.teamA.includes(meId) ? c.teamB : c.teamA;
  const partner = mine.filter(id => id !== meId).map(playerName);
  return `${lead}Round ${idx + 1}: ${courtLabel(ev, c.court, round.offset)}${partner.length ? ` with ${partner.join(' & ')}` : ''} v ${them.map(playerName).join(' & ')}.`;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 50 },
  card: {
    width: '100%', maxWidth: 520, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md,
    backgroundColor: colors.courtDeep, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 10,
  },
  title: { color: colors.courtTint, fontWeight: '700', fontSize: 13 },
  text: { color: '#fff', fontSize: 13.5, marginTop: 2 },
  sync: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.clayDeep, zIndex: 40 },
  syncText: { color: '#fff', fontSize: 13, flex: 1 },
});
