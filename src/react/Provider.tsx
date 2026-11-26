import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, AppState, Easing, Keyboard, Linking, Modal, PanResponder, StatusBar, StyleSheet, View, useColorScheme, useWindowDimensions } from 'react-native';
import { safeCall } from '../core/safe';
import { redactUrl, safeLink } from '../core/security';
import { Slot } from '../ui/Guard';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ChatClient, type ClientEvents } from '../core/client';
import { contrast, resolveConfig, type AttachmentType, type MeheryConfig } from '../core/config';
import type { ChatButton, ChatTransport, MeheryError, PickedFile } from '../types';
import { Launcher, LauncherFace } from '../ui/Launcher';
import { EnsureSafeArea, MeheryChat, useInsets } from '../ui/MeheryChat';
import { useMotionMode, useReduceMotionSetting } from '../ui/primitives';
import {
  DismissGestureContext,
  ModalBackContext,
  MeheryContext,
  useChatState,
  useMehery,
  type BrandAsset,
  type MeheryComponents,
  type MeheryContextValue,
  type SvgRenderer,
  type VideoRenderer,
  type AudioRenderer,
  type VoiceRecorder,
} from './context';

export interface MeheryChatProviderProps extends ClientEvents {
  /** The backend connection. `createMockTransport()` previews the UI without credentials. */
  transport: ChatTransport;
  /**
   * Include the raw `cause` (error objects, rejected payloads) in `onError`. Default off: a cause can carry
   * message text or URLs, which you may not want in a crash reporter.
   */
  debug?: boolean;
  /** Appearance and behaviour JSON (see MeheryConfig). Fetch it from anywhere and pass it in. */
  config?: MeheryConfig | null;
  /** Force light or dark. Default: follows the device. */
  colorScheme?: 'light' | 'dark';
  /** Language for the SDK's own text, e.g. "ar-KW". Default: the device language. */
  locale?: string;
  /** Replace built-in pieces with your own components. */
  components?: Partial<MeheryComponents>;
  /** Opens a picker for attachments. Without it the attach button is hidden. */
  pickAttachment?: (type: AttachmentType) => Promise<PickedFile | null>;
  /** Records voice notes (the chat draws the recording bar). Without it the mic is hidden. The file goes through `sendFile`. */
  voiceRecorder?: VoiceRecorder;
  /**
   * Images bundled in your app, used from the config as "asset:<name>":
   * `assets={{ wordmark: require('./logo.png'), mark: LogoSvg }}`.
   */
  assets?: Record<string, BrandAsset>;
  /** Draws SVG URLs, e.g. `renderSvg={(p) => <SvgUri {...p} />}` with react-native-svg. Without it SVG URLs fall back to text. */
  renderSvg?: SvgRenderer;
  /** Draws video in the full-screen player (see VideoRenderer), e.g. with react-native-video. Without it videos open outside the app. */
  renderVideo?: VideoRenderer;
  /** Plays voice notes and audio (see AudioRenderer). Without it audio opens outside the app. */
  renderAudio?: AudioRenderer;
  /** Return true if you handled the link (e.g. navigated in-app); otherwise the SDK opens it. */
  onLinkPress?: (url: string) => boolean | void;
  /**
   * Extra URL schemes bot links may use, e.g. `['myapp']` for deep links. By default only https
   * (http is upgraded), mailto and tel are opened; anything else is blocked and reported as LINK_BLOCKED.
   */
  allowedLinkSchemes?: string[];
  /** Called when the chat finishes opening or closing. */
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

const NO_COMPONENTS: Partial<MeheryComponents> = {};
const NO_ASSETS: Record<string, BrandAsset> = {};

export function MeheryChatProvider(props: MeheryChatProviderProps) {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  // A new `transport` (a different customer, a changed channel) is a new conversation: the old client is
  // stopped by the cleanup below and the chat starts again on the new one.
  const client = useMemo(
    () =>
      new ChatClient(props.transport, {
        onMessageReceived: (m) => latest.current.onMessageReceived?.(m),
        onUnreadCountChange: (n) => latest.current.onUnreadCountChange?.(n),
        onConnectionChange: (c) => latest.current.onConnectionChange?.(c),
        onError: (e) => latest.current.onError?.(latest.current.debug ? e : redactError(e)),
      }),
    [props.transport],
  );

  const system = useColorScheme();
  const scheme = props.colorScheme ?? (system === 'dark' ? 'dark' : 'light');
  const locale = props.locale ?? deviceLocale();
  const { config, warnings } = useMemo(() => {
    try {
      return resolveConfig(props.config, scheme, locale);
    } catch (cause) {
      // Should be impossible, but a bad config must never stop the chat: fall back to defaults.
      return { ...resolveConfig(undefined, scheme, locale), warnings: [`config could not be read (${String(cause)}); using defaults`] };
    }
  }, [props.config, scheme, locale]);
  const warningKey = warnings.join('\n');
  useEffect(() => {
    if (!warningKey) return;
    if (__DEV__) console.warn(`[react-native-mehery-chat]\n${warningKey}`);
    client.report({ code: 'CONFIG_INVALID', message: warningKey });
  }, [warningKey]);

  const rtl = RTL_LANGS.test(locale);
  const reduceMotion = useReduceMotionSetting();
  const modal = config.behaviour.presentation === 'modal';
  const [isOpen, setOpen] = useState(modal && config.behaviour.autoOpen);
  // True from the first frame of opening until the last frame of closing.
  const [windowUp, setWindowUp] = useState(isOpen);
  const open = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const openLink = useCallback(
    (raw: string) => {
      const url = safeLink(raw, latest.current.allowedLinkSchemes);
      if (!url) {
        client.report({ code: 'LINK_BLOCKED', message: `Blocked a link: ${redactUrl(raw)}` });
        return;
      }
      let handled = false;
      try {
        handled = latest.current.onLinkPress?.(url) === true;
      } catch (cause) {
        client.report({ code: 'UNKNOWN', message: 'onLinkPress threw; opening the link instead', cause });
      }
      if (!handled) Linking.openURL(url).catch((cause) => client.report({ code: 'UNKNOWN', message: `Could not open ${redactUrl(url)}`, cause }));
    },
    [client],
  );
  useEffect(() => () => client.stop(), [client]);
  useEffect(() => {
    client.thinkingTimeoutMs = config.features.thinkingTimeoutMs;
  }, [client, config.features.thinkingTimeoutMs]);
  useEffect(() => {
    client.setFilePolicy({ types: config.features.attachments, maxMB: config.features.maxAttachmentMB });
  }, [client, config.features.attachments, config.features.maxAttachmentMB]);
  // Back in the foreground while offline: try again straight away instead of waiting for the backoff.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && client.getState().connection === 'offline') client.reconnect();
    });
    return () => sub.remove();
  }, [client]);

  // Adapters are read through `latest`, so passing a new inline function on every render doesn't rebuild the chat.
  const hasPick = !!props.pickAttachment;
  const hasRecorder = !!props.voiceRecorder;
  const hasSvg = !!props.renderSvg;
  const hasVideo = !!props.renderVideo;
  const hasAudio = !!props.renderAudio;
  const pickAttachment = useMemo(() => (hasPick ? (t: AttachmentType) => latest.current.pickAttachment!(t) : undefined), [hasPick]);
  const voiceRecorder = useMemo<VoiceRecorder | undefined>(
    () => (hasRecorder ? { start: () => latest.current.voiceRecorder!.start(), stop: () => latest.current.voiceRecorder!.stop(), cancel: () => latest.current.voiceRecorder!.cancel() } : undefined),
    [hasRecorder],
  );
  const renderSvg = useMemo<SvgRenderer | undefined>(() => (hasSvg ? (p) => latest.current.renderSvg!(p) : undefined), [hasSvg]);
  const renderVideo = useMemo<VideoRenderer | undefined>(() => (hasVideo ? (p) => latest.current.renderVideo!(p) : undefined), [hasVideo]);
  const renderAudio = useMemo<AudioRenderer | undefined>(() => (hasAudio ? (p) => latest.current.renderAudio!(p) : undefined), [hasAudio]);

  const value = useMemo<MeheryContextValue>(
    () => ({
      client,
      config,
      components: props.components ?? NO_COMPONENTS,
      reduceMotion,
      isOpen,
      open,
      close,
      openLink,
      ...(pickAttachment ? { pickAttachment } : {}),
      ...(voiceRecorder ? { voiceRecorder } : {}),
      rtl,
      locale,
      assets: props.assets ?? NO_ASSETS,
      ...(renderSvg ? { renderSvg } : {}),
      ...(renderVideo ? { renderVideo } : {}),
      ...(renderAudio ? { renderAudio } : {}),
    }),
    [client, config, props.components, reduceMotion, isOpen, open, close, openLink, pickAttachment, voiceRecorder, rtl, locale, props.assets, renderSvg, renderVideo, renderAudio],
  );

  return (
    <MeheryContext.Provider value={value}>
      {/* The host's tree is rendered as is: no wrapper view, no layout direction forced on it. */}
      {props.children}
      {modal && config.behaviour.launcher ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <LauncherSlot hidden={windowUp} />
        </View>
      ) : null}
      {modal ? (
        <ChatWindow
          onSettled={(up) => {
            setWindowUp(up);
            safeCall(latest.current.onOpenChange, up);
          }}
        />
      ) : null}
    </MeheryContext.Provider>
  );
}

