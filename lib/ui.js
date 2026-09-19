import React from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Modal, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, genderColor, genderTint } from './theme';
import { useModalState, confirmYes, confirmCancel } from './confirm';

export function Screen({ children, contentStyle }) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[{ padding: 16, paddingBottom: 40 }, contentStyle]}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

export function SectionTitle({ children, first, onPress, style }) {
  const Comp = onPress ? Pressable : View;
  return (
    <Comp onPress={onPress} style={[styles.sectionTitleRow, first ? { marginTop: 0 } : null, style]}>
      <View style={styles.sectionTitleBar} />
      <Text style={styles.sectionTitleText}>{children}</Text>
      {onPress ? <Ionicons name="chevron-forward" size={13} color={colors.slate} style={{ marginLeft: 4 }} /> : null}
    </Comp>
  );
}

export function Card({ children, lift, style }) {
  return <View style={[styles.card, lift ? styles.cardLift : null, style]}>{children}</View>;
}

export function Row({ children, style, onPress }) {
  const Comp = onPress ? Pressable : View;
  return <Comp onPress={onPress} style={[styles.row, style]}>{children}</Comp>;
}

const BTN_VARIANTS = {
  solid: { bg: colors.court, bgPressed: colors.courtDeep, fg: '#fff', border: 'transparent' },
  outline: { bg: 'transparent', bgPressed: colors.courtTint, fg: colors.court, border: colors.court },
  ghost: { bg: 'transparent', bgPressed: colors.chalk, fg: colors.slate, border: colors.line },
  clay: { bg: colors.clay, bgPressed: colors.clayDeep, fg: '#fff', border: 'transparent' },
};
export function Btn({ title, onPress, variant = 'solid', small, disabled, icon, style, dangerText }) {
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.solid;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: pressed ? v.bgPressed : v.bg, borderColor: v.border, borderWidth: v.border === 'transparent' ? 0 : 1.5 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 14 : 16} color={dangerText ? colors.clay : v.fg} /> : null}
      <Text style={[styles.btnText, { color: dangerText ? colors.clay : v.fg }, small && { fontSize: 12 }]}>{title}</Text>
    </Pressable>
  );
}

export function IconBtn({ icon, onPress, danger, size = 16 }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconBtn,
        pressed && { backgroundColor: danger ? colors.clayTint : colors.courtTint, borderColor: danger ? colors.clay : colors.court },
      ]}
    >
      <Ionicons name={icon} size={size} color={danger ? colors.clay : colors.slate} />
    </Pressable>
  );
}

