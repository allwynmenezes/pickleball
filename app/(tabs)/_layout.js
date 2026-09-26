import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { View, StyleSheet } from 'react-native';
import { colors } from '../../lib/theme';

const ICONS = {
  index: 'calendar',
  players: 'people',
  chat: 'chatbubble-ellipses',
  games: 'grid',
};

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.courtDeep,
        tabBarInactiveTintColor: colors.courtTint,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarActiveBackgroundColor: colors.ball,
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name] || 'ellipse'} size={size ? size - 3 : 18} color={color} />
        ),
      })}
    >
      <Tabs.Screen name="index" options={{ title: 'Events' }} />
      <Tabs.Screen name="players" options={{ title: 'Players' }} />
      <Tabs.Screen name="chat" options={{ title: 'Chat' }} />
      <Tabs.Screen name="games" options={{ title: 'Games' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute', left: 14, right: 14, bottom: 14,
    backgroundColor: colors.court, borderRadius: 18, borderTopWidth: 0,
    height: 62, paddingBottom: 6, paddingTop: 6,
    shadowColor: colors.courtDeep, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  tabBarItem: { borderRadius: 14, marginHorizontal: 4 },
  tabBarLabel: { fontSize: 10, fontWeight: '600' },
});
