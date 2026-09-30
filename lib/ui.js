import React from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, Modal, ScrollView, Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Calendar from '../components/Calendar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, genderColor, genderTint } from './theme';
import { useModalState, confirmYes, confirmCancel } from './confirm';
import { fmtClock } from './engine';

/* Android's native Picker has no intrinsic height that matches a bordered
   TextInput, so left uncontrolled it renders visibly taller — pin it to the
   same height as `input` below. iOS renders Picker as an inline wheel, which
   a fixed height would clip, so it's left alone there. */
const SELECT_HEIGHT = Platform.OS === 'ios' ? undefined : 38;

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

/* expanded (optional): makes the title a collapsible section header — the
   chevron points down when open and right when closed. */
export function SectionTitle({ children, first, onPress, style, expanded }) {
  const Comp = onPress ? Pressable : View;
  const chevron = expanded === undefined ? 'chevron-forward' : expanded ? 'chevron-down' : 'chevron-forward';
  return (
    <Comp
      onPress={onPress}
      style={[styles.sectionTitleRow, first ? { marginTop: 0 } : null, style]}
      {...(onPress && expanded !== undefined ? { accessibilityRole: 'button', accessibilityState: { expanded } } : null)}
    >
      <View style={styles.sectionTitleBar} />
      <Text style={styles.sectionTitleText}>{children}</Text>
      {onPress ? <Ionicons name={chevron} size={13} color={colors.slate} style={{ marginLeft: 4 }} /> : null}
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
  solid: { bg: colors.court, bgPressed: colors.courtDeep, fg: colors.courtTint, border: 'transparent' },
  outline: { bg: 'transparent', bgPressed: colors.courtTint, fg: colors.court, border: colors.court },
  ghost: { bg: 'transparent', bgPressed: colors.chalk, fg: colors.slate, border: colors.line },
  clay: { bg: colors.clay, bgPressed: colors.clayDeep, fg: colors.courtTint, border: 'transparent' },
  female: { bg: colors.female, bgPressed: colors.femaleDeep, fg: colors.courtTint, border: 'transparent' },
};
/* Ionicons' "add" is hairline-thin next to bold button text; every plus in
   the app uses this heavier glyph instead. */
export function BoldPlus({ size = 16, color }) {
  return <MaterialCommunityIcons name="plus-thick" size={size} color={color} />;
}

export function Btn({ title, onPress, variant = 'solid', small, disabled, icon, style, dangerText }) {
  const v = BTN_VARIANTS[variant] || BTN_VARIANTS.solid;
  const iconColor = dangerText ? colors.clay : v.fg;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        // Every variant carries the same 1.5px border (transparent on filled
        // ones) so solid and outline buttons side by side are the same height.
        { backgroundColor: pressed ? v.bgPressed : v.bg, borderColor: v.border, borderWidth: 1.5 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      {icon === 'add' ? <BoldPlus size={small ? 14 : 16} color={iconColor} />
        : icon ? <Ionicons name={icon} size={small ? 14 : 16} color={iconColor} /> : null}
      <Text style={[styles.btnText, { color: dangerText ? colors.clay : v.fg }, small && { fontSize: 12 }]}>{title}</Text>
    </Pressable>
  );
}

export function IconBtn({ icon, onPress, danger, size = 16, label }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconBtn,
        pressed && { backgroundColor: danger ? colors.clayTint : colors.courtTint, borderColor: danger ? colors.clay : colors.court },
      ]}
    >
      <Ionicons name={icon} size={size} color={danger ? colors.clay : colors.slate} />
    </Pressable>
  );
}

export function Pill({ label, active, activeColor, activeTextColor, outline, onPress, style, disabled, accessibilityLabel }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ selected: !!active, disabled: !!disabled }}
      style={[
        styles.pill,
        active && (outline
          ? { borderColor: activeColor || colors.court }
          : { backgroundColor: activeColor || colors.court, borderColor: activeColor || colors.court }),
        disabled && !active && { opacity: 0.45 },
        style,
      ]}
    >
      <Text style={[styles.pillText, active && { color: outline ? (activeColor || colors.court) : (activeTextColor || colors.courtTint) }]}>{label}</Text>
    </Pressable>
  );
}

