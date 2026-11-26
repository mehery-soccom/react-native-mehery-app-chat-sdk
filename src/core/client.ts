import type {
  Attachment,
  ChatButton,
  ChatTransport,
  ConnectionStatus,
  FormInput,
  MeheryError,
  Message,
  OutgoingMessage,
  PickedFile,
} from '../types';
import { normalizeMessage, safeCall } from './safe';
import { checkFile, safeFileName, type FilePolicy } from './security';

export interface ChatState {
  /** In conversation order (history by server time, then arrival order). */
  messages: Message[];
  connection: ConnectionStatus;
  /** A reply is expected: shows the thinking indicator. */
  thinking: boolean;
  unread: number;
  visible: boolean;
  /**
   * The field the next composer message answers: `inputs[0]` of the latest received message, like the
   * web's `form_input`. Every received message resets it, customer echoes included.
   */
  pendingInput: FormInput | null;
  /** What was submitted from each form card, by bot message id, so the card stays on screen filled in. */
  forms: Record<string, Record<string, string>>;
  /** The customer's name, once they have given it (form card or a typed answer to a name prompt). */
  userName: string;
}

export interface ClientEvents {
  onMessageReceived?(message: Message): void;
  onUnreadCountChange?(count: number): void;
  onError?(error: MeheryError): void;
  /** The connection went online, offline or is (re)connecting. */
  onConnectionChange?(status: ConnectionStatus): void;
}

export const THINKING_TIMEOUT_MS = 20_000;

export function attachmentKind(mimeType = ''): Attachment['kind'] {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'file';
}

/**
 * The web's check mark: every customer message the server has (history included), so anything
 * not still sending or failed. History messages carry no status at all.
 */
export function isDelivered(message: Pick<Message, 'author' | 'status'>): boolean {
  return message.author === 'user' && message.status !== 'sending' && message.status !== 'failed';
}

const CARD_TYPES = ['TEXT', 'EMAIL', 'PHONE'];

/**
 * The fields the web card actually draws. Its checkbox and radio branches can never run (their
 * condition is always false), so any other type renders no control and is left out of `form`.
 */
export function formFields(inputs?: readonly FormInput[] | null): FormInput[] {
  return (inputs ?? []).filter((i) => CARD_TYPES.includes(i.type.toUpperCase()));
}

/**
 * Any message with a fillable field gets the card inside its bubble, one field or many, like the
 * web (`inputs.length > 0`). The composer is bound to `inputs[0]` as well (see `pendingInput`).
 */
export function isFormCard(message?: { inputs?: readonly FormInput[] } | null): boolean {
  return formFields(message?.inputs).length > 0;
}

/** The web's landing: the auth reply is the only message, and its id is the backend's typo. */
export function isIcebreaker(messages: readonly { id: string }[]): boolean {
  return messages.length === 1 && messages[0]?.id === 'icebrakerMsg';
}

/** BG_VOICE is a soundtrack, not a bubble attachment. */
export function visibleAttachments(attachments?: readonly Attachment[] | null): Attachment[] {
  return (attachments ?? []).filter((a) => !a.background);
}

/**
 * URL of the background track that should be playing, or null.
 * Null when the feature is off, the latest message is the customer's, or that message has no BG_VOICE.
 */
export function backgroundTrack(messages: readonly Pick<Message, 'author' | 'attachments'>[], enabled: boolean): string | null {
  if (!enabled) return null;
  const last = messages[messages.length - 1];
  if (!last || last.author === 'user') return null;
  return last.attachments?.find((a) => a.background)?.url ?? null;
}

/**
 * Web `onMessageRecvd`: `form_input = inputs ? inputs[0] : null`, for every received message and
 * whatever the number of inputs. Polls resend the whole session in order, so the last item wins.
 */
function composerInput(message?: Message | null): FormInput | null {
  return message?.inputs?.[0] ?? null;
}

