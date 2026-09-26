import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, InteractionManager } from 'react-native';
import PagerView from '../../components/StepPager';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Screen, Card, Btn, TextField, DateField, Pill } from '../../lib/ui';
import { TimeWheelField } from '../../components/WheelPicker';
import { useAuth } from '../../lib/auth';
import { showConfirm } from '../../lib/confirm';
import {
  useStore, getEventById, newEvent, deleteEvent,
  beginNewEventFlow, beginEditEventFlow, cancelEventFlow, saveEventFlow, eventFlowHasChanges,
} from '../../lib/store';
import SetupStep from '../../components/eventSteps/SetupStep';
import RsvpStep from '../../components/eventSteps/RsvpStep';
import BookingStep from '../../components/eventSteps/BookingStep';
import RosterStep from '../../components/eventSteps/RosterStep';
import RoundsStep from '../../components/eventSteps/RoundsStep';
import DetailsStep from '../../components/eventSteps/DetailsStep';
import AiEventComposer from '../../components/AiEventComposer';
import { colors } from '../../lib/theme';

const STEPS = [
  ['setup', 'Setup'], ['rsvp', 'RSVP'], ['booking', 'Courts'],
  ['roster', 'Roster'], ['rounds', 'Rounds'], ['details', 'Details'],
];
const STEP_KEYS = STEPS.map(([key]) => key);

