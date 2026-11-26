import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { ChatClient, withDialCode } from './client';
import { createMeheryTransport, mapMeheryMessage, parseStomp, stompFrame, type KeyValueStorage } from './meheryTransport';

// Response shapes copied from mehery-jx: InBoundControllerWeb.onAuthV2 / inboundMessageBoxEvent,
// ChatMessageDTO (history, poll) and OutboxMessage (socket).
const AUTH = {
  results: [{ messageId: 'icebrakerMsg', text: 'Hi, how can we help?', type: 'O', timestamp: 1000, options: { buttons: [{ code: 'track', name: 'track', label: 'Track order', type: 'QUICK_REPLY' }] } }],
  meta: {
    webSessionIdKey: 'web-session-id_web_acme',
    webSessionId: null,
    csid: 'gINSTALL',
    stomp: { xsessionId: 'X1', jsessionId: 'J1', tenantToken: 'TT', tags: ['tagA'] },
  },
};
const SENT = { results: [{ messageId: 'm-1', timestamp: 2000, type: 'I', message: 'hello' }], meta: { webSessionIdKey: 'web-session-id_web_acme', webSessionId: 'S1' } };

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function fakeFetch(responses: Record<string, unknown>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = Object.keys(responses).find((k) => url.includes(k));
    return { ok: true, status: 200, json: async () => (key ? responses[key] : {}) } as Response;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

class FakeSocket {
  static last: FakeSocket | null = null;
  sent: string[] = [];
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.last = this;
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.({});
  }
  serverSends(frame: string) {
    this.onmessage?.({ data: frame });
  }
  lastFrame() {
    return parseStomp(this.sent[this.sent.length - 1]!).frames[0]!;
  }
  subscriptions() {
    return this.sent.map((s) => parseStomp(s).frames[0]!).filter((f) => f.command === 'SUBSCRIBE');
  }
}

const flush = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const base = { domain: 'acme.mehery.io', channelId: 'web:acme.mehery.io', channelKey: 'KEY123' };

describe('mapMeheryMessage (same rules as the web chat toMessage)', () => {
  it('maps customer, bot and socket messages, buttons, form inputs and attachments', () => {
    expect(mapMeheryMessage({ messageId: 'a', type: 'I', text: 'hi', timestamp: 5 })).toMatchObject({ id: 'a', author: 'user', text: 'hi', createdAt: 5 });
    // OutboxMessage from the socket: no type, text in `message`.
    expect(mapMeheryMessage({ messageId: 'b', message: 'from bot' })).toMatchObject({ author: 'bot', text: 'from bot' });
    const rich = mapMeheryMessage({
      messageId: 'c',
      type: 'O',
      options: {
        buttons: [{ code: 'sales', name: 'sales', label: 'Sales' }, { label: 'Site', type: 'URL', url: 'https://a.co' }, { code: 'x' }],
        inputs: [{ code: 'email', type: 'EMAIL', label: 'Your email' }],
      },
      attachments: [
        { mediaURL: 'http://bucket.s3.amazonaws.com/a.jpg', mediaType: 'IMAGE', mediaCaption: 'Receipt' },
        { mediaURL: 'https://x/v.mp4', mediaType: 'VIDEO' },
        { mediaURL: 'https://x/a.pdf', mediaType: 'PDF', mediaName: 'invoice.pdf', mediaMimeType: 'application/pdf' },
        { mediaType: 'IMAGE' },
      ],
    });
    expect(rich?.buttons).toEqual([
      { id: 'sales', label: 'Sales', type: 'QUICK_REPLY' },
      { id: 'Site', label: 'Site', type: 'URL', url: 'https://a.co' },
    ]);
    expect(rich?.inputs).toEqual([{ name: 'email', type: 'EMAIL', label: 'Your email' }]);
    expect(rich?.attachments).toEqual([
      { url: 'https://bucket.s3.amazonaws.com/a.jpg', kind: 'image', name: 'Receipt', caption: 'Receipt' },
      { url: 'https://x/v.mp4', kind: 'video' },
      { url: 'https://x/a.pdf', kind: 'file', name: 'invoice.pdf', mimeType: 'application/pdf' },
    ]);
    expect(mapMeheryMessage({ text: 'no id' })).toBeNull();
    expect(
      mapMeheryMessage({ messageId: 'bg', attachments: [{ mediaURL: 'https://x/bg.mp3', mediaType: 'AUDIO', mediaSubType: 'BG_VOICE' }] })?.attachments,
    ).toEqual([{ url: 'https://x/bg.mp3', kind: 'audio', background: true }]);
  });
});

