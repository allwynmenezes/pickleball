import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Screen, Card, Btn, Field } from '../../lib/ui';
import { showConfirm } from '../../lib/confirm';
import {
  useStore, getEventById, newEvent, deleteEvent,
  beginNewEventFlow, beginEditEventFlow, cancelEventFlow, saveEventFlow,
} from '../../lib/store';
import SetupStep from '../../components/eventSteps/SetupStep';
import RsvpStep from '../../components/eventSteps/RsvpStep';
import BookingStep from '../../components/eventSteps/BookingStep';
import RosterStep from '../../components/eventSteps/RosterStep';
import GamesStep from '../../components/eventSteps/GamesStep';
import DetailsStep from '../../components/eventSteps/DetailsStep';
import { colors, radius } from '../../lib/theme';

const STEPS = [
  ['setup', 'Setup'], ['rsvp', 'RSVP'], ['booking', 'Booking'],
  ['roster', 'Roster'], ['games', 'Games'], ['details', 'Details'],
];

export default function EventFlowScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const isNew = params.id === 'new';

  const [localEventId, setLocalEventId] = useState(isNew ? null : params.id);
  const [step, setStep] = useState(params.step || 'setup');
  const initRef = useRef(false);

  const [draft, setDraft] = useState(() => ({
    name: '', date: params.date || new Date().toISOString().slice(0, 10),
    startTime: '18:00', durationMin: '240', courts: '4',
  }));

  const ev = useStore(s => (localEventId ? s.events.find(e => e.id === localEventId) : null));

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    if (isNew) {
      beginNewEventFlow();
    } else {
      const existing = getEventById(params.id);
      if (existing) beginEditEventFlow(existing);
    }
  }, []);

  function submitDraft() {
    if (!draft.name.trim()) return;
    const created = newEvent(draft);
    setLocalEventId(created.id);
    setStep('setup');
  }
  function cancelDraft() {
    router.back();
  }

  function onCancel() {
    showConfirm('Discard everything done in this session? Nothing will be saved.', () => {
      cancelEventFlow(localEventId);
      router.back();
    }, 'Discard');
  }
  function onSave() {
    saveEventFlow();
    router.back();
  }
  function onDeleteEvent() {
    showConfirm(`Delete "${ev.name}" (${ev.date})? This removes its RSVPs, roster, and booking plan. Players themselves are never deleted — they stay available for other events. This cannot be undone.`, () => {
      deleteEvent(ev.id);
      router.back();
    });
  }

  // Draft composer — nothing created yet.
  if (isNew && !localEventId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.chalk }} edges={['top']}>
        <Screen>
          <Text style={styles.title}>New event</Text>
          <Card>
            <Field label="Event name">
              <TextInput value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="e.g. Tuesday Night" style={styles.input} autoFocus />
            </Field>
            <View style={styles.grid2}>
              <Field label="Date"><TextInput value={draft.date} onChangeText={(v) => setDraft({ ...draft, date: v })} placeholder="YYYY-MM-DD" style={styles.input} /></Field>
              <Field label="Start time"><TextInput value={draft.startTime} onChangeText={(v) => setDraft({ ...draft, startTime: v })} placeholder="HH:MM" style={styles.input} /></Field>
            </View>
            <View style={styles.grid2}>
              <Field label="Duration (min)"><TextInput value={draft.durationMin} onChangeText={(v) => setDraft({ ...draft, durationMin: v })} keyboardType="number-pad" style={styles.input} /></Field>
              <Field label="Courts"><TextInput value={draft.courts} onChangeText={(v) => setDraft({ ...draft, courts: v })} keyboardType="number-pad" style={styles.input} /></Field>
            </View>
            <View style={styles.pillRow}>
              <Btn title="Create event" onPress={submitDraft} />
              <Btn title="Cancel" variant="ghost" onPress={cancelDraft} />
            </View>
          </Card>
        </Screen>
      </SafeAreaView>
    );
  }

  if (!ev) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.chalk }} edges={['top']}>
        <Screen><Text>Event not found.</Text></Screen>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.chalk }} edges={['top']}>
      <View style={styles.flowbar}>
        <View style={styles.flowbarTop}>
          <Text style={styles.title} numberOfLines={1}>{ev.name}</Text>
          <View style={styles.pillRow}>
            <Btn title="Cancel" variant="ghost" small onPress={onCancel} />
            <Btn title="Save" small onPress={onSave} />
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stepsRow} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
          {STEPS.map(([key, label]) => (
            <Pressable key={key} onPress={() => setStep(key)} style={[styles.stepPill, step === key && { backgroundColor: colors.court, borderColor: colors.court }]}>
              <Text style={[styles.stepPillText, step === key && { color: '#fff' }]}>{label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      <Screen>
        {step === 'setup' ? <SetupStep ev={ev} onDeleteEvent={onDeleteEvent} /> : null}
        {step === 'rsvp' ? <RsvpStep ev={ev} /> : null}
        {step === 'booking' ? <BookingStep ev={ev} /> : null}
        {step === 'roster' ? <RosterStep ev={ev} /> : null}
        {step === 'games' ? <GamesStep ev={ev} /> : null}
        {step === 'details' ? <DetailsStep /> : null}
      </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 16, color: colors.ink, flexShrink: 1 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: '#fff' },
  grid2: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  pillRow: { flexDirection: 'row', gap: 8 },
  flowbar: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  flowbarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  stepsRow: { paddingBottom: 12 },
  stepPill: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  stepPillText: { fontSize: 12, fontWeight: '700', color: colors.slate },
});