export default function EventFlowScreen() {
  const params = useLocalSearchParams();
  const router = useRouter();
  const isNew = params.id === 'new';

  const [localEventId, setLocalEventId] = useState(isNew ? null : params.id);
  // 'games' is the step's old name — keep links that still use it working.
  const [step, setStep] = useState(params.step === 'games' ? 'rounds' : (params.step || 'setup'));
  const navigation = useNavigation();
  const leaveOk = useRef(false);
  const initRef = useRef(false);
  const pagerRef = useRef(null);
  const [allMounted, setAllMounted] = useState(false);
  const { player: me } = useAuth();
  const stepIdx = Math.max(0, STEP_KEYS.indexOf(step));

  /* The step you opened renders straight away, so its data is on screen as
     the page slides in. Only the other steps wait — they mount once the
     slide has finished, so they don't slow the opening down, and they're
     ready before any swipe needs them. */
  useEffect(() => {
    let task = null;
    const mountRest = () => { if (!task) task = InteractionManager.runAfterInteractions(() => setAllMounted(true)); };
    const unsubscribe = navigation.addListener('transitionEnd', (e) => { if (!e.data || !e.data.closing) mountRest(); });
    const fallback = setTimeout(mountRest, 600); // in case no transition event fires (e.g. web)
    return () => { unsubscribe(); clearTimeout(fallback); if (task) task.cancel(); };
  }, [navigation]);

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

  /* Leaving any other way than Save (Android back gesture/button, iOS swipe)
     would otherwise keep the edits, since they're applied as you go. Treat
     it like Cancel: if anything changed, ask before discarding. */
  useEffect(() => navigation.addListener('beforeRemove', (e) => {
    if (leaveOk.current || !localEventId || !eventFlowHasChanges(localEventId)) return;
    e.preventDefault();
    showConfirm('Discard everything done in this session? Nothing will be saved.', () => {
      cancelEventFlow(localEventId);
      leaveOk.current = true;
      navigation.dispatch(e.data.action);
    }, 'Discard');
  }), [navigation, localEventId]);

  function submitDraft() {
    if (!draft.name.trim()) return;
    const created = newEvent({ ...draft, createdBy: me ? me.id : null });
    // Creating saves the event for good — Cancel from here on only discards
    // later edits, it no longer deletes the event.
    beginEditEventFlow(created);
    setLocalEventId(created.id);
    setStep('setup');
  }
  function cancelDraft() {
    router.back();
  }

  function onCancel() {
    showConfirm('Discard everything done in this session? Nothing will be saved.', () => {
      cancelEventFlow(localEventId);
      leaveOk.current = true;
      router.back();
    }, 'Discard');
  }
  function onSave() {
    saveEventFlow();
    leaveOk.current = true;
    router.back();
  }
  function onDeleteEvent() {
    showConfirm(`Delete "${ev.name}" (${ev.date})? This removes its RSVPs, roster, and booking plan. Players themselves are never deleted — they stay available for other events. This cannot be undone.`, () => {
      deleteEvent(ev.id);
      leaveOk.current = true;
      router.back();
    });
  }

  // Draft composer — nothing created yet.
  if (isNew && !localEventId) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.chalk }}>
        <Screen>
          <Text style={styles.title}>New event</Text>
          {/* Fills the draft below; the user still checks it and taps Create. */}
          <AiEventComposer onFill={(fields) => setDraft((d) => ({ ...d, ...fields }))} />
          <Card style={{ gap: 10 }}>
            <TextField label="Event name" value={draft.name} onChangeText={(v) => setDraft({ ...draft, name: v })} placeholder="e.g. Tuesday Night" autoFocus />
            <View style={styles.grid2}>
              <DateField label="Date" value={draft.date} onChange={(v) => setDraft({ ...draft, date: v })} />
              <TimeWheelField label="Start time" value={draft.startTime} onChange={(v) => setDraft({ ...draft, startTime: v })} />
            </View>
            <View style={styles.grid2}>
              <TextField label="Duration (min)" value={draft.durationMin} onChangeText={(v) => setDraft({ ...draft, durationMin: v })} keyboardType="number-pad" />
              <TextField label="Courts" value={draft.courts} onChangeText={(v) => setDraft({ ...draft, courts: v })} keyboardType="number-pad" />
            </View>
            <View style={styles.pillRow}>
              <Btn title="Create event" onPress={submitDraft} />
              <Btn title="Cancel" variant="ghost" onPress={cancelDraft} />
            </View>
          </Card>
        </Screen>
      </View>
    );
  }

  if (!ev) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.chalk }}>
        <Screen><Text>Event not found.</Text></Screen>
      </View>
    );
  }

  /* Steps live in a native pager (Android ViewPager2 / iOS UIPageViewController):
     the drag, the page settle and the neighbouring page all run on the UI
     thread, independent of JS. A pill tap highlights immediately and asks
     the pager to animate there; a swipe reports back via onPageSelected.
     The web has no native pager, so it just shows the current step. */
  function goToStep(nextKey) {
    const to = STEP_KEYS.indexOf(nextKey);
    if (to === stepIdx) return;
    setStep(nextKey);
    if (pagerRef.current) pagerRef.current.setPage(to);
  }

  function renderStep(key) {
    switch (key) {
      case 'setup': return <SetupStep ev={ev} active={step === 'setup'} onDeleteEvent={onDeleteEvent} canEdit={!!(me && ev.createdBy && me.id === ev.createdBy)} />;
      case 'rsvp': return <RsvpStep ev={ev} />;
      case 'booking': return <BookingStep ev={ev} />;
      case 'roster': return <RosterStep ev={ev} />;
      case 'rounds': return <RoundsStep ev={ev} />;
      case 'details': return <DetailsStep />;
      default: return null;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <View style={styles.flowbar}>
        <View style={styles.flowbarTop}>
          <Text style={styles.title} numberOfLines={1}>{ev.name}</Text>
          <View style={styles.pillRow}>
            <Btn title="Cancel" variant="ghost" small onPress={onCancel} />
            <Btn title="Save" small onPress={onSave} />
          </View>
        </View>
        <View style={styles.stepsRow}>
          {STEPS.map(([key, label]) => (
            <Pill key={key} label={label} active={step === key} outline onPress={() => goToStep(key)} style={styles.stepPill} />
          ))}
        </View>
      </View>
      {Platform.OS === 'web' ? (
        <Screen>{renderStep(step)}</Screen>
      ) : (
        <PagerView
          ref={pagerRef}
          style={{ flex: 1 }}
          initialPage={stepIdx}
          offscreenPageLimit={STEP_KEYS.length}
          onPageSelected={(e) => setStep(STEP_KEYS[e.nativeEvent.position])}
        >
          {STEP_KEYS.map((key, i) => (
            <View key={key} style={{ flex: 1 }} collapsable={false}>
              {allMounted || i === stepIdx ? <Screen>{renderStep(key)}</Screen> : null}
            </View>
          ))}
        </PagerView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 16, color: colors.ink, flexShrink: 1 },
  grid2: { flexDirection: 'row', gap: 10 },
  pillRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  flowbar: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  flowbarTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  stepsRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingBottom: 12 },
  stepPill: { flex: 1, alignItems: 'center' },
});
