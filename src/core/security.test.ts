import { describe, expect, it, vi } from 'vitest';
import { ChatClient } from './client';
import { createMeheryTransport, mapMeheryMessage, stompFrame, parseStomp, type KeyValueStorage } from './meheryTransport';
import { createMockTransport } from './mockTransport';
import { checkFile, isContextPath, isHostname, isSafeToken, redactUrl, safeFileName, safeLink, safeMediaUrl } from './security';
import { thumbnailUrl } from './media';

const AUTH = { results: [], meta: { webSessionIdKey: 'k', csid: 'C1', stomp: { xsessionId: 'X1', jsessionId: 'J1', tenantToken: 'TT', tags: ['ok', 'bad/tag', 'a\nb'] } } };
const store = (): KeyValueStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const json = (body: unknown, extra: object = {}) => ({ ok: true, status: 200, json: async () => body, ...extra }) as Response;
const base = { domain: 'acme.mehery.io', channelId: 'web:acme.mehery.io', channelKey: 'KEY123' };

describe('links', () => {
  it('allows https, mailto, tel, upgrades http, blocks the rest', () => {
    expect(safeLink('https://a.co/x')).toBe('https://a.co/x');
    expect(safeLink('http://a.co')).toBe('https://a.co');
    expect(safeLink('MAILTO:a@b.co')).toBe('MAILTO:a@b.co');
    expect(safeLink('tel:+911234567890')).toBe('tel:+911234567890');
    expect(safeLink('www.a.co')).toBe('https://www.a.co');
    for (const bad of ['javascript:alert(1)', 'file:///etc/hosts', 'intent://x#Intent;end', 'sms:1', 'market://x', 'myapp://x', 'data:text/html,x', ' java\nscript:x', 'https://a.co/\u0000', '', undefined, 5]) {
      expect(safeLink(bad)).toBeNull();
    }
  });
  it('lets the host opt in to deep-link schemes', () => {
    expect(safeLink('myapp://order/1', ['myapp'])).toBe('myapp://order/1');
    expect(safeLink('other://x', ['myapp'])).toBeNull();
  });
  it('redacts to scheme and host', () => {
    expect(redactUrl('https://a.co/path?token=SECRET')).toBe('https://a.co');
    expect(redactUrl('javascript:alert(1)')).toBe('javascript:');
  });
});

describe('server media', () => {
  it('keeps only https (http upgraded) and drops local or data URLs', () => {
    expect(safeMediaUrl('http://b.s3.amazonaws.com/a.jpg')).toBe('https://b.s3.amazonaws.com/a.jpg');
    for (const bad of ['file:///a.jpg', 'data:image/png;base64,AA', 'content://x', 'ftp://x/a', 'https://a b']) expect(safeMediaUrl(bad)).toBeNull();
    const m = mapMeheryMessage({ messageId: 'a', attachments: [{ mediaURL: 'file:///etc/passwd' }, { mediaURL: 'http://x.co/a.pdf', mediaType: 'FILE' }] });
    expect(m?.attachments).toEqual([{ url: 'https://x.co/a.pdf', kind: 'file' }]);
  });
  it('thumbnailProxy false keeps S3 off ImageKit', () => {
    const s3 = 'https://bkt.s3.amazonaws.com/a.jpg';
    expect(thumbnailUrl(s3, 100)).toContain('imagekit');
    expect(thumbnailUrl(s3, 100, undefined, false)).toBe(s3);
  });
});