/**
 * The web's phone field sends an international number ("+91 98765 43210"). A number typed without
 * "+" gets the configured dial code, minus the national trunk 0 ("09876…" → "+91 9876…").
 * ponytail: one fixed code per app; a country picker is in TODOS.md.
 */
export function withDialCode(value: string, dialCode?: string): string {
  const v = value.trim();
  if (!dialCode || !v || v.startsWith('+')) return v;
  return `${dialCode} ${v.replace(/^0+/, '')}`;
}

/** A phone typed without "+" keeps at most this many digits by default (`features.phoneMaxDigits`). */
export const PHONE_MAX_DIGITS = 10;
/** E.164: a number typed with "+" and a country code can have up to 15 digits. */
export const PHONE_MAX_INTERNATIONAL = 15;

/** The digit limit for what was typed: international numbers get the E.164 limit. */
export function phoneLimit(value: string, max = PHONE_MAX_DIGITS): number {
  return value.trim().startsWith('+') ? Math.max(max, PHONE_MAX_INTERNATIONAL) : max;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?[\d\s()-]{6,}$/;

export function isEmailInput(input: FormInput | null | undefined): boolean {
  if (!input) return false;
  const type = input.type.toUpperCase();
  if (type === 'PHONE' || type === 'NUMBER') return false;
  return type === 'EMAIL' || input.name.toLowerCase() === 'email';
}

export function isPhoneInput(input: FormInput | null | undefined): boolean {
  if (!input) return false;
  const type = input.type.toUpperCase();
  if (type === 'EMAIL') return false;
  return type === 'PHONE' || type === 'NUMBER' || input.name.toLowerCase() === 'phone';
}

/** ASCII digits in `value`. Spaces, dashes, parentheses and "+" do not count. */
export function phoneDigitCount(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 48 && c <= 57) n += 1;
  }
  return n;
}

/** Keep formatting characters; drop any digit past the limit. */
export function limitPhoneDigits(value: string, max = PHONE_MAX_DIGITS): string {
  const limit = phoneLimit(value, max);
  let digits = 0;
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      if (digits >= limit) continue;
      digits += 1;
    }
    out += value[i];
  }
  return out;
}

/** Client-side check for form fields (the backend doesn't validate them). */
export function isValidInput(input: FormInput | null, text: string, phoneMax = PHONE_MAX_DIGITS): boolean {
  if (!input) return true;
  const value = text.trim();
  if (isEmailInput(input)) return EMAIL_PATTERN.test(value);
  if (isPhoneInput(input)) {
    if (phoneDigitCount(value) > phoneLimit(value, phoneMax)) return false;
    return PHONE_PATTERN.test(value);
  }
  return value.length > 0;
}

/** The conversation engine. No React or React Native here, so it runs (and is tested) anywhere. */
export class ChatClient {
  private state: ChatState = {
    messages: [],
    connection: 'connecting',
    thinking: false,
    unread: 0,
    visible: false,
    pendingInput: null,
    forms: {},
    userName: '',
  };
  private listeners = new Set<() => void>();
  private outbox = new Map<string, OutgoingMessage>();
  private seq = 0;
  private thinkingTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * Local ids of sends a bot message has not answered yet.
   * A reply clears this, so a receipt that lands afterwards cannot turn typing back on.
   */
  private awaitingReply = new Set<string>();
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryAttempt = 0;
  private started = false;
  private stopped = false;
  /** Bumped when the thread is discarded, so in-flight sends and connects can't land in the new one. */
  private epoch = 0;
  /** How long the typing indicator waits for a reply. Set by the provider from `features.thinkingTimeoutMs`. */
  thinkingTimeoutMs = THINKING_TIMEOUT_MS;

  constructor(
    private transport: ChatTransport,
    public events: ClientEvents = {},
  ) {}

  /** Report a problem to the host's onError. Never throws. */
  report(error: MeheryError): void {
    safeCall(this.events.onError, error);
  }

