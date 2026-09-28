import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Platform, InteractionManager, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PagerView from '../../components/StepPager';
import { useLocalSearchParams, useRouter, useNavigation } from 'expo-router';
import { Screen, Card, Btn, TextField, DateField } from '../../lib/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import StepIndicator from '../../components/StepIndicator';
import { TimeWheelField } from '../../components/WheelPicker';
import { localDateStr } from '../../lib/engine';
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
import AiEventPanel from '../../components/AiEventPanel';
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
  const [aiOpen, setAiOpen] = useState(false);
  const insets = useSafeAreaInsets();
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
    name: '', date: params.date || localDateStr(),
    startTime: '18:00', durationMin: '240', courts: '4', gameLenMin: '15',
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
          <AiEventComposer
            messages={draft.aiMessages || []}
            onMessages={(msgs) => setDraft((d) => ({ ...d, aiMessages: [...(d.aiMessages || []), ...msgs] }))}
            onFill={(fields) => setDraft((d) => ({ ...d, ...fields }))}
            draft={draft}
          />
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
            <View style={styles.grid2}>
              <TextField label="Game length (min)" value={draft.gameLenMin} onChangeText={(v) => setDraft({ ...draft, gameLenMin: v })} keyboardType="number-pad" />
              <View style={{ flex: 1 }} />
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

  const canEdit = !!(me && ev.createdBy && me.id === ev.createdBy);

  function renderStep(key) {
    switch (key) {
      case 'setup': return <SetupStep ev={ev} active={step === 'setup'} onDeleteEvent={onDeleteEvent} canEdit={canEdit} />;
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
      {/* Steps on top; the event's name and actions sit at the bottom, in
          thumb reach. */}
      <View style={styles.stepsBar}>
        <StepIndicator steps={STEPS} current={step} onSelect={goToStep} />
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
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Text style={styles.title} numberOfLines={1}>{ev.name}</Text>
        <View style={styles.pillRow}>
          {/* The assistant, on every step — for the host, until games start. */}
          {canEdit && !ev.started ? (
            <Pressable
              onPress={() => setAiOpen(true)}
              style={({ pressed }) => [styles.aiBtn, pressed && styles.aiBtnPressed]}
              accessibilityRole="button" accessibilityLabel="Open the assistant"
            >
              <Ionicons name="sparkles" size={16} color={colors.court} />
            </Pressable>
          ) : null}
          <Btn title="Cancel" variant="ghost" small onPress={onCancel} />
          <Btn title="Save" small onPress={onSave} />
        </View>
      </View>
      {canEdit && !ev.started ? <AiEventPanel eventId={ev.id} visible={aiOpen} onClose={() => setAiOpen(false)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 16, color: colors.ink, flexShrink: 1 },
  grid2: { flexDirection: 'row', gap: 10 },
  pillRow: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  stepsBar: { backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line,
    shadowColor: colors.courtDeep, shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: -2 }, elevation: 8,
  },
  aiBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.court, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  aiBtnPressed: { backgroundColor: colors.courtTint },
});
