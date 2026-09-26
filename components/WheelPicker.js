import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Modal, Animated, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Field } from '../lib/ui';
import { fmtClock } from '../lib/engine';
import { colors, radius } from '../lib/theme';

/* Apple-style wheel pickers, identical on iOS and Android: snapping scroll
   columns whose rows fade, shrink and tilt away from the centre band, shown
   in a card in the middle of the screen. The choice is only committed on
   Done, so spinning past values never writes half-picked times into the
   store. */

const ITEM_H = 40;
const VISIBLE = 5;
const PAD = ITEM_H * Math.floor(VISIBLE / 2);

function WheelColumn({ items, index, onChange, width }) {
  const ref = useRef(null);
  const y = useRef(new Animated.Value(index * ITEM_H)).current;
  const current = useRef(index);

  useEffect(() => {
    // Android ignores contentOffset on first render — scroll there instead.
    const t = setTimeout(() => ref.current && ref.current.scrollTo({ y: index * ITEM_H, animated: false }), 0);
    return () => clearTimeout(t);
  }, []);

  function settle(e) {
    const i = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)));
    if (i !== current.current) { current.current = i; onChange(i); }
  }

  return (
    <View style={[styles.column, width ? { width } : { flex: 1 }]}>
      <Animated.ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        nestedScrollEnabled
        contentContainerStyle={{ paddingVertical: PAD }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y } } }], { useNativeDriver: true })}
        onMomentumScrollEnd={settle}
        onScrollEndDrag={settle}
      >
        {items.map((it, i) => {
          const c = i * ITEM_H;
          const range = [c - 2 * ITEM_H, c - ITEM_H, c, c + ITEM_H, c + 2 * ITEM_H];
          const opacity = y.interpolate({ inputRange: range, outputRange: [0.2, 0.45, 1, 0.45, 0.2], extrapolate: 'clamp' });
          const scale = y.interpolate({ inputRange: range, outputRange: [0.82, 0.92, 1, 0.92, 0.82], extrapolate: 'clamp' });
          const rotateX = y.interpolate({ inputRange: [c - 2 * ITEM_H, c, c + 2 * ITEM_H], outputRange: ['55deg', '0deg', '-55deg'], extrapolate: 'clamp' });
          return (
            <Animated.View key={String(it.value)} style={[styles.item, { opacity, transform: [{ perspective: 500 }, { rotateX }, { scale }] }]}>
              <Text style={styles.itemText}>{it.label}</Text>
            </Animated.View>
          );
        })}
      </Animated.ScrollView>
    </View>
  );
}

/* columns: [{ items: [{label, value}], index, width? }] */
function WheelSheet({ title, columns, onCancel, onDone }) {
  const [picked, setPicked] = useState(columns.map(c => c.index));
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onCancel}>
      <View style={styles.center}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={styles.sheetBar}>
          <Pressable onPress={onCancel} hitSlop={10}><Text style={styles.sheetCancel}>Cancel</Text></Pressable>
          <Text style={styles.sheetTitle}>{title}</Text>
          <Pressable onPress={() => onDone(picked)} hitSlop={10}><Text style={styles.sheetDone}>Done</Text></Pressable>
        </View>
        <View style={styles.wheels}>
          <View pointerEvents="none" style={styles.band} />
          {columns.map((col, ci) => (
            <WheelColumn
              key={ci} items={col.items} index={col.index} width={col.width}
              onChange={(i) => setPicked(p => p.map((v, k) => (k === ci ? i : v)))}
            />
          ))}
        </View>
      </View>
      </View>
    </Modal>
  );
}

function FieldButton({ label, text, onPress, style, disabled }) {
  return (
    <Field label={label} style={style}>
      <Pressable onPress={disabled ? undefined : onPress} style={[styles.field, disabled && styles.fieldDisabled]}>
        <Text style={styles.fieldText} numberOfLines={1}>{text}</Text>
        <Ionicons name="time-outline" size={15} color={colors.slate} />
      </Pressable>
    </Field>
  );
}

const HOURS = Array.from({ length: 12 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));
const AMPM = [{ label: 'AM', value: 'am' }, { label: 'PM', value: 'pm' }];

/* A time of day as "HH:MM" (24h), picked on hour / minute / AM-PM wheels. */
export function TimeWheelField({ label, value, onChange, minuteStep = 15, style }) {
  const [open, setOpen] = useState(false);
  const minutes = [];
  for (let m = 0; m < 60; m += minuteStep) minutes.push({ label: String(m).padStart(2, '0'), value: m });

  const [h24, m] = (value || '18:00').split(':').map(Number);
  const hourIdx = ((h24 % 12) || 12) - 1;
  const minIdx = Math.max(0, minutes.findIndex(x => x.value >= m));
  const apIdx = h24 >= 12 ? 1 : 0;

  function done([hi, mi, ai]) {
    let h = HOURS[hi].value % 12;
    if (AMPM[ai].value === 'pm') h += 12;
    onChange(String(h).padStart(2, '0') + ':' + String(minutes[mi].value).padStart(2, '0'));
    setOpen(false);
  }

  return (
    <>
      <FieldButton label={label} text={fmtClock(value || '18:00')} onPress={() => setOpen(true)} style={style} />
      {open ? (
        <WheelSheet
          title={label || 'Time'}
          columns={[
            { items: HOURS, index: hourIdx, width: 70 },
            { items: minutes, index: minIdx, width: 70 },
            { items: AMPM, index: apIdx, width: 70 },
          ]}
          onCancel={() => setOpen(false)}
          onDone={done}
        />
      ) : null}
    </>
  );
}

/* One wheel over a fixed list — for times limited to what an event allows
   (segment boundaries, partial-RSVP windows). */
export function WheelSelectField({ label, value, onValueChange, items, style, disabled }) {
  const [open, setOpen] = useState(false);
  const idx = Math.max(0, items.findIndex(it => String(it.value) === String(value)));
  const selected = items[idx];
  return (
    <>
      <FieldButton label={label} text={selected ? selected.label : ''} onPress={() => setOpen(true)} style={style} disabled={disabled} />
      {open ? (
        <WheelSheet
          title={label || 'Select'}
          columns={[{ items, index: idx, width: 160 }]}
          onCancel={() => setOpen(false)}
          onDone={([i]) => { onValueChange(items[i].value); setOpen(false); }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.white,
    height: 38, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
  },
  fieldText: { fontSize: 14, color: colors.ink, flexShrink: 1 },
  fieldDisabled: { backgroundColor: colors.chalk, opacity: 0.6 },
  // A centred card over a dimmed backdrop (it used to be a bottom sheet).
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,15,46,0.45)' },
  sheet: { backgroundColor: colors.card, borderRadius: 16, paddingBottom: 16, width: '100%', maxWidth: 360, overflow: 'hidden' },
  sheetBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  sheetTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  sheetCancel: { fontSize: 15, color: colors.slate },
  sheetDone: { fontSize: 15, fontWeight: '700', color: colors.court },
  wheels: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16, paddingTop: 8 },
  band: {
    position: 'absolute', left: 16, right: 16, top: 8 + PAD, height: ITEM_H,
    borderRadius: 9, backgroundColor: colors.courtTint,
  },
  column: { height: ITEM_H * VISIBLE, overflow: 'hidden' },
  item: { height: ITEM_H, alignItems: 'center', justifyContent: 'center' },
  itemText: { fontSize: 21, color: colors.ink },
});
