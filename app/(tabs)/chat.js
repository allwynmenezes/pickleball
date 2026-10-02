import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, SectionTitle, Card, Btn, Row, EmptyState, Hint, GenderDot, Pill, TextField, IconBtn } from '../../lib/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  useStore, startChat, sendChatMessage, playerName, playerGender,
  renameChat, ensureEventChat, eventChatId, eventChatMembers, eventChatDefaultName,
} from '../../lib/store';
import { useAuth } from '../../lib/auth';
import { useSocial } from '../../lib/social';
import FriendButton from '../../components/FriendButton';
import { pushOnce } from '../../lib/nav';
import { showAlert } from '../../lib/confirm';
import { colors, radius } from '../../lib/theme';

export default function ChatScreen() {
  const router = useRouter();
  const players = useStore(s => s.players);
  const allChats = useStore(s => s.chats);
  const events = useStore(s => s.events);
  // You always chat as the logged-in account, and only see your own chats —
  // plus the group chat of every event you're in that has one turned on
  // (made the first time someone opens it).
  const { player: me } = useAuth();
  const asIdLive = me ? me.id : null;
  const eventById = id => events.find(e => e.id === id);
  const chats = [
    ...allChats.filter(c => !c.eventId && c.participantIds.includes(asIdLive)),
    ...events.filter(ev => ev.groupChat && asIdLive && eventChatMembers(ev).includes(asIdLive)).map(ev => (
      allChats.find(c => c.id === eventChatId(ev))
      || { id: eventChatId(ev), type: 'group', eventId: ev.id, name: '', participantIds: eventChatMembers(ev), messages: [] }
    )),
  ];
  const titleOf = (c) => {
    if (c.eventId) { const ev = eventById(c.eventId); return c.name || (ev ? eventChatDefaultName(ev) : 'Event chat'); }
    const others = c.participantIds.filter(id => id !== asIdLive).map(playerName);
    return c.type === 'group' ? (c.name || others.join(', ')) : (others[0] || 'Chat');
  };
  const openChat = (c) => {
    if (c.eventId) { const ev = eventById(c.eventId); if (ev) ensureEventChat(ev); }
    setActiveChatId(c.id);
  };
  const [renaming, setRenaming] = useState(null); // the new group name being typed, or null
  const [activeChatId, setActiveChatIdRaw] = useState(null);
  const setActiveChatId = (id) => { setRenaming(null); setActiveChatIdRaw(id); };
  const [composerType, setComposerType] = useState(null); // 'dm' | 'group' | null
  const [picked, setPicked] = useState([]);
  const [groupName, setGroupName] = useState('');
  const [draft, setDraft] = useState('');
  // 1:1 chats are only with friends (the server enforces it for new ones).
  const { friendIds } = useSocial();
  // "Message" on a friend's profile opens /chat?with=<their id>.
  const { with: withId } = useLocalSearchParams();
  useEffect(() => {
    if (!withId || !asIdLive || !friendIds.has(withId)) return;
    const { chatId } = startChat(asIdLive, 'dm', [withId], '');
    if (chatId) { setActiveChatId(chatId); setComposerType(null); }
    router.setParams({ with: '' });
  }, [withId, asIdLive, friendIds]);

  if (!me) {
    return (
      <Screen>
        <EmptyState icon="chatbubble-ellipses">
          <Text style={styles.emptyText}>Log in to chat with your group.</Text>
          <Btn title="Log in" small onPress={() => pushOnce(router, '/login')} style={{ marginTop: 12, alignSelf: 'center' }} />
        </EmptyState>
      </Screen>
    );
  }

  const activeChat = chats.find(c => c.id === activeChatId);
  if (activeChat) {
    const title = titleOf(activeChat);
    const dmWith = activeChat.type === 'dm' ? players.find(p => activeChat.participantIds.includes(p.id) && p.id !== asIdLive) : null;
    const chatEvent = activeChat.eventId ? eventById(activeChat.eventId) : null;
    function saveName() { renameChat(activeChat.id, renaming); setRenaming(null); }
    return (
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Screen contentStyle={{ flexGrow: 1 }}>
          <Row style={{ borderBottomWidth: 0, paddingBottom: chatEvent ? 2 : 12 }}>
            <Pressable onPress={() => setActiveChatId(null)} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back to conversations">
              <Ionicons name="chevron-back" size={18} color={colors.slate} />
            </Pressable>
            {renaming !== null ? (
              <>
                <TextInput
                  value={renaming} onChangeText={setRenaming} placeholder="Group name" style={styles.composerInput}
                  autoFocus onSubmitEditing={saveName} returnKeyType="done"
                />
                <Btn title="Save" small onPress={saveName} />
                <Btn title="Cancel" variant="ghost" small onPress={() => setRenaming(null)} />
              </>
            ) : (
              <>
                <Text style={[styles.threadTitle, { flex: 1 }]} numberOfLines={2}>{title}</Text>
                {activeChat.type === 'group' ? <IconBtn icon="create-outline" label="Rename this group" onPress={() => setRenaming(title)} /> : null}
              </>
            )}
          </Row>
          {chatEvent ? <Hint style={{ marginTop: 0, marginBottom: 10 }}>Everyone in {chatEvent.name}.</Hint> : null}
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
          {dmWith && !friendIds.has(dmWith.id) ? (
            <View style={styles.notFriend}>
              <Hint style={{ marginTop: 0, flex: 1 }}>You can only message friends one-on-one. Add {dmWith.name} as a friend to reply.</Hint>
              <FriendButton player={dmWith} />
            </View>
          ) : (
            <View style={styles.composerRow}>
              <TextInput
                value={draft} onChangeText={setDraft} placeholder="Message…" style={styles.composerInput}
                onSubmitEditing={() => { sendChatMessage(asIdLive, activeChat.id, draft); setDraft(''); }}
              />
              <Btn title="Send" small onPress={() => { sendChatMessage(asIdLive, activeChat.id, draft); setDraft(''); }} />
            </View>
          )}
        </Screen>
      </KeyboardAvoidingView>
    );
  }

  function submitNewChat() {
    if (picked.length === 0) { showAlert('Pick at least one other person to chat with.'); return; }
    const { chatId, error } = startChat(asIdLive, composerType, picked, groupName);
    if (error) { showAlert(error); return; }
    setActiveChatId(chatId);
    setComposerType(null); setPicked([]); setGroupName('');
  }

  // You start 1:1 and group chats with friends only (an event's own group
  // chat is the one way to chat with players who aren't your friends).
  const others = players.filter(p => p.claimed && p.id !== asIdLive && friendIds.has(p.id));

  return (
    <Screen>
      <SectionTitle first>Conversations</SectionTitle>
      <Hint style={{ marginTop: -6, marginBottom: 10 }}>Chatting as {me.name}.</Hint>
      {chats.length === 0 ? (
        <Card><EmptyState icon="chatbubble-ellipses">No conversations yet — start one below.</EmptyState></Card>
      ) : (
        <Card>
          {chats.map(c => {
            const label = titleOf(c);
            const last = c.messages[c.messages.length - 1];
            const otherId = c.participantIds.find(id => id !== asIdLive);
            return (
              <Row key={c.id} onPress={() => openChat(c)}>
                {c.type === 'group' ? <Ionicons name={c.eventId ? 'calendar' : 'people'} size={18} color={colors.slate} /> : null}
                <View style={styles.convLabelRow}>
                  <Text style={styles.convLabel} numberOfLines={1}>{label}</Text>
                  {c.type === 'group' ? null : <GenderDot gender={playerGender(otherId)} />}
                </View>
                <Text style={styles.convLast} numberOfLines={1}>{last ? last.text : 'No messages yet'}</Text>
              </Row>
            );
          })}
        </Card>
      )}

      <View style={styles.actionRow}>
        <Btn title="New 1:1 chat" icon="person" variant="outline" small onPress={() => { setComposerType('dm'); setPicked([]); }} />
        <Btn title="New group chat" icon="people" variant="outline" small onPress={() => { setComposerType('group'); setPicked([]); setGroupName(''); }} />
      </View>

      {composerType ? (
        <View>
          <SectionTitle>{composerType === 'group' ? 'New group chat' : 'New 1:1 chat'}</SectionTitle>
          <Card>
            {composerType === 'group' ? (
              <TextField value={groupName} onChangeText={setGroupName} placeholder="Group name (optional)" />
            ) : null}
            <Text style={[styles.hintLabel, { marginTop: composerType === 'group' ? 10 : 0 }]}>With</Text>
            <View style={styles.pillRow}>
              {others.length === 0 ? (
                <Text style={styles.emptyText}>You can start chats with your friends. Send friend requests from the Players tab.</Text>
              ) : others.map(p => {
                const isPicked = picked.includes(p.id);
                return (
                  <Pill
                    key={p.id}
                    label={p.name}
                    active={isPicked}
                    onPress={() => setPicked(isPicked ? picked.filter(id => id !== p.id) : [...picked, p.id])}
                  />
                );
              })}
            </View>
            <View style={[styles.actionRow, { marginTop: 12 }]}>
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
  emptyText: { color: colors.slate, fontSize: 13, textAlign: 'center' },
  convLabelRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  convLabel: { fontWeight: '600', fontSize: 14, flexShrink: 1, color: colors.ink },
  convLast: { fontSize: 12, color: colors.slate, maxWidth: 130 },
  pillRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4, justifyContent: 'flex-end' },
  hintLabel: { fontSize: 11.5, color: colors.slate, fontWeight: '600', textTransform: 'uppercase', marginBottom: 6 },
  backBtn: { width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  threadTitle: { fontWeight: '600', fontSize: 15, color: colors.ink },
  bubble: { padding: 10, borderRadius: 14, marginBottom: 8, maxWidth: '80%' },
  bubbleMine: { backgroundColor: colors.court, alignSelf: 'flex-end' },
  bubbleTheirs: { backgroundColor: colors.courtTint, alignSelf: 'flex-start' },
  bubbleSender: { fontSize: 10, fontWeight: '700', opacity: 0.7, marginBottom: 2, color: colors.ink },
  bubbleTextMine: { color: colors.white, fontSize: 13.5 },
  bubbleTextTheirs: { color: colors.ink, fontSize: 13.5 },
  composerRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  notFriend: { flexDirection: 'row', gap: 10, marginTop: 10, alignItems: 'center' },
  composerInput: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: colors.white },
});
