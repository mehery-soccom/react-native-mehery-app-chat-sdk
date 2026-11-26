import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import type { ResolvedConfig } from '../core/config';
import { useMehery } from '../react/context';

// ---------- Text ----------

type Variant = 'body' | 'caption' | 'title';
type Weight = 'regular' | 'medium' | 'bold';
const WEIGHTS: Record<Weight, TextStyle['fontWeight']> = { regular: '400', medium: '500', bold: '600' };

export function fontStyle(config: ResolvedConfig, variant: Variant, weight: Weight = 'regular'): TextStyle {
  const fontSize = config.font.size[variant];
  // A named family per weight avoids Android picking the wrong face for custom fonts.
  const family = config.font[weight] ?? config.font.regular;
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.38),
    ...(family ? { fontFamily: family } : {}),
    ...(config.font[weight] ? {} : { fontWeight: WEIGHTS[weight] }),
  };
}

export function Txt({
  variant = 'body',
  weight = 'regular',
  color,
  style,
  children,
  ...rest
}: {
  variant?: Variant;
  weight?: Weight;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
} & Omit<ComponentProps<typeof Text>, 'style' | 'children'>) {
  const { config } = useMehery();
  return (
    <Text
      maxFontSizeMultiplier={config.font.maxScale}
      style={[fontStyle(config, variant, weight), { color: color ?? config.colors.text }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ---------- Motion ----------

const SPRINGS = {
  subtle: { damping: 18, stiffness: 220, mass: 1 },
  playful: { damping: 11, stiffness: 190, mass: 1 },
};

export function useReduceMotionSetting(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/** 'spring' | 'fade' (Reduce Motion) | 'none' for the current settings. */
export function useMotionMode(): 'spring' | 'fade' | 'none' {
  const { config, reduceMotion } = useMehery();
  if (config.motion.preset === 'none') return 'none';
  return reduceMotion ? 'fade' : 'spring';
}

export function spring(value: Animated.Value, toValue: number, preset: ResolvedConfig['motion']['preset'], delay = 0) {
  const cfg = preset === 'playful' ? SPRINGS.playful : SPRINGS.subtle;
  return Animated.spring(value, { toValue, delay, useNativeDriver: true, ...cfg });
}

/** Fade + rise + slight scale with a gentle overshoot. Runs once per mount when `enabled`. */
export function useEntrance(enabled: boolean, { fromY = 10, fromScale = 0.96, delay = 0 } = {}) {
  const { config } = useMehery();
  const mode = useMotionMode();
  const animate = enabled && mode !== 'none';
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    const anim =
      mode === 'fade'
        ? Animated.timing(progress, { toValue: 1, duration: 180, delay, easing: Easing.out(Easing.quad), useNativeDriver: true })
        : spring(progress, 1, config.motion.preset, delay);
    anim.start();
    return () => anim.stop();
  }, []); // once per mount, by design
  const still = mode === 'fade';
  return {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [
      { translateY: still ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [fromY, 0] }) },
      { scale: still ? 1 : progress.interpolate({ inputRange: [0, 1], outputRange: [fromScale, 1] }) },
    ],
  };
}

/** Press feedback: shrink a touch, spring back. */
export function usePressScale(pressed = 0.92) {
  const { config } = useMehery();
  const mode = useMotionMode();
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => mode === 'spring' && spring(scale, v, config.motion.preset).start();
  return { scale, onPressIn: () => to(pressed), onPressOut: () => to(1) };
}

// ---------- Icons (plain Views: no icon font or SVG dependency) ----------

const bar = (color: string, width: number, height: number, extra: ViewStyle = {}): ViewStyle => ({
  position: 'absolute',
  width,
  height,
  borderRadius: Math.min(width, height) / 2,
  backgroundColor: color,
  ...extra,
});

export function CloseIcon({ color, size = 16 }: { color: string; size?: number }) {
  const t = Math.max(1.75, size / 9);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={bar(color, size * 1.15, t, { transform: [{ rotate: '45deg' }] })} />
      <View style={bar(color, size * 1.15, t, { transform: [{ rotate: '-45deg' }] })} />
    </View>
  );
}

/** Mic for the voice-note button: capsule, cradle, stem. */
export function MicIcon({ color, size = 16 }: { color: string; size?: number }) {
  const t = Math.max(1.5, size / 10);
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View style={{ width: size * 0.36, height: size * 0.52, borderRadius: size * 0.18, borderWidth: t, borderColor: color }} />
      <View
        style={{
          width: size * 0.62,
          height: size * 0.32,
          marginTop: -size * 0.16,
          borderBottomLeftRadius: size,
          borderBottomRightRadius: size,
          borderWidth: t,
          borderTopWidth: 0,
          borderColor: color,
        }}
      />
      <View style={{ width: t, height: size * 0.14, backgroundColor: color }} />
      <View style={{ width: size * 0.34, height: t, borderRadius: t, backgroundColor: color }} />
    </View>
  );
}

