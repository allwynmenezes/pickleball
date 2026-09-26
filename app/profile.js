import React from 'react';
import { View, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { pushOnce } from '../lib/nav';
import { Screen, SectionTitle, Card, Btn, Hint, Row, GenderDot } from '../lib/ui';
import { useAuth, logout } from '../lib/auth';
import { colors } from '../lib/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const { player } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: colors.chalk }}>
      <Screen>
        <SectionTitle first>Profile</SectionTitle>
        <Card>
          <Hint style={{ marginTop: 0 }}>The Pickle Slot's data is shared by your whole group — there's no login wall to use it. An account just lets you claim a name your host added, so it's recognizably you.</Hint>
        </Card>

        <SectionTitle>Account</SectionTitle>
        <Card>
          {player ? (
            <>
              <Row style={{ borderBottomWidth: 0, paddingVertical: 4 }}>
                <Text style={{ flexShrink: 1, fontSize: 14, fontWeight: '600', color: colors.ink }} numberOfLines={1}>{player.name}</Text>
                <GenderDot gender={player.gender} />
                <Text style={{ flex: 1, fontSize: 14, color: colors.slate }} numberOfLines={1}>{player.email}</Text>
              </Row>
              <Btn title="Log out" variant="ghost" small dangerText onPress={logout} style={{ alignSelf: 'flex-end' }} />
            </>
          ) : (
            <>
              <Hint style={{ marginTop: 0 }}>Not logged in. If your host sent you an invite link, open that to claim your spot. New here? Sign up — or log in with the email you already used.</Hint>
              <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'flex-end' }}>
                <Btn title="Sign up" variant="outline" onPress={() => pushOnce(router, '/signup')} />
                <Btn title="Log in" onPress={() => pushOnce(router, '/login')} />
              </View>
            </>
          )}
        </Card>

        <Btn title="Close" variant="ghost" onPress={() => router.back()} style={{ marginTop: 8, alignSelf: 'flex-end' }} />
      </Screen>
    </View>
  );
}
