import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, Btn, TextField, Field, Pill, Hint, Banner, LinkText } from '../lib/ui';
import { sendSignupCode, confirmSignup } from '../lib/auth';
import { colors } from '../lib/theme';

const GENDERS = [
  { key: 'M', label: 'Male' },
  { key: 'F', label: 'Female' },
  { key: 'O', label: 'Other' },
];
const MIN_PASSWORD = 8;

/* Shared by plain sign-up (app/signup.js) and claiming an invite
   (app/claim/[token].js — name/category prefilled, claimToken set). Step 1
   collects the details and password; step 2 verifies the email with the
   code we send. The account only exists once that code checks out. */
export default function SignupForm({ initialName = '', initialGender = 'M', claimToken, submitLabel = 'Create account', onSuccess }) {
  const [step, setStep] = useState('details');
  const [name, setName] = useState(initialName);
  const [gender, setGender] = useState(initialGender);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message || 'Something went wrong.'); }
    setBusy(false);
  }

  function sendCode() {
    if (!name.trim()) { setError('Enter your name.'); return; }
    if (!email.trim()) { setError('Enter your email.'); return; }
    if (password.length < MIN_PASSWORD) { setError(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    run(async () => {
      await sendSignupCode({ name: name.trim(), gender, email: email.trim(), password, claimToken });
      setStep('code');
    });
  }

  function verify() {
    if (!code.trim()) return;
    run(async () => onSuccess(await confirmSignup(email.trim(), code.trim())));
  }

  if (step === 'code') {
    return (
      <Card style={{ gap: 10 }}>
        {error ? <Banner kind="warn">{error}</Banner> : null}
        <Text style={styles.sentTo}>We emailed a 6-digit code to <Text style={styles.strong}>{email.trim()}</Text> to confirm it's you.</Text>
        <TextField label="6-digit code" value={code} onChangeText={setCode} placeholder="000000" keyboardType="number-pad" onSubmitEditing={verify} autoFocus />
        <View style={styles.row}>
          <View style={{ gap: 6 }}>
            <LinkText onPress={() => run(() => sendSignupCode({ name: name.trim(), gender, email: email.trim(), password, claimToken }))}>Resend code</LinkText>
            <LinkText onPress={() => { setStep('details'); setCode(''); setError(''); }}>Change details</LinkText>
          </View>
          <Btn title={busy ? 'Verifying…' : submitLabel} onPress={verify} disabled={busy} />
        </View>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 10 }}>
      {error ? <Banner kind="warn">{error}</Banner> : null}
      <TextField label="Your name" value={name} onChangeText={setName} placeholder="First and last name" autoFocus={!initialName} />
      <Field label="Category">
        <View style={styles.pills}>
          {GENDERS.map(g => <Pill key={g.key} label={g.label} active={gender === g.key} onPress={() => setGender(g.key)} />)}
        </View>
      </Field>
      <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" autoFocus={!!initialName} />
      <TextField label="Password" value={password} onChangeText={setPassword} placeholder={`At least ${MIN_PASSWORD} characters`} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
      <TextField label="Confirm password" value={confirm} onChangeText={setConfirm} placeholder="Type it again" secureTextEntry autoCapitalize="none" autoComplete="new-password" onSubmitEditing={sendCode} />
      <Hint style={{ marginTop: 0 }}>We'll email you a code to confirm your address.</Hint>
      <Btn title={busy ? 'Sending…' : 'Continue'} onPress={sendCode} disabled={busy} style={{ alignSelf: 'flex-end' }} />
    </Card>
  );
}

const styles = StyleSheet.create({
  pills: { flexDirection: 'row', gap: 8 },
  sentTo: { fontSize: 13, color: colors.slate, lineHeight: 18 },
  strong: { fontWeight: '600', color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
