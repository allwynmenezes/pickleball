import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, Platform, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { hydrate, isHydrated, startLiveSync } from '../lib/store';
import { hydrateAuth } from '../lib/auth';
import { ConfirmModalHost } from '../lib/ui';
import AppHeader from '../components/AppHeader';
import RoundNotifier, { SyncStatus } from '../components/RoundNotifier';
import { colors } from '../lib/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(isHydrated());
  // After loading, keep in step with the server: others' scores and the
  // host's round changes show up live (see startLiveSync).
  useEffect(() => { Promise.all([hydrate(), hydrateAuth()]).then(() => { setReady(true); startLiveSync(); }); }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chalk }}>
        <ActivityIndicator color={colors.court} size="large" />
      </View>
    );
  }

  /* The header lives outside the Stack so it stays put while pushed pages
     (event flow, profile, login, claim) slide in underneath it, rather than
     each page drawing its own header over the whole screen. */
  const stack = (
    <View style={{ flex: 1 }}>
      <AppHeader />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.chalk } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="event/[id]" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="profile" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="player/[id]" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="login" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="signup" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="forgot-password" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="claim/[token]" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </View>
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {Platform.OS === 'web' ? (
          <View style={styles.webOuter}>
            <View style={styles.webInner}>{stack}</View>
          </View>
        ) : stack}
        <RoundNotifier />
        <SyncStatus />
        <ConfirmModalHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  webOuter: { flex: 1, backgroundColor: colors.chalk, alignItems: 'center' },
  webInner: { flex: 1, width: '100%', maxWidth: 960 },
});
