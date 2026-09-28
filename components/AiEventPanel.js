import React from 'react';
import { View, Text, Modal, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { editEventText } from '../lib/api';
import { useStore, aiMessage, appendAiMessages, applyAiEdit } from '../lib/store';
import { useAuth } from '../lib/auth';
import AiChat from './AiChat';
import { colors } from '../lib/theme';

/* The event's assistant, opened from the event screen's top bar on any
   step. It continues the event's conversation (the description that
   created it, if any): each change asked for is a message, applied
   straight away through the normal setup editing — so the event's Cancel
   undoes it and Save keeps it, just like editing Setup by hand. Hosts
   only; the state endpoint enforces the same rule. */
export default function AiEventPanel({ eventId, visible, onClose }) {
  const insets = useSafeAreaInsets();
  const { player: me } = useAuth();
  const ev = useStore(s => s.events.find(e => e.id === eventId));
  if (!ev) return null;

  async function send(text) {
    appendAiMessages(ev, [aiMessage('user', text)]);
    try {
      const r = await editEventText(text, ev);
      applyAiEdit(ev, r.changes);
      const replies = [aiMessage('assistant', `${r.summary}. Tap Save to keep ${Object.keys(r.changes).length > 1 ? 'these changes' : 'this change'}, or Cancel to undo.`)];
      if (r.unmatchedNames && r.unmatchedNames.length) {
        replies.push(aiMessage('assistant', `Couldn't find ${r.unmatchedNames.join(', ')} in the players list, so that part wasn't changed.`, { tone: 'warn' }));
      }
      appendAiMessages(ev, replies);
    } catch (e) {
      // "Nothing to change" and "not a change" are answers worth keeping;
      // sign-in, limits and network trouble are shown but not kept.
      if (e.status === 422) { appendAiMessages(ev, [aiMessage('assistant', e.message, { tone: 'warn' })]); return; }
      throw new Error(e.status === 401 ? 'Sign in again to use the assistant.' : e.message);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropTap} onPress={onClose} accessibilityLabel="Close the assistant" />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.sheetWrap}>
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.header}>
              <Ionicons name="sparkles" size={18} color={colors.court} />
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>Assistant</Text>
                <Text style={styles.subtitle} numberOfLines={1}>{ev.name}</Text>
              </View>
              <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={24} color={colors.slate} />
              </Pressable>
            </View>
            <AiChat
              scrollable
              messages={ev.aiMessages || []}
              onSend={send}
              signedIn={!!me}
              busyLabel="Making the change…"
              placeholder="e.g. Move it to 7pm, add a court, mixed for the last hour, add Sam"
              emptyHint="Tell me what to change — the time or date, courts, game length, the play format, or who's playing. You can check the result on any step, then tap Save."
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(26, 15, 46, 0.45)', justifyContent: 'flex-end' },
  backdropTap: { flex: 1 },
  sheetWrap: { maxHeight: '88%', minHeight: '60%' },
  sheet: {
    flex: 1, backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 16, paddingTop: 14,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  title: { fontWeight: '700', fontSize: 16, color: colors.ink },
  subtitle: { fontSize: 12, color: colors.slate },
});
