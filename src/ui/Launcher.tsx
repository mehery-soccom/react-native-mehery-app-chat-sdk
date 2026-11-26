import { Animated, Pressable, View, type ViewStyle } from 'react-native';
import type { ResolvedConfig } from '../core/config';
import { useMehery, type LauncherProps } from '../react/context';
import { RefImage } from './RefImage';
import {
  BubblesIcon,
  ChatIcon,
  ChatOutlineIcon,
  HeadsetIcon,
  HelpIcon,
  MailIcon,
  SparkleIcon,
  StarIcon,
  Txt,
  useEntrance,
  usePressScale,
} from './primitives';

const MIN_TAP = 44;

/** The launcher's icon only, per config: built-in shape, your image, or nothing. */
export function LauncherGlyph({ launcher, pageBackground }: { launcher: ResolvedConfig['launcher']; pageBackground: string }) {
  const { icon, iconSize: size, iconColor: color, image, background } = launcher;
  if (image) return <RefImage src={image} height={size} width={size} />;
  if (icon === 'none') return null;
  if (icon === 'chat-outline') return <ChatOutlineIcon color={color} size={size} />;
  if (icon === 'bubbles') return <BubblesIcon color={color} size={size} />;
  if (icon === 'sparkle') return <SparkleIcon color={color} size={size} />;
  if (icon === 'help') return <HelpIcon color={color} size={size} />;
  if (icon === 'headset') return <HeadsetIcon color={color} size={size} />;
  if (icon === 'mail') return <MailIcon color={color} size={size} />;
  if (icon === 'star') return <StarIcon color={color} size={size} />;
  // Dots are "holes": they show whatever sits behind the bubble.
  return <ChatIcon color={color} holes={background === 'transparent' ? pageBackground : background} size={size} />;
}

/** Container + icon exactly as configured. The open/close animation reuses it, so it matches pixel for pixel. */
export function LauncherFace({ style }: { style?: ViewStyle }) {
  const { config } = useMehery();
  const l = config.launcher;
  return (
    <View
      style={[
        {
          width: l.size,
          height: l.size,
          borderRadius: l.radius,
          backgroundColor: l.background,
          borderWidth: l.borderWidth,
          borderColor: l.borderColor,
          alignItems: 'center',
          justifyContent: 'center',
        },
        l.shadow && { shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
        style,
      ]}
    >
      <LauncherGlyph launcher={l} pageBackground={config.colors.background} />
    </View>
  );
}

export function Launcher({ unread, onPress }: LauncherProps) {
  const { config } = useMehery();
  const entrance = useEntrance(true, { fromY: 16, fromScale: 0.6, delay: 250 });
  const press = usePressScale(0.9);
  const l = config.launcher;
  const slop = Math.max(0, (MIN_TAP - l.size) / 2);
  return (
    <Animated.View style={[entrance, { transform: [...entrance.transform, { scale: press.scale }] }]}>
      <Pressable
        testID="mehery-launcher"
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={slop}
        accessibilityRole="button"
        accessibilityLabel={unread ? `${config.strings.openChat}, ${config.strings.unreadCount.replace('{n}', String(unread))}` : config.strings.openChat}
      >
        <LauncherFace />
      </Pressable>
      {unread > 0 ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: l.shape === 'circle' || l.shape === 'none' ? l.size * 0.02 - 4 : -6,
            right: l.shape === 'circle' || l.shape === 'none' ? l.size * 0.02 - 4 : -6,
            minWidth: 20,
            height: 20,
            paddingHorizontal: 5,
            borderRadius: 10,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: config.colors.error,
            borderWidth: 2,
            borderColor: config.colors.background,
          }}
        >
          <Txt variant="caption" weight="bold" color="#FFFFFF" style={{ fontSize: 11, lineHeight: 13 }}>
            {unread > 9 ? '9+' : String(unread)}
          </Txt>
        </View>
      ) : null}
    </Animated.View>
  );
}
