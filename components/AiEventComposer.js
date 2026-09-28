import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ActivityIndicator, StyleSheet, Platform, Linking } from 'react-native';
import { Audio } from 'expo-av';
import { Card, Btn, Hint, Banner } from '../lib/ui';
import { parseEventText, transcribeAudio } from '../lib/api';
import { useAuth } from '../lib/auth';
import { colors, radius } from '../lib/theme';

/* "Describe your event": the user types a sentence or speaks it (the app's
   own mic button — it asks for microphone permission the first time), the
   backend turns it into a draft, and onFill hands the draft to the
   new-event form. Nothing is created here — the user still checks the
   form and taps Create. See backend-worker/src/ai.js. */

const MAX_LEN = 500;
const MAX_RECORDING_MS = 60000;
const FIELD_LABELS = {
  name: 'name', date: 'date', startTime: 'start time', durationMin: 'length', courts: 'courts',
  gameLenMin: 'game length', segments: 'play format', players: 'players',
};

/* Speech needs far less than expo-av's music-quality preset: mono, 16 kHz,
   32 kbps keeps a minute-long note around 240 KB to upload. */
const SPEECH_RECORDING = {
  isMeteringEnabled: false,
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.MEDIUM,
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 32000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 32000 },
};

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const fmtSecs = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

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
  const { player: me } = useAuth();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(null); // null | 'reading' | 'listening'
  const [error, setError] = useState(null);
  const [needsSettings, setNeedsSettings] = useState(false);
  const [result, setResult] = useState(null);
  const [recording, setRecording] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const recordingRef = useRef(null);
  recordingRef.current = recording;

  // Leaving the screen mid-recording releases the mic.
  useEffect(() => () => {
    if (recordingRef.current) recordingRef.current.stopAndUnloadAsync().catch(() => {});
  }, []);

  async function submit(value = text) {
    const t = value.trim();
    if (t.length < 3 || busy) return;
    setBusy('reading');
    setError(null);
    setResult(null);
    try {
      const r = await parseEventText(t);
      const d = r.draft;
      onFill({
        name: d.name, date: d.date, startTime: d.startTime,
        durationMin: String(d.durationMin), courts: String(d.courts),
        gameLenMin: String(d.gameLenMin), memberIds: d.memberIds, segmentPlan: toSegmentPlan(d.segments),
      });
      setResult(r);
    } catch (e) {
      setError(e.status === 401 ? 'Sign in again to describe an event.' : e.message);
    } finally {
      setBusy(null);
    }
  }

  async function startRecording() {
    setError(null);
    setNeedsSettings(false);
    setResult(null);
    // Say so before recording, not after the note has been made.
    if (!me) { setError('Sign in to describe an event.'); return; }
    try {
      let perm = await Audio.getPermissionsAsync();
      if (!perm.granted && perm.canAskAgain) perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        setNeedsSettings(Platform.OS !== 'web' && !perm.canAskAgain);
        setError(Platform.OS === 'web'
          ? 'Allow microphone access for this site in your browser, then tap Speak again.'
          : 'The Pickle Slot needs microphone access to hear your description. You can still type it.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      setElapsed(0);
      const { recording: rec } = await Audio.Recording.createAsync(SPEECH_RECORDING, (status) => {
        if (!status.isRecording) return;
        setElapsed(status.durationMillis);
        if (status.durationMillis >= MAX_RECORDING_MS) stopRecording(rec);
      }, 250);
      setRecording(rec);
    } catch (e) {
      setError("Couldn't start the microphone. Close other apps that might be using it and try again.");
    }
  }

  async function stopRecording(rec = recording) {
    if (!rec || recordingRef.current !== rec) return;
    setRecording(null);
    recordingRef.current = null;
    setBusy('listening');
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false }).catch(() => {});
      const { text: heard } = await transcribeAudio(rec.getURI());
      setText(heard);
      setBusy(null);
      await submit(heard);
    } catch (e) {
      setError(e.status === 401 ? 'Sign in again to describe an event.' : e.message);
      setBusy(null);
    }
  }

  const filled = result ? result.filled.map(f => (f === 'players' ? `players (${result.draft.memberIds.length})` : FIELD_LABELS[f] || f)) : [];

  return (
    <Card style={{ gap: 10 }}>
      <View style={{ gap: 2 }}>
        <Text style={styles.title}>Describe your event</Text>
        <Hint>Type it, or tap Speak and say it. You can check everything before it's created.</Hint>
      </View>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="e.g. Next Tuesday 6 to 10pm, 4 courts, 15-minute games, mixed for the first hour, add Priya and Sam"
        placeholderTextColor={colors.slate}
        multiline
        maxLength={MAX_LEN}
        style={styles.input}
        editable={!busy && !recording}
        accessibilityLabel="Describe your event"
      />
      <View style={styles.row}>
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.court} />
            <Text style={styles.busyText}>{busy === 'listening' ? 'Turning your voice into text…' : 'Reading your description…'}</Text>
          </View>
        ) : recording ? (
          <View style={styles.busy}>
            <Btn title={`Stop  ${fmtSecs(elapsed)}`} icon="stop" variant="clay" small onPress={() => stopRecording()} />
            <Text style={styles.busyText}>Listening… tap Stop when you're done.</Text>
          </View>
        ) : (
          <View style={styles.actions}>
            <Btn title="Speak" icon="mic" variant="outline" small onPress={startRecording} />
            <Btn title="Fill in form" icon="sparkles" small onPress={() => submit()} disabled={text.trim().length < 3} />
          </View>
        )}
        {text.length > MAX_LEN - 80 ? <Text style={styles.count}>{text.length}/{MAX_LEN}</Text> : null}
      </View>
      {error ? <Banner>{error}</Banner> : null}
      {needsSettings ? <Btn title="Open settings" icon="settings-outline" variant="ghost" small onPress={() => Linking.openSettings()} style={{ alignSelf: 'flex-start' }} /> : null}
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
  actions: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  busy: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32, flexShrink: 1 },
  busyText: { color: colors.slate, fontSize: 13, flexShrink: 1 },
  count: { color: colors.slate, fontSize: 12 },
});
