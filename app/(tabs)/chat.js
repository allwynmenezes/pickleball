import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { Screen, SectionTitle, Card, Btn, Row, EmptyState, Hint, GenderDot } from '../../lib/ui';
import {
  useStore, getState, getChatAsId, setChatAsId, startChat, sendChatMessage, playerName, playerGender,
} from '../../lib/store';
import { showAlert } from '../../lib/confirm';
import { colors, radius } from '../../lib/theme';

export default function ChatScreen() {
  const players = useStore(s => s.players);
  const chats = useStore(s => s.chats);
  const asIdLive = useStore(() => getChatAsId());
  const [activeChatId, setActiveChatId] = useState(null);
  const [composerType, setComposerType] = useState(null); // 'dm' | 'group' | null
  const [picked, setPicked] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [draft, setDraft] = useState('');

  if (players.length === 0) {
    return (
      <Screen>
        <EmptyState icon="people">Add players first, from the Players tab, before starting a chat.</EmptyState>
      </Screen>
    );
  }

  const activeChat = chats.find(c => c.id === activeChatId);
  if (activeChat) {
    const others = activeChat.participantIds.filter(id => id !== asIdLive).map(playerName);
    const title = activeChat.type === 'group' ? (activeChat.name || others.join(', ')) : (others[0] || 'Chat');
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen contentStyle={{ flexGrow: 1 }}>
          <Row style={{ borderBottomWidth: 0, paddingBottom: 12 }}>
            <Pressable onPress={() => setActiveChatId(null)} style={styles.backBtn}>
              <Ionicons name="chevron-back" size={18} color={colors.slate} />
            </Pressable>
            <Text style={styles.threadTitle}>{title}</Text>
          </Row>
          <Card style={{ minHeight: 220 }}>
            {activeChat.messages.length === 0 ? (
              <EmptyState icon="chatbubble-ellipses">No messages yet — say hello.</EmptyState>
            ) : activeChat.messages.map(m => {
              const mine = m.senderId === asIdLive;
              return (
                <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {!mine ? <Text style={styles.bubbleSender}>{playerName(m.senderId)}</Text> : null}
                  <Text style={mine ? styles.bubbleTextMine : styles.bubbleTextTheirs}>{m.text}</Text>
                </View>
              );
            })}
          </Card>
          <View style={styles.composerRow}>
            <TextInput
              value={draft} onChangeText={setDraft} placeholder="Message…" style={styles.composerInput}
              onSubmitEditing={() => { sendChatMessage(activeChat.id, draft); setDraft(''); }}
            />
            <Btn title="Send" small onPress={() => { sendChatMessage(activeChat.id, draft); setDraft(''); }} />
          </View>
        </Screen>
      </KeyboardAvoidingView>
    );
  }

  function submitNewChat() {
    const others = players.filter(p => p.id !== asIdLive);
    if (picked.length === 0) { showAlert('Pick at least one other person to chat with.'); return; }
    const { chatId, error } = startChat(composerType, picked, groupName);
    if (error) { showAlert(error); return; }
    setActiveChatId(chatId);
    setComposerType(null); setPicked([]); setGroupName('');
  }

  const others = players.filter(p => p.id !== asIdLive);

  return (
    <Screen>
      <SectionTitle first>Chatting as</SectionTitle>
      <Card>
        <View style={styles.pickerWrap}>
          <Picker selectedValue={asIdLive} onValueChange={setChatAsId}>
            {players.map(p => <Picker.Item key={p.id} label={p.name} value={p.id} />)}
          </Picker>
        </View>
        <Hint>Pick who you are on this device — there are no logins, so this choice is just for this visit.</Hint>
      </Card>

      <SectionTitle>Conversations</SectionTitle>
      {chats.length === 0 ? (
        <Card><EmptyState icon="chatbubble-ellipses">No conversations yet — start one below.</EmptyState></Card>
      ) : (
        <Card>
          {chats.map(c => {
            const chatOthers = c.participantIds.filter(id => id !== asIdLive).map(playerName);
            const label = c.type === 'group' ? (c.name || chatOthers.join(', ')) : (chatOthers[0] || '—');
            const last = c.messages[c.messages.length - 1];
            const otherId = c.participantIds.find(id => id !== asIdLive);
            return (
              <Row key={c.id} onPress={() => setActiveChatId(c.id)}>
                {c.type === 'group' ? <Ionicons name="people" size={18} color={colors.slate} /> : <GenderDot gender={playerGender(otherId)} />}
                <Text style={styles.convLabel} numberOfLines={1}>{label}</Text>
                <Text style={styles.convLast} numberOfLines={1}>{last ? last.text : 'No messages yet'}</Text>
              </Row>
            );
          })}
        </Card>
      )}

      <View style={styles.pillRow}>
        <Btn title="New 1:1 chat" icon="person" variant="outline" small onPress={() => { setComposerType('dm'); setPicked([]); }} />
        <Btn title="New group chat" icon="people" variant="outline" small onPress={() => { setComposerType('group'); setPicked([]); setGroupName(''); }} />
      </View>

      {composerType ? (
        <View>
          <SectionTitle>{composerType === 'group' ? 'New group chat' : 'New 1:1 chat'}</SectionTitle>
          <Card>
            {composerType === 'group' ? (
              <TextInput value={groupName} onChangeText={setGroupName} placeholder="Group name (optional)" style={styles.input} />
            ) : null}
            <Text style={[styles.hintLabel, { marginTop: composerType === 'group' ? 10 : 0 }]}>With</Text>
            <View style={styles.pillRow}>
              {others.length === 0 ? <Text style={styles.hintLabel}>No other players yet.</Text> : others.map(p => {
                const isPicked = picked.includes(p.id);
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => setPicked(isPicked ? picked.filter(id => id !== p.id) : [...picked, p.id])}
                    style={[styles.toggle, isPicked && { backgroundColor: colors.court, borderColor: colors.court }]}
                  >
                    <Text style={[styles.toggleText, isPicked && { color: '#fff' }]}>{p.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[styles.pillRow, { marginTop: 12 }]}>
              <Btn title="Start chat" onPress={submitNewChat} />
              <Btn title="Cancel" variant="ghost" onPress={() => setComposerType(null)} />
            </View>
          </Card>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pickerWrap: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, marginBottom: 4, overflow: 'hidden' },
  convLabel: { fontWeight: '600', fontSize: 14, flex: 1, color: colors.ink },
  convLast: { fontSize: 12, color: colors.slate, maxWidth: 130 },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  toggle: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  toggleText: { fontSize: 12, fontWeight: '700', color: colors.slate },
  hintLabel: { fontSize: 11.5, color: colors.slate, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: '#fff' },
  backBtn: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  threadTitle: { fontWeight: '600', fontSize: 15, color: colors.ink },
  bubble: { padding: 10, borderRadius: 14, marginBottom: 8, maxWidth: '80%' },
  bubbleMine: { backgroundColor: colors.court, alignSelf: 'flex-end' },
  bubbleTheirs: { backgroundColor: colors.courtTint, alignSelf: 'flex-start' },
  bubbleSender: { fontSize: 10, fontWeight: '700', opacity: 0.7, marginBottom: 2, color: colors.ink },
  bubbleTextMine: { color: '#fff', fontSize: 13.5 },
  bubbleTextTheirs: { color: colors.ink, fontSize: 13.5 },
  composerRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  composerInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: '#fff' },
});
