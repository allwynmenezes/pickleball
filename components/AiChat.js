import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator, Pressable, StyleSheet, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Btn, Banner } from '../lib/ui';
import { useVoiceNote } from '../lib/useVoiceNote';
import { colors, radius } from '../lib/theme';

/* The assistant as a chat: each thing the user asks is its own message,
   with the assistant's reply under it. Used on the New event screen (the
   description that creates the event) and in an event's assistant panel
   (each change as a message). The caller owns the messages — this only
   shows them and hands new text to onSend, which adds the user's message
   and the reply.

   messages: [{ id, role: 'user' | 'assistant', text, ts, tone?: 'warn' }]
   onSend(text): Promise — throw an Error to show a message that isn't
     kept (network trouble, limits); the typed text is put back.
   scrollable: the list scrolls on its own (in a panel) rather than being
     part of the page. */
const MAX_LEN = 500;
const fmtSecs = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtTime = ts => new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function AiChat({ messages = [], onSend, placeholder, emptyHint, signedIn = true, scrollable = false, busyLabel = 'Working on it…' }) {
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  async function send(value = input) {
    const text = value.trim();
    if (!text || pending) return;
    if (!signedIn) { setError('Sign in to use the assistant.'); return; }
    setError(null);
    setInput('');
    setPending(true);
    try {
      await onSend(text);
    } catch (e) {
      setError(e.message || 'Something went wrong. Try again.');
      setInput(text);
    } finally {
      setPending(false);
    }
  }

  const voice = useVoiceNote({ onText: t => send(t), canRecord: signedIn });
  const shownError = error || voice.error;

  useEffect(() => {
    if (scrollable && scrollRef.current) setTimeout(() => scrollRef.current && scrollRef.current.scrollToEnd({ animated: true }), 50);
  }, [messages.length, pending, scrollable]);

  const list = (
    <View style={styles.list}>
      {messages.length === 0 && emptyHint ? <Text style={styles.empty}>{emptyHint}</Text> : null}
      {messages.map(m => (
        <View key={m.id} style={[styles.bubbleRow, m.role === 'user' ? styles.rowUser : styles.rowAi]}>
          {m.role !== 'user' ? <Ionicons name="sparkles" size={14} color={colors.court} style={styles.aiIcon} /> : null}
          <View style={[styles.bubble, m.role === 'user' ? styles.userBubble : m.tone === 'warn' ? styles.warnBubble : styles.aiBubble]}>
            <Text style={m.role === 'user' ? styles.userText : styles.aiText}>{m.text}</Text>
            <Text style={[styles.time, m.role === 'user' && styles.timeUser]}>{fmtTime(m.ts)}</Text>
          </View>
        </View>
      ))}
      {pending || voice.transcribing ? (
        <View style={[styles.bubbleRow, styles.rowAi]}>
          <Ionicons name="sparkles" size={14} color={colors.court} style={styles.aiIcon} />
          <View style={[styles.bubble, styles.aiBubble, styles.typing]}>
            <ActivityIndicator size="small" color={colors.court} />
            <Text style={styles.aiText}>{voice.transcribing ? 'Turning your voice into text…' : busyLabel}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={scrollable ? styles.fill : null}>
      {scrollable ? (
        <ScrollView ref={scrollRef} style={styles.fill} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">{list}</ScrollView>
      ) : list}

      {shownError ? <View style={styles.errorWrap}><Banner>{shownError}</Banner></View> : null}
      {voice.needsSettings ? (
        <Btn title="Open settings" icon="settings-outline" variant="ghost" small onPress={() => Linking.openSettings()} style={{ alignSelf: 'flex-start', marginTop: 6 }} />
      ) : null}

      {voice.recording ? (
        <View style={styles.inputRow}>
          <Btn title={`Stop  ${fmtSecs(voice.elapsed)}`} icon="stop" variant="clay" small onPress={() => voice.stop()} />
          <Text style={styles.listening}>Listening… tap Stop when you're done.</Text>
        </View>
      ) : (
        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={(t) => { setInput(t); if (error) setError(null); if (voice.error) voice.clearError(); }}
            placeholder={placeholder}
            placeholderTextColor={colors.slate}
            multiline
            maxLength={MAX_LEN}
            style={styles.input}
            editable={!pending && !voice.transcribing}
            accessibilityLabel="Message the assistant"
          />
          <Pressable
            onPress={voice.start}
            disabled={pending || voice.transcribing}
            style={({ pressed }) => [styles.roundBtn, styles.micBtn, pressed && styles.micPressed, (pending || voice.transcribing) && styles.disabled]}
            accessibilityRole="button" accessibilityLabel="Speak"
          >
            <Ionicons name="mic" size={20} color={colors.court} />
          </Pressable>
          <Pressable
            onPress={() => send()}
            disabled={!input.trim() || pending}
            style={({ pressed }) => [styles.roundBtn, styles.sendBtn, pressed && styles.sendPressed, (!input.trim() || pending) && styles.disabled]}
            accessibilityRole="button" accessibilityLabel="Send"
          >
            <Ionicons name="arrow-up" size={20} color={colors.courtTint} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { paddingVertical: 8 },
  list: { gap: 10 },
  empty: { color: colors.slate, fontSize: 13, lineHeight: 19 },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, maxWidth: '100%' },
  rowUser: { justifyContent: 'flex-end', paddingLeft: 36 },
  rowAi: { justifyContent: 'flex-start', paddingRight: 36 },
  aiIcon: { marginBottom: 8 },
  bubble: { borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12, flexShrink: 1 },
  userBubble: { backgroundColor: colors.court, borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: colors.courtTint, borderBottomLeftRadius: 4 },
  warnBubble: { backgroundColor: colors.clayTint, borderBottomLeftRadius: 4 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userText: { color: colors.white, fontSize: 14, lineHeight: 20 },
  aiText: { color: colors.ink, fontSize: 14, lineHeight: 20 },
  time: { fontSize: 10.5, color: colors.slate, marginTop: 3 },
  timeUser: { color: colors.courtTint, opacity: 0.8, textAlign: 'right' },
  errorWrap: { marginTop: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 },
  input: {
    flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, minHeight: 44, maxHeight: 120,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8, paddingHorizontal: 10,
    fontSize: 14, backgroundColor: colors.white, color: colors.ink, textAlignVertical: 'top',
  },
  roundBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  micBtn: { borderWidth: 1.5, borderColor: colors.court, backgroundColor: colors.white },
  micPressed: { backgroundColor: colors.courtTint },
  sendBtn: { backgroundColor: colors.court },
  sendPressed: { backgroundColor: colors.courtDeep },
  disabled: { opacity: 0.4 },
  listening: { color: colors.slate, fontSize: 13, flex: 1 },
});
