import React from 'react';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Screen, SectionTitle, Card, Btn, Hint } from '../lib/ui';
import { showConfirm } from '../lib/confirm';
import { resetAllData } from '../lib/store';
import { colors } from '../lib/theme';

export default function ProfileScreen() {
  const router = useRouter();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.chalk }} edges={['top']}>
      <Screen>
        <SectionTitle first>Profile</SectionTitle>
        <Card>
          <Hint style={{ marginTop: 0 }}>The Pickle Slot is shared by your whole group rather than tied to any one account — there's no login. This page holds app-wide settings.</Hint>
        </Card>
        <SectionTitle>Data</SectionTitle>
        <Card>
          <Btn
            title="Reset all data" variant="ghost" small dangerText
            onPress={() => showConfirm('Erase all The Pickle Slot data for this group? This cannot be undone.', () => { resetAllData(); router.back(); })}
          />
        </Card>
        <Btn title="Close" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8 }} />
      </Screen>
    </SafeAreaView>
  );
}
