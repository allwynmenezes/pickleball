import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../lib/theme';

/* Brand gradient runs Purple → Lavender, left (dark) to right (light), so
   the wordmark on the left keeps strong contrast while the profile button
   on the right is an opaque chip that reads fine wherever it lands. */
export default function AppHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      colors={[colors.courtDeep, colors.court, colors.courtTint]}
      locations={[0, 0.45, 1]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.header, { paddingTop: insets.top + 12 }]}
    >
      <View style={styles.brandrow}>
        <View style={styles.mark}>
          <View style={styles.markPill} />
          <View style={styles.markDot} />
        </View>
        <Text style={styles.word}>THE PICKLE <Text style={{ color: colors.ball }}>SLOT</Text></Text>
      </View>
      <Pressable onPress={() => router.push('/profile')} style={styles.profileBtn}>
        <Ionicons name="person" size={18} color={colors.courtDeep} />
      </Pressable>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20, paddingBottom: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  brandrow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  markPill: { position: 'absolute', left: 0, top: 2, width: 15, height: 22, borderRadius: 7.5, backgroundColor: colors.ball },
  markDot: { position: 'absolute', right: 0, bottom: 0, width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#fff', borderWidth: 1.2, borderColor: colors.courtDeep },
  word: { fontWeight: '700', fontSize: 21, letterSpacing: 0.5, color: '#fff' },
  profileBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center', justifyContent: 'center',
  },
});
