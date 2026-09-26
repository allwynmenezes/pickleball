import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Btn, TextField, Banner, Hint, LinkText } from '../lib/ui';
import { sendPasswordResetCode, confirmPasswordReset } from '../lib/auth';
import { colors } from '../lib/theme';

const MIN_PASSWORD = 8;

/* Email → emailed code → new password. Finishing signs you in on this
   device (and out everywhere else). Also how accounts made before
   passwords existed set their first one. */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState(params.email || '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(e.message || 'Something went wrong.'); }
    setBusy(false);
  }

  function sendCode() {
    if (!email.trim()) { setError('Enter your email.'); return; }
    run(async () => { await sendPasswordResetCode(email.trim()); setStep('reset'); });
  }

  function reset() {
    if (!code.trim()) { setError('Enter the code from the email.'); return; }
    if (password.length < MIN_PASSWORD) { setError(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    run(async () => {
      await confirmPasswordReset(email.trim(), code.trim(), password);
      // Pop Forgot password and the Log in screen under it.
      router.dismiss(2);
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        <SectionTitle first>Reset password</SectionTitle>
        <Card style={{ gap: 10 }}>
          {error ? <Banner kind="warn">{error}</Banner> : null}
          {step === 'email' ? (
            <>
              <Hint style={{ marginTop: 0 }}>Enter your account's email and we'll send you a code to set a new password.</Hint>
              <TextField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoComplete="email" onSubmitEditing={sendCode} autoFocus />
              <Btn title={busy ? 'Sending…' : 'Send code'} onPress={sendCode} disabled={busy} style={{ alignSelf: 'flex-end' }} />
            </>
          ) : (
            <>
              <Text style={styles.sentTo}>Code sent to <Text style={styles.strong}>{email.trim()}</Text></Text>
              <TextField label="6-digit code" value={code} onChangeText={setCode} placeholder="000000" keyboardType="number-pad" autoFocus />
              <TextField label="New password" value={password} onChangeText={setPassword} placeholder={`At least ${MIN_PASSWORD} characters`} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
              <TextField label="Confirm new password" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoComplete="new-password" onSubmitEditing={reset} />
              <View style={styles.row}>
                <LinkText onPress={() => run(() => sendPasswordResetCode(email.trim()))}>Resend code</LinkText>
                <Btn title={busy ? 'Saving…' : 'Set password'} onPress={reset} disabled={busy} />
              </View>
            </>
          )}
        </Card>
        <Btn title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  sentTo: { fontSize: 13, color: colors.slate },
  strong: { fontWeight: '600', color: colors.ink },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