describe('files', () => {
  const policy = { types: ['image' as const, 'document' as const], maxMB: 1 };
  it('requires a local uri, an allowed type and size', () => {
    expect(checkFile({ uri: 'https://x/a.jpg' }, policy)).toMatch(/local/);
    expect(checkFile({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, policy)).toBeNull();
    expect(checkFile({ uri: 'file:///a.exe', name: 'a.exe', mimeType: 'application/x-msdownload' }, policy)).toMatch(/type/);
    expect(checkFile({ uri: 'file:///a.jpg', mimeType: 'image/jpeg', size: 2 * 1024 * 1024 }, policy)).toMatch(/larger/);
    expect(checkFile({ uri: 'file:///a.jpg', mimeType: 'image/jpeg' }, { types: ['document'], maxMB: 1 })).toMatch(/type/);
    expect(checkFile({ uri: 'file:///r.m4a', mimeType: 'audio/mp4' }, policy)).toBeNull(); // voice notes
  });
  it('cleans file names', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName(undefined)).toBe('file');
    expect(safeFileName('a'.repeat(300))).toHaveLength(120);
  });
  it('client.sendFile reports a rejected file and sends a cleaned one', async () => {
    const onError = vi.fn();
    const send = vi.fn(async () => ({ id: 's1', createdAt: 1 }));
    const t = { ...createMockTransport(), send };
    const c = new ChatClient(t, { onError });
    c.setFilePolicy({ types: ['image'], maxMB: 1 });
    c.sendFile({ uri: 'https://evil/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg' });
    c.sendFile({ uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf' });
    expect(onError.mock.calls.map((x) => x[0].code)).toEqual(['ATTACHMENT_REJECTED', 'ATTACHMENT_REJECTED']);
    expect(send).not.toHaveBeenCalled();
    c.sendFile({ uri: 'file:///dir/a.jpg', name: '../a.jpg', mimeType: 'image/jpeg' });
    expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ file: { name: '.._a.jpg' } });
    c.stop();
  });
});

describe('transport hardening', () => {
  it('validates domain and context', () => {
    for (const d of ['evil.com/x', 'a@evil.com', 'evil.com#', 'a b.com', '', 'evil.com?x=1']) expect(() => createMeheryTransport({ ...base, domain: d })).toThrow(/domain/);
    expect(() => createMeheryTransport({ ...base, context: '/a/../b?x' })).toThrow(/context/);
    expect(() => createMeheryTransport({ ...base, domain: 'https://acme.mehery.io/' })).not.toThrow();
    expect(isHostname('a.co:8443')).toBe(true);
    expect(isContextPath('')).toBe(true);
  });
  it('refuses a response that came from another host or over http', async () => {
    for (const url of ['https://evil.com/x', 'http://acme.mehery.io/x']) {
      const t = createMeheryTransport({ ...base, fetch: (async () => json(AUTH, { url })) as unknown as typeof fetch });
      await expect(t.connect({ onMessage() {}, onConnection() {} })).rejects.toThrow(/redirected/);
    }
    const ok = createMeheryTransport({ ...base, WebSocket: undefined, fetch: (async () => json(AUTH, { url: 'https://ACME.mehery.io/postman/x' })) as unknown as typeof fetch });
    await expect(ok.connect({ onMessage() {}, onConnection() {} })).resolves.toEqual([]);
    ok.disconnect();
  });
  it('keeps channelId and channelKey inside their path segment', async () => {
    const urls: string[] = [];
    const fetchFn = (async (u: string) => (urls.push(u), json(u.includes('auth') ? AUTH : { results: [] }))) as unknown as typeof fetch;
    const t = createMeheryTransport({ ...base, channelKey: 'a/b?c#d', fetch: fetchFn });
    await t.connect({ onMessage() {}, onConnection() {} });
    await t.send({ text: 'hi' });
    expect(urls.at(-1)).toContain('/web:acme.mehery.io/a%2Fb%3Fc%23d');
    t.disconnect();
  });
  it('only accepts safe stomp ids and escapes CR in headers', () => {
    expect(isSafeToken('ok.tag-1')).toBe(true);
    for (const bad of ['a/b', 'a\nb', '', 'x'.repeat(300), 5]) expect(isSafeToken(bad)).toBe(false);
    const f = stompFrame('SEND', { h: 'a\rb' });
    expect(f).not.toContain('\r');
    expect(parseStomp(f).frames[0]!.headers.h).toBe('a\rb');
  });
  it('subscribes only to safe tags', async () => {
    class Sock {
      static last: Sock;
      sent: string[] = [];
      onopen: any = null; onmessage: any = null; onerror: any = null; onclose: any = null;
      constructor(public url: string) { Sock.last = this; }
      send(d: string) { this.sent.push(d); }
      close() {}
    }
    const t = createMeheryTransport({ ...base, WebSocket: Sock as never, fetch: (async () => json(AUTH)) as unknown as typeof fetch });
    await t.connect({ onMessage() {}, onConnection() {} });
    expect(Sock.last.url).toBe('wss://acme.mehery.io/postman/stomp-tunnel/websocket');
    Sock.last.onmessage({ data: stompFrame('CONNECTED', {}) });
    const metaSub = parseStomp(Sock.last.sent.at(-1)!).frames[0]!;
    Sock.last.onmessage({ data: stompFrame('MESSAGE', { subscription: metaSub.headers.id }, '{"x-tenant-token":"T/../x","tags":["good","bad/one"]}') });
    const dests = Sock.last.sent.map((x) => parseStomp(x).frames[0]!.headers.destination).filter(Boolean);
    expect(dests.some((d) => d!.includes('/good/'))).toBe(true);
    expect(dests.some((d) => d!.includes('bad'))).toBe(false);
    expect(dests.some((d) => d!.includes('T/../x'))).toBe(false);
    t.disconnect();
  });
});

