import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Hint } from '../lib/ui';
import { parseEventText } from '../lib/api';
import { aiMessage } from '../lib/store';
import { useAuth } from '../lib/auth';
import AiChat from './AiChat';
import { colors } from '../lib/theme';

/* "Describe your event" on the New event screen: the user types or speaks
   a description, the backend turns it into a draft, and onFill hands it
   to the form below. Nothing is created here — the user still checks the
   form and taps Create. The conversation (messages) belongs to the draft
   and is saved with the event, where later changes continue it. See
   backend-worker/src/ai.js. */

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

function describeResult(r) {
  const d = r.draft;
  const filled = r.filled.map(f => {
    if (f === 'players') return `players (${d.memberIds.length})`;
    if (f === 'courts' && r.courtsFrom) return `courts (${d.courts}, for ${r.courtsFrom} players)`;
    return FIELD_LABELS[f] || f;
  });
  let text = `Filled in ${filled.join(', ')}. Check the details below, then tap Create event.`;
  if (!r.aiUsed) text += ' (Only dates, times and numbers were read this time — fill in anything else yourself.)';
  return text;
}

export default function AiEventComposer({ messages = [], onMessages, onFill }) {
  const { player: me } = useAuth();

  async function send(text) {
    onMessages([aiMessage('user', text)]);
    try {
      const r = await parseEventText(text);
      const d = r.draft;
      onFill({
        name: d.name, date: d.date, startTime: d.startTime,
        durationMin: String(d.durationMin), courts: String(d.courts),
        gameLenMin: String(d.gameLenMin), memberIds: d.memberIds, segmentPlan: toSegmentPlan(d.segments),
      });
      const replies = [aiMessage('assistant', describeResult(r))];
      if (r.unmatchedNames.length) {
        replies.push(aiMessage('assistant', `Couldn't find ${r.unmatchedNames.length === 1 ? 'a player' : 'players'} named ${r.unmatchedNames.join(', ')}. You can add them on the event's Setup page after creating it.`, { tone: 'warn' }));
      }
      onMessages(replies);
    } catch (e) {
      // "Not an event" is an answer worth keeping in the conversation;
      // sign-in, limits and network trouble are shown but not kept.
      if (e.status === 422) { onMessages([aiMessage('assistant', e.message, { tone: 'warn' })]); return; }
      throw new Error(e.status === 401 ? 'Sign in again to describe an event.' : e.message);
    }
  }

  return (
    <Card style={{ gap: 6 }}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>Describe your event</Text>
        <Hint>Type it, or tap the mic and say it. You can check everything before it's created.</Hint>
      </View>
      <AiChat
        messages={messages}
        onSend={send}
        signedIn={!!me}
        busyLabel="Reading your description…"
        placeholder="e.g. Next Tuesday 6 to 10pm, 8 players, 15-minute games, mixed for the first hour, add Priya and Sam"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 15, color: colors.ink },
});
