import { describe, expect, it, vi } from 'vitest';
import type { ChatTransport, ConnectionStatus, Message, MeheryError, OutgoingMessage, TransportHandlers } from '../types';
import { ChatClient } from './client';
import { createMeheryTransport, parseStomp, type KeyValueStorage } from './meheryTransport';

const AUTH = {
  results: [],
  meta: { webSessionIdKey: 'web-session-id_acme', webSessionId: null, csid: 'C1', stomp: { xsessionId: 'X1', jsessionId: 'J1', tenantToken: 'TT', tags: [] } },
};
const SENT = { results: [{ messageId: 'm-1', timestamp: 2000, type: 'I', message: 'hi' }], meta: { webSessionIdKey: 'web-session-id_acme', webSessionId: 'S1' } };
// Always inject a socket: the global WebSocket would try the real network.
class Sock0 {
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  send() {}
  close() {}
}
/** A socket that can't connect: the transport falls back to polling. */
class DeadSock extends Sock0 {
  constructor() {
    super();
    setTimeout(() => this.onclose?.({}), 0);
  }
}
const base = { domain: 'acme.mehery.io', channelId: 'web:acme.mehery.io', channelKey: 'KEY', WebSocket: Sock0 };
const wait = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));

const reply = (status: number, body: unknown = {}) => ({ ok: status < 400, status, url: '', json: async () => body }) as unknown as Response;

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

class Sock {
  static all: Sock[] = [];
  closed = false;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    Sock.all.push(this);
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.closed = true;
    this.onclose?.({});
  }
}

describe('connection state', () => {
  it('reports offline when requests get no answer, and online again once one does', async () => {
    let down = false;
    const fetchFn = (async (url: string) => {
      if (down) throw new TypeError('Network request failed');
      return reply(200, url.includes('auth') ? AUTH : { results: [] });
    }) as unknown as typeof fetch;
    const seen: ConnectionStatus[] = [];
    const t = createMeheryTransport({ ...base, WebSocket: DeadSock, fetch: fetchFn, pollIntervalMs: 5 });
    await t.connect({ onMessage() {}, onConnection: (s) => seen.push(s) });
    down = true;
    await wait(40);
    expect(seen.at(-1)).toBe('offline');
    down = false;
    await wait(40);
    expect(seen.at(-1)).toBe('online');
    expect(seen.filter((s) => s === 'offline')).toHaveLength(1); // once per change, not once per failed poll
    t.disconnect();
  });
});

describe('refused credentials', () => {
  it('401 on connect is AUTH_FAILED and is not retried in a loop', async () => {
    const fetchFn = vi.fn(async () => reply(401, { message: 'bad key' })) as unknown as typeof fetch;
    const errors: MeheryError[] = [];
    const c = new ChatClient(createMeheryTransport({ ...base, fetch: fetchFn }), { onError: (e) => errors.push(e) });
    await c.start();
    await wait(60);
    expect(errors.map((e) => e.code)).toEqual(['AUTH_FAILED']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(c.getState().connection).toBe('offline');
    c.stop();
  });

  it('a 5xx is still a NETWORK error that retries', async () => {
    const errors: MeheryError[] = [];
    const c = new ChatClient(createMeheryTransport({ ...base, fetch: (async () => reply(503)) as unknown as typeof fetch }), { onError: (e) => errors.push(e) });
    await c.start();
    expect(errors.map((e) => e.code)).toEqual(['NETWORK']);
    c.stop();
  });

  it('a send refused with 401 signs in again once and replays', async () => {
    let refused = 1;
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      if (url.includes('auth')) return reply(200, AUTH);
      if (url.includes('inbound') && refused-- > 0) return reply(401);
      return reply(200, SENT);
    }) as unknown as typeof fetch;
    const t = createMeheryTransport({ ...base, fetch: fetchFn });
    await t.connect({ onMessage() {}, onConnection() {} });
    const receipt = await t.send({ text: 'hi' });
    expect(receipt.id).toBe('m-1');
    expect(urls.filter((u) => u.includes('auth'))).toHaveLength(2);
    expect(urls.filter((u) => u.includes('inbound'))).toHaveLength(2);
    t.disconnect();
  });
});

