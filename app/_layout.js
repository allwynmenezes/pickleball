import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { hydrate, isHydrated } from '../lib/store';
import { ConfirmModalHost } from '../lib/ui';
import { colors } from '../lib/theme';

export default function RootLayout() {
  const [ready, setReady] = useState(isHydrated());
  useEffect(() => { hydrate().then(() => setReady(true)); }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chalk }}>
        <ActivityIndicator color={colors.court} size="large" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="event/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="profile" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
        <ConfirmModalHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
