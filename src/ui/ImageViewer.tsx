import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Image, PixelRatio, Pressable, ScrollView, StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { thumbnailUrl } from '../core/media';
import { ModalBackContext, useMehery } from '../react/context';
import { useSwipeDismiss } from './media/swipeDismiss';
import { CloseIcon, Txt } from './primitives';

/**
 * Full-screen photo. Swipe down (or up) to dismiss: the photo follows the finger, shrinks a
 * little and the backdrop fades, then it flies off or springs back. Pinch to zoom on iOS; while
 * zoomed, dragging pans the photo instead of dismissing. Tap or the close button also closes.
 * Several photos (one message's gallery): swipe sideways to page, with a "2 / 5" counter.
 *
 * Drawn as an overlay inside the chat, not a native Modal: the chat is itself a Modal, and on iOS
 * opening a second nested Modal after closing the first froze the whole app (blocked touches).
 */
// Screen-sized (not original-sized) photos decode and draw fast. The 240 pt grid thumbnail is
// already cached, so it paints instantly underneath while the screen-sized one loads.
const PLACEHOLDER_WIDTH = 240;
const sized = (url: string, width: number, proxy: boolean) => thumbnailUrl(url, Math.min(1440, Math.round(width * PixelRatio.get())), undefined, proxy);

export function ImageViewer({ gallery, onClose }: { gallery: { urls: string[]; index: number } | null; onClose(): void }) {
  const { config } = useMehery();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const zoom = useRef(1);
  const { drag, panHandlers, away } = useSwipeDismiss(onClose, () => zoom.current <= 1.01);

  const [page, setPage] = useState(0);
  const urls = gallery?.urls ?? [];

  const fade = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const modalBack = useContext(ModalBackContext);
  useEffect(() => {
    if (!gallery) return;
    drag.setValue(0);
    zoom.current = 1;
    setPage(gallery.index);
    gallery.urls.forEach((u, i) => Math.abs(i - gallery.index) <= 1 && Image.prefetch(sized(u, width, config.features.thumbnailProxy)).catch(() => {}));
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    // Android back closes the photo, not the chat. Inside the chat Modal back never reaches
    // BackHandler (the Modal's onRequestClose gets it), so take it there too.
    const back = () => {
      closeRef.current();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', back);
    if (modalBack) modalBack.current = back;
    return () => {
      sub.remove();
      if (modalBack?.current === back) modalBack.current = null;
      // This viewer stays mounted between opens (it renders null while closed). A swipe-down close
      // left drag at full screen height, so the next open mounted with the photo off screen and the
      // backdrop and close button at opacity 0 (an invisible layer over the chat) until the reset
      // above landed. Reset on close so every open mounts at rest.
      drag.setValue(0);
    };
  }, [gallery, drag, fade, modalBack]);

  if (!gallery) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000, opacity: fade }]}>
      <StatusBar barStyle="light-content" />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width, height, backgroundColor: '#000', opacity: away(0.96, 0) }} />
      <Animated.View style={{ flex: 1, transform: [{ translateY: drag }, { scale: away(1, 0.82) }] }} {...panHandlers}>
        <ScrollView
          testID="mehery-viewer-pager"
          horizontal
          pagingEnabled
          scrollEnabled={urls.length > 1}
          contentOffset={{ x: gallery.index * width, y: 0 }}
          // Pages move with the finger; neighbours are mounted and warmed as the page changes.
          onScroll={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / width);
            if (next === page || next < 0 || next >= urls.length) return;
            setPage(next);
            zoom.current = 1; // ponytail: a page left zoomed stays zoomed; only the current page's zoom is tracked
            [next - 1, next + 1].forEach((i) => urls[i] && Image.prefetch(sized(urls[i]!, width, config.features.thumbnailProxy)).catch(() => {}));
          }}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1, direction: 'ltr' }} // photos page left to right in every language
        >
          {urls.map((url, i) => Math.abs(i - page) > 1 ? <View key={`${i}-${url}`} style={{ width, height }} /> : (
            <ScrollView
              key={`${i}-${url}`}
              style={{ width, height }}
              contentContainerStyle={{ flexGrow: 1 }}
              maximumZoomScale={4}
              centerContent
              alwaysBounceVertical={false}
              scrollEventThrottle={16}
              onScroll={(e) => {
                zoom.current = e.nativeEvent.zoomScale ?? 1;
              }}
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
            >
              <Pressable
                testID="mehery-viewer"
                onPress={onClose}
                style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
                accessibilityLabel={urls.length > 1 ? `${config.strings.photo} ${i + 1} / ${urls.length}. ${config.strings.close}` : config.strings.close}
                accessibilityHint={config.strings.swipeToClose}
              >
                <Image source={{ uri: thumbnailUrl(url, PLACEHOLDER_WIDTH, undefined, config.features.thumbnailProxy) }} style={{ position: 'absolute', width, height: height * 0.8 }} resizeMode="contain" />
                <Image source={{ uri: sized(url, width, config.features.thumbnailProxy) }} style={{ width, height: height * 0.8 }} resizeMode="contain" fadeDuration={0} />
              </Pressable>
            </ScrollView>
          ))}
        </ScrollView>
      </Animated.View>
      {urls.length > 1 ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 12, start: 0, end: 0, height: 40, alignItems: 'center', justifyContent: 'center', opacity: away(1, 0) }}>
          <Txt testID="mehery-viewer-counter" variant="caption" weight="medium" color="rgba(255,255,255,0.85)" style={{ fontVariant: ['tabular-nums'] }}>
            {`${page + 1} / ${urls.length}`}
          </Txt>
        </Animated.View>
      ) : null}
      <Animated.View style={{ position: 'absolute', top: insets.top + 12, end: 16, opacity: away(1, 0) }}>
        <Pressable
          testID="mehery-viewer-close"
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={config.strings.close}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }}
        >
          <CloseIcon color="#FFFFFF" size={14} />
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
