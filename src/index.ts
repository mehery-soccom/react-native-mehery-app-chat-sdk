export { MeheryChatProvider, useMeheryChat, useMeheryTheme, type MeheryChatProviderProps, type UseMeheryChatResult } from './react/Provider';
export { MeheryChat, type MeheryChatProps } from './ui/MeheryChat';
export { createMockTransport, type MockTransport, type MockTransportOptions } from './core/mockTransport';
export { createMeheryTransport, type MeheryTransportOptions, type MeheryUser, type KeyValueStorage } from './core/meheryTransport';
export {
  resolveConfig,
  type MeheryConfig,
  type ResolvedConfig,
  type Strings,
  type Palette,
  type AttachmentType,
  type ImageRef,
  type LauncherIcon,
  type LauncherShape,
  type MotionPreset,
} from './core/config';
export type { ChatState } from './core/client';

// Built-in pieces, so custom components can wrap or reuse them.
export { Header } from './ui/Header';
export { Launcher } from './ui/Launcher';
export { QuickReply, ThinkingIndicator, EmptyState } from './ui/MessageList';
export type { MeheryComponents, HeaderProps, LauncherProps, QuickReplyProps, EmptyStateProps, BrandAsset, SvgRenderer, VideoRenderer, AudioRenderer, MediaPlayerProps, VoiceRecorder } from './react/context';

export type {
  Message,
  Attachment,
  ChatButton,
  FormInput,
  PickedFile,
  ConnectionStatus,
  ChatTransport,
  OutgoingMessage,
  SendReceipt,
  TransportHandlers,
  MeheryError,
  MeheryErrorCode,
} from './types';