export function PlusIcon({ color, size = 16 }: { color: string; size?: number }) {
  const t = Math.max(1.75, size / 9);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={bar(color, size, t)} />
      <View style={bar(color, t, size)} />
    </View>
  );
}

/** Pencil, tilted, for the pull-up "new chat" button. */
/** Checkmark: one rotated L (right + bottom borders), so the corner is a clean joined stroke. */
export function CheckIcon({ color, size = 14 }: { color: string; size?: number }) {
  const t = Math.max(1.75, Math.round(size * 0.15 * 2) / 2);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.34,
          height: size * 0.64,
          borderRightWidth: t,
          borderBottomWidth: t,
          borderColor: color,
          borderBottomRightRadius: t * 0.6,
          transform: [{ translateY: -size * 0.07 }, { rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function ComposeIcon({ color, size = 16 }: { color: string; size?: number }) {
  const thick = Math.max(2, size * 0.16);
  const body = size * 0.72;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: body, height: body, alignItems: 'center', transform: [{ rotate: '-45deg' }] }}>
        <View style={{ width: thick, height: body * 0.7, borderRadius: thick / 2, backgroundColor: color, marginTop: thick * 0.7 }} />
        <View
          style={{
            position: 'absolute',
            top: size * 0.02,
            width: 0,
            height: 0,
            borderLeftWidth: thick * 0.7,
            borderRightWidth: thick * 0.7,
            borderBottomWidth: thick,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderBottomColor: color,
          }}
        />
      </View>
    </View>
  );
}

/**
 * Up arrow: a one-piece chevron (a square with top and left borders, turned 45° so that corner
 * becomes the tip; the joint is seamless) over a thin shaft that starts just under the tip.
 */
export function ArrowUpIcon({ color, size = 14 }: { color: string; size?: number }) {
  const t = Math.max(1.75, Math.round(size * 0.15 * 2) / 2);
  const side = size * 0.52; // chevron square; its diagonal sets the arrowhead width
  const tipInset = t * 0.75; // keep the tip's stroke inside the box
  const centerY = tipInset + side / Math.SQRT2;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          left: size / 2 - t / 2,
          top: tipInset + t * 0.6,
          width: t,
          height: size - tipInset - t * 0.6,
          borderRadius: t / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: size / 2 - side / 2,
          top: centerY - side / 2,
          width: side,
          height: side,
          borderTopWidth: t,
          borderLeftWidth: t,
          borderColor: color,
          borderTopLeftRadius: t * 0.6,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function FileIcon({ color, size = 18 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size * 0.78, height: size, borderWidth: 1.75, borderColor: color, borderRadius: 3, padding: size * 0.16, paddingTop: size * 0.3, gap: size * 0.12 }}>
      <View style={{ height: 1.75, backgroundColor: color, borderRadius: 1 }} />
      <View style={{ height: 1.75, backgroundColor: color, borderRadius: 1, width: '70%' }} />
    </View>
  );
}

export function PhotoIcon({ color, size = 22 }: { color: string; size?: number }) {
  const stroke = Math.max(1.75, size / 12);
  return (
    <View style={{ width: size, height: size * 0.82, borderWidth: stroke, borderColor: color, borderRadius: size * 0.16, overflow: 'hidden' }}>
      <View style={{ position: 'absolute', right: size * 0.16, top: size * 0.14, width: size * 0.18, height: size * 0.18, borderRadius: size, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: size * 0.06, bottom: -1, width: 0, height: 0, borderLeftWidth: size * 0.26, borderRightWidth: size * 0.26, borderBottomWidth: size * 0.36, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
    </View>
  );
}

export function ChatOutlineIcon({ color, size = 24 }: { color: string; size?: number }) {
  const stroke = Math.max(1.75, size / 12);
  const dot = size / 9;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size * 0.8, borderRadius: size * 0.36, borderWidth: stroke, borderColor: color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: dot * 0.9 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: color }} />
        ))}
      </View>
      {/* Solid tail: a corner triangle drawn with borders. */}
      <View style={{ position: 'absolute', left: size * 0.18, bottom: size * 0.02, width: 0, height: 0, borderTopWidth: size * 0.24, borderRightWidth: size * 0.2, borderTopColor: color, borderRightColor: 'transparent' }} />
    </View>
  );
}

