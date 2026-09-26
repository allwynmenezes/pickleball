import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, SectionTitle, Btn, Hint, LinkText } from '../lib/ui';
import SignupForm from '../components/SignupForm';
import { colors } from '../lib/theme';

/* Sign-up without an invite link: the person fills in everything. */
export default function SignupScreen() {
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        <SectionTitle first>Sign up</SectionTitle>
        <SignupForm onSuccess={() => router.back()} />
        <Hint>Already have an account? <LinkText onPress={() => router.replace('/login')}>Log in</LinkText></Hint>
        <Btn title="Cancel" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Screen>
    </View>
  );
}
