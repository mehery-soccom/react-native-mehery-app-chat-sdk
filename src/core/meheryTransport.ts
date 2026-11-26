/**
 * The real Mehery connection: a native port of the web chat (mehery-web CustomerChat.vue) that the
 * old iOS/Android SDKs loaded in a WebView. Same endpoints, same payloads, same order:
 *
 *  1. connect  POST {domain}/postman/ext/plugin/outbound/web/auth/v2   (form-encoded, like $service.submit)
 *              → history (ChatMessageDTO[]) + meta { webSessionIdKey, webSessionId, csid, stomp }
 *  2. live     STOMP over WebSocket {domain}/postman/stomp-tunnel/websocket (tunnel.client.js):
 *              CONNECT {user, token, xSessionId} → SUBSCRIBE /app/stomp/tunnel/meta/{xsession}/{jsession}
 *              → SUBSCRIBE /tag/{tenantToken}/{tagId}/message/receive/new (+ /topic and /queue variants)
 *              → MESSAGE { data: OutboxMessage }
 *  3. send     POST {domain}/postman/ext/plugin/inbound/v2/web/callback/{nonce}/{channelId}/{channelKey}?{key}={id}
 *              JSON { message, from: csid, form }   (files: PUT multipart `file`, ?from={csid})
 *  4. poll     GET  {domain}/postman/ext/plugin/outbound/web/callback/v2?number&csid&channelId&sessionId
 *              (the web chat's fallback when STOMP is off, and its safety net when it's on)
 *
 * No React Native imports: uses the global fetch / WebSocket / FormData that React Native provides
 * (injectable for tests).
 */
import { isContextPath, isHostname, isSafeToken, randomHex, safeFileName, safeMediaUrl } from './security';
import type { Attachment, ChatButton, ChatTransport, ConnectionStatus, FormInput, Message, OutgoingMessage, SendReceipt, TransportHandlers } from '../types';

/** AsyncStorage-compatible. Without it, a guest is a new contact on every app launch. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem?(key: string): Promise<void> | void;
}

/** A signed-in customer. Omit for guests. Sent as userCode/userName/... exactly like the web chat. */
export interface MeheryUser {
  /** Your stable user id; the backend keys the contact on it ("u" + id). */
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  /**
   * Passed through as userToken. The backend stores it and does NOT verify it today, so it does not prove
   * who the user is. Never pass a long-lived auth/session token (a JWT, an API key) here.
   */
  token?: string;
}