export function Badge({ label, kind = 'ok' }) {
  const map = {
    ok: { bg: colors.courtTint, fg: colors.courtDeep },
    wait: { bg: colors.ballTint, fg: colors.ballText },
    flag: { bg: colors.clayTint, fg: colors.clay },
    done: { bg: colors.line, fg: colors.slate },
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
      <Text style={{ color: colors.white, fontSize: size * 0.55, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
/* A player's DUPR rating, e.g. "DUPR 3.742" — nothing when there isn't one. */
export function DuprChip({ dupr }) {
  if (dupr == null) return null;
  return (
    <View style={styles.duprChip}>
      <Text style={styles.duprText}>DUPR {Number(dupr).toFixed(3)}</Text>
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

/* Android draws a one-sided dashed border as solid (or not at all), so the
   dash comes from a fully-bordered box clipped down to its top edge. */
export function DashedLine({ color = colors.line, thickness = 1, style }) {
  return (
    <View style={[{ height: thickness, overflow: 'hidden' }, style]}>
      <View style={{ height: thickness * 3, borderWidth: thickness, borderColor: color, borderStyle: 'dashed', borderRadius: 1 }} />
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

export function Checkbox({ label, checked, onChange, disabled, style }) {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange(!checked)}
      style={[styles.checkRow, disabled && { opacity: 0.5 }, style]}
      accessibilityRole="checkbox" accessibilityState={{ checked, disabled }}
    >
      <Ionicons name={checked ? 'checkbox' : 'square-outline'} size={20} color={checked ? colors.court : colors.slate} />
      <Text style={styles.checkLabel}>{label}</Text>
    </Pressable>
  );
}

/* Shown on every step that freezes once the event's games have started. */
export function LockedNote({ children }) {
  return <Banner kind="info">{children || 'Games have started — this page is read-only.'}</Banner>;
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

export function Field({ label, children, style }) {
  return (
    <View style={[{ flex: 1, minWidth: 0 }, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

export function TextField({ label, value, onChangeText, onBlur, placeholder, keyboardType, onSubmitEditing, autoFocus, secureTextEntry, autoCapitalize, autoComplete }) {
  return (
    <Field label={label}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        placeholder={placeholder}
        keyboardType={keyboardType}
        onSubmitEditing={onSubmitEditing}
        autoFocus={autoFocus}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        style={styles.input}
        placeholderTextColor={colors.slate}
      />
    </Field>
  );
}

/* Android ignores fontSize on the Picker's own closed/collapsed text no
   matter what `style`/`itemStyle` say (a long-standing quirk of the native
   Spinner this wraps — itemStyle there only reaches the popup list, not the
   field itself). So on Android we render our own styled Text for the
   closed state and make the real Picker an invisible tap target underneath
   it, purely to drive the native selection UI. iOS renders Picker as a
   visible inline wheel — there is no "closed state" to fix — so it's left
   untouched there. */
export function Select({ label, value, onValueChange, items, placeholder, style, disabled }) {
  const selected = items.find(it => String(it.value) === String(value));
  const androidFix = Platform.OS !== 'ios';
  return (
    <Field label={label} style={style}>
      <View style={[styles.select, disabled && styles.fieldDisabled]}>
        {androidFix ? (
          <>
            <Text style={[styles.selectDisplayText, !selected && styles.selectPlaceholder]} numberOfLines={1}>
              {selected ? selected.label : (placeholder || '')}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.slate} style={styles.selectChevron} />
          </>
        ) : null}
        <Picker
          selectedValue={value} onValueChange={onValueChange} enabled={!disabled}
          style={[styles.selectPicker, androidFix && styles.selectPickerHidden]}
          itemStyle={styles.selectItem}
        >
          {placeholder ? <Picker.Item label={placeholder} value="" color={colors.slate} /> : null}
          {items.map(it => <Picker.Item key={String(it.value)} label={it.label} value={it.value} />)}
        </Picker>
      </View>
    </Field>
  );
}

/* value/onChange use plain "YYYY-MM-DD" strings, matching the rest of the
   app's date handling — the native picker is only a UI, not the source of
   truth for date format. */
/* The app's own purple calendar in a centred card — rather than the
   platform date dialog, which on Android brings its own (green) accent
   colours. Picking a day commits it and closes. */
export function DateField({ label, value, onChange, style }) {
  const [open, setOpen] = React.useState(false);
  const dateObj = value ? new Date(value + 'T00:00:00') : new Date();
  const [cursor, setCursor] = React.useState({ year: dateObj.getFullYear(), month: dateObj.getMonth() });
  const display = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  function openPicker() {
    setCursor({ year: dateObj.getFullYear(), month: dateObj.getMonth() });
    setOpen(true);
  }
  function shift(delta) {
    setCursor(c => {
      const m = c.month + delta;
      return { year: c.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
    });
  }

  return (
    <Field label={label} style={style}>
      <Pressable onPress={openPicker} style={[styles.select, styles.dateSelect]}>
        <Text style={styles.dateText}>{display}</Text>
        <Ionicons name="calendar-outline" size={15} color={colors.slate} />
      </Pressable>
      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <View style={styles.pickerCenter}>
          <Pressable style={styles.pickerBackdrop} onPress={() => setOpen(false)} />
          <View style={styles.pickerCard}>
            <Text style={styles.pickerTitle}>{label || 'Date'}</Text>
            <Calendar
              cursor={cursor} onShift={shift} events={[]} selectedDate={value}
              onSelectDate={(d) => { onChange(d); setOpen(false); }}
            />
            <Btn title="Cancel" variant="ghost" small onPress={() => setOpen(false)} style={{ alignSelf: 'flex-end', marginTop: 10 }} />
          </View>
        </View>
      </Modal>
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
  duprChip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1 },
  duprText: { fontSize: 11, fontWeight: '700', color: colors.slate, fontVariant: ['tabular-nums'] },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 22, marginBottom: 10 },
  sectionTitleBar: { width: 3, height: 13, backgroundColor: colors.court, borderRadius: 2 },
  sectionTitleText: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, color: colors.slate, fontWeight: '700' },
  card: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 16, marginBottom: 12 },
  cardLift: { borderColor: 'transparent', shadowColor: colors.courtDeep, shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderRadius: radius.sm, paddingVertical: 11, paddingHorizontal: 16, alignSelf: 'flex-start',
  },
  btnSmall: { paddingVertical: 7, paddingHorizontal: 12 },
  btnText: { fontSize: 13.5, fontWeight: '600' },
  iconBtn: {
    width: 32, height: 32, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.white, alignItems: 'center', justifyContent: 'center',
  },
  pill: { paddingVertical: 7, paddingHorizontal: 13, borderRadius: 20, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
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
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, height: SELECT_HEIGHT, paddingVertical: Platform.OS === 'ios' ? 10 : 8, paddingHorizontal: 10,
    fontSize: 14, backgroundColor: colors.white, color: colors.ink,
  },
  select: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.white,
    overflow: 'hidden', justifyContent: 'center', height: SELECT_HEIGHT, paddingHorizontal: 10,
  },
  selectDisplayText: { fontSize: 14, color: colors.ink, paddingRight: 16 },
  selectPlaceholder: { color: colors.slate },
  selectChevron: { position: 'absolute', right: 10, top: '50%', marginTop: -7 },
  selectPicker: { height: SELECT_HEIGHT, color: colors.ink, fontSize: 14 },
  selectPickerHidden: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: 0 },
  selectItem: { fontSize: 14 },
  dateText: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  dateSelect: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  pickerCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  pickerBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,15,46,0.45)' },
  pickerCard: { backgroundColor: colors.card, borderRadius: 16, padding: 16, width: '100%', maxWidth: 360 },
  pickerTitle: { fontSize: 15, fontWeight: '600', color: colors.ink, marginBottom: 12 },
  fieldDisabled: { backgroundColor: colors.chalk, opacity: 0.6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4, alignSelf: 'flex-start' },
  checkLabel: { fontSize: 13.5, color: colors.ink },
  link: { color: colors.court, fontSize: 12, fontWeight: '600' },
  bignum: { fontFamily: Platform.select({ ios: 'Georgia', default: 'serif' }), fontWeight: '700', fontSize: 34, color: colors.courtDeep },
  meta: { fontSize: 12, color: colors.slate },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(26,15,46,0.55)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: colors.card, borderRadius: radius.md, padding: 20, maxWidth: 340, width: '100%' },
  modalMessage: { marginBottom: 16, fontSize: 14, lineHeight: 20, color: colors.ink },
  modalActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
});