describe('sockets and timeouts', () => {
  it('connecting twice leaves exactly one live socket', async () => {
    Sock.all = [];
    const fetchFn = (async (url: string) => reply(200, url.includes('auth') ? AUTH : {})) as unknown as typeof fetch;
    const t = createMeheryTransport({ ...base, fetch: fetchFn, WebSocket: Sock });
    const h: TransportHandlers = { onMessage() {}, onConnection() {} };
    await Promise.all([t.connect(h), t.connect(h)]);
    await t.connect(h);
    const live = Sock.all.filter((s) => !s.closed);
    expect(live).toHaveLength(1);
    t.disconnect();
    expect(Sock.all.every((s) => s.closed)).toBe(true);
  });

  it('a replaced socket delivers nothing', async () => {
    Sock.all = [];
    const got: string[] = [];
    const fetchFn = (async (url: string) => reply(200, url.includes('auth') ? AUTH : {})) as unknown as typeof fetch;
    const t = createMeheryTransport({ ...base, fetch: fetchFn, WebSocket: Sock });
    const h: TransportHandlers = { onMessage: (m) => got.push(m.id), onConnection() {} };
    await t.connect(h);
    const first = Sock.all[0]!;
    await t.connect(h);
    first.onmessage?.({ data: 'CONNECTED\n\n\0' });
    expect(first.sent.map((s) => parseStomp(s).frames[0]?.command)).not.toContain('SUBSCRIBE');
    t.disconnect();
  });

  it('gives a photo upload far longer than a chat line', async () => {
    const signals: Record<string, AbortSignal | undefined> = {};
    const fetchFn = ((url: string, init: RequestInit) => {
      if (url.includes('auth')) return Promise.resolve(reply(200, AUTH));
      signals[init.method ?? ''] = init.signal ?? undefined;
      return new Promise<Response>(() => {}); // never answers
    }) as unknown as typeof fetch;
    const t = createMeheryTransport({ ...base, fetch: fetchFn, requestTimeoutMs: 15 });
    await t.connect({ onMessage() {}, onConnection() {} });
    void t.send({ text: 'hello' }).catch(() => {});
    void t.send({ text: '', file: { uri: 'file:///p.jpg', name: 'p.jpg', mimeType: 'image/jpeg', size: 5 * 1024 * 1024 } }).catch(() => {});
    await wait(60);
    expect(signals.POST?.aborted).toBe(true);
    expect(signals.PUT?.aborted).toBe(false);
    t.disconnect();
  });
});

describe('signing out and switching customers', () => {
  const fetchLog = () => {
    const calls: { url: string; body: string }[] = [];
    const fn = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init?.body ?? '') });
      return reply(200, url.includes('auth') ? AUTH : {});
    }) as unknown as typeof fetch;
    return { fn, calls };
  };

  it('after clear() the next sign-in is a guest with a session id of its own', async () => {
    const storage = memoryStorage();
    const log = fetchLog();
    const t = createMeheryTransport({ ...base, storage, fetch: log.fn, user: { id: 'A', name: 'Ann' } });
    await t.connect({ onMessage() {}, onConnection() {} });
    t.disconnect();
    await t.clear!();
    await t.connect({ onMessage() {}, onConnection() {} });
    const [first, second] = log.calls.filter((c) => c.url.includes('auth'));
    expect(first!.body).toContain('userCode=A');
    expect(second!.body).not.toContain('userCode');
    expect(second!.body).not.toContain('Ann');
    expect(second!.url).toMatch(/web-session-id_acme=[0-9a-f]{24}/); // outranks the old customer's HttpOnly cookie
    t.disconnect();
  });

  it('a different customer on the same device does not inherit the previous session or cookie', async () => {
    const storage = memoryStorage();
    const log = fetchLog();
    const a = createMeheryTransport({ ...base, storage, fetch: log.fn, user: { id: 'A' } });
    await a.connect({ onMessage() {}, onConnection() {} });
    a.disconnect();
    const b = createMeheryTransport({ ...base, storage, fetch: log.fn, user: { id: 'B' } });
    await b.connect({ onMessage() {}, onConnection() {} });
    const last = log.calls.filter((c) => c.url.includes('auth')).at(-1)!;
    expect(last.body).toContain('userCode=B');
    expect(last.url).toMatch(/web-session-id_acme=[0-9a-f]{24}/);
    b.disconnect();
  });

  it('getIdentityToken supplies userToken at every sign-in', async () => {
    const log = fetchLog();
    let n = 0;
    const t = createMeheryTransport({ ...base, fetch: log.fn, user: { id: 'A', token: 'plain' }, getIdentityToken: async () => `signed-${++n}` });
    await t.connect({ onMessage() {}, onConnection() {} });
    t.disconnect();
    await t.connect({ onMessage() {}, onConnection() {} });
    const bodies = log.calls.filter((c) => c.url.includes('auth')).map((c) => c.body);
    expect(bodies[0]).toContain('userToken=signed-1');
    expect(bodies[1]).toContain('userToken=signed-2');
    t.disconnect();
  });
});

