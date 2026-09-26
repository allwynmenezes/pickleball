import React, { useState } from 'react';
import { View, Text, TextInput, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Card, Btn, Hint, Banner } from '../lib/ui';
import { parseEventText } from '../lib/api';
import { colors, radius } from '../lib/theme';

/* "Describe your event": the user types (or dictates, with the keyboard's
   mic) a sentence, the backend turns it into a draft, and onFill hands the
   draft to the new-event form. Nothing is created here — the user still
   checks the form and taps Create. See backend-worker/src/ai.js. */

const MAX_LEN = 500;
const FIELD_LABELS = {
  name: 'name', date: 'date', startTime: 'start time', durationMin: 'length', courts: 'courts',
  gameLenMin: 'game length', segments: 'play format', players: 'players',
};

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/* The server sends segments as clock times; the form keeps their lengths
   instead, so they still fit if the user then changes the start time. */
function toSegmentPlan(segments) {
  return (segments || []).map(s => {
    let minutes = toMin(s.end) - toMin(s.start);
    if (minutes <= 0) minutes += 1440;
    return { minutes, modes: s.modes || {} };
  });
}

export default function AiEventComposer({ onFill }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function submit() {
    const t = text.trim();
    if (t.length < 3 || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await parseEventText(t);
      const d = r.draft;
      onFill({
        name: d.name, date: d.date, startTime: d.startTime,
        durationMin: String(d.durationMin), courts: String(d.courts),
        gameLenMin: d.gameLenMin, memberIds: d.memberIds, segmentPlan: toSegmentPlan(d.segments),
      });
      setResult(r);
    } catch (e) {
      setError(e.status === 401 ? 'Sign in again to describe an event.' : e.message);
    } finally {
      setBusy(false);
    }
  }

  const filled = result ? result.filled.map(f => (f === 'players' ? `players (${result.draft.memberIds.length})` : FIELD_LABELS[f] || f)) : [];

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>Describe your event</Text>
        <Hint>Type it, or tap the mic on your keyboard and say it. You can check everything before it's created.</Hint>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="e.g. Next Tuesday 6 to 10pm, 4 courts, 15-minute games, mixed for the first hour, add Priya and Sam"
        placeholderTextColor={colors.slate}
        multiline
        maxLength={MAX_LEN}
        style={styles.input}
        editable={!busy}
        accessibilityLabel="Describe your event"
      />
      <View style={styles.row}>
        {busy ? (
          <View style={styles.busy}><ActivityIndicator color={colors.court} /><Text style={styles.busyText}>Reading your description…</Text></View>
        ) : (
          <Btn title="Fill in form" icon="sparkles" small onPress={submit} disabled={text.trim().length < 3} />
        )}
        {text.length > MAX_LEN - 80 ? <Text style={styles.count}>{text.length}/{MAX_LEN}</Text> : null}
      </View>
      {error ? <Banner>{error}</Banner> : null}
      {result ? (
        <Banner kind="info">
          Filled in {filled.join(', ')}. Check the details below, then tap Create event.
          {result.aiUsed ? '' : ' (Only dates, times and numbers were read this time — fill in anything else yourself.)'}
        </Banner>
      ) : null}
      {result && result.unmatchedNames.length ? (
        <Banner>
          Couldn't find {result.unmatchedNames.length === 1 ? 'a player' : 'players'} named {result.unmatchedNames.join(', ')}. You can add them on the event's Setup page after creating it.
        </Banner>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 15, color: colors.ink },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, minHeight: 76,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8, paddingHorizontal: 10,
    fontSize: 14, backgroundColor: colors.white, color: colors.ink, textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  busyText: { color: colors.slate, fontSize: 13 },
  count: { color: colors.slate, fontSize: 12 },
});