export function Pill({ label, active, activeColor, activeTextColor, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.pill,
        active && { backgroundColor: activeColor || colors.court, borderColor: activeColor || colors.court },
      ]}
    >
      <Text style={[styles.pillText, active && { color: activeTextColor || '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, kind = 'ok' }) {
  const map = {
    ok: { bg: colors.courtTint, fg: colors.courtDeep },
    wait: { bg: colors.ballTint, fg: colors.ballText },
    flag: { bg: colors.clayTint, fg: colors.clay },
  };
  const c = map[kind] || map.ok;
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.badgeText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function GenderDot({ gender, size = 18 }) {
  const label = gender === 'M' ? 'M' : gender === 'F' ? 'F' : 'O';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: genderColor(gender), alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontSize: size * 0.55, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
export function GenderChip({ gender }) {
  const label = gender === 'M' ? 'Male' : gender === 'F' ? 'Female' : 'Other';
  return (
    <View style={[styles.gchip, { backgroundColor: genderTint(gender) }]}>
      <Text style={[styles.gchipText, { color: genderColor(gender) }]}>{label}</Text>
    </View>
  );
}

export function EmptyState({ icon, children }) {
  return (
    <View style={styles.empty}>
      {icon ? <Ionicons name={icon} size={28} color={colors.line} style={{ marginBottom: 10 }} /> : null}
      {typeof children === 'string' ? <Text style={styles.emptyText}>{children}</Text> : children}
    </View>
  );
}

export function Hint({ children, style }) {
  return <Text style={[styles.hint, style]}>{children}</Text>;
}

export function Banner({ children, kind = 'warn' }) {
  const isWarn = kind === 'warn';
  return (
    <View style={[styles.banner, { backgroundColor: isWarn ? colors.clayTint : colors.courtTint, borderLeftColor: isWarn ? colors.clay : colors.court }]}>
      <Text style={{ color: isWarn ? colors.clayText : colors.courtDeep, fontSize: 12.5, lineHeight: 17 }}>{children}</Text>
    </View>
  );
}

export function Field({ label, children }) {
  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

export function TextField({ label, value, onChangeText, placeholder, keyboardType, onSubmitEditing }) {
  return (
    <Field label={label}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        onSubmitEditing={onSubmitEditing}
        style={styles.input}
        placeholderTextColor={colors.slate}
      />
    </Field>
  );
}

export function LinkText({ children, onPress }) {
  return (
    <Text style={styles.link} onPress={onPress}>{children}</Text>
  );
}

export function BigNum({ value, label }) {
  return (
    <View>
      <Text style={styles.bignum}>{value}</Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

export function ConfirmModalHost() {
  const modal = useModalState();
  if (!modal) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={confirmCancel}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalBox}>
          <Text style={styles.modalMessage}>{modal.message}</Text>
          <View style={styles.modalActions}>
            {modal.showCancel ? <Btn title="Cancel" variant="ghost" onPress={confirmCancel} /> : null}
            <Btn title={modal.confirmLabel} variant={modal.showCancel ? 'clay' : 'solid'} onPress={confirmYes} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.chalk },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 22, marginBottom: 10 },
  sectionTitleBar: { width: 3, height: 13, backgroundColor: colors.court, borderRadius: 2 },
  sectionTitleText: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: colors.slate, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 16, marginBottom: 12 },
  cardLift: { borderColor: 'transparent', shadowColor: '#320078', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.sm, paddingVertical: 11, paddingHorizontal: 16, alignSelf: 'flex-start',
  },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 12 },
  btnText: { fontSize: 13.5, fontWeight: '600' },
  iconBtn: {
    width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  pill: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff' },
  pillText: { fontSize: 12, fontWeight: '700', color: colors.slate },
  badge: { paddingVertical: 3, paddingHorizontal: 8, borderRadius: 20, alignSelf: 'flex-start' },
  badgeText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  gchip: { paddingVertical: 3, paddingHorizontal: 9, borderRadius: 20, alignSelf: 'flex-start' },
  gchipText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  empty: { padding: 34, alignItems: 'center', borderWidth: 1.5, borderColor: colors.line, borderStyle: 'dashed', borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.5)' },
  emptyText: { color: colors.slate, fontSize: 13, textAlign: 'center' },
  hint: { fontSize: 12, color: colors.slate, marginTop: 7, lineHeight: 17 },
  banner: { padding: 10, borderRadius: radius.sm, borderLeftWidth: 3, marginBottom: 9 },
  label: { fontSize: 11.5, color: colors.slate, marginBottom: 4, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, paddingVertical: Platform.OS === 'ios' ? 10 : 8, paddingHorizontal: 10,
    fontSize: 14, backgroundColor: '#fff', color: colors.ink,
  },
  link: { color: colors.court, fontSize: 12, fontWeight: '600' },
  bignum: { fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontWeight: '700', fontSize: 34, color: colors.courtDeep },
  meta: { fontSize: 12, color: colors.slate },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(26,15,46,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: colors.card, borderRadius: radius.md, padding: 20, maxWidth: 340, width: '100%' },
  modalMessage: { marginBottom: 16, fontSize: 14, lineHeight: 20, color: colors.ink },
  modalActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
});
