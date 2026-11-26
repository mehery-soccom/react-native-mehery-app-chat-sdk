import { useMemo, useRef } from 'react';
import { Animated, Easing, PanResponder, useWindowDimensions, type GestureResponderHandlers } from 'react-native';
import { useMotionMode } from '../primitives';

const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 0.9;

/**
 * Full-screen viewers' swipe down (or up) to dismiss: the content follows the finger, then flies
 * off past 120 pt or a flick, or springs back. `away(rest, gone)` interpolates a value from at
 * rest to fully swiped (for the backdrop fade and the shrink). `canSwipe` can veto (e.g. zoomed in).
 */
export function useSwipeDismiss(
  onDismiss: () => void,
  canSwipe: () => boolean = () => true,
): { drag: Animated.Value; panHandlers: GestureResponderHandlers; away: (atRest: number, gone: number) => Animated.AnimatedInterpolation<number> } {
  const mode = useMotionMode();
  const { height } = useWindowDimensions();
  const drag = useRef(new Animated.Value(0)).current;
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const can = useRef(canSwipe);
  can.current = canSwipe;

  const pan = useMemo(() => {
    const settle = () => Animated.spring(drag, { toValue: 0, stiffness: 260, damping: 24, useNativeDriver: true }).start();
    const isSwipe = (dx: number, dy: number, touches: number) =>
      touches === 1 && can.current() && Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx) * 1.4;
    return PanResponder.create({
      // Capture so a ScrollView (zoom, pager) doesn't swallow the drag.
      onMoveShouldSetPanResponderCapture: (_, g) => isSwipe(g.dx, g.dy, g.numberActiveTouches),
      onMoveShouldSetPanResponder: (_, g) => isSwipe(g.dx, g.dy, g.numberActiveTouches),
      onPanResponderMove: (_, g) => drag.setValue(g.dy),
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dy) > DISMISS_DISTANCE || Math.abs(g.vy) > DISMISS_VELOCITY) {
          const direction = Math.sign(g.dy || g.vy) || 1;
          Animated.timing(drag, {
            toValue: direction * height,
            duration: mode === 'none' ? 0 : 200,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
            // Only a fly-off that ran to the end closes. A stopped one (finger down again, the
            // viewer unmounted, a new photo opened) must not close the viewer under a live touch.
          }).start(({ finished }) => finished && dismiss.current());
        } else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [drag, height, mode]);

  const away = (atRest: number, gone: number) =>
    drag.interpolate({ inputRange: [-height * 0.6, 0, height * 0.6], outputRange: [gone, atRest, gone], extrapolate: 'clamp' });

  return { drag, panHandlers: pan.panHandlers, away };
}