/** What a custom slot component needs to match the chat: resolved colours, fonts, spacing and strings. */
export function useMeheryTheme() {
  return useMehery().config;
}

/** What `useMeheryChat()` returns. */
export type UseMeheryChatResult = ReturnType<typeof useMeheryChat>;

/** Conversation state plus actions, for custom UIs or your own "Help" buttons. */
export function useMeheryChat() {
  const { client, isOpen, open, close } = useMehery();
  const state = useChatState();
  return useMemo(
    () => ({
      ...state,
      isOpen,
      open,
      close,
      send: (text: string) => client.send(text),
      sendQuickReply: (button: ChatButton) => client.sendQuickReply(button),
      sendFile: (file: PickedFile) => client.sendFile(file),
      retry: (id: string) => client.retry(id),
      newChat: () => client.newChat(),
      /** Logout: stops the chat and wipes the stored guest/user session from this device. Mount a new provider to chat again. */
      logout: () => client.logout(),
    }),
    [state, isOpen, open, close, client],
  );
}

/** Where the launcher sits on screen; the chat window grows out of exactly this box. */
function useLauncherFrame() {
  const { config } = useMehery();
  const { width, height } = useWindowDimensions();
  const insets = useInsets();
  const l = config.launcher;
  const x = l.position === 'bottom-left' ? insets.left + l.margin : width - insets.right - l.margin - l.size;
  return { x, y: height - insets.bottom - l.margin - l.size, size: l.size, radius: l.radius };
}