export function BubblesIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', right: 0, top: size * 0.04, width: size * 0.62, height: size * 0.5, borderRadius: size * 0.22, backgroundColor: color, opacity: 0.5 }} />
      <View style={{ position: 'absolute', left: 0, bottom: size * 0.08, width: size * 0.74, height: size * 0.58, borderRadius: size * 0.26, backgroundColor: color }} />
    </View>
  );
}

function Star({ color, size, style }: { color: string; size: number; style: ViewStyle }) {
  const side = size / Math.SQRT2;
  const diamond = (squash: ViewStyle['transform']): ViewStyle => ({
    position: 'absolute',
    width: side,
    height: side,
    left: (size - side) / 2,
    top: (size - side) / 2,
    borderRadius: side * 0.08,
    backgroundColor: color,
    transform: squash,
  });
  return (
    <View style={[{ position: 'absolute', width: size, height: size }, style]}>
      <View style={diamond([{ scaleX: 0.34 }, { rotate: '45deg' }])} />
      <View style={diamond([{ scaleY: 0.34 }, { rotate: '45deg' }])} />
    </View>
  );
}

export function SparkleIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size }}>
      <Star color={color} size={size * 0.86} style={{ left: 0, bottom: 0 }} />
      <Star color={color} size={size * 0.38} style={{ right: 0, top: 0 }} />
    </View>
  );
}

export function ChatIcon({ color, holes, size = 24 }: { color: string; holes: string; size?: number }) {
  const dot = size / 8;
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ width: size, height: size * 0.8, borderRadius: size * 0.36, backgroundColor: color, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: dot * 0.9 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: dot, height: dot, borderRadius: dot, backgroundColor: holes }} />
        ))}
      </View>
      <View style={{ position: 'absolute', left: size * 0.16, bottom: size * 0.06, width: size * 0.26, height: size * 0.26, backgroundColor: color, transform: [{ rotate: '45deg' }], borderRadius: 2 }} />
    </View>
  );
}

/** Question mark in a circle. */
export function HelpIcon({ color, size = 24 }: { color: string; size?: number }) {
  const stroke = Math.max(1.75, size / 12);
  const mark = size * 0.22;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: stroke,
          borderColor: color,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: mark,
            height: mark * 0.95,
            borderWidth: stroke,
            borderColor: color,
            borderRadius: mark,
            borderBottomWidth: 0,
            marginBottom: size * 0.06,
          }}
        />
        <View style={{ width: stroke, height: size * 0.1, backgroundColor: color, borderRadius: stroke, marginTop: -size * 0.02 }} />
        <View style={{ width: stroke * 1.4, height: stroke * 1.4, borderRadius: stroke, backgroundColor: color, marginTop: size * 0.04 }} />
      </View>
    </View>
  );
}

/** Headset: band over two ear cups. */
export function HeadsetIcon({ color, size = 24 }: { color: string; size?: number }) {
  const stroke = Math.max(1.75, size / 12);
  const cup = size * 0.28;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.08,
          width: size * 0.72,
          height: size * 0.42,
          borderTopLeftRadius: size,
          borderTopRightRadius: size,
          borderWidth: stroke,
          borderBottomWidth: 0,
          borderColor: color,
        }}
      />
      <View style={{ flexDirection: 'row', width: size * 0.9, justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: size * 0.06 }}>
        <View style={{ width: cup, height: cup * 1.15, borderRadius: cup * 0.35, backgroundColor: color }} />
        <View style={{ width: cup, height: cup * 1.15, borderRadius: cup * 0.35, backgroundColor: color }} />
      </View>
    </View>
  );
}

/** Closed envelope. */
export function MailIcon({ color, size = 24 }: { color: string; size?: number }) {
  const stroke = Math.max(1.75, size / 12);
  const w = size;
  const h = size * 0.72;
  return (
    <View style={{ width: w, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: w, height: h, borderWidth: stroke, borderColor: color, borderRadius: size * 0.1, overflow: 'hidden' }}>
        <View
          style={{
            position: 'absolute',
            left: stroke * 0.5,
            top: stroke * 0.5,
            width: 0,
            height: 0,
            borderLeftWidth: (w - stroke) / 2,
            borderRightWidth: (w - stroke) / 2,
            borderTopWidth: h * 0.42,
            borderLeftColor: 'transparent',
            borderRightColor: 'transparent',
            borderTopColor: color,
          }}
        />
      </View>
    </View>
  );
}

/** Single filled star (reuses the diamond star used by SparkleIcon). */
export function StarIcon({ color, size = 24 }: { color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Star color={color} size={size} style={{ left: 0, top: 0 }} />
    </View>
  );
}
