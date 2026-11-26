import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, Text, TextInput, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/** Open a hue / saturation / value picker. Writes `#RRGGBB` (uppercase). */
export function ColorPickerModal({
  visible,
  value,
  title,
  dark,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: string;
  title: string;
  dark: boolean;
  onChange(hex: string): void;
  onClose(): void;
}) {
  const initial = useMemo(() => hexToHsv(parseHex(value) ?? '#111111'), [visible]);
  const [h, setH] = useState(initial.h);
  const [s, setS] = useState(initial.s);
  const [v, setV] = useState(initial.v);
  const [hexText, setHexText] = useState(toHex(initial.h, initial.s, initial.v));

  useEffect(() => {
    if (!visible) return;
    const next = hexToHsv(parseHex(value) ?? '#111111');
    setH(next.h);
    setS(next.s);
    setV(next.v);
    setHexText(toHex(next.h, next.s, next.v));
  }, [visible, value]);

  const hex = toHex(h, s, v);
  const apply = (nh: number, ns: number, nv: number) => {
    setH(nh);
    setS(ns);
    setV(nv);
    setHexText(toHex(nh, ns, nv));
  };

  const bg = dark ? '#0A0A0A' : '#FFFFFF';
  const fg = dark ? '#FAFAFA' : '#0A0A0A';
  const muted = '#71717A';
  const border = dark ? '#27272A' : '#E4E4E7';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36, gap: 16 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ color: fg, fontSize: 17, fontWeight: '600' }}>{title}</Text>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: hex, borderWidth: 1, borderColor: border }} />
          </View>

          <SvSquare hue={h} saturation={s} value={v} onChange={(ns, nv) => apply(h, ns, nv)} />
          <HueStrip hue={h} onChange={(nh) => apply(nh, s, v)} />

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text style={{ color: muted, fontSize: 13, width: 36 }}>Hex</Text>
            <TextInput
              value={hexText}
              autoCapitalize="characters"
              autoCorrect={false}
              onChangeText={(t) => {
                setHexText(t);
                const parsed = parseHex(t);
                if (!parsed) return;
                const next = hexToHsv(parsed);
                setH(next.h);
                setS(next.s);
                setV(next.v);
              }}
              style={{
                flex: 1,
                height: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: border,
                paddingHorizontal: 14,
                color: fg,
                fontFamily: 'Menlo',
                fontSize: 15,
              }}
            />
          </View>

          <Pressable
            onPress={() => {
              onChange(hex);
              onClose();
            }}
            style={{ height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: dark ? '#FAFAFA' : '#111111' }}
          >
            <Text style={{ color: dark ? '#111111' : '#FFFFFF', fontWeight: '600', fontSize: 16 }}>Use {hex}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Swatch that opens the picker. */
export function ColorField({
  label,
  value,
  dark,
  onChange,
}: {
  label: string;
  value: string;
  dark: boolean;
  onChange(hex: string): void;
}) {
  const [open, setOpen] = useState(false);
  const display = parseHex(value) ?? value;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: dark ? '#1C1C1F' : '#F4F4F5',
        }}
      >
        <Text style={{ color: dark ? '#FAFAFA' : '#0A0A0A', fontSize: 15, flex: 1 }}>{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ color: '#71717A', fontSize: 12, fontFamily: 'Menlo' }}>{display}</Text>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: parseHex(value) ?? '#CCCCCC',
              borderWidth: 1,
              borderColor: dark ? '#3F3F46' : '#D4D4D8',
            }}
          />
        </View>
      </Pressable>
      <ColorPickerModal visible={open} value={value} title={label} dark={dark} onChange={onChange} onClose={() => setOpen(false)} />
    </>
  );
}

function HueStrip({ hue, onChange }: { hue: number; onChange(h: number): void }) {
  const width = useRef(1);
  const setFromX = (x: number) => onChange(clamp((x / width.current) * 360, 0, 359.9));
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setFromX(e.nativeEvent.locationX),
        onPanResponderMove: (e) => setFromX(e.nativeEvent.locationX),
      }),
    [onChange],
  );
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e: LayoutChangeEvent) => {
        width.current = e.nativeEvent.layout.width || 1;
      }}
      style={{ height: 28, borderRadius: 14, overflow: 'hidden' }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 360 28" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="hue" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor="#FF0000" />
            <Stop offset="0.17" stopColor="#FFFF00" />
            <Stop offset="0.33" stopColor="#00FF00" />
            <Stop offset="0.5" stopColor="#00FFFF" />
            <Stop offset="0.67" stopColor="#0000FF" />
            <Stop offset="0.83" stopColor="#FF00FF" />
            <Stop offset="1" stopColor="#FF0000" />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="360" height="28" fill="url(#hue)" />
      </Svg>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: `${(hue / 360) * 100}%`,
          marginLeft: -8,
          top: 2,
          width: 16,
          height: 24,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: '#FFFFFF',
          backgroundColor: hsvToRgb(hue, 1, 1),
        }}
      />
    </View>
  );
}

function SvSquare({
  hue,
  saturation,
  value,
  onChange,
}: {
  hue: number;
  saturation: number;
  value: number;
  onChange(s: number, v: number): void;
}) {
  const size = useRef({ w: 1, h: 1 });
  const setFrom = (x: number, y: number) => {
    onChange(clamp(x / size.current.w, 0, 1), clamp(1 - y / size.current.h, 0, 1));
  };
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => setFrom(e.nativeEvent.locationX, e.nativeEvent.locationY),
        onPanResponderMove: (e) => setFrom(e.nativeEvent.locationX, e.nativeEvent.locationY),
      }),
    [onChange],
  );
  const pure = hsvToRgb(hue, 1, 1);
  return (
    <View
      {...pan.panHandlers}
      onLayout={(e: LayoutChangeEvent) => {
        size.current = { w: e.nativeEvent.layout.width || 1, h: e.nativeEvent.layout.height || 1 };
      }}
      style={{ height: 180, borderRadius: 12, overflow: 'hidden' }}
    >
      <View style={{ flex: 1, backgroundColor: pure }}>
        <Svg width="100%" height="100%" style={{ position: 'absolute' }}>
          <Defs>
            <LinearGradient id="white" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="1" />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
            <LinearGradient id="black" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity="0" />
              <Stop offset="1" stopColor="#000000" stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#white)" />
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#black)" />
        </Svg>
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: `${saturation * 100}%`,
          top: `${(1 - value) * 100}%`,
          marginLeft: -8,
          marginTop: -8,
          width: 16,
          height: 16,
          borderRadius: 8,
          borderWidth: 2,
          borderColor: '#FFFFFF',
          backgroundColor: toHex(hue, saturation, value),
        }}
      />
    </View>
  );
}

export function parseHex(input: string): string | null {
  const t = input.trim();
  const m = t.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return `#${h.toUpperCase()}`;
}

function toHex(h: number, s: number, v: number): string {
  return hsvToRgb(h, s, v);
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

function hsvToRgb(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const byte = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}