  getState = (): ChatState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopped = false;
    const epoch = this.epoch;
    clearTimeout(this.retryTimer);
    this.update({ connection: 'connecting' });
    try {
      const history = await this.transport.connect({
        onMessage: (m) => {
          if (epoch === this.epoch) this.receive(m);
        },
        onConnection: (connection) => {
          if (epoch !== this.epoch) return;
          if (connection === 'online' || connection === 'offline' || connection === 'connecting') {
            const changed = connection !== this.state.connection;
            this.update({ connection });
            if (changed) safeCall(this.events.onConnectionChange, connection);
          }
        },
      });
      if (epoch !== this.epoch || this.stopped) return;
      const sorted = (Array.isArray(history) ? history : [])
        .map(normalizeMessage)
        .filter((m): m is Message => m !== null)
        .sort((a, b) => a.createdAt - b.createdAt);
      const last = sorted[sorted.length - 1];
      this.retryAttempt = 0;
      this.update({
        connection: this.state.connection === 'connecting' ? 'online' : this.state.connection,
        messages: mergeAll(this.state.messages, sorted),
        pendingInput: composerInput(last),
        ...knownName(sorted, this.state.userName),
      });
    } catch (cause) {
      if (epoch !== this.epoch || this.stopped) return;
      this.started = false;
      this.update({ connection: 'offline' });
      safeCall(this.events.onConnectionChange, 'offline');
      // 401/403: the channel key or session is refused. Asking again every few seconds won't change that.
      const status = (cause as { status?: unknown } | null)?.status;
      if (status === 401 || status === 403) {
        this.report({ code: 'AUTH_FAILED', message: 'The chat server refused the channel credentials', cause });
        return; // the offline banner's reconnect (or a new Provider) tries again
      }
      this.report({ code: 'NETWORK', message: 'Could not connect to chat', cause });
      this.scheduleRetry();
    }
  }

  /**
   * Leave this thread and open a blank one. The pull-up gesture on the latest messages commits here.
   * Transports that implement `restart` also drop the server session.
   * `{ guest: true }` also forgets who the customer is: a brand-new contact, for testing first-visit flows.
   */
  async newChat(options?: { guest?: boolean }): Promise<void> {
    this.epoch += 1;
    const epoch = this.epoch;
    clearTimeout(this.thinkingTimer);
    clearTimeout(this.retryTimer);
    this.outbox.clear();
    this.awaitingReply.clear();
    this.stopped = false;
    this.update({ messages: [], thinking: false, pendingInput: null, unread: 0, forms: {}, ...(options?.guest ? { userName: '' } : {}) }); // userName stays on a plain New chat: same guest, same name
    try {
      await this.transport.restart?.(options);
    } catch (cause) {
      this.report({ code: 'NETWORK', message: 'Could not start a new chat', cause });
    }
    if (epoch !== this.epoch) return;
    this.started = false;
    try {
      this.transport.disconnect();
    } catch (cause) {
      this.report({ code: 'UNKNOWN', message: 'Disconnect failed', cause });
    }
    await this.start();
  }

  /** Try to connect again now (offline banner tap, app back in foreground). */
  reconnect(): void {
    if (this.stopped) return;
    if (this.started) {
      // Connected before: ask the transport to sign in again, reopen its socket and catch up.
      try {
        void Promise.resolve(this.transport.reconnect?.()).catch((cause) => this.report({ code: 'NETWORK', message: 'Could not reconnect', cause }));
      } catch (cause) {
        this.report({ code: 'NETWORK', message: 'Could not reconnect', cause });
      }
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryAttempt = 0;
    void this.start();
  }

  stop(): void {
    this.started = false;
    this.stopped = true;
    clearTimeout(this.thinkingTimer);
    clearTimeout(this.retryTimer);
    this.awaitingReply.clear();
    try {
      this.transport.disconnect();
    } catch (cause) {
      this.report({ code: 'UNKNOWN', message: 'Disconnect failed', cause });
    }
  }

  /** Back off 2 s, 4 s, 8 s … up to 30 s between connection attempts. */
  private scheduleRetry(): void {
    const delay = Math.min(30_000, 2_000 * 2 ** this.retryAttempt++);
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => void this.start(), delay);
  }

  send(text: string, form?: Record<string, string>): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    const pending = this.state.pendingInput;
    const payload: OutgoingMessage = { text: trimmed };
    if (form) payload.form = form;
    else if (pending) payload.form = { [pending.name]: trimmed };
    if (!form && pending?.name.toLowerCase() === 'name') this.update({ userName: trimmed });
    this.enqueue(payload, { text: trimmed });
  }

  /** A plain send with an empty form. The icebreaker landing uses it so a button code is not a reply form. */
  sendText(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.enqueue({ text: trimmed, form: {} }, { text: trimmed });
  }

  /**
   * Submit a contact card the way the web widget does: the message text is "Submitted" and every
   * field is sent together, keyed by its name (`name`, `email`, `phone`, …).
   */
  sendForm(values: Record<string, string>): void {
    const form: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (key && trimmed) form[key] = trimmed;
    }
    if (Object.keys(form).length === 0) return;
    const card = [...this.state.messages].reverse().find((m) => isFormCard(m));
    if (card) this.update({ forms: { ...this.state.forms, [card.id]: form } });
    if (form.name) this.update({ userName: form.name });
    this.enqueue({ text: 'Submitted', form }, { text: 'Submitted', formSubmit: true });
  }

  /**
   * Same shape the web chat sends: the button code and label ride along as form fields, plus
   * `replyIdExt`, the id of the bot message the button belongs to.
   */
  sendQuickReply(button: ChatButton, replyIdExt?: string): void {
    const form: Record<string, string> = { reply_id: button.id, reply_title: button.label };
    if (replyIdExt) form.replyIdExt = replyIdExt;
    this.send(button.label, form);
  }

  /** Set by the provider from the config (features.attachments, maxAttachmentMB). */
  setFilePolicy(policy: FilePolicy | undefined): void {
    this.filePolicy = policy;
  }

  private filePolicy: FilePolicy | undefined;

  /** Every file, whether picked, recorded or passed by the host, is checked here before upload. */
  sendFile(picked: PickedFile): void {
    const why = checkFile(picked, this.filePolicy);
    if (why) {
      this.report({ code: 'ATTACHMENT_REJECTED', message: `File not sent: ${why}` });
      return;
    }
    const file = { ...picked, name: safeFileName(picked.name) };
    const attachment: Attachment = { url: file.uri, kind: attachmentKind(file.mimeType), name: file.name };
    if (file.mimeType) attachment.mimeType = file.mimeType;
    this.enqueue({ text: '', file }, { text: '', attachments: [attachment] });
  }

  /** Logout: stop the chat, empty the screen and wipe the stored identity (csid, session id) from the device. */
  async logout(): Promise<void> {
    this.stop();
    this.epoch += 1;
    this.outbox.clear();
    this.update({ messages: [], thinking: false, pendingInput: null, unread: 0, forms: {}, userName: '' });
    try {
      await this.transport.clear?.();
    } catch (cause) {
      this.report({ code: 'UNKNOWN', message: 'Could not clear the stored session', cause });
    }
  }

  retry(id: string): void {
    const message = this.state.messages.find((m) => m.id === id);
    if (!message || message.status !== 'failed' || !this.outbox.has(id)) return;
    this.awaitingReply.add(id);
    this.patch(id, { status: 'sending' });
    this.armThinking();
    void this.dispatch(id);
  }

  setVisible(visible: boolean): void {
    if (visible === this.state.visible) return;
    // Once the chat is closed, everything already seen stops animating on the next open.
    const messages = visible ? this.state.messages : this.state.messages.map(stale);
    this.update({ visible, messages, unread: visible ? 0 : this.state.unread });
    if (visible) safeCall(this.events.onUnreadCountChange, 0);
    try {
      this.transport.setActive?.(visible);
    } catch (cause) {
      this.report({ code: 'UNKNOWN', message: 'transport.setActive failed', cause });
    }
  }

  receive(raw: unknown): void {
    const message = normalizeMessage(raw);
    if (!message) {
      this.report({ code: 'BAD_MESSAGE', message: 'Skipped a message without a usable id', cause: raw });
      return;
    }
    const isBot = message.author === 'bot';
    const exists = this.state.messages.some((m) => m.id === message.id);
    const messages = mergeAll(this.state.messages, [{ ...message, fresh: !exists }]);
    // A poll resends the whole session, oldest first. Only the newest message decides what the composer
    // asks for; an old form prompt flipping it on and off mid-batch makes iOS reload the keyboard
    // while the customer is typing, which drops keystrokes.
    const isLatest = messages[messages.length - 1]?.id === message.id;
    const pendingInput = isLatest ? composerInput(message) : this.state.pendingInput;
    const pendingSame = sameInput(this.state.pendingInput, pendingInput);
    // A poll resends the whole session. An unchanged message must not allocate a new state.
    if (messages === this.state.messages && pendingSame) return;
    const previousUnread = this.state.unread;
    const unread = isBot && !exists && !this.state.visible ? previousUnread + 1 : previousUnread;
    // This reply answers every send already handed to the transport. Forget them
    // before the receipt arrives, or dispatch will re-arm typing for a message that is on screen.
    if (isBot) {
      this.awaitingReply.clear();
      clearTimeout(this.thinkingTimer);
    }
    this.update({
      ...knownName([message], this.state.userName),
      messages,
      thinking: isBot ? false : this.state.thinking,
      pendingInput: pendingSame ? this.state.pendingInput : pendingInput,
      unread,
    });
    if (exists) return;
    safeCall(this.events.onMessageReceived, message);
    if (unread !== previousUnread) safeCall(this.events.onUnreadCountChange, unread);
  }

  /** Show the typing indicator and (re)start its timeout. */
  private armThinking(extra?: Partial<ChatState>): void {
    clearTimeout(this.thinkingTimer);
    this.update({ ...extra, thinking: true });
    this.thinkingTimer = setTimeout(() => this.update({ thinking: false }), this.thinkingTimeoutMs);
  }

  /** Hide the typing indicator when nothing else is still waiting for a reply. */
  private clearThinking(): void {
    if (this.awaitingReply.size > 0) return;
    clearTimeout(this.thinkingTimer);
    if (this.state.thinking) this.update({ thinking: false });
  }

  private enqueue(payload: OutgoingMessage, content: Pick<Message, 'text' | 'attachments' | 'formSubmit'>): void {
    const id = `local-${++this.seq}`;
    const message: Message = {
      id,
      author: 'user',
      createdAt: Date.now(),
      status: 'sending',
      fresh: true,
      ...content,
    };
    this.outbox.set(id, payload);
    this.awaitingReply.add(id);
    // Typing starts with the local bubble so a slow send does not leave the thread silent.
    this.armThinking({ messages: [...this.state.messages, message], pendingInput: null });
    void this.dispatch(id);
  }

  private async dispatch(localId: string): Promise<void> {
    const payload = this.outbox.get(localId);
    if (!payload) return;
    const epoch = this.epoch;
    try {
      const receipt = await this.transport.send(payload);
      if (epoch !== this.epoch || !this.outbox.has(localId)) return;
      this.outbox.delete(localId);
      // A receipt without a usable id still means "sent"; keep the local id.
      const serverId = typeof receipt?.id === 'string' && receipt.id ? receipt.id : localId;
      const attachments = Array.isArray(receipt?.attachments) ? receipt.attachments : undefined;
      const duplicate = serverId !== localId && this.state.messages.some((m) => m.id === serverId);
      const messages = duplicate
        ? this.state.messages.filter((m) => m.id !== localId)
        : this.state.messages.map((m) =>
            m.id === localId
              ? { ...m, id: serverId, localId, status: 'sent' as const, attachments: attachments ?? m.attachments, ...(serverId !== localId && receipt.createdAt > 0 ? { createdAt: receipt.createdAt } : {}) }
              : m,
          );
      // Typing was armed at enqueue. The bot reply often lands first and clears `awaitingReply`;
      // a latest bot message means the same thing. Either way the receipt must not re-arm typing.
      // If we are still waiting, reset the timeout so thinkingTimeoutMs counts from confirmed send.
      const stillWaiting = this.awaitingReply.delete(localId);
      const replyShown = messages[messages.length - 1]?.author === 'bot';
      if (replyShown) this.awaitingReply.clear();
      if (stillWaiting && !replyShown) {
        this.armThinking({ messages });
      } else {
        clearTimeout(this.thinkingTimer);
        this.update(replyShown ? { messages, thinking: false } : { messages });
      }
    } catch (cause) {
      if (epoch !== this.epoch || !this.outbox.has(localId)) return;
      this.awaitingReply.delete(localId);
      this.patch(localId, { status: 'failed' });
      this.clearThinking();
      this.report({
        code: payload.file ? 'UPLOAD_FAILED' : 'SEND_FAILED',
        message: 'Message not sent',
        cause,
      });
    }
  }

  private patch(id: string, changes: Partial<Message>): void {
    this.update({ messages: this.state.messages.map((m) => (m.id === id ? { ...m, ...changes } : m)) });
  }

  private update(changes: Partial<ChatState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((l) => l());
  }
}

