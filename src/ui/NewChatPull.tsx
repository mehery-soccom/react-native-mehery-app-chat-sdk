import { useMemo, useRef, useState, type RefObject } from 'react';
import { Animated, Easing, View, type GestureResponderEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useMehery } from '../react/context';
import { isFlick, resisted } from './newChatPullMath';
import { CheckIcon, Txt, useEntrance, useMotionMode } from './primitives';

const SIZE = 28;
/** Pull distance (after resistance) where the ring has closed and releasing starts a new chat. */
const FULL = 76;
const DOTS = 12;
const START = 8;
/** Dead zone before the pull owns the finger. */
const ACTIVATE = 16;

/**
 * Pull up on the latest messages. The thread follows the finger with growing resistance and a
 * ring above the composer fills; once it closes it turns into a tick, and releasing starts a
 * new chat. A fast flick is left to the list so reading history still coasts.
 */
export function usePullNewChat(
  enabled: boolean,
  onCommit: () => void,
  listRef: RefObject<{ scrollToOffset(options: { offset: number; animated?: boolean }): void } | null>,
) {
  const { config } = useMehery();
  const mode = useMotionMode();
  const pull = useRef(new Animated.Value(0)).current;
  const shift = useRef(new Animated.Value(0)).current;
  const enabledRef = useRef(enabled);
  const commitRef = useRef(onCommit);
  const modeRef = useRef(mode);
  const atBottom = useRef(true);
  const pulling = useRef(false);
  const live = useRef(false);
  const armed = useRef(false);
  const touch = useRef<{ y: number; atBottom: boolean; lastY: number; lastT: number; flicked: boolean } | null>(null);
  enabledRef.current = enabled;
  commitRef.current = onCommit;
  modeRef.current = mode;

  const reveal = useMemo(() => pull.interpolate({ inputRange: [4, 20], outputRange: [0, 1], extrapolate: 'clamp' }), [pull]);
  // "Release now" state lives in React, not in a native-driven fade: on the New Architecture that
  // fade was never applied, so the tick stayed invisible.
  const [ready, setReady] = useState(false);

  const api = useRef({
    apply(_distance: number, _manual?: boolean) {},
    finish() {},
  });

  api.current.apply = (distance: number, manual = true) => {
    const damped = resisted(distance);
    pull.setValue(damped);
    shift.setValue(manual ? damped : 0);
    // Only a finger-owned pull can arm. Bounce may reveal the ring but never commit.
    if (manual) {
      armed.current = damped >= FULL;
      setReady(armed.current);
    }
  };

  api.current.finish = () => {
    const commit = armed.current && enabledRef.current && pulling.current;
    armed.current = false;
    setReady(false);
    pulling.current = false;
    live.current = false;
    if (commit) {
      pull.setValue(0);
      shift.setValue(0);
      commitRef.current();
      return;
    }
    const glide = modeRef.current === 'spring';
    Animated.parallel([
      glide
        ? Animated.spring(pull, { toValue: 0, useNativeDriver: true, stiffness: 180, damping: 27, mass: 0.9 })
        : Animated.timing(pull, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      glide
        ? Animated.spring(shift, { toValue: 0, useNativeDriver: true, stiffness: 180, damping: 27, mass: 0.9 })
        : Animated.timing(shift, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    atBottom.current = y <= 16;
    // Keep the thread parked on the latest messages while the pull owns the finger.
    if (pulling.current && y > 1) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      return;
    }
    // iOS rubber-band: nudge the ring without closing it. A flick's bounce must never commit.
    if (!pulling.current && y < -6 && enabledRef.current && !touch.current?.flicked) {
      live.current = true;
      api.current.apply(Math.min(-y, FULL - 8), false);
    }
  };

  const onScrollEndDrag = () => {
    // Bounce-only release: spring the ring back. Commit only happens from the finger path.
    if (live.current && !pulling.current) api.current.finish();
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    touch.current = {
      y: e.nativeEvent.pageY,
      atBottom: atBottom.current,
      lastY: e.nativeEvent.pageY,
      lastT: Date.now(),
      flicked: false,
    };
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    const start = touch.current;
    if (!start?.atBottom || !enabledRef.current || start.flicked) return;
    const y = e.nativeEvent.pageY;
    const up = start.y - y;
    const now = Date.now();
    const speed = Math.abs(start.lastY - y) / Math.max(8, now - start.lastT);
    start.lastY = y;
    start.lastT = now;
    // Finger moving down is a normal scroll. Up, from the latest messages, may be a pull.
    if (up < ACTIVATE) return;
    if (!pulling.current) {
      if (isFlick(up, speed)) {
        start.flicked = true;
        return;
      }
      pulling.current = true;
      live.current = true;
    }
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
    api.current.apply(up, true);
  };

  const onTouchEnd = () => {
    const was = pulling.current;
    touch.current = null;
    if (was) api.current.finish();
  };

  const accent = config.colors.accent;

  const indicator = (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 12, zIndex: 5, alignItems: 'center', opacity: reveal }}
    >
      <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
        {ready ? <ReadyTick color={accent} tick={config.colors.onAccent} /> : <Ring pull={pull} color={accent} />}
      </View>
      <Txt variant="caption" weight={ready ? 'bold' : 'regular'} color={ready ? accent : config.colors.muted} style={{ marginTop: 6 }}>
        {config.strings.newChat}
      </Txt>
    </Animated.View>
  );

  return {
    shiftStyle: { transform: [{ translateY: Animated.multiply(shift, -1) }] },
    indicator: enabled ? indicator : null,
    onScroll,
    onScrollEndDrag,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel: onTouchEnd,
  };
}

/** Solid circle with a white tick; pops in with a light spring when the pull is ready to release. */
function ReadyTick({ color, tick }: { color: string; tick: string }) {
  const pop = useEntrance(true, { fromY: 0, fromScale: 0.5 });
  return (
    <Animated.View style={[{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }, pop]}>
      <CheckIcon color={tick} size={14} />
    </Animated.View>
  );
}

/** A ring of dots that lights up one by one as the pull grows, closing the circle at FULL. */
function Ring({ pull, color }: { pull: Animated.Value; color: string }) {
  const step = (FULL - START) / DOTS;
  return (
    <>
      {Array.from({ length: DOTS }, (_, i) => {
        const a = (i / DOTS) * 2 * Math.PI - Math.PI / 2;
        const at = START + i * step;
        const lit = pull.interpolate({ inputRange: [at, at + step], outputRange: [0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              width: 4,
              height: 4,
              borderRadius: 2,
              backgroundColor: color,
              left: SIZE / 2 - 2 + Math.cos(a) * 11,
              top: SIZE / 2 - 2 + Math.sin(a) * 11,
              opacity: lit,
              transform: [{ scale: lit }],
            }}
          />
        );
      })}
    </>
  );
}
