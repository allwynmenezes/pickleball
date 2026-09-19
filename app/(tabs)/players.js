import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, SectionTitle, Card, Btn, Row, GenderChip, Hint, EmptyState, Field } from '../../lib/ui';
import { showConfirm } from '../../lib/confirm';
import { useStore, addPlayer, editPlayer, deletePlayerEverywhere, affectedEventsForPlayer } from '../../lib/store';
import { colors, radius } from '../../lib/theme';

const GENDERS = [
  { key: 'M', label: 'Male' },
  { key: 'F', label: 'Female' },
  { key: 'O', label: 'Other' },
];

function GenderPicker({ value, onChange }) {
  return (
    <View style={styles.genderRow}>
      {GENDERS.map(g => (
        <Pressable
          key={g.key}
          onPress={() => onChange(g.key)}
          style={[styles.genderOpt, value === g.key && { backgroundColor: colors.court, borderColor: colors.court }]}
        >
          <Text style={[styles.genderOptText, value === g.key && { color: '#fff' }]}>{g.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function PlayersScreen() {
  const players = useStore(s => s.players);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState('M');
  const [newName, setNewName] = useState('');
  const [newGender, setNewGender] = useState('M');

  function startEdit(p) { setEditingId(p.id); setEditName(p.name); setEditGender(p.gender); }
  function saveEdit() { editPlayer(editingId, editName, editGender); setEditingId(null); }

  function onDelete(p) {
    const affected = affectedEventsForPlayer(p.id);
    const message = affected.length
      ? `Remove ${p.name} from your Players list? They're currently part of ${affected.length} event${affected.length === 1 ? '' : 's'}: ${affected.map(e => `"${e.name}" (${e.date})`).join(', ')}. Removing them here also removes them from those events' RSVPs, rosters, and booking claims (rounds already played or announced are kept as they happened). This cannot be undone.`
      : `Remove ${p.name} from your Players list? This cannot be undone.`;
    showConfirm(message, () => deletePlayerEverywhere(p.id));
  }

  function submitNew() {
    addPlayer(newName, newGender);
    setNewName('');
  }

  return (
    <Screen>
      <SectionTitle first>Players ({players.length})</SectionTitle>
      <Hint style={{ marginTop: -6, marginBottom: 10 }}>
        Standalone list, shared across every event. Editing someone's name or gender here updates them everywhere. Deleting someone here removes them everywhere they've been added — including their RSVPs, rosters, and booking claims in other events.
      </Hint>
      <Card>
        {players.length === 0 ? (
          <EmptyState icon="people">No players yet — add your group below.</EmptyState>
        ) : players.map(p => editingId === p.id ? (
          <View key={p.id} style={styles.editingRow}>
            <TextInput value={editName} onChangeText={setEditName} style={styles.editInput} autoFocus />
            <GenderPicker value={editGender} onChange={setEditGender} />
            <View style={styles.editActions}>
              <Pressable onPress={saveEdit} style={styles.smallIconBtn}><Ionicons name="checkmark-circle" size={18} color={colors.court} /></Pressable>
              <Pressable onPress={() => setEditingId(null)} style={styles.smallIconBtn}><Ionicons name="close" size={18} color={colors.slate} /></Pressable>
            </View>
          </View>
        ) : (
          <Row key={p.id}>
            <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
            <GenderChip gender={p.gender} />
            <Pressable onPress={() => startEdit(p)} style={styles.smallIconBtn}><Ionicons name="pencil" size={15} color={colors.slate} /></Pressable>
            <Pressable onPress={() => onDelete(p)} style={styles.smallIconBtn}><Ionicons name="trash" size={15} color={colors.clay} /></Pressable>
          </Row>
        ))}
      </Card>
      <Card>
        <Field label="Name">
          <TextInput value={newName} onChangeText={setNewName} placeholder="Player name" style={styles.input} onSubmitEditing={submitNew} />
        </Field>
        <View style={{ height: 10 }} />
        <Field label="Category"><GenderPicker value={newGender} onChange={setNewGender} /></Field>
        <View style={{ height: 12 }} />
        <Btn title="Add player" icon="add" onPress={submitNew} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontWeight: '600', fontSize: 14, flex: 1, color: colors.ink },
  editingRow: { backgroundColor: colors.ballTint, borderRadius: radius.sm, padding: 10, marginBottom: 4, gap: 8 },
  editInput: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 8, backgroundColor: '#fff', fontSize: 14 },
  editActions: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
  smallIconBtn: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  genderRow: { flexDirection: 'row', gap: 7 },
  genderOpt: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  genderOptText: { fontSize: 12, fontWeight: '700', color: colors.slate },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 9, fontSize: 14, backgroundColor: '#fff' },
});