/** The server's name for the customer (latest message that carries one), when it differs from what we show. */
function knownName(messages: readonly Message[], current: string): { userName?: string } {
  for (let i = messages.length - 1; i >= 0; i--) {
    const name = messages[i]!.contactName;
    if (name) return name === current ? {} : { userName: name };
  }
  return {};
}

function stale(m: Message): Message {
  return m.fresh ? { ...m, fresh: false } : m;
}

function sameInput(a: FormInput | null, b: FormInput | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.name === b.name && a.type === b.type && (a.label ?? '') === (b.label ?? '');
}

/** Shallow equality of two lists of flat objects (attachments, buttons, inputs). */
function sameList(a: readonly object[] | undefined, b: readonly object[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i] as Record<string, unknown>;
    const xr = x as Record<string, unknown>;
    const keys = Object.keys(xr);
    return keys.length === Object.keys(y).length && keys.every((k) => xr[k] === y[k]);
  });
}

/** Field compare. `fresh` is session-local, so a poll that omits it is not a change. */
function sameMessage(a: Message, b: Message): boolean {
  if (a.id !== b.id || a.author !== b.author || a.text !== b.text || a.createdAt !== b.createdAt) return false;
  if (a.status !== b.status || a.localId !== b.localId) return false;
  return sameList(a.attachments, b.attachments) && sameList(a.buttons, b.buttons) && sameList(a.inputs, b.inputs);
}

const settled = (m: Message) => m.status !== 'sending' && m.status !== 'failed';

/**
 * Upsert by id, keeping conversation order: a new message goes after the last one that is not newer,
 * so a poll that back-fills a missed reply lands where it belongs. Messages still being sent hold their
 * place: a reply that arrives meanwhile goes after them.
 */
function mergeAll(current: Message[], incoming: Message[]): Message[] {
  const index = new Map(current.map((m, i) => [m.id, i]));
  let next = current;
  for (const m of incoming) {
    const i = index.get(m.id);
    if (i === undefined) {
      if (next === current) next = current.slice();
      let at = next.length;
      while (at > 0 && settled(next[at - 1]!) && next[at - 1]!.createdAt > m.createdAt) at -= 1;
      if (at === next.length) {
        next.push(m);
        index.set(m.id, at);
      } else {
        next.splice(at, 0, m);
        index.clear();
        next.forEach((x, k) => index.set(x.id, k));
      }
    } else {
      const prev = next[i]!;
      const merged: Message = { ...prev, ...m, fresh: prev.fresh };
      if (sameMessage(prev, merged)) continue;
      if (next === current) next = current.slice();
      next[i] = merged;
    }
  }
  return next;
}
