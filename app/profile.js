import React, { useState } from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { pushOnce } from '../lib/nav';
import { Screen, SectionTitle, Card, Btn, Hint, Row, GenderChip, DuprChip, TextField, Pill, Banner } from '../lib/ui';
import { useAuth, logout, updateMyDetails } from '../lib/auth';
import { useStore, editPlayer, setPlayerDupr } from '../lib/store';
import { useSocial, setSearchable } from '../lib/social';
import { showAlert } from '../lib/confirm';
import { colors } from '../lib/theme';

const GENDERS = [
  { key: 'M', label: 'Male' },
  { key: 'F', label: 'Female' },
  { key: 'O', label: 'Other' },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { player } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        <SectionTitle first>Profile</SectionTitle>
        {player ? (
          <>
            <MyDetails account={player} />
            <Card><SearchVisibility /></Card>
            <SectionTitle>Account</SectionTitle>
            <Card>
              <Row style={{ borderBottomWidth: 0, paddingVertical: 4 }}>
                <Text style={{ flex: 1, fontSize: 14, color: colors.slate }} numberOfLines={1}>{player.email}</Text>
                <Btn title="Log out" variant="ghost" small dangerText onPress={logout} />
              </Row>
            </Card>
          </>
        ) : (
          <Card>
            <Hint style={{ marginTop: 0 }}>Not logged in. If your host sent you an invite link, open that to claim your spot. New here? Sign up — or log in with the email you already used.</Hint>
            <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'flex-end' }}>
              <Btn title="Sign up" variant="outline" onPress={() => pushOnce(router, '/signup')} />
              <Btn title="Log in" onPress={() => pushOnce(router, '/login')} />
            </View>
          </Card>
        )}
        <Btn title="Close" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Screen>
    </View>
  );
}

/* Your name, gender and DUPR rating — what other players see on your profile. */
function MyDetails({ account }) {
  const p = useStore(s => s.players.find(x => x.id === account.id)) || account;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [gender, setGender] = useState('M');
  const [dupr, setDupr] = useState('');
  const [error, setError] = useState(null);

  function start() {
    setName(p.name || ''); setGender(p.gender || 'M'); setDupr(p.dupr != null ? String(p.dupr) : '');
    setError(null); setEditing(true);
  }
  function save() {
    if (!name.trim()) { setError('Your name can\'t be empty.'); return; }
    const r = setPlayerDupr(p.id, dupr);
    if (r.error) { setError(r.error); return; }
    editPlayer(p.id, name, gender);
    updateMyDetails({ name: name.trim(), gender });
    setEditing(false);
  }

  if (!editing) {
    return (
      <Card style={{ gap: 8 }}>
        <View style={styles.headRow}>
          <Text style={styles.name} numberOfLines={1}>{p.name}</Text>
          <Btn title="Edit" icon="create" variant="ghost" small onPress={start} />
        </View>
        <View style={styles.facts}>
          <GenderChip gender={p.gender} />
          <DuprChip dupr={p.dupr} />
          {p.dupr == null ? <Text style={styles.muted}>No DUPR rating</Text> : null}
        </View>
      </Card>
    );
  }
  return (
    <Card style={{ gap: 10 }}>
      <TextField label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <Text style={styles.label}>Gender</Text>
      <View style={styles.facts}>
        {GENDERS.map(g => <Pill key={g.key} label={g.label} active={gender === g.key} onPress={() => setGender(g.key)} />)}
      </View>
      <TextField label="DUPR doubles rating" value={dupr} onChangeText={setDupr} keyboardType="decimal-pad" placeholder="e.g. 3.742 — leave empty to clear" />
      <Hint style={{ marginTop: 0 }}>Used to seed players in events that seed by rating. It isn't synced with DUPR — update it when your rating changes.</Hint>
      {error ? <Banner>{error}</Banner> : null}
      <View style={styles.actions}>
        <Btn title="Cancel" variant="ghost" small onPress={() => setEditing(false)} />
        <Btn title="Save" small onPress={save} />
      </View>
    </Card>
  );
}

/* Whether you're listed on everyone's Players tab. On unless you turn it off. */
function SearchVisibility() {
  const { loaded, searchable } = useSocial();
  async function toggle(v) {
    const error = await setSearchable(v);
    if (error) showAlert(error);
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>Visible in search</Text>
        <Text style={{ fontSize: 12, color: colors.slate, marginTop: 2 }}>
          List me on everyone's Players tab, so people can find me, see my profile and send me a friend request.
        </Text>
      </View>
      <Switch
        value={searchable} onValueChange={toggle} disabled={!loaded}
        trackColor={{ true: colors.court, false: colors.line }} thumbColor={colors.white}
        accessibilityLabel="Visible in search"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flexShrink: 1, fontSize: 18, fontWeight: '700', color: colors.ink },
  facts: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  muted: { fontSize: 12, color: colors.slate },
  label: { fontSize: 11.5, color: colors.slate, fontWeight: '600', textTransform: 'uppercase', marginBottom: -4 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