// ---- the engine ----

function scripted() {
  const sent: OutgoingMessage[] = [];
  let handlers: TransportHandlers | undefined;
  const transport: ChatTransport = {
    async connect(h) {
      handlers = h;
      h.onConnection('online');
      return [];
    },
    async send(m) {
      sent.push(m);
      return { id: `s${sent.length}`, createdAt: 5_000 + sent.length };
    },
    disconnect() {},
  };
  return { transport, sent, push: (m: Message) => handlers?.onMessage(m), conn: (s: ConnectionStatus) => handlers?.onConnection(s) };
}
const bot = (id: string, createdAt: number): Message => ({ id, author: 'bot', text: id, createdAt });

describe('ChatClient ordering and state', () => {
  it('puts a back-filled message where it belongs, not at the end', async () => {
    const s = scripted();
    const c = new ChatClient(s.transport);
    await c.start();
    s.push(bot('a', 100));
    s.push(bot('c', 300));
    s.push(bot('b', 200)); // a poll fills a gap
    expect(c.getState().messages.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    c.stop();
  });

  it('a reply that arrives while a send is pending goes after it, and the sent message takes the server time', async () => {
    const s = scripted();
    const c = new ChatClient(s.transport);
    await c.start();
    c.send('hello');
    s.push(bot('r', 50));
    expect(c.getState().messages.map((m) => m.id)).toEqual(['local-1', 'r']);
    await wait();
    expect(c.getState().messages.find((m) => m.localId === 'local-1')?.createdAt).toBe(5_001);
    c.stop();
  });

  it('flags a contact-card submission so only that is hidden, never a typed "Submitted"', async () => {
    const s = scripted();
    const c = new ChatClient(s.transport);
    await c.start();
    s.push({ ...bot('card', 10), inputs: [{ name: 'name', type: 'TEXT' }] });
    c.sendForm({ name: 'Sam' });
    c.send('Submitted');
    const mine = c.getState().messages.filter((m) => m.author === 'user');
    expect(mine.map((m) => !!m.formSubmit)).toEqual([true, false]);
    c.stop();
  });

  it('tells the host when the connection changes, once per change', async () => {
    const s = scripted();
    const seen: ConnectionStatus[] = [];
    const c = new ChatClient(s.transport, { onConnectionChange: (x) => seen.push(x) });
    await c.start();
    s.conn('offline');
    s.conn('offline');
    s.conn('online');
    expect(seen).toEqual(['online', 'offline', 'online']);
    c.stop();
  });

  it('waits as long as the configured thinking timeout', async () => {
    const s = scripted();
    const c = new ChatClient(s.transport);
    c.thinkingTimeoutMs = 20;
    await c.start();
    c.send('hello');
    await wait(5);
    expect(c.getState().thinking).toBe(true);
    await wait(40);
    expect(c.getState().thinking).toBe(false);
    c.stop();
  });

  it('reconnect() on a connected chat asks the transport instead of doing nothing', async () => {
    const s = scripted();
    const reconnect = vi.fn();
    const c = new ChatClient({ ...s.transport, reconnect });
    await c.start();
    c.reconnect();
    expect(reconnect).toHaveBeenCalledTimes(1);
    c.stop();
  });
});