function LauncherSlot({ hidden }: { hidden: boolean }) {
  return (
    <EnsureSafeArea>
      <PositionedLauncher hidden={hidden} />
    </EnsureSafeArea>
  );
}

function PositionedLauncher({ hidden }: { hidden: boolean }) {
  const { components, open } = useMehery();
  const { unread } = useChatState();
  const frame = useLauncherFrame();
  // Stays mounted while the chat is up (just hidden), so it doesn't replay its entrance on close.
  return (
    <View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={{ position: 'absolute', left: frame.x, top: frame.y, opacity: hidden ? 0 : 1 }}
    >
      <Slot name="Launcher" custom={components.Launcher} builtIn={Launcher} props={{ unread, onPress: open }} />
    </View>
  );
}

/**
 * Apple-style open/close: the window grows out of the launcher into full screen and shrinks back
 * into it. Frame, corner radius and content scale move together on one critically damped spring
 * (no overshoot). The launcher's face cross-fades out as the chat fades in, so frame 0 is the
 * launcher itself. Reduce Motion swaps the zoom for a cross-fade, like iOS.
 */
function ChatWindow({ onSettled }: { onSettled(up: boolean): void }) {
  const { isOpen, close, config, rtl } = useMehery();
  const mode = useMotionMode();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useInsets();
  const from = useLauncherFrame();
  const [mounted, setMounted] = useState(isOpen);
  const p = useRef(new Animated.Value(isOpen ? 1 : 0)).current;
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const modalBack = useRef<(() => boolean) | null>(null);

  // Swipe down on the header: the window follows the finger, then either flies back into the
  // launcher (past 110 pt or a flick) or springs back. Like swiping an app home on iOS.
  const drag = useRef(new Animated.Value(0)).current;
  const dismissGesture = useMemo(() => {
    const back = () => Animated.spring(drag, { toValue: 0, stiffness: 180, damping: 27, mass: 1, useNativeDriver: false }).start();
    return PanResponder.create({
      // Claim header touches at start. Waiting for a move doesn't work: an ancestor takes the
      // touch first and the header is never asked again. Bubble order means the close button,
      // being deeper, still gets its own taps.
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => Keyboard.dismiss(),
      onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        back();
        if (g.dy > 110 || g.vy > 0.8) close();
      },
      onPanResponderTerminate: back,
    }).panHandlers;
  }, [drag, close]);

  // Opening waits until the window is actually on screen (Modal onShow + one frame for layout):
  // starting on mount loses the first ~200 ms to the chat's first render and the zoom "jumps".
  const [shown, setShown] = useState(false);
  // Fully open: the frame is rendered as plain numbers. JS-driven layout animation updates the
  // native view directly, so React's layout tree can still hold the launcher-sized frame and touch
  // targeting goes wrong (e.g. the header swipe never fires). Re-rendering at rest re-syncs it.
  const [atRest, setAtRest] = useState(false);
  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      settled.current(true);
      if (!shown) return;
    } else {
      setAtRest(false);
    }
    const toValue = isOpen ? 1 : 0;
    const anim =
      mode === 'spring'
        ? // Critically damped (ζ ≈ 1, ~0.47 s response): no overshoot, like iOS app zooms.
          Animated.spring(p, { toValue, stiffness: 180, damping: 27, mass: 1, useNativeDriver: false, restSpeedThreshold: 0.002, restDisplacementThreshold: 0.002 })
        : Animated.timing(p, { toValue, duration: mode === 'none' ? 0 : 220, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    let frame = 0;
    frame = requestAnimationFrame(() =>
      anim.start(({ finished }) => {
        if (!finished) return;
        if (isOpen) setAtRest(true);
        else {
          setMounted(false);
          setShown(false);
          settled.current(false);
        }
      }),
    );
    return () => {
      cancelAnimationFrame(frame);
      anim.stop();
    };
  }, [isOpen, shown, mode, p]);

  // The Modal itself stays mounted and is hidden with `visible={false}`. Unmounting a visible
  // Modal skips iOS's proper dismissal: an invisible presented screen lingered on top and hid the
  // whole app (chat and host) from VoiceOver/accessibility after the chat was reopened.
  if (!mounted) return <Modal visible={false} transparent animationType="none" />;

  const zoom = mode === 'spring';
  const range = (output: number[], input = [0, 1]) => p.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });
  const dragRange = (output: number[], input: number[]) => drag.interpolate({ inputRange: input, outputRange: output, extrapolate: 'clamp' });
  const l = config.launcher;
  // While swiping the header down the window rounds its corners like a card being lifted.
  const dragRadius = dragRange([0, 36], [0, 80]);
  const frame = zoom && !atRest
    ? {
        left: range([from.x, 0]),
        top: range([from.y, 0]),
        width: range([from.size, W]),
        height: range([from.size, H]),
        // Ends on the display's own curve, then squares off once it fills the screen.
        borderRadius: Animated.add(range([from.radius, 44, 0], [0, 0.92, 1]), dragRadius),
      }
    : { left: 0, top: 0, width: W, height: H, borderRadius: dragRadius };
  const lightHeader = contrast(config.header.background, '#000000') > contrast(config.header.background, '#FFFFFF');

  return (
    <Modal visible transparent animationType="none" onRequestClose={() => void (modalBack.current?.() || close())} onShow={() => setShown(true)} statusBarTranslucent>
      <StatusBar barStyle={lightHeader ? 'dark-content' : 'light-content'} />
      <Animated.View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: '#000', opacity: Animated.multiply(range([0, 0.22]), dragRange([1, 0.2], [0, H * 0.5])) }}
      />
      <Animated.View
        style={[
          { position: 'absolute', overflow: 'hidden', direction: rtl ? 'rtl' : 'ltr', transform: [{ translateY: drag }, { scale: dragRange([1, 0.82], [0, H]) }] },
          frame,
          zoom && l.shadow ? { shadowColor: '#000', shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, shadowOpacity: range([0.16, 0], [0, 0.4]) } : null,
          !zoom ? { opacity: p } : null,
        ]}
      >
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: config.colors.background, opacity: zoom ? range([0, 1], [0, 0.3]) : 1 }} />
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: W,
            height: H,
            transformOrigin: 'top left',
            transform: [{ scale: zoom ? range([from.size / W, 1]) : 1 }],
            opacity: zoom ? range([0, 0, 1], [0, 0.22, 0.6]) : 1,
          }}
        >
          <SafeAreaInsetsContext.Provider value={insets}>
            <DismissGestureContext.Provider value={dismissGesture}>
              <ModalBackContext.Provider value={modalBack}>
                <MeheryChat edges={['top', 'bottom']} onClose={close} />
              </ModalBackContext.Provider>
            </DismissGestureContext.Provider>
          </SafeAreaInsetsContext.Provider>
        </Animated.View>
        {zoom ? (
          <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', opacity: range([1, 0], [0, 0.32]) }}>
            <LauncherFace style={{ width: '100%', height: '100%', borderRadius: 0, shadowOpacity: 0, elevation: 0 }} />
          </Animated.View>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

/** `cause` can hold message text or URLs; keep the kind of failure and the HTTP status, nothing else. */
function redactError(e: MeheryError): MeheryError {
  const c = e.cause;
  if (!(c instanceof Error)) return { code: e.code, message: e.message };
  const status = (c as { status?: unknown }).status;
  return { code: e.code, message: e.message, cause: { name: c.name, message: c.message, ...(typeof status === 'number' ? { status } : {}) } };
}

const RTL_LANGS = /^(ar|he|iw|fa|ur|ps|sd|ug|yi|dv|ckb)\b/i;

function deviceLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}
