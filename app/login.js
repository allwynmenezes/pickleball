import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Btn, TextField, Banner, Hint, LinkText } from '../lib/ui';
import { login } from '../lib/auth';
import { colors } from '../lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    setBusy(true); setError('');
    try {
      await login(email.trim(), password);
      router.back();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        <SectionTitle first>Log in</SectionTitle>
        <Card style={{ gap: 10 }}>
          {error ? <Banner kind="warn">{error}</Banner> : null}
          <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus />
          <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" onSubmitEditing={submit} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <LinkText onPress={() => router.push({ pathname: '/forgot-password', params: { email: email.trim() } })}>Forgot password?</LinkText>
            <Btn title={busy ? 'Logging in…' : 'Log in'} onPress={submit} disabled={busy} />
          </View>
        </Card>
        <Hint>New to The Pickle Slot? <LinkText onPress={() => router.replace('/signup')}>Sign up</LinkText></Hint>
        <Btn title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Screen>
    </View>
  );
}
