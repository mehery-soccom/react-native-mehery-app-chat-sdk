import { useContext, useEffect, useRef, useState, type ComponentRef, type ReactNode, type RefObject } from 'react';
import { AccessibilityInfo, Keyboard, LayoutAnimation, Platform, Pressable, View, type KeyboardEvent, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics, useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';
import { DismissGestureContext, useChatState, useMehery } from '../react/context';
import { Composer } from './Composer';
import { ContainedRender, Slot } from './Guard';
import { ConnectionBanner, Header } from './Header';
import { Txt } from './primitives';
import { ImageViewer } from './ImageViewer';
import { MessageList } from './MessageList';

export interface MeheryChatProps {
  style?: StyleProp<ViewStyle>;
  /** Screen edges to pad for. Embedded default: ['bottom'] (your screen owns the top). */
  edges?: ('top' | 'bottom')[];
  /** Shows a close button in the header. In the built-in modal this closes the chat. */
  onClose?: () => void;
}

/** The chat screen. Embed it anywhere, or let the provider present it as a modal. */
export function MeheryChat(props: MeheryChatProps) {
  return (
    <EnsureSafeArea>
      <ContainedRender where="Chat" fallback={(retry) => <ChatFallback onRetry={retry} {...(props.onClose ? { onClose: props.onClose } : {})} />}>
        <ChatScreen {...props} />
      </ContainedRender>
    </EnsureSafeArea>
  );
}

/** Shown if the chat screen itself fails to render: never a red screen in the host app. */
function ChatFallback({ onRetry, onClose }: { onRetry(): void; onClose?: () => void }) {
  const { config } = useMehery();
  const insets = useInsets();
  const s = config.strings;
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, paddingTop: insets.top + 32, backgroundColor: config.colors.background }}>
      <Txt variant="title" weight="bold" style={{ textAlign: 'center' }}>
        {s.chatUnavailable}
      </Txt>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={{ height: 44, paddingHorizontal: 22, borderRadius: 22, justifyContent: 'center', backgroundColor: config.colors.accent }}
      >
        <Txt weight="medium" color={config.colors.onAccent}>
          {s.tryAgain}
        </Txt>
      </Pressable>
      {onClose ? (
        <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
          <Txt color={config.colors.muted}>{s.close}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

function ChatScreen({ style, edges = ['bottom'], onClose }: MeheryChatProps) {
  const { client, config, components, rtl } = useMehery();
  const { connection, messages } = useChatState();
  const insets = useSafeAreaInsets();
  const [gallery, setGallery] = useState<{ urls: string[]; index: number } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const body = useRef<ComponentRef<typeof View>>(null);
  const keyboard = useKeyboardOverlap(body);
  const bottomInset = keyboard > 0 || !edges.includes('bottom') ? 0 : insets.bottom;

  useEffect(() => {
    client.setVisible(true);
    void client.start();
    return () => client.setVisible(false);
  }, [client]);

  // Screen readers hear a new reply without having to find it in the list.
  const lastSeen = useRef(messages[messages.length - 1]?.id);
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.id === lastSeen.current) return;
    lastSeen.current = last.id;
    if (last.author === 'bot' && last.fresh && last.text) AccessibilityInfo.announceForAccessibility(`${config.header.title}: ${last.text}`);
  }, [messages, config.header.title]);

  const showHeader = config.features.header;
  const dismissGesture = useContext(DismissGestureContext);
  return (
    <View style={[{ flex: 1, direction: rtl ? 'rtl' : 'ltr', backgroundColor: showHeader ? config.header.background : config.colors.background }, style]}>
      {/* The header strip (incl. the status-bar area) is the swipe-to-dismiss handle in the modal. */}
      {/* collapsable={false}: a padding-only View is flattened away on the New Architecture, and its touch handlers never fire. */}
      <View {...(dismissGesture ?? {})} collapsable={false} style={{ paddingTop: edges.includes('top') ? insets.top : 0 }}>
        {showHeader ? (
          <Slot
            name="Header"
            custom={components.Header}
            builtIn={Header}
            props={{
              title: config.header.title,
              connection,
              ...(config.header.logo ? { logo: config.header.logo } : {}),
              ...(config.header.brand ? { brand: config.header.brand } : {}),
              ...(config.features.closeButton && onClose ? { onClose } : {}),
            }}
          />
        ) : null}
      </View>
      <View ref={body} style={{ flex: 1, backgroundColor: config.colors.background, paddingBottom: keyboard }}>
        <ConnectionBanner connection={connection} />
        <MessageList
          onImagePress={(url, urls) => setGallery({ urls, index: Math.max(0, urls.indexOf(url)) })}
          onNewChat={() => {
            void client.newChat();
            setFocusTick((n) => n + 1);
          }}
        />
        <Composer bottomInset={bottomInset} focusTick={focusTick} />
      </View>
      <ImageViewer gallery={gallery} onClose={() => setGallery(null)} />
    </View>
  );
}

/**
 * How far the keyboard covers this view, measured on screen. KeyboardAvoidingView measures
 * relative to its parent, so it under-pads under headers and in modals; this works anywhere
 * (modal, embedded under a navigation header, Android edge-to-edge) with no offset to configure.
 */
function useKeyboardOverlap(ref: RefObject<ComponentRef<typeof View> | null>): number {
  const [overlap, setOverlap] = useState(0);
  useEffect(() => {
    const apply = (e: KeyboardEvent | null) => {
      const update = (value: number) => {
        if (Platform.OS === 'ios' && e?.duration) {
          LayoutAnimation.configureNext({ duration: e.duration, update: { type: LayoutAnimation.Types.keyboard } });
        }
        setOverlap(value);
      };
      if (!e) return update(0);
      ref.current?.measureInWindow((_x, y, _w, height) => {
        // The view's own bottom padding is the old overlap, so measure the full box.
        update(Math.max(0, Math.round(y + height - e.endCoordinates.screenY)));
      });
    };
    const subs =
      Platform.OS === 'ios'
        ? [Keyboard.addListener('keyboardWillChangeFrame', apply)]
        : [Keyboard.addListener('keyboardDidShow', apply), Keyboard.addListener('keyboardDidHide', () => apply(null))];
    return () => subs.forEach((s) => s.remove());
  }, [ref]);
  return overlap;
}

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The host's live safe-area insets, or the device's launch-time insets if the app has no SafeAreaProvider. */
export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets ?? NO_INSETS;
}

/**
 * Makes insets available without mounting a native view (a SafeAreaProvider would add a flex:1
 * view to the host's layout). Wrap your app in SafeAreaProvider to also track rotation.
 */
export function EnsureSafeArea({ children }: { children: ReactNode }) {
  const existing = useContext(SafeAreaInsetsContext);
  if (existing) return <>{children}</>;
  return <SafeAreaInsetsContext.Provider value={initialWindowMetrics?.insets ?? NO_INSETS}>{children}</SafeAreaInsetsContext.Provider>;
}
