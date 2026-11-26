export type Author = 'user' | 'bot' | 'system';
export type MessageStatus = 'sending' | 'sent' | 'failed';
export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface Attachment {
  url: string;
  kind: 'image' | 'audio' | 'video' | 'file';
  name?: string;
  mimeType?: string;
  /** Small preview image (a video poster, or a low-res photo shown while the full one loads). */
  thumbnailUrl?: string;
  /** Pixel size of the photo or video. When known, its box is reserved before loading (no layout jump). */
  width?: number;
  height?: number;
  /** Length of a video or audio clip. */
  durationMs?: number;
  /** File size in bytes. */
  size?: number;
  caption?: string;
  /** Hidden soundtrack (`mediaSubType` BG_VOICE). Played outside the bubble, not drawn in it. */
  background?: boolean;
}

/** Mirrors the backend's TmplElement: QUICK_REPLY sends, URL opens, anything else sends its label. */
export interface ChatButton {
  id: string;
  label: string;
  type: string;
  url?: string;
}

/**
 * One field of a bot form (`options.inputs`). Like the web widget: TEXT, EMAIL and PHONE fields are
 * drawn as a card (one or many), submitted together; the composer also answers the first field.
 */
export interface FormInput {
  name: string;
  type: 'TEXT' | 'EMAIL' | 'PHONE' | string;
  label?: string;
}

export interface Message {
  id: string;
  author: Author;
  text: string;
  createdAt: number;
  status?: MessageStatus;
  attachments?: Attachment[];
  buttons?: ChatButton[];
  inputs?: FormInput[];
  /** Arrived during this session (animates in, reveals text). History messages don't. */
  fresh?: boolean;
  /** Temporary id of a message this device sent; stays stable after the server id replaces `id`. */
  localId?: string;
  /** The customer's name as the server has it (Mehery sends the contact on each message). */
  contactName?: string;
  /** A contact-card submission ("Submitted"): a trigger for the bot, not something to show as a bubble. */
  formSubmit?: boolean;
}

export interface PickedFile {
  uri: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface OutgoingMessage {
  text: string;
  form?: Record<string, string>;
  file?: PickedFile;
}

export interface SendReceipt {
  id: string;
  createdAt: number;
  attachments?: Attachment[];
}

export interface TransportHandlers {
  onMessage(message: Message): void;
  onConnection(status: ConnectionStatus): void;
}

/** How the engine talks to a backend. The Mehery transport and the mock both implement this. */
export interface ChatTransport {
  /** Opens the connection and resolves with the conversation history. */
  connect(handlers: TransportHandlers): Promise<Message[]>;
  send(message: OutgoingMessage): Promise<SendReceipt>;
  disconnect(): void;
  /**
   * Drop the current conversation on the server so the next `connect` starts fresh.
   * Without this, a new chat only clears the screen until history reloads.
   */
  restart?(options?: { guest?: boolean }): Promise<void> | void;
  /** Try to bring the live connection back now (offline banner, app back in the foreground). */
  reconnect?(): Promise<void> | void;
  /** Logout: forget the stored identity on this device. */
  clear?(): Promise<void> | void;
  // guest: also forget who the customer is (a brand-new contact), for testing first-visit flows.
  /** The chat became visible (true) or hidden (false). Lets a transport poll only while it's open. */
  setActive?(active: boolean): void;
}

export type MeheryErrorCode =
  | 'NETWORK'
  /** The backend refused the channel key or session (401/403). Not retried automatically. */
  | 'AUTH_FAILED'
  | 'SEND_FAILED'
  | 'UPLOAD_FAILED'
  | 'CONFIG_INVALID'
  /** The backend sent something that isn't a usable message; it was skipped. */
  | 'BAD_MESSAGE'
  /** Part of the chat UI failed to render; it was replaced with a fallback. */
  | 'RENDER'
  /** The attachment picker failed. */
  | 'PICKER'
  /** A file was refused before upload (not a local file, wrong type, too large). */
  | 'ATTACHMENT_REJECTED'
  /** A bot link used a scheme the host hasn't allowed (see allowedLinkSchemes); it was not opened. */
  | 'LINK_BLOCKED'
  /** A photo, video or audio clip failed to load or play; it shows a fallback tile. */
  | 'MEDIA'
  | 'UNKNOWN';

export interface MeheryError {
  code: MeheryErrorCode;
  message: string;
  cause?: unknown;
}
