import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import type { ConnectionStatus } from '../types';
import { useChatState, useMehery, type HeaderProps } from '../react/context';
import { CloseIcon, Txt } from './primitives';
import { RefImage } from './RefImage';

/**
 * Header with optional client branding:
 *  left:   [avatar][brand][title]              [close]
 *  center: [avatar]        [brand (title)]     [close]   title hidden unless brand.showTitle
 *  right:  [avatar][title]              [brand][close]
 * If the brand image can't be shown, the title takes its place.
 */
export function Header({ title, logo, brand, onClose }: HeaderProps) {
  const { config } = useMehery();
  const { userName } = useChatState();
  const { background, text } = config.header;
  const [brandFailed, setBrandFailed] = useState(false);
  useEffect(() => setBrandFailed(false), [brand?.image]);
  const hasBrand = !!brand && !brandFailed;
  const position = hasBrand ? brand.position : 'left';
  const showTitle = !hasBrand || brand.showTitle;
  // Mirror the close control on both sides so the brand stays optically centred.
  // With no close button, centre across the full bar.
  const centerInset = onClose ? 56 : 0;
  // When the logo replaces the title, the logo carries the title for screen readers.
  const brandImage = hasBrand ? (
    <View accessible={!showTitle} accessibilityRole={showTitle ? undefined : 'header'} accessibilityLabel={showTitle ? undefined : title}>
      <RefImage src={brand.image} height={brand.height} {...(brand.width ? { width: brand.width } : {})} onFail={() => setBrandFailed(true)} />
    </View>
  ) : null;
  const titleText = showTitle ? (
    <Txt
      variant="title"
      weight="bold"
      color={text}
      numberOfLines={1}
      accessibilityRole="header"
      style={{ flexShrink: 1, includeFontPadding: false, textAlignVertical: 'center' }}
    >
      {title}
    </Txt>
  ) : null;
  return (
    <View
      style={{
        height: 56,
        flexDirection: 'row',
        alignItems: 'center',
        gap: config.spacing * 2,
        paddingHorizontal: config.spacing * 4,
        backgroundColor: background,
        borderBottomWidth: 1,
        borderBottomColor: config.colors.border,
      }}
    >
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: config.spacing * 2, minWidth: 0 }}>
        {logo ? <RefImage src={logo} height={30} round /> : null}
        {position === 'left' ? brandImage : null}
        {position !== 'center' ? (
          <View style={{ flexShrink: 1 }}>
            {titleText}
            <Txt variant="caption" color={config.colors.muted} numberOfLines={1} accessibilityLiveRegion="polite">
              {userName ? `${config.strings.botTalking} · ${userName}` : config.strings.botTalking}
            </Txt>
          </View>
        ) : null}
      </View>
      {position === 'center' ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: centerInset, right: centerInset, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: config.spacing * 2 }}
        >
          {brandImage}
          {titleText}
        </View>
      ) : null}
      {position === 'right' ? brandImage : null}
      {onClose ? (
        <Pressable
          testID="mehery-close"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={config.strings.close}
          hitSlop={8}
          style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? config.colors.surface : 'transparent' })}
        >
          <CloseIcon color={text} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Slim status line under the header. "Connecting" waits a beat so quick connects don't flicker. */
export function ConnectionBanner({ connection }: { connection: ConnectionStatus }) {
  const { config, client } = useMehery();
  const [shown, setShown] = useState<ConnectionStatus>('online');
  const height = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (connection === 'online') return setShown('online');
    const t = setTimeout(() => setShown(connection), connection === 'connecting' ? 1200 : 0);
    return () => clearTimeout(t);
  }, [connection]);

  useEffect(() => {
    Animated.timing(height, { toValue: shown === 'online' ? 0 : 28, duration: 200, useNativeDriver: false }).start();
  }, [shown, height]);

  return (
    <Animated.View style={{ height, overflow: 'hidden', backgroundColor: config.colors.surface, justifyContent: 'center' }} accessibilityLiveRegion="polite">
      {shown === 'offline' ? (
        <Pressable testID="mehery-reconnect" onPress={() => client.reconnect()} accessibilityRole="button" style={{ height: 28, justifyContent: 'center' }}>
          <Txt variant="caption" color={config.colors.muted} style={{ textAlign: 'center' }}>
            {`${config.strings.offline} · ${config.strings.reconnect}`}
          </Txt>
        </Pressable>
      ) : shown === 'connecting' ? (
        <Txt variant="caption" color={config.colors.muted} style={{ textAlign: 'center' }}>
          {config.strings.connecting}
        </Txt>
      ) : null}
    </Animated.View>
  );
}