describe('session storage', () => {
  const fetchOk = (async (u: string) => json(u.includes('auth') ? AUTH : {})) as unknown as typeof fetch;
  it('keeps each signed-in user in their own record, guests on the original key', async () => {
    const storage = store();
    const a = createMeheryTransport({ ...base, storage, user: { id: 'A' }, fetch: fetchOk });
    const b = createMeheryTransport({ ...base, storage, user: { id: 'B' }, fetch: fetchOk });
    const g = createMeheryTransport({ ...base, storage, fetch: fetchOk });
    for (const t of [a, b, g]) await t.connect({ onMessage() {}, onConnection() {} }).then(() => t.disconnect());
    // ":meta" holds only the name of the server's session cookie, shared by everyone on the device.
    const sessions = [...storage.data.entries()].filter(([k]) => !k.endsWith(':meta'));
    expect(sessions.map(([k]) => k).sort()).toEqual(['mehery:acme.mehery.io:web:acme.mehery.io', 'mehery:acme.mehery.io:web:acme.mehery.io:u:A', 'mehery:acme.mehery.io:web:acme.mehery.io:u:B'].sort());
    const ids = sessions.map(([, v]) => JSON.parse(v).installId);
    expect(new Set(ids).size).toBe(3);
  });
  it('logout wipes the stored session', async () => {
    const storage = store();
    const c = new ChatClient(createMeheryTransport({ ...base, storage, fetch: fetchOk }), {});
    await c.start();
    expect(storage.data.size).toBe(2); // the session and the cookie name
    await c.logout();
    expect([...storage.data.keys()]).toEqual(['mehery:acme.mehery.io:web:acme.mehery.io:meta']); // no csid, no session id
    expect(c.getState().messages).toEqual([]);
  });
  it('logout blanks the record when storage has no removeItem', async () => {
    const data = new Map<string, string>();
    const storage: KeyValueStorage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
    const t = createMeheryTransport({ ...base, storage, fetch: fetchOk });
    await t.connect({ onMessage() {}, onConnection() {} });
    t.disconnect();
    await t.clear!();
    expect(data.get('mehery:acme.mehery.io:web:acme.mehery.io')).toBe('');
  });
});

describe('lost reply to a send', () => {
  it('does not offer a duplicate: finds the echo of the message the server already took', async () => {
    let n = 0;
    const fetchFn = (async (u: string, init?: RequestInit) => {
      if (u.includes('auth')) return json(AUTH);
      if (init?.method === 'POST') throw new Error('timeout');
      n++;
      return json({ results: [{ messageId: 'srv-1', type: 'I', text: 'hello', timestamp: Date.now() }] });
    }) as unknown as typeof fetch;
    const t = createMeheryTransport({ ...base, fetch: fetchFn });
    await t.connect({ onMessage() {}, onConnection() {} });
    await expect(t.send({ text: 'hello' })).resolves.toMatchObject({ id: 'srv-1' });
    expect(n).toBe(1);
    t.disconnect();
  });
  it('still fails when there is no echo, and on HTTP errors', async () => {
    const mk = (post: () => Response) => createMeheryTransport({ ...base, fetch: (async (u: string, init?: RequestInit) => (u.includes('auth') ? json(AUTH) : init?.method === 'POST' ? post() : json({ results: [] }))) as unknown as typeof fetch });
    const t = mk(() => { throw new Error('timeout'); });
    await t.connect({ onMessage() {}, onConnection() {} });
    await expect(t.send({ text: 'x' })).rejects.toThrow('timeout');
    t.disconnect();
    const h = mk(() => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    await h.connect({ onMessage() {}, onConnection() {} });
    await expect(h.send({ text: 'x' })).rejects.toThrow(/500/);
    h.disconnect();
  });
});