describe('STOMP framing', () => {
  it('round-trips frames, escapes headers, and buffers partial frames', () => {
    const frame = stompFrame('SEND', { destination: '/a:b', 'x-n': 'l1\nl2' }, '{"x":1}');
    const { frames, rest } = parseStomp(`${frame}\n${frame.slice(0, 10)}`);
    expect(frames).toEqual([{ command: 'SEND', headers: { destination: '/a:b', 'x-n': 'l1\nl2' }, body: '{"x":1}' }]);
    expect(rest).toBe(`\n${frame.slice(0, 10)}`); // kept until the rest of the frame arrives
    const more = parseStomp(rest + frame.slice(10));
    expect(more.frames).toHaveLength(1);
    expect(more.rest).toBe('');
  });
});

describe('createMeheryTransport (the web chat flow)', () => {
  it('auth/v2 exactly like loadChats(): form-encoded identity, history back, session kept', async () => {
    const storage = memoryStorage();
    const { fn, calls } = fakeFetch({ 'auth/v2': AUTH });
    const t = createMeheryTransport({ ...base, storage, fetch: fn, WebSocket: FakeSocket });
    const onMessage = vi.fn();
    const history = await t.connect({ onMessage, onConnection: vi.fn() });

    const auth = calls[0]!;
    expect(auth.url).toBe('https://acme.mehery.io/postman/ext/plugin/outbound/web/auth/v2');
    expect(auth.init.method).toBe('POST');
    expect((auth.init.headers as Record<string, string>)['Content-Type']).toContain('application/x-www-form-urlencoded');
    const form = new URLSearchParams(auth.init.body as string);
    const install = form.get('browserfp')!;
    expect(install).toBeTruthy();
    expect({ number: form.get('number'), csid: form.get('csid'), channelId: form.get('channelId'), channelKey: form.get('channelKey') }).toEqual({
      number: install,
      csid: install,
      channelId: 'web:acme.mehery.io',
      channelKey: 'KEY123',
    });
    expect(form.has('userCode')).toBe(false); // guest
    expect(history.map((m: Message) => m.id)).toEqual(['icebrakerMsg']);
    t.disconnect();

    // Same device next launch: same install id; the session travels as ?{key}={id}.
    storage.data.set(`mehery:acme.mehery.io:web:acme.mehery.io`, JSON.stringify({ installId: install, csid: 'gINSTALL', webSessionKey: 'web-session-id_web_acme', webSessionId: 'S9' }));
    const again = fakeFetch({ 'auth/v2': AUTH });
    const t2 = createMeheryTransport({ ...base, storage, fetch: again.fn, WebSocket: FakeSocket });
    await t2.connect({ onMessage, onConnection: vi.fn() });
    expect(again.calls[0]!.url).toContain('?web-session-id_web_acme=S9');
    expect(new URLSearchParams(again.calls[0]!.init.body as string).get('browserfp')).toBe(install);
    t2.disconnect();
  });

  it('sends a signed-in user like the web chat (userCode, userName, …)', async () => {
    const { fn, calls } = fakeFetch({ 'auth/v2': AUTH });
    const t = createMeheryTransport({ ...base, user: { id: '42', name: 'Sam', email: 's@a.co' }, fetch: fn, WebSocket: FakeSocket });
    await t.connect({ onMessage: vi.fn(), onConnection: vi.fn() });
    const form = new URLSearchParams(calls[0]!.init.body as string);
    expect({ userCode: form.get('userCode'), userName: form.get('userName'), userEmail: form.get('userEmail'), userPhone: form.get('userPhone') }).toEqual({
      userCode: '42',
      userName: 'Sam',
      userEmail: 's@a.co',
      userPhone: null,
    });
    t.disconnect();
  });

  it('sends text, quick replies and form answers to inbound/v2 with from=csid', async () => {
    const { fn, calls } = fakeFetch({ 'auth/v2': AUTH, 'inbound/v2': SENT });
    const t = createMeheryTransport({ ...base, fetch: fn, WebSocket: FakeSocket });
    await t.connect({ onMessage: vi.fn(), onConnection: vi.fn() });
    const receipt = await t.send({ text: 'Sales', form: { reply_id: 'sales', reply_title: 'Sales' } });
    const send = calls[1]!;
    expect(send.url).toMatch(/^https:\/\/acme\.mehery\.io\/postman\/ext\/plugin\/inbound\/v2\/web\/callback\/[^/]+\/web:acme\.mehery\.io\/KEY123$/);
    expect(send.init.method).toBe('POST');
    expect(JSON.parse(send.init.body as string)).toEqual({ message: 'Sales', from: 'gINSTALL', form: { reply_id: 'sales', reply_title: 'Sales' } });
    expect(receipt).toEqual({ id: 'm-1', createdAt: 2000 });
    // The server's new session id is used on the next call, as ?{key}={id}.
    await t.send({ text: 'again' });
    expect(calls[2]!.url).toContain('?web-session-id_web_acme=S1');
    t.disconnect();
  });

  it('uploads files with PUT multipart and ?from=csid', async () => {
    const { fn, calls } = fakeFetch({ 'auth/v2': AUTH, 'inbound/v2': SENT });
    const t = createMeheryTransport({ ...base, fetch: fn, WebSocket: FakeSocket });
    await t.connect({ onMessage: vi.fn(), onConnection: vi.fn() });
    await t.send({ text: '', file: { uri: 'file:///p.jpg', name: 'p.jpg', mimeType: 'image/jpeg' } });
    expect(calls[1]!.init.method).toBe('PUT');
    expect(calls[1]!.url).toContain('?from=gINSTALL');
    expect(calls[1]!.init.body).toBeInstanceOf(FormData);
    t.disconnect();
  });

  it('live replies over STOMP exactly like tunnel.client.js', async () => {
    const { fn } = fakeFetch({ 'auth/v2': AUTH, 'callback/v2': { results: [] } });
    const onMessage = vi.fn();
    const onConnection = vi.fn();
    const t = createMeheryTransport({ ...base, fetch: fn, WebSocket: FakeSocket });
    await t.connect({ onMessage, onConnection });
    const ws = FakeSocket.last!;
    expect(ws.url).toBe('wss://acme.mehery.io/postman/stomp-tunnel/websocket');

    ws.onopen?.({});
    expect(ws.lastFrame()).toMatchObject({ command: 'CONNECT', headers: { xSessionId: 'X1', 'heart-beat': '0,0' } });
    ws.serverSends(stompFrame('CONNECTED', { version: '1.2' }));
    const meta = ws.lastFrame();
    expect(meta.headers.destination).toBe('/app/stomp/tunnel/meta/X1/J1');

    ws.serverSends(stompFrame('MESSAGE', { subscription: meta.headers.id, destination: meta.headers.destination }, JSON.stringify({ 'x-session-uid': 'SU', 'x-tenant-token': 'TT2', tags: ['tagB'] })));
    const destinations = ws.subscriptions().map((f) => f.headers.destination);
    expect(destinations).toEqual(
      expect.arrayContaining([
        '/topic/_/message/receive/new',
        '/topic/TT2/message/receive/new',
        '/queue/SU/message/receive/new',
        '/tag/TT2/tagB/message/receive/new',
        '/topic/_/stomp/tunnel/health',
      ]),
    );
    expect(onConnection).toHaveBeenLastCalledWith('online');

    const tagSub = ws.subscriptions().find((f) => f.headers.destination === '/tag/TT2/tagB/message/receive/new')!;
    ws.serverSends(stompFrame('MESSAGE', { subscription: tagSub.headers.id }, JSON.stringify({ data: { messageId: 'r1', message: 'Reply from bot', timestamp: 3000 } })));
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', author: 'bot', text: 'Reply from bot' }));
    t.disconnect();
  });

  it('falls back to polling callback/v2 when the socket drops', async () => {
    const poll = { results: [{ messageId: 'p1', type: 'O', text: 'polled', timestamp: 4000 }] };
    const { fn, calls } = fakeFetch({ 'auth/v2': AUTH, 'callback/v2': poll });
    const onMessage = vi.fn();
    const t = createMeheryTransport({ ...base, fetch: fn, WebSocket: FakeSocket, pollIntervalMs: 5 });
    await t.connect({ onMessage, onConnection: vi.fn() });
    FakeSocket.last!.close();
    await new Promise<void>((r) => setTimeout(() => r(), 30));
    const pollCall = calls.find((c) => c.url.includes('callback/v2'))!;
    expect(pollCall.url).toContain('csid=gINSTALL');
    expect(pollCall.url).toContain('channelId=web%3Aacme.mehery.io');
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', text: 'polled' }));
    t.disconnect();
  });

  it('safety poll every 10 s only while the chat is open (web chat parity)', async () => {
    vi.useFakeTimers();
    const { fn, calls } = fakeFetch({ 'auth/v2': AUTH, 'callback/v2': { results: [] } });
    const t = createMeheryTransport({ ...base, fetch: fn, WebSocket: FakeSocket });
    await t.connect({ onMessage: vi.fn(), onConnection: vi.fn() });
    const ws = FakeSocket.last!;
    ws.onopen?.({});
    ws.serverSends(stompFrame('CONNECTED', {}));
    const meta = ws.lastFrame();
    ws.serverSends(stompFrame('MESSAGE', { subscription: meta.headers.id }, '{}'));
    const polls = () => calls.filter((c) => c.url.includes('callback/v2')).length;
    const afterConnect = polls(); // one catch-up poll when the socket comes up
    await vi.advanceTimersByTimeAsync(30_000);
    expect(polls()).toBe(afterConnect); // chat closed: no safety polling
    t.setActive?.(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(polls()).toBe(afterConnect + 1); // reopening catches up straight away
    await vi.advanceTimersByTimeAsync(20_000);
    expect(polls()).toBe(afterConnect + 3); // then every 10 s
    t.setActive?.(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(polls()).toBe(afterConnect + 3);
    t.disconnect();
    vi.useRealTimers();
  });

  it('new chat: asks for a different session so the old thread is not reloaded, and sends a fresh ticketHash', async () => {
    const fn = vi.fn(async (url: string) => {
      const old = url.includes('S1');
      const body = url.includes('auth/v2')
        ? old
          ? { ...AUTH, results: [{ messageId: 'old', text: 'old thread', type: 'O', timestamp: 1 }], meta: { ...AUTH.meta, webSessionId: 'S1' } }
          : { ...AUTH, results: [], meta: { ...AUTH.meta, webSessionId: null } }
        : SENT;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const storage = memoryStorage();
    storage.data.set(
      'mehery:acme.mehery.io:web:acme.mehery.io',
      JSON.stringify({ installId: 'install-1', csid: 'gINSTALL', webSessionKey: 'web-session-id_web_acme', webSessionId: 'S1' }),
    );
    const t = createMeheryTransport({ ...base, storage, fetch: fn as unknown as typeof fetch, WebSocket: FakeSocket });
    const c = new ChatClient(t);
    await c.start();
    c.send('first');
    await flush();
    expect(c.getState().messages.map((m) => m.text)).toContain('old thread');
    await c.newChat();
    expect(c.getState().messages).toEqual([]);
    const authUrls = fn.mock.calls.map((call) => String(call[0])).filter((url) => url.includes('auth/v2'));
    expect(authUrls.at(-1)).not.toContain('S1');
    expect(authUrls.at(-1)).toContain('web-session-id_web_acme=');
    c.send('second');
    await flush();
    const send = fn.mock.calls.map((call) => ({ url: String(call[0]), init: (call as unknown[])[1] as RequestInit })).filter((call) => call.url.includes('inbound/v2')).at(-1)!;
    expect(send.url).not.toContain('S1');
    expect(JSON.parse(send.init.body as string).session.ticketHash).toBeTruthy();
    c.stop();
  });
});

// ---------- Web parity contract ----------
// Real wire payloads in (captured live on customer.mehery.com, web:wwwmeherycom, 2026-11-16), the exact
// JSON body the web widget (chunk 03162c4f, module 510c) POSTs out. Runs the whole stack:
// mapMeheryMessage → normalizeMessage → ChatClient → createMeheryTransport → fetch.
const LIVE_INPUT = (code: string, type: string) => ({ code, variable: null, label: null, type, desc: null, url: null, shorturl: null, phone: null, action: null, uid: null, params: null, name: code });
const LIVE_HI = { messageId: '6afb02704cf1e506faa5e6f2', type: 'I', text: 'Hi', timestamp: 1794835054453, options: { '': '' }, attachments: null };
const LIVE_CARD = {
  messageId: '6afb02704cf1e506faa5e6f3',
  type: 'O',
  text: 'Please enter your',
  timestamp: 1794835054900, // ponytail: not captured live; any time after LIVE_HI
  options: { inputs: [LIVE_INPUT('name', 'TEXT'), LIVE_INPUT('email', 'EMAIL'), LIVE_INPUT('phone', 'PHONE')] },
  attachments: null,
};
const EMAIL_PROMPT = { messageId: 'ask-email', type: 'O', text: 'Your email?', timestamp: 1794835054900, options: { inputs: [LIVE_INPUT('email', 'EMAIL')] } };

/** Loads `wire` as history, runs `act`, returns the JSON body of the POST it caused. */
async function webBody(wire: unknown[], act: (c: ChatClient) => void): Promise<unknown> {
  const { fn, calls } = fakeFetch({ 'auth/v2': { ...AUTH, results: wire }, 'inbound/v2': SENT });
  const c = new ChatClient(createMeheryTransport({ ...base, fetch: fn, WebSocket: FakeSocket }));
  await c.start();
  act(c);
  await flush();
  c.stop();
  const send = calls.find((x) => x.url.includes('inbound/v2'));
  return send ? JSON.parse(send.init.body as string) : undefined;
}

describe('web parity contract (exact POST body)', () => {
  it('contact card Submit: { message: "Submitted", form: { name, email, phone } }', async () => {
    const body = await webBody([LIVE_HI, LIVE_CARD], (c) => c.sendForm({ name: 'Sam', email: 'sam@acme.com', phone: '+1 202-555-0100' }));
    expect(body).toEqual({ message: 'Submitted', from: 'gINSTALL', form: { name: 'Sam', email: 'sam@acme.com', phone: '+1 202-555-0100' } });
  });

  it('contact card Submit with a dial code: phone goes out international (vue-tel-input on the web)', async () => {
    const body = await webBody([LIVE_HI, LIVE_CARD], (c) => c.sendForm({ name: 'Sam', email: 'sam@acme.com', phone: withDialCode('09876543210', '+91') }));
    expect(body).toEqual({ message: 'Submitted', from: 'gINSTALL', form: { name: 'Sam', email: 'sam@acme.com', phone: '+91 9876543210' } });
  });

  // Web: onMessageRecvd sets form_input = inputs[0] for any inputs; the next composer text is form[name].
  it('typing in the composer while the card is latest sends form[inputs[0].name]', async () => {
    const body = await webBody([LIVE_HI, LIVE_CARD], (c) => c.send('hi'));
    expect(body).toEqual({ message: 'hi', from: 'gINSTALL', form: { name: 'hi' } });
  });

  it('a one-field card Submit: { message: "Submitted", form: { email } }', async () => {
    const body = await webBody([EMAIL_PROMPT], (c) => c.sendForm({ email: 'sam@acme.com' }));
    expect(body).toEqual({ message: 'Submitted', from: 'gINSTALL', form: { email: 'sam@acme.com' } });
  });

  it('a one-field prompt answered in the composer sends form[name]', async () => {
    const body = await webBody([EMAIL_PROMPT], (c) => c.send('sam@acme.com'));
    expect(body).toEqual({ message: 'sam@acme.com', from: 'gINSTALL', form: { email: 'sam@acme.com' } });
  });

  it('quick reply: { message: label, form: { reply_id, reply_title, replyIdExt: bot messageId } }', async () => {
    const menu = { messageId: 'menu-1', type: 'O', text: 'Pick one', timestamp: 1, options: { buttons: [{ code: 'sales', name: 'sales', label: 'Sales', type: 'QUICK_REPLY' }] } };
    const body = await webBody([menu], (c) => {
      const last = c.getState().messages.at(-1)!;
      c.sendQuickReply(last.buttons![0]!, last.id); // what QuickReplies in MessageList passes
    });
    expect(body).toEqual({ message: 'Sales', from: 'gINSTALL', form: { reply_id: 'sales', reply_title: 'Sales', replyIdExt: 'menu-1' } });
  });

  it('icebreaker quick link sends the button code with an empty form', async () => {
    const ice = { messageId: 'icebrakerMsg', type: 'O', text: 'Hi, how can we help?', timestamp: 1000, options: { buttons: [{ code: 'track', name: 'track', label: 'Track order', type: 'QUICK_REPLY' }] } };
    const body = await webBody([ice], (c) => c.sendText('track'));
    expect(body).toEqual({ message: 'track', from: 'gINSTALL', form: {} });
  });

  it('icebreaker "Chat with human" sends "#"', async () => {
    const ice = { messageId: 'icebrakerMsg', type: 'O', text: 'Hi, how can we help?', timestamp: 1000 };
    const body = await webBody([ice], (c) => c.sendText('#'));
    expect(body).toEqual({ message: '#', from: 'gINSTALL', form: {} });
  });

  it('a message after the customer answered goes out with an empty form', async () => {
    const answer = { messageId: 'ans', type: 'I', text: 'sam@acme.com', timestamp: 1794835055000 };
    const body = await webBody([EMAIL_PROMPT, answer], (c) => c.send('thanks'));
    expect(body).toEqual({ message: 'thanks', from: 'gINSTALL', form: {} });
  });
});
