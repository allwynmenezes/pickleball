import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Hint } from '../lib/ui';
import { parseEventText, editEventText } from '../lib/api';
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

/* The form as an event, for the edit endpoint. */
function draftToEvent(draft) {
  const num = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : d; };
  const ev = {
    name: draft.name || '', date: draft.date, startTime: draft.startTime,
    durationMin: num(draft.durationMin, 240), courts: num(draft.courts, 4), gameLenMin: num(draft.gameLenMin, 15),
    memberIds: draft.memberIds || [],
  };
  // Segments back to clock times, laid from the form's start time.
  const [h, m] = ev.startTime.split(':').map(Number);
  const clock = off => { const t = (h * 60 + m + off) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
  let cursor = 0;
  ev.segments = (draft.segmentPlan && draft.segmentPlan.length ? draft.segmentPlan : [{ minutes: ev.durationMin, modes: {} }])
    .map((s, i, all) => {
      const len = i === all.length - 1 ? ev.durationMin - cursor : Math.min(s.minutes, ev.durationMin - cursor);
      const seg = { start: clock(cursor), end: clock(cursor + len), modes: s.modes || {} };
      cursor += len;
      return seg;
    })
    .filter(s => s.start !== s.end);
  return ev;
}

/* An edit's changes as form fields. */
function changesToForm(changes, draft) {
  const f = {};
  ['name', 'date', 'startTime'].forEach(k => { if (changes[k] !== undefined) f[k] = changes[k]; });
  ['durationMin', 'courts', 'gameLenMin'].forEach(k => { if (changes[k] !== undefined) f[k] = String(changes[k]); });
  if (changes.segments) f.segmentPlan = toSegmentPlan(changes.segments);
  if (changes.addIds || changes.removeIds) {
    const ids = (draft.memberIds || []).filter(id => !(changes.removeIds || []).includes(id));
    (changes.addIds || []).forEach(id => { if (!ids.includes(id)) ids.push(id); });
    f.memberIds = ids;
  }
  return f;
}

/* The first message describes the event. After that — or when the first
   message isn't a description at all, like "set the game length to 20"
   — each message changes what's in the form, the same way the assistant
   changes an existing event. */
export default function AiEventComposer({ messages = [], onMessages, onFill, draft }) {
  const { player: me } = useAuth();
  const described = messages.some(m => m.role === 'assistant' && m.filled);

  const unmatchedNote = names => aiMessage('assistant', `Couldn't find ${names.length === 1 ? 'a player' : 'players'} named ${names.join(', ')}. You can add them on the event's Setup page after creating it.`, { tone: 'warn' });

  async function describe(text) {
    const r = await parseEventText(text);
    const d = r.draft;
    onFill({
      name: d.name, date: d.date, startTime: d.startTime,
      durationMin: String(d.durationMin), courts: String(d.courts),
      gameLenMin: String(d.gameLenMin), memberIds: d.memberIds, segmentPlan: toSegmentPlan(d.segments),
    });
    const replies = [aiMessage('assistant', describeResult(r), { filled: true })];
    if (r.unmatchedNames.length) replies.push(unmatchedNote(r.unmatchedNames));
    onMessages(replies);
  }

  async function change(text) {
    const r = await editEventText(text, draftToEvent(draft));
    onFill(changesToForm(r.changes, draft));
    const replies = [aiMessage('assistant', `${r.summary}. Check the details below, then tap Create event.`, { filled: true })];
    if (r.unmatchedNames && r.unmatchedNames.length) replies.push(unmatchedNote(r.unmatchedNames));
    onMessages(replies);
  }

  async function send(text) {
    onMessages([aiMessage('user', text)]);
    try {
      if (described) { await change(text); return; }
      try {
        await describe(text);
      } catch (e) {
        if (e.status !== 422) throw e;
        // Not a description — maybe a change to the form. If that fails
        // too, the description's answer is the one to show.
        try { await change(text); } catch (e2) { throw e2.status === 422 ? e : e2; }
      }
    } catch (e) {
      // "Not an event" / "nothing to change" are answers worth keeping in
      // the conversation; sign-in, limits and network trouble are shown
      // but not kept.
      if (e.status === 422) { onMessages([aiMessage('assistant', e.message, { tone: 'warn' })]); return; }
      throw new Error(e.status === 401 ? 'Sign in again to describe an event.' : e.message);
    }
  }

  return (
    <Card style={{ gap: 6 }}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>Describe your event</Text>
        <Hint>Type it, or tap the mic and say it — then ask for changes the same way. You can check everything before it's created.</Hint>
      </View>
      <AiChat
        messages={messages}
        onSend={send}
        signedIn={!!me}
        busyLabel="Reading your description…"
        listHeight={260}
        placeholder="e.g. Next Tuesday 6 to 10pm, 8 players, 15-minute games, mixed for the first hour, add Priya and Sam"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontWeight: '600', fontSize: 15, color: colors.ink },
});