interface SocketLike {
  onopen: ((e: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onclose: ((e: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface MeheryTransportOptions {
  /** The WebChat channel's domain, e.g. "acme.mehery.io" (no scheme). */
  domain: string;
  /** e.g. "web:acme.mehery.io", from the WebChat channel in Mehery admin. */
  channelId: string;
  channelKey: string;
  user?: MeheryUser | null;
  /** Keeps the guest identity and session across launches. Pass AsyncStorage. */
  storage?: KeyValueStorage;
  /**
   * Returns a signed identity for `user` (for example a short-lived token from your backend), asked
   * before every sign-in and sent as `userToken`. Without it, `user.token` is sent as given.
   */
  getIdentityToken?: () => Promise<string | undefined> | string | undefined;
  /** Server context path. Default "/postman". */
  context?: string;
  /** Poll interval while the live socket is down. Default 3000 ms (the web chat used 2000). */
  pollIntervalMs?: number;
  /** Per-request timeout. Default 15000 ms. */
  requestTimeoutMs?: number;
  /** Injection points for tests. */
  fetch?: typeof fetch;
  WebSocket?: new (url: string) => SocketLike;
}

interface Session {
  installId: string;
  csid?: string;
  webSessionKey?: string;
  webSessionId?: string;
  /** "New chat": a fresh ticket makes the backend open a new session (ChatSessionFactory). */
  ticketHash?: string;
  /** "New chat" and nothing sent yet: the thread is empty by definition, whatever the server's cookie says. */
  fresh?: boolean;
}

interface StompMeta {
  xsessionId?: string;
  jsessionId?: string;
  tenantToken?: string;
  tags?: string[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.filter(isObj) : []);
const randomId = () => `${Date.now().toString(36)}${randomHex(8)}`;
/** Same shape as a server session id, but not one the server issued. */
const freshSessionId = () => randomHex(12);
/** An HTTP answer that wasn't 2xx: the server saw the request. Anything else (timeout, offline) is ambiguous. */
class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const KIND: Record<string, Attachment['kind']> = { IMAGE: 'image', AUDIO: 'audio', VIDEO: 'video' };

/**
 * ChatMessageDTO (history, poll) or OutboxMessage (live socket) → SDK Message. Same rules as the
 * web chat's toMessage(): type "I" is the customer, anything else (including no type) is bot/agent;
 * text falls back to `message`; buttons come from options.buttons, form prompts from options.inputs.
 */
export function mapMeheryMessage(raw: unknown): Message | null {
  if (!isObj(raw)) return null;
  const id = str(raw.messageId) ?? str(raw.id);
  if (!id) return null;
  const options = isObj(raw.options) ? raw.options : {};
  const message: Message = {
    id,
    author: raw.type === 'I' ? 'user' : 'bot',
    text: str(raw.text) ?? str(raw.message) ?? '',
    createdAt: typeof raw.timestamp === 'number' && raw.timestamp > 0 ? raw.timestamp : Date.now(),
  };
  const attachments = list(raw.attachments).flatMap((a): Attachment[] => {
    // formatters.https in the web chat: media is upgraded to https. Anything else (file:, data:, content:) is dropped.
    const url = safeMediaUrl(a.mediaURL);
    if (!url) return [];
    const out: Attachment = { url, kind: KIND[String(a.mediaType).toUpperCase()] ?? 'file' };
    const name = str(a.mediaName) ?? str(a.mediaCaption);
    const caption = str(a.mediaCaption);
    const mimeType = str(a.mediaMimeType);
    if (name) out.name = name;
    if (caption) out.caption = caption;
    if (mimeType) out.mimeType = mimeType;
    if (str(a.mediaSubType)?.toUpperCase() === 'BG_VOICE') out.background = true;
    return [out];
  });
  // TmplElement serialises both `code` and `name` (= code); the web chat replies with `name`.
  const buttons = list(options.buttons).flatMap((b): ChatButton[] => {
    const label = str(b.label);
    if (!label) return [];
    const out: ChatButton = { id: str(b.name) ?? str(b.code) ?? label, label, type: str(b.type) ?? 'QUICK_REPLY' };
    const url = str(b.url);
    if (url) out.url = url;
    return [out];
  });
  const inputs = list(options.inputs).flatMap((i): FormInput[] => {
    const name = str(i.name) ?? str(i.code);
    if (!name) return [];
    const out: FormInput = { name, type: str(i.type) ?? 'TEXT' };
    const label = str(i.label);
    if (label) out.label = label;
    return [out];
  });
  if (attachments.length) message.attachments = attachments;
  if (buttons.length) message.buttons = buttons;
  // Every message carries the contact; its name is what the customer gave (pre-chat form, earlier visits).
  const contactName = isObj(raw.contact) ? str(raw.contact.name) : undefined;
  if (contactName) message.contactName = contactName;
  if (inputs.length) message.inputs = inputs;
  return message;
}

// ---------- Minimal STOMP 1.2 framing (text frames only; heart-beats are 0,0 on this server) ----------

export function stompFrame(command: string, headers: Record<string, string | undefined>, body = ''): string {
  const lines = Object.entries(headers)
    .filter((e): e is [string, string] => typeof e[1] === 'string')
    .map(([k, v]) => `${k}:${v.replace(/\\/g, '\\\\').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/:/g, '\\c')}`);
  return `${command}\n${lines.join('\n')}\n\n${body}\0`;
}

export interface StompMessage {
  command: string;
  headers: Record<string, string>;
  body: string;
}

/** Splits a buffer into complete frames; returns them plus any incomplete remainder. */
export function parseStomp(buffer: string): { frames: StompMessage[]; rest: string } {
  const frames: StompMessage[] = [];
  let rest = buffer;
  let end = rest.indexOf('\0');
  while (end !== -1) {
    const raw = rest.slice(0, end).replace(/^[\r\n]+/, '');
    rest = rest.slice(end + 1);
    end = rest.indexOf('\0');
    if (!raw) continue; // heart-beat newlines
    const split = raw.indexOf('\n\n');
    const head = split === -1 ? raw : raw.slice(0, split);
    const body = split === -1 ? '' : raw.slice(split + 2);
    const [command = '', ...lines] = head.split('\n');
    const headers: Record<string, string> = {};
    for (const line of lines) {
      const i = line.indexOf(':');
      if (i > 0) headers[line.slice(0, i)] = line.slice(i + 1).replace(/\\c/g, ':').replace(/\\r/g, '\r').replace(/\\n/g, '\n').replace(/\\\\/g, '\\');
    }
    frames.push({ command: command.trim(), headers, body });
  }
  return { frames, rest };
}

const TOPIC = '/message/receive/new';
const HEALTH = '/stomp/tunnel/health';
const LIVENESS_MS = 150_000; // the server pings every 60 s

export function createMeheryTransport(options: MeheryTransportOptions): ChatTransport {
  const domain = options.domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const context = options.context ?? '/postman';
  if (!isHostname(domain)) throw new Error('createMeheryTransport: "domain" must be a bare host name like "acme.mehery.io"');
  if (typeof __DEV__ !== 'undefined' && __DEV__ && options.user?.token && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(options.user.token)) {
    console.warn('[react-native-mehery-chat] user.token looks like a JWT. Mehery stores it unverified; pass a short-lived, chat-only token instead.');
  }
  if (!isContextPath(context)) throw new Error('createMeheryTransport: "context" must look like "/postman"');
  const base = `https://${domain}${context}`;
  const doFetch = options.fetch ?? fetch;
  const Socket = options.WebSocket ?? (globalThis as { WebSocket?: new (url: string) => SocketLike }).WebSocket;
  const pollMs = options.pollIntervalMs ?? 3000;
  const timeoutMs = options.requestTimeoutMs ?? 15_000;
  // Guests keep the original key; a signed-in user gets their own, so one user never inherits another's session.
  // One path segment: '/', '?' and '#' can't escape it; ':' stays readable ("web:acme.mehery.io").
  const seg = (v: string) => encodeURIComponent(v).replace(/%3A/gi, ':');
  let user = options.user ?? null; // clear() turns this transport into a guest
  const baseKey = `mehery:${domain}:${options.channelId}`;
  const storageKey = () => `${baseKey}${user?.id ? `:u:${user.id}` : ''}`;
  // Shared by every customer on this device: the name of the server's session cookie. A customer with
  // no saved session sends a new session id under that name, which wins over the previous customer's cookie.
  const metaKey = `${baseKey}:meta`;
  /** Ids of messages already delivered, so a lost reply to a send can be matched to its echo. */
  const known = new Set<string>();

  let session: Session | null = null;
  let handlers: TransportHandlers | null = null;
  let closed = true;
  let socket: SocketLike | null = null;
  let socketUp = false;
  let stomp: StompMeta = {};
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let livenessTimer: ReturnType<typeof setTimeout> | undefined;
  let reconnectAttempt = 0;
  let generation = 0;
  let reported: ConnectionStatus = 'connecting';
  /** Tells the chat about a change in reachability, once per change. */
  function report(next: ConnectionStatus): void {
    if (closed || reported === next) return;
    reported = next;
    handlers?.onConnection(next);
  }
  function closeSocket(keepPolling = false): void {
    if (!keepPolling) clearTimeout(pollTimer);
    clearTimeout(reconnectTimer);
    clearTimeout(livenessTimer);
    socketUp = false;
    const ws = socket;
    socket = null;
    try {
      ws?.close();
    } catch {
      // already closed
    }
  }
  // The web chat's safety net: while the chat is open, poll every 10 s unless a live message
  // arrived in the last 2 s (fetchMessage + setInterval in CustomerChat.vue).
  let active = false;
  let lastLiveAt = 0;
  let safetyTimer: ReturnType<typeof setInterval> | undefined;
  const SAFETY_POLL_MS = 10_000;
  const LIVE_GRACE_MS = 2_000;
  function updateSafetyPoll(): void {
    clearInterval(safetyTimer);
    if (closed || !active) return;
    safetyTimer = setInterval(() => {
      if (socketUp && Date.now() - lastLiveAt >= LIVE_GRACE_MS) void poll();
    }, SAFETY_POLL_MS);
  }

  // ----- persisted identity (the web chat used the browser fingerprint + a session cookie) -----

  async function loadSession(): Promise<Session> {
    if (session) return session;
    let saved: Partial<Session> = {};
    let cookieName: string | undefined;
    try {
      const raw = await options.storage?.getItem(storageKey());
      if (raw) saved = JSON.parse(raw) as Partial<Session>;
      if (!str(saved.installId)) {
        const meta = await options.storage?.getItem(metaKey);
        if (meta) cookieName = str((JSON.parse(meta) as Json).webSessionKey);
      }
    } catch {
      // unreadable storage: start fresh rather than fail
    }
    session = { ...saved, installId: str(saved.installId) ?? randomId() };
    if (cookieName && !session.webSessionId) {
      session.webSessionKey = cookieName;
      session.webSessionId = freshSessionId();
    }
    await saveSession();
    return session;
  }

  async function saveSession(): Promise<void> {
    if (!session || !options.storage) return;
    try {
      await options.storage.setItem(storageKey(), JSON.stringify(session));
      if (session.webSessionKey) await options.storage.setItem(metaKey, JSON.stringify({ webSessionKey: session.webSessionKey }));
    } catch {
      // persistence is best effort
    }
  }

  /** filterReponse() in the web chat: keep the session key/id and csid the server hands back. */
  function absorb(meta: unknown): void {
    if (!isObj(meta) || !session) return;
    const key = str(meta.webSessionIdKey);
    const id = str(meta.webSessionId);
    const csid = str(meta.csid);
    if (key) session.webSessionKey = key;
    if (id && !session.fresh) session.webSessionId = id;
    if (csid) session.csid = csid;
    if (isObj(meta.stomp)) {
      const ok = (v: unknown) => (isSafeToken(v) ? v : undefined);
      stomp = {
        xsessionId: ok(meta.stomp.xsessionId),
        jsessionId: ok(meta.stomp.jsessionId),
        tenantToken: ok(meta.stomp.tenantToken),
        tags: Array.isArray(meta.stomp.tags) ? meta.stomp.tags.filter(isSafeToken) : [],
      };
    }
    void saveSession();
  }

  /** The web chat passed the session as `?{webSessionIdKey}={webSessionId}` (and a cookie). */
  function sessionParam(): Record<string, string> {
    return session?.webSessionKey && session.webSessionId ? { [session.webSessionKey]: session.webSessionId } : {};
  }

  // ----- HTTP -----

  const query = (params: Record<string, string | undefined>) => {
    const parts = Object.entries(params)
      .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };

  async function request(url: string, init: RequestInit, limitMs = timeoutMs): Promise<Json> {
    const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = setTimeout(() => abort?.abort(), limitMs);
    try {
      const res = await doFetch(url, { credentials: 'include', ...init, headers: { Accept: 'application/json', ...(init.headers as Record<string, string>) }, ...(abort ? { signal: abort.signal } : {}) });
      // A redirect must not move the chat (and its channel key) to another host.
      const finalHost = typeof res.url === 'string' ? /^https?:\/\/([^/?#]+)/i.exec(res.url)?.[1]?.toLowerCase() : undefined;
      if (res.url && (!/^https:/i.test(res.url) || finalHost !== domain.toLowerCase())) throw new Error('Mehery: the request was redirected to another host');
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const message = isObj(body) ? str(body.message) ?? str(body.error) : undefined;
        throw new HttpError(res.status, `Mehery ${res.status}${message ? `: ${message}` : ''}`);
      }
      if (reported === 'offline') report('online'); // an answer from the server proves we are reachable again
      return isObj(body) ? body : {};
    } catch (error) {
      // No answer at all (offline, timeout): tell the chat. An HTTP error means the server is there.
      if (!(error instanceof HttpError)) report('offline');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function auth(): Promise<Json> {
    const s = await loadSession();
    const u = user;
    let token = u?.token;
    if (u && options.getIdentityToken) {
      try {
        token = (await options.getIdentityToken()) ?? token;
      } catch {
        // no signed identity available: send the plain claim
      }
    }
    // $service.submit: form-encoded, null/undefined fields skipped. Same field set as loadChats().
    const fields: Record<string, string | undefined> = {
      number: s.installId,
      csid: s.installId,
      browserfp: s.installId,
      channelId: options.channelId,
      channelKey: options.channelKey,
      visitorId: s.installId,
      userCode: u?.id,
      userToken: token,
      userName: u?.name,
      userEmail: u?.email,
      userPhone: u?.phone,
    };
    return request(`${base}/ext/plugin/outbound/web/auth/v2${query(sessionParam())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: query(fields).slice(1),
    });
  }

  /** fetchMessage(): the catch-up poll. Delivers through onMessage; the client dedupes by id. */
  async function fetchResults(): Promise<Json[]> {
    if (!session?.csid || session.fresh) return [];
    const body = await request(
      `${base}/ext/plugin/outbound/web/callback/v2${query({ number: session.csid, csid: session.csid, channelId: options.channelId, sessionId: session.webSessionId })}`,
      { method: 'GET' },
    );
    return list(body.results);
  }

  async function poll(): Promise<void> {
    try {
      for (const raw of await fetchResults()) {
        const m = mapMeheryMessage(raw);
        if (m) {
          known.add(m.id);
          handlers?.onMessage(m);
        }
      }
    } catch {
      // a failed poll just waits for the next tick
    }
  }

  function startPolling(): void {
    clearTimeout(pollTimer);
    const tick = async () => {
      if (closed || socketUp) return;
      await poll();
      if (!closed && !socketUp) pollTimer = setTimeout(tick, pollMs);
    };
    pollTimer = setTimeout(tick, pollMs);
  }

  // ----- live socket (tunnel.client.js) -----

  function openSocket(): void {
    if (closed || !Socket || !stomp.xsessionId) {
      startPolling();
      return;
    }
    closeSocket(true); // never two sockets; polling carries on until this one is up
    let buffer = '';
    let subId = 0;
    const subscriptions = new Map<string, (body: string) => void>();
    const ws = new Socket(`wss://${domain}${context}/stomp-tunnel/websocket`);
    socket = ws;

    const send = (frame: string) => {
      try {
        ws.send(frame);
      } catch {
        // socket already closing; onclose handles recovery
      }
    };
    const subscribe = (destination: string, onBody: (body: string) => void) => {
      const id = `sub-${subId++}`;
      subscriptions.set(id, onBody);
      send(stompFrame('SUBSCRIBE', { id, destination }));
    };
    const alive = () => {
      clearTimeout(livenessTimer);
      livenessTimer = setTimeout(() => ws.close(), LIVENESS_MS);
    };
    const onLiveMessage = (body: string) => {
      alive();
      lastLiveAt = Date.now();
      try {
        const parsed: unknown = JSON.parse(body);
        const m = mapMeheryMessage(isObj(parsed) && 'data' in parsed ? parsed.data : parsed);
        if (m) {
          known.add(m.id);
          handlers?.onMessage(m);
        }
      } catch {
        // malformed frame: skip it, the catch-up poll will fill gaps
      }
    };

    ws.onopen = () => {
      if (socket !== ws) return;
      send(stompFrame('CONNECT', { 'accept-version': '1.2,1.1,1.0', 'heart-beat': '0,0', user: 'guest', token: randomId(), xSessionId: stomp.xsessionId }));
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return; // a replaced socket must not deliver
      buffer += typeof event.data === 'string' ? event.data : '';
      const { frames, rest } = parseStomp(buffer);
      buffer = rest;
      for (const frame of frames) {
        if (frame.command === 'CONNECTED') {
          alive();
          const metaPath = ['/app/stomp/tunnel/meta', ...(stomp.xsessionId && stomp.jsessionId ? [stomp.xsessionId, stomp.jsessionId] : [])].join('/');
          // @SubscribeMapping answers once with this socket's tokens and tags.
          subscribe(metaPath, (body) => {
            let tenantToken = stomp.tenantToken;
            let tags = stomp.tags ?? [];
            let sessionToken: string | undefined;
            try {
              const meta: unknown = JSON.parse(body);
              if (isObj(meta)) {
                const t = meta['x-tenant-token'];
                const u = meta['x-session-uid'];
                if (isSafeToken(t)) tenantToken = t;
                if (isSafeToken(u)) sessionToken = u;
                if (Array.isArray(meta.tags) && meta.tags.length) tags = meta.tags.filter(isSafeToken);
              }
            } catch {
              // fall back to the tokens from auth/v2
            }
            // The same four headlines tunnel.client.js subscribes for a topic.
            subscribe(`/topic/_${TOPIC}`, onLiveMessage);
            if (tenantToken) subscribe(`/topic/${tenantToken}${TOPIC}`, onLiveMessage);
            if (sessionToken) subscribe(`/queue/${sessionToken}${TOPIC}`, onLiveMessage);
            for (const tag of tags) if (tenantToken) subscribe(`/tag/${tenantToken}/${tag}${TOPIC}`, onLiveMessage);
            subscribe(`/topic/_${HEALTH}`, alive);
            socketUp = true;
            reconnectAttempt = 0;
            clearTimeout(pollTimer);
            report('online');
            void poll(); // catch up on anything sent while we were connecting
          });
        } else if (frame.command === 'MESSAGE') {
          subscriptions.get(frame.headers.subscription ?? '')?.(frame.body);
        } else if (frame.command === 'ERROR') {
          ws.close();
        }
      }
    };
    ws.onerror = () => {
      // onclose follows and handles recovery
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      socketUp = false;
      clearTimeout(livenessTimer);
      if (closed) return;
      // Still "online": REST and polling carry the chat while the socket reconnects.
      startPolling();
      const delay = Math.min(30_000, 2_000 * 2 ** reconnectAttempt++);
      reconnectTimer = setTimeout(() => {
        void (async () => {
          // Two failures in a row: the socket tokens may have expired with the session. Sign in again first.
          if (reconnectAttempt >= 2) {
            try {
              absorb((await auth()).meta);
            } catch {
              // still unreachable or refused: the next attempt tries again
            }
          }
          openSocket();
        })();
      }, delay);
    };
  }

  return {
    async connect(h) {
      handlers = h;
      closed = false;
      const mine = ++generation;
      closeSocket(); // connect() twice (remount, StrictMode) must not leave the first socket running
      reported = 'connecting';
      h.onConnection('connecting');
      const body = await auth();
      absorb(body.meta);
      const history = (session?.fresh ? [] : list(body.results))
        .map(mapMeheryMessage)
        .filter((m): m is Message => m !== null);
      for (const m of history) known.add(m.id);
      // The REST side works on its own; the socket only speeds up replies.
      if (mine !== generation || closed) return history; // superseded by a newer connect() or a disconnect()
      reported = 'online';
      h.onConnection('online');
      openSocket();
      updateSafetyPoll();
      return history;
    },

    setActive(next) {
      active = next;
      updateSafetyPoll();
      if (next && !closed && session?.csid) void poll(); // reopening the chat catches up straight away
    },

    async send(message: OutgoingMessage): Promise<SendReceipt> {
      const s = await loadSession();
      if (!s.csid) throw new Error('Not connected to Mehery yet');
      const nonce = randomId(); // the server doesn't check it (the check is commented out)
      const path = `${base}/ext/plugin/inbound/v2/web/callback/${nonce}/${seg(options.channelId)}/${seg(options.channelKey)}`;
      const startedAt = Date.now();
      let body: Json;
      const attempt = async (): Promise<Json> => {
        if (message.file) {
          const form = new FormData();
          form.append('file', { uri: message.file.uri, name: safeFileName(message.file.name), type: message.file.mimeType } as unknown as Blob);
          // A photo is not a chat line: 60 s plus 10 s per MB, so a slow network doesn't time out and retry mid-upload.
          const upload = Math.max(timeoutMs, 60_000 + Math.ceil((message.file.size ?? 0) / 1_048_576) * 10_000);
          return request(`${path}${query({ from: s.csid, ...sessionParam() })}`, { method: 'PUT', body: form }, upload);
        }
        const payload: Json = { message: message.text, from: s.csid, form: message.form ?? {} };
        if (s.ticketHash) payload.session = { ticketHash: s.ticketHash };
        return request(`${path}${query(sessionParam())}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      };
      try {
        try {
          body = await attempt();
        } catch (error) {
          // The session expired while the app was open: sign in again once and replay (the server refused it, so it did not take it).
          if (!(error instanceof HttpError && (error.status === 401 || error.status === 403))) throw error;
          absorb((await auth()).meta);
          body = await attempt();
        }
      } catch (error) {
        // A timeout or dropped connection after the server took the message would make "retry" send it twice.
        // The server dedupes nothing, so look for our own text among the new messages first.
        if (error instanceof HttpError || message.file) throw error;
        const echo = await fetchResults().then(
          (rows) => rows.find((r) => r.type === 'I' && (str(r.text) ?? str(r.message)) === message.text && !known.has(str(r.messageId) ?? str(r.id) ?? '') && (typeof r.timestamp !== 'number' || r.timestamp >= startedAt - 60_000)),
          () => undefined,
        );
        if (!echo) throw error;
        body = { results: [echo] };
      }
      const sentId = str(list(body.results)[0]?.messageId);
      if (sentId) known.add(sentId);
      s.fresh = false;
      absorb(body.meta);
      const first = list(body.results)[0] ?? {};
      const receipt: SendReceipt = {
        id: str(first.messageId) ?? '',
        createdAt: typeof first.timestamp === 'number' && first.timestamp > 0 ? first.timestamp : Date.now(),
      };
      const mapped = mapMeheryMessage({ ...first, messageId: receipt.id || 'x' });
      if (mapped?.attachments) receipt.attachments = mapped.attachments;
      return receipt;
    },

    disconnect() {
      closed = true;
      generation += 1;
      clearInterval(safetyTimer);
      closeSocket();
    },

    /** Bring the connection back now: sign in again if needed, reopen the socket, catch up. */
    async reconnect() {
      if (closed) return;
      try {
        absorb((await auth()).meta);
      } catch {
        return; // request() already reported offline; the chat stays as it was
      }
      if (!socket) openSocket();
      void poll();
    },

    /** Logout: forget this identity on the device (storage and memory). The server session is untouched. */
    async clear() {
      const cookieName = session?.webSessionKey;
      const key = storageKey();
      session = null;
      stomp = {};
      known.clear();
      user = null; // this transport is a guest from now on; a signed-in customer needs a new transport
      try {
        if (options.storage?.removeItem) await options.storage.removeItem(key);
        else await options.storage?.setItem(key, '');
        // Keep the cookie's name so the next customer's first session id outranks this one's cookie.
        if (cookieName) await options.storage?.setItem(metaKey, JSON.stringify({ webSessionKey: cookieName }));
      } catch {
        // best effort
      }
    },

    /**
     * "New chat". The web-session cookie is HttpOnly and outlives the id we store, and auth/v2
     * trusts that cookie whenever the query is missing — so deleting the id reloads the old thread.
     * A different session id in the query wins over the cookie and comes back empty.
     * The next send carries a new ticketHash; the backend keys sessions on (contact, ticketHash)
     * and answers with the new session id.
     */
    async restart(options) {
      const s = await loadSession();
      if (options?.guest) {
        // A brand-new contact: new install id, and forget the server's contact id until auth answers.
        s.installId = randomId();
        delete s.csid;
      }
      if (s.webSessionKey) s.webSessionId = freshSessionId();
      else delete s.webSessionId;
      s.ticketHash = randomId();
      s.fresh = true;
      stomp = {};
      await saveSession();
    },
  };
}
