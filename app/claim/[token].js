import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen, SectionTitle, Card, Btn, GenderDot, Hint } from '../../lib/ui';
import { getClaimInfo } from '../../lib/auth';
import SignupForm from '../../components/SignupForm';
import { colors } from '../../lib/theme';

/* Where an invite link lands (see the share button next to unclaimed
   players in RsvpStep). Resolves the token first — links can be invalid,
   already used, or expired — then runs the normal sign-up with the name and
   category the host entered already filled in (still editable). */
export default function ClaimScreen() {
  const { token } = useLocalSearchParams();
  const router = useRouter();
  const [state, setState] = useState({ loading: true, info: null, error: null });

  useEffect(() => {
    let cancelled = false;
    getClaimInfo(token)
      .then(info => { if (!cancelled) setState({ loading: false, info, error: null }); })
      .catch(e => { if (!cancelled) setState({ loading: false, info: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [token]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        <SectionTitle first>Claim your spot</SectionTitle>

        {state.loading ? (
          <Card style={{ alignItems: 'center', paddingVertical: 28 }}>
            <ActivityIndicator color={colors.court} />
          </Card>
        ) : state.error ? (
          <Card>
            <Text style={styles.errorText}>{state.error}</Text>
            <Hint>Ask whoever shared this with you to send a new invite link.</Hint>
            <Btn title="Go to The Pickle Slot" variant="ghost" onPress={() => router.replace('/(tabs)')} style={{ marginTop: 10, alignSelf: 'flex-end' }} />
          </Card>
        ) : (
          <>
            <Card style={styles.whoCard}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.name}>{state.info.name}</Text>
                  <GenderDot gender={state.info.gender} size={20} />
                </View>
                <Text style={styles.sub}>You've been invited — create your account to claim this spot.</Text>
              </View>
            </Card>
            <SignupForm
              initialName={state.info.name}
              initialGender={state.info.gender}
              claimToken={token}
              submitLabel="Claim account"
              onSuccess={() => router.replace('/(tabs)')}
            />
          </>
        )}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  whoCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontWeight: '700', fontSize: 16, color: colors.ink },
  sub: { fontSize: 12.5, color: colors.slate, marginTop: 2 },
  errorText: { fontSize: 14, color: colors.clayText, marginBottom: 4 },
});
