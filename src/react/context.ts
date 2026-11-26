import { createContext, useContext, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import type { GestureResponderHandlers, ImageSourcePropType } from 'react-native';
import type { ChatClient, ChatState } from '../core/client';
import type { AttachmentType, ResolvedConfig } from '../core/config';
import type { ChatButton, ConnectionStatus, PickedFile } from '../types';

/**
 * An image the app bundles, referenced from the config as "asset:<name>":
 * `require('./logo.png')`, `{ uri }`, or an SVG imported as a component
 * (react-native-svg-transformer), which is given `width` and `height`.
 */
export type BrandAsset = ImageSourcePropType | ComponentType<{ width: number; height: number }>;

/** Draws an SVG URL (React Native's Image can't). Typically `(p) => <SvgUri {...p} />` from react-native-svg. */
export type SvgRenderer = (props: { uri: string; width: number; height: number }) => ReactNode;

/** What the chat hands your media player. The SDK owns play/pause; your player reports back. */
export interface MediaPlayerProps {
  uri: string;
  /** Pause when true, play when false. Keep the position across pauses. */
  paused: boolean;
  /** Current position and total length, in ms. Call it while playing (a few times a second). */
  onProgress(positionMs: number, durationMs: number): void;
  /** Playback reached the end. */
  onEnd(): void;
  /** The clip can't load or play. The chat shows a fallback and reports a 'MEDIA' error. */
  onError(error: unknown): void;
  /**
   * Set when the user scrubs: jump to `positionMs` each time this object changes. Optional to
   * support; without it the scrubber still shows progress, it just can't seek.
   */
  seekTo?: { positionMs: number };
  /** 0–1. Voice notes omit it. Background tracks pass 0.2. Hosts may ignore it. */
  volume?: number;
}

/**
 * Draws the video in the chat's full-screen player (React Native has no built-in video player).
 * Fill `width` x `height` and fit the video inside it (contain); the chat draws the controls.
 * Mounted only while the player is open, unmounted on close. With react-native-video, a small
 * component that forwards the props (and `seekTo` to `ref.seek(positionMs / 1000)`); see the
 * example app. Without it, tapping a video opens it outside the app.
 */
export type VideoRenderer = (props: MediaPlayerProps & { width: number; height: number }) => ReactNode;

/**
 * Plays audio (voice notes). The chat mounts what you return off-screen, only while that clip is
 * playing or paused mid-way, e.g. a zero-size `<Video>` from react-native-video with the same
 * props as `renderVideo`. Without it, tapping a voice note opens it outside the app.
 */
export type AudioRenderer = (props: MediaPlayerProps) => ReactNode;

/**
 * Voice-note recorder (e.g. react-native-nitro-sound). The chat draws the recording bar itself:
 * `start` on mic tap, `stop` on send (resolve the recorded file), `cancel` to discard.
 */
export interface VoiceRecorder {
  start(): Promise<void>;
  stop(): Promise<PickedFile | null>;
  cancel(): Promise<void>;
}

export interface HeaderProps {
  title: string;
  logo?: string;
  brand?: ResolvedConfig['header']['brand'];
  connection: ConnectionStatus;
  onClose?: () => void;
}

export interface EmptyStateProps {
  title: string;
  body: string;
}

export interface LauncherProps {
  unread: number;
  onPress: () => void;
}

export interface QuickReplyProps {
  button: ChatButton;
  onPress: () => void;
}

/** Replaceable building blocks. Anything not given uses the built-in component. */
export interface MeheryComponents {
  Header: ComponentType<HeaderProps>;
  EmptyState: ComponentType<EmptyStateProps>;
  Launcher: ComponentType<LauncherProps>;
  QuickReply: ComponentType<QuickReplyProps>;
  ThinkingIndicator: ComponentType<object>;
}

export interface MeheryContextValue {
  client: ChatClient;
  config: ResolvedConfig;
  components: Partial<MeheryComponents>;
  reduceMotion: boolean;
  isOpen: boolean;
  open(): void;
  close(): void;
  openLink(url: string): void;
  pickAttachment?: (type: AttachmentType) => Promise<PickedFile | null>;
  /** Records voice notes. Without it the mic is hidden. The file is sent with `sendFile`. */
  voiceRecorder?: VoiceRecorder;
  /** True when the chat's language reads right to left (Arabic, Hebrew, ...). */
  rtl: boolean;
  /** The language of the SDK's own text, e.g. "ar-KW". */
  locale: string;
  assets: Record<string, BrandAsset>;
  renderSvg?: SvgRenderer;
  renderVideo?: VideoRenderer;
  renderAudio?: AudioRenderer;
}

export const MeheryContext = createContext<MeheryContextValue | null>(null);

/** Swipe-down-to-dismiss handlers for the header area. Only set inside the built-in modal window. */
export const DismissGestureContext = createContext<GestureResponderHandlers | null>(null);

/**
 * Android back inside the chat Modal goes to the Modal's onRequestClose, never to BackHandler.
 * An overlay in the chat (the photo viewer) sets this to take the press; return true if handled.
 */
export const ModalBackContext = createContext<{ current: (() => boolean) | null } | null>(null);

export function useMehery(): MeheryContextValue {
  const value = useContext(MeheryContext);
  if (!value) throw new Error('react-native-mehery-chat: wrap your app in <MeheryChatProvider>.');
  return value;
}

export function useChatState(): ChatState {
  const { client } = useMehery();
  return useSyncExternalStore(client.subscribe, client.getState, client.getState);
}
