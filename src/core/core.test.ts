import { describe, expect, it, vi } from 'vitest';
import type { ChatTransport, Message, OutgoingMessage, TransportHandlers } from '../types';
import { ChatClient, attachmentKind, backgroundTrack, formFields, isDelivered, isFormCard, isIcebreaker, isValidInput, limitPhoneDigits, phoneDigitCount, visibleAttachments, withDialCode } from './client';
import { contrast, isSvgRef, resolveConfig, withAlpha } from './config';
import { formatStamp, isRTL, parseRichText, revealStops, sliceRange } from './richText';

function fakeTransport(history: Message[] = []) {
  const sent: OutgoingMessage[] = [];
  let handlers: TransportHandlers | undefined;
  let fail = false;
  let n = 0;
  let current = history;
  const transport: ChatTransport = {
    async connect(h) {
      handlers = h;
      h.onConnection('online');
      return current;
    },
    restart() {
      current = [];
    },
    async send(m) {
      sent.push(m);
      if (fail) throw new Error('boom');
      return { id: `s${++n}`, createdAt: 1 };
    },
    disconnect() {},
  };
  return {
    transport,
    sent,
    push: (m: Message) => handlers?.onMessage(m),
    setFail: (f: boolean) => (fail = f),
  };
}
const flush = () => new Promise<void>((r) => setTimeout(() => r(), 0));
const botMsg = (id: string, extra: Partial<Message> = {}): Message => ({ id, author: 'bot', text: id, createdAt: 2, ...extra });

describe('ChatClient', () => {
  it('sends optimistically, then confirms with the server id and expects a reply', async () => {
    const t = fakeTransport();
    const c = new ChatClient(t.transport);
    await c.start();
    c.send('  hi  ');
    expect(c.getState().messages[0]).toMatchObject({ text: 'hi', status: 'sending', author: 'user' });
    expect(c.getState().thinking).toBe(true); // typing starts with the local bubble, not the receipt
    await flush();
    expect(c.getState().messages[0]).toMatchObject({ id: 's1', status: 'sent' });
    expect(c.getState().thinking).toBe(true);
    t.push(botMsg('b1'));
    expect(c.getState().thinking).toBe(false);
    c.stop();
  });

  it('clears thinking when a bot reply arrives before the send receipt, and stays quiet after', async () => {
    let releaseSend: (receipt: { id: string; createdAt: number }) => void = () => {};
    const gate = new Promise<{ id: string; createdAt: number }>((resolve) => {
      releaseSend = resolve;
    });
    let handlers: TransportHandlers | undefined;
    const transport: ChatTransport = {
      async connect(h) {
        handlers = h;
        h.onConnection('online');
        return [];
      },
      send: () => gate,
      disconnect() {},
    };
    const c = new ChatClient(transport);
    await c.start();
    c.send('Hello');
    expect(c.getState().thinking).toBe(true);
    handlers?.onMessage(botMsg('card', {
      text: 'Please enter your',
      inputs: [
        { name: 'name', type: 'TEXT' },
        { name: 'email', type: 'EMAIL' },
        { name: 'phone', type: 'PHONE' },
      ],
    }));
    expect(c.getState().messages.at(-1)).toMatchObject({ id: 'card', author: 'bot' });
    expect(c.getState().thinking).toBe(false);
    releaseSend({ id: 's1', createdAt: 3 });
    await flush();
    expect(c.getState().messages[0]).toMatchObject({ id: 's1', status: 'sent', author: 'user' });
    expect(c.getState().thinking).toBe(false);
    c.stop();
  });

  it('clears thinking on the timeout when no reply arrives', async () => {
    vi.useFakeTimers();
    try {
      const t = fakeTransport();
      const c = new ChatClient(t.transport);
      await c.start();
      c.send('hi');
      expect(c.getState().thinking).toBe(true);
      // Instant send resets the timeout on receipt; full window counts from then.
      await vi.advanceTimersByTimeAsync(0);
      expect(c.getState().thinking).toBe(true);
      await vi.advanceTimersByTimeAsync(19_999);
      expect(c.getState().thinking).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(c.getState().thinking).toBe(false);
      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets the thinking timeout when the send receipt arrives', async () => {
    vi.useFakeTimers();
    try {
      let releaseSend: (receipt: { id: string; createdAt: number }) => void = () => {};
      const gate = new Promise<{ id: string; createdAt: number }>((resolve) => {
        releaseSend = resolve;
      });
      const transport: ChatTransport = {
        connect: async (h) => {
          h.onConnection('online');
          return [];
        },
        send: () => gate,
        disconnect() {},
      };
      const c = new ChatClient(transport);
      c.thinkingTimeoutMs = 1_000;
      await c.start();
      c.send('hi');
      expect(c.getState().thinking).toBe(true);
      // Almost through the enqueue timeout — receipt should restart the clock.
      await vi.advanceTimersByTimeAsync(900);
      expect(c.getState().thinking).toBe(true);
      releaseSend({ id: 's1', createdAt: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(c.getState().messages[0]).toMatchObject({ id: 's1', status: 'sent' });
      expect(c.getState().thinking).toBe(true);
      await vi.advanceTimersByTimeAsync(999);
      expect(c.getState().thinking).toBe(true);
      await vi.advanceTimersByTimeAsync(1);
      expect(c.getState().thinking).toBe(false);
      c.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks failures and retries the same payload', async () => {
    const t = fakeTransport();
    const onError = vi.fn();
    const c = new ChatClient(t.transport, { onError });
    await c.start();
    t.setFail(true);
    c.send('hello');
    expect(c.getState().thinking).toBe(true);
    await flush();
    const failed = c.getState().messages[0]!;
    expect(failed.status).toBe('failed');
    expect(c.getState().thinking).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'SEND_FAILED' }));
    t.setFail(false);
    c.retry(failed.id);
    expect(c.getState().thinking).toBe(true);
    await flush();
    expect(c.getState().messages[0]!.status).toBe('sent');
    expect(c.getState().thinking).toBe(true);
    expect(t.sent).toHaveLength(2);
    expect(t.sent[1]).toEqual({ text: 'hello' });
    c.stop();
  });

  it('answers a form prompt with the next message, and quick replies carry reply_id', async () => {
    const t = fakeTransport();
    const c = new ChatClient(t.transport);
    await c.start();
    t.push(botMsg('ask', { inputs: [{ name: 'email', type: 'EMAIL' }] }));
    expect(c.getState().pendingInput?.name).toBe('email');
    c.send('a@b.co');
    expect(t.sent[0]).toEqual({ text: 'a@b.co', form: { email: 'a@b.co' } });
    expect(c.getState().pendingInput).toBeNull();
    c.sendQuickReply({ id: 'track', label: 'Track', type: 'QUICK_REPLY' });
    expect(t.sent[1]).toEqual({ text: 'Track', form: { reply_id: 'track', reply_title: 'Track' } });
    c.stop();
  });

  it('submits a contact card as one message, and binds the composer to its first field like the web', async () => {
    const t = fakeTransport();
    const c = new ChatClient(t.transport);
    await c.start();
    const card = botMsg('form', {
      text: 'Please enter your',
      inputs: [
        { name: 'name', type: 'TEXT' },
        { name: 'email', type: 'EMAIL' },
        { name: 'phone', type: 'PHONE' },
      ],
    });
    t.push(card);
    expect(isFormCard(card)).toBe(true);
    expect(c.getState().pendingInput?.name).toBe('name'); // web form_input = inputs[0]
    c.sendForm({ name: 'Sam Lee', email: 'sam@acme.com', phone: ' 09938374 ' });
    expect(t.sent[0]).toEqual({
      text: 'Submitted',
      form: { name: 'Sam Lee', email: 'sam@acme.com', phone: '09938374' },
    });
    expect(c.getState().messages.at(-1)).toMatchObject({ author: 'user', text: 'Submitted' });
    t.push(card); // a later poll resends the card, but the answer already follows it...
    expect(c.getState().pendingInput).toBeNull(); // ...so it must not re-arm the composer (it flips the keyboard mid-typing)
    c.send('hi');
    expect(t.sent[1]).toEqual({ text: 'hi' });
    c.stop();
  });

  it('a re-polled prompt does not stay armed once the customer echo follows it (regression)', async () => {
    const t = fakeTransport();
    const c = new ChatClient(t.transport);
    await c.start();
    const prompt = botMsg('ask', { inputs: [{ name: 'email', type: 'EMAIL' }] });
    t.push(prompt);
    c.send('sam@acme.com');
    await flush();
    // The poll resends the whole session in order: [prompt, answer].
    t.push(prompt);
    t.push({ id: 's1', author: 'user', text: 'sam@acme.com', createdAt: 3 });
    expect(c.getState().pendingInput).toBeNull();
    c.send('thanks');
    expect(t.sent.at(-1)).toEqual({ text: 'thanks' });
    c.stop();
  });

  it('takes the customer name the server sends on messages (header shows it without asking again)', async () => {
    const t = fakeTransport([{ ...botMsg('hi'), contactName: 'Neil' }]);
    const c = new ChatClient(t.transport);
    await c.start();
    expect(c.getState().userName).toBe('Neil');
    t.push({ ...botMsg('later'), id: 'later', contactName: 'Neil K' });
    expect(c.getState().userName).toBe('Neil K');
    c.stop();
  });

  it('history that ends on a form message arms the composer', async () => {
    const t = fakeTransport([botMsg('card', { inputs: [{ name: 'name', type: 'TEXT' }, { name: 'email', type: 'EMAIL' }] })]);
    const c = new ChatClient(t.transport);
    await c.start();
    expect(c.getState().pendingInput?.name).toBe('name');
    c.stop();
  });

  it('one fillable field is a card; checkbox, radio and unknown types are not drawn', () => {
    expect(isFormCard({ inputs: [{ name: 'email', type: 'EMAIL' }] })).toBe(true);
    expect(isFormCard({ inputs: [{ name: 'ok', type: 'CHECKBOX' }, { name: 'r', type: 'radio' }] })).toBe(false);
    expect(isFormCard({})).toBe(false);
    expect(formFields([{ name: 'n', type: 'text' }, { name: 'ok', type: 'CHECKBOX' }, { name: 'p', type: 'PHONE' }]).map((i) => i.name)).toEqual(['n', 'p']);
  });

  it('isValidInput ignores the case of the type', () => {
    expect(isValidInput({ name: 'e', type: 'email' }, 'nope')).toBe(false);
    expect(isValidInput({ name: 'e', type: 'email' }, 'a@b.co')).toBe(true);
  });

  it('timestamps by age like the web, and the check covers history messages', () => {
    const now = new Date(2026, 10, 16, 15, 0).getTime();
    expect(formatStamp(new Date(2026, 10, 16, 9, 5).getTime(), now)).toBe('9:05 am');
    expect(formatStamp(new Date(2026, 10, 13, 15, 5).getTime(), now)).toBe('3:05 pm Fri');
    expect(formatStamp(new Date(2026, 9, 4, 0, 30).getTime(), now)).toBe('12:30 am 04 Oct 26');
    expect(isDelivered({ author: 'user' })).toBe(true); // from history: no status
    expect(isDelivered({ author: 'user', status: 'sent' })).toBe(true);
    expect(isDelivered({ author: 'user', status: 'sending' })).toBe(false);
    expect(isDelivered({ author: 'user', status: 'failed' })).toBe(false);
    expect(isDelivered({ author: 'bot' })).toBe(false);
  });

  it('links a voice note as audio and sends it through sendFile', async () => {
    expect(attachmentKind('audio/mpeg')).toBe('audio');
    const t = fakeTransport();
    const c = new ChatClient(t.transport);
    await c.start();
    c.sendFile({ uri: 'file:///Recording.mp3', name: 'Recording.mp3', mimeType: 'audio/mpeg' });
    expect(c.getState().messages[0]!.attachments).toEqual([
      { url: 'file:///Recording.mp3', kind: 'audio', name: 'Recording.mp3', mimeType: 'audio/mpeg' },
    ]);
    c.stop();
  });

  it('plays a background track only for the latest non-customer message, and hides it from the bubble', () => {
    const bg = { url: 'https://x/bg.mp3', kind: 'audio' as const, background: true };
    const photo = { url: 'https://x/a.jpg', kind: 'image' as const };
    expect(visibleAttachments([bg, photo])).toEqual([photo]);
    expect(visibleAttachments([bg])).toEqual([]);
    const bot = { author: 'bot' as const, attachments: [bg] };
    const user = { author: 'user' as const, attachments: [bg] };
    expect(backgroundTrack([bot], true)).toBe('https://x/bg.mp3');
    expect(backgroundTrack([bot], false)).toBeNull();
    expect(backgroundTrack([bot, user], true)).toBeNull();
    expect(backgroundTrack([{ author: 'bot', attachments: [photo] }], true)).toBeNull();
    expect(resolveConfig({}).config.features.backgroundAudio).toBe(true);
    expect(resolveConfig({ features: { backgroundAudio: false } }).config.features.backgroundAudio).toBe(false);
    expect(resolveConfig({}).config.features.attribution).toBe(true);
    expect(resolveConfig({ features: { attribution: false } }).config.features.attribution).toBe(false);
  });

  it('treats only a lone icebrakerMsg as the landing', () => {
    expect(isIcebreaker([{ id: 'icebrakerMsg' }])).toBe(true);
    expect(isIcebreaker([{ id: 'icebrakerMsg' }, { id: 'next' }])).toBe(false);
    expect(isIcebreaker([{ id: 'other' }])).toBe(false);
    expect(isIcebreaker([])).toBe(false);
  });

  it('keeps the same state when a poll repeats a message, and updates when a field changes', async () => {
    const t = fakeTransport();
    const c = new ChatClient(t.transport);
    await c.start();
    t.push(botMsg('b1', { text: 'hello' }));
    const state = c.getState();
    const listener = vi.fn();
    const unsub = c.subscribe(listener);
    t.push(botMsg('b1', { text: 'hello' }));
    expect(c.getState()).toBe(state);
    expect(listener).not.toHaveBeenCalled();
    t.push(botMsg('b1', { text: 'edited' }));
    expect(c.getState()).not.toBe(state);
    expect(c.getState().messages[0]).toMatchObject({ text: 'edited', fresh: true });
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    c.stop();
  });

  it('withDialCode sends phones in international form, like the web phone field', () => {
    expect(withDialCode('98765 43210', '+91')).toBe('+91 98765 43210');
    expect(withDialCode('09876543210', '+91')).toBe('+91 9876543210'); // trunk 0 dropped
    expect(withDialCode(' +1 202-555-0100 ', '+91')).toBe('+1 202-555-0100'); // already international
    expect(withDialCode('98765 43210')).toBe('98765 43210'); // no code configured
    expect(resolveConfig({ features: { phoneDialCode: '+91' } }).config.features.phoneDialCode).toBe('+91');
    const bad = resolveConfig({ features: { phoneDialCode: '91' } });
    expect(bad.config.features.phoneDialCode).toBeUndefined();
    expect(bad.warnings.join(' ')).toContain('phoneDialCode');
  });

  it('dedupes by id, counts unread only while hidden, and history is not fresh', async () => {
    const t = fakeTransport([botMsg('h1')]);
    const onUnread = vi.fn();
    const c = new ChatClient(t.transport, { onUnreadCountChange: onUnread });
    await c.start();
    expect(c.getState().messages[0]!.fresh).toBeUndefined();
    t.push(botMsg('b1'));
    t.push(botMsg('b1', { text: 'edited' }));
    expect(c.getState().messages).toHaveLength(2);
    expect(c.getState().messages[1]).toMatchObject({ text: 'edited', fresh: true });
    expect(c.getState().unread).toBe(1);
    c.setVisible(true);
    expect(c.getState().unread).toBe(0);
    t.push(botMsg('b2'));
    expect(c.getState().unread).toBe(0);
    expect(onUnread.mock.calls).toEqual([[1], [0]]);
    c.setVisible(false);
    expect(c.getState().messages.every((m) => !m.fresh)).toBe(true);
    c.stop();
  });

  it('survives bad backend data and throwing host callbacks', async () => {
    const t = fakeTransport();
    const onError = vi.fn();
    const c = new ChatClient(t.transport, {
      onError,
      onMessageReceived: () => {
        throw new Error('host bug');
      },
      onUnreadCountChange: () => Promise.reject(new Error('async host bug')),
    });
    await c.start();
    expect(() => t.push({} as Message)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'BAD_MESSAGE' }));
    expect(() =>
      t.push({ id: 7, text: null, createdAt: NaN, author: 'alien', buttons: [{ label: 'Ok' }, {}, null], attachments: [{ url: '' }, { url: 'https://x/a.png', kind: 'gif' }] } as unknown as Message),
    ).not.toThrow();
    expect(c.getState().messages).toHaveLength(1);
    expect(c.getState().messages[0]).toMatchObject({
      id: '7',
      text: '',
      author: 'bot',
      buttons: [{ id: 'Ok', label: 'Ok', type: 'QUICK_REPLY' }],
      attachments: [{ url: 'https://x/a.png', kind: 'file' }],
    });
    expect(Number.isFinite(c.getState().messages[0]!.createdAt)).toBe(true);
    c.stop();
  });

  it('opens a blank thread and drops a send that resolves afterwards', async () => {
    let releaseSend: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const history = [botMsg('old')];
    let current = history;
    const transport: ChatTransport = {
      async connect(h) {
        h.onConnection('online');
        return current;
      },
      async send() {
        await gate;
        return { id: 'late', createdAt: 1 };
      },
      disconnect() {},
      restart() {
        current = [];
      },
    };
    const c = new ChatClient(transport);
    await c.start();
    expect(c.getState().messages.map((m) => m.id)).toEqual(['old']);
    c.send('hi');
    const next = c.newChat();
    releaseSend();
    await next;
    await flush();
    expect(c.getState().messages).toEqual([]);
    expect(c.getState().thinking).toBe(false);
    expect(c.getState().pendingInput).toBeNull();
    c.stop();
  });

  it('treats a receipt without an id as sent and keeps the local id', async () => {
    const transport: ChatTransport = {
      connect: async () => [],
      send: async () => ({}) as never,
      disconnect() {},
    };
    const c = new ChatClient(transport);
    await c.start();
    c.send('hi');
    await flush();
    expect(c.getState().messages[0]).toMatchObject({ id: 'local-1', status: 'sent' });
    c.stop();
  });

  it('reconnects with backoff after a failed connect, and stop() cancels it', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const transport: ChatTransport = {
      connect: async (h) => {
        attempts++;
        if (attempts < 3) throw new Error('down');
        h.onConnection('online');
        return [];
      },
      send: async () => ({ id: 'x', createdAt: 1 }),
      disconnect() {},
    };
    const onError = vi.fn();
    const c = new ChatClient(transport, { onError });
    await c.start();
    expect(c.getState().connection).toBe('offline');
    await vi.advanceTimersByTimeAsync(2_000); // retry 1 (fails)
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(4_000); // retry 2 (succeeds)
    expect(attempts).toBe(3);
    expect(c.getState().connection).toBe('online');
    expect(onError).toHaveBeenCalledTimes(2);

    const d = new ChatClient({ ...transport, connect: async () => Promise.reject(new Error('down')) });
    await d.start();
    d.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.getState().connection).toBe('offline');
    vi.useRealTimers();
  });

  it('validates email format and limits a phone number to 10 digits', () => {
    expect(isValidInput({ name: 'e', type: 'EMAIL' }, 'nope')).toBe(false);
    expect(isValidInput({ name: 'e', type: 'EMAIL' }, 'a@b')).toBe(false);
    expect(isValidInput({ name: 'e', type: 'EMAIL' }, 'a @b.io')).toBe(false);
    expect(isValidInput({ name: 'e', type: 'EMAIL' }, 'a@b.io')).toBe(true);
    expect(isValidInput({ name: 'e', type: 'EMAIL' }, 'sam@acme.com')).toBe(true);
    expect(isValidInput({ name: 'email', type: 'TEXT' }, 'nope')).toBe(false);
    expect(isValidInput({ name: 'email', type: 'TEXT' }, 'sam@acme.com')).toBe(true);

    // Formatting is not counted: "(555) 123-4567" and "+965 555 1234" are 10 digits.
    expect(phoneDigitCount('(555) 123-4567')).toBe(10);
    expect(phoneDigitCount('+965 5555 1234')).toBe(11);
    expect(isValidInput({ name: 'p', type: 'PHONE' }, '(555) 123-4567')).toBe(true);
    expect(isValidInput({ name: 'p', type: 'PHONE' }, '+965 555 1234')).toBe(true);
    expect(isValidInput({ name: 'p', type: 'PHONE' }, '+965 5555 1234')).toBe(true); // "+" lifts the limit to 15 (E.164)
    expect(isValidInput({ name: 'p', type: 'PHONE' }, '+965 5555 1234 56789')).toBe(false);
    expect(isValidInput({ name: 'p', type: 'PHONE' }, '55512345678', 12)).toBe(true); // features.phoneMaxDigits
    expect(limitPhoneDigits('+91 98765 43210 99999')).toBe('+91 98765 43210 999');
    expect(isValidInput({ name: 'p', type: 'PHONE' }, '55512345678')).toBe(false);
    expect(isValidInput({ name: 'phone', type: 'TEXT' }, '555123456789')).toBe(false);
    expect(isValidInput({ name: 'p', type: 'NUMBER' }, '55512345678')).toBe(false);
    expect(limitPhoneDigits('(555) 123-456789')).toBe('(555) 123-4567');
    expect(limitPhoneDigits('555123456789')).toBe('5551234567');
    expect(isValidInput(null, 'anything')).toBe(true);
  });
});

describe('resolveConfig', () => {
  it('returns complete defaults for no config', () => {
    const { config, warnings } = resolveConfig(undefined);
    expect(warnings).toEqual([]);
    expect(config.userBubble.background).toBe('#111111');
    expect(config.strings.placeholder).toBe('Message…');
  });

  it('resolves token references and falls back per field on bad values', () => {
    const { config, warnings } = resolveConfig({
      theme: { colors: { light: { accent: '#174EA6', surface: 'blue' } }, radius: { bubble: 99 } },
      components: { botBubble: { background: 'accent' }, header: { logo: 'http://insecure.png' } },
      features: { attachments: ['image', 'video'] },
      surprise: true,
    });
    expect(config.colors.accent).toBe('#174EA6');
    expect(config.colors.surface).toBe('#F4F4F5');
    expect(config.botBubble.background).toBe('#174EA6');
    expect(config.radius.bubble).toBe(20);
    expect(config.header.logo).toBeUndefined();
    expect(config.features.attachments).toEqual(['image', 'document']);
    expect(warnings.map((w) => w.split(':')[0])).toEqual([
      'config.surprise',
      'config.theme.colors.light.surface',
      'config.features.attachments',
      'config.theme.radius.bubble',
      'config.components.header.logo',
    ]);
  });

  it('accepts brand logos from S3/CDN, local assets, files and data URIs, and places them', () => {
    const s3 = 'https://acme-assets.s3.eu-west-1.amazonaws.com/logo.png?X-Amz-Signature=abc';
    for (const image of [s3, 'asset:wordmark', 'file:///var/app/logo.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'https://cdn.acme.com/logo.svg']) {
      const { config, warnings } = resolveConfig({ components: { header: { brand: { image } } } });
      expect(warnings).toEqual([]);
      expect(config.header.brand).toMatchObject({ image, position: 'left', height: 28, showTitle: true });
    }
    const centred = resolveConfig({ components: { header: { brand: { image: 'asset:logo', position: 'center', height: 40, width: 120 } } } });
    expect(centred.config.header.brand).toEqual({ image: 'asset:logo', position: 'center', height: 40, width: 120, showTitle: false });
    const bad = resolveConfig({ components: { header: { brand: { image: 'http://insecure/logo.png' }, logo: 'javascript:alert(1)' } } });
    expect(bad.config.header.brand).toBeUndefined();
    expect(bad.config.header.logo).toBeUndefined();
    expect(bad.warnings.map((w) => w.split(':')[0])).toEqual(['config.components.header.logo', 'config.components.header.brand.image', 'config.components.header.brand']);
    expect(isSvgRef('https://x.s3.amazonaws.com/a.SVG?sig=1')).toBe(true);
    expect(isSvgRef('asset:logo')).toBe(false);
  });

  it('resolves launcher icon options', () => {
    const ok = resolveConfig({ components: { launcher: { icon: 'sparkle', shape: 'rounded', size: 64, image: 'https://x.co/i.png', iconColor: 'accent' } } });
    expect(ok.config.launcher).toMatchObject({ icon: 'sparkle', shape: 'rounded', size: 64, image: 'https://x.co/i.png', iconColor: '#111111' });
    expect(ok.config.launcher.radius).toBe(19);
    for (const icon of ['help', 'headset', 'mail', 'star'] as const) {
      expect(resolveConfig({ components: { launcher: { icon } } }).config.launcher.icon).toBe(icon);
    }
    const bad = resolveConfig({ components: { launcher: { icon: 'rocket', size: 200 } } });
    expect(bad.config.launcher).toMatchObject({ icon: 'chat', size: 58, shape: 'circle', radius: 29 });
    expect(bad.warnings).toHaveLength(2);
    const bare = resolveConfig({ components: { launcher: { shape: 'none', iconSize: 40, size: 44, background: '#ff0000' } } });
    expect(bare.config.launcher).toMatchObject({ background: 'transparent', shadow: false, borderWidth: 0, iconSize: 40, iconColor: '#111111' });
    // A valid but too-large icon is fitted inside its container; out-of-range values fall back.
    const clear = resolveConfig({ components: { launcher: { background: 'transparent', borderColor: 'accent', borderWidth: 2, iconSize: 70 } } });
    expect(clear.config.launcher).toMatchObject({ background: 'transparent', shadow: false, borderColor: '#111111', borderWidth: 2, iconSize: 50 });
    expect(clear.warnings).toEqual([]);
    expect(resolveConfig({ components: { launcher: { iconSize: 90 } } }).config.launcher.iconSize).toBe(24);
  });

  it('keeps a brand accent in dark mode only when it stays readable', () => {
    expect(resolveConfig({ theme: { colors: { light: { accent: '#174EA6' } } } }, 'dark').config.colors.accent).toBe('#FAFAFA');
    expect(resolveConfig({ theme: { colors: { light: { accent: '#8AB4F8' } } } }, 'dark').config.colors.accent).toBe('#8AB4F8');
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21);
    expect(withAlpha('#174EA6', 0.5)).toBe('rgba(23,78,166,0.5)');
    expect(withAlpha('#FFF', 0.25)).toBe('rgba(255,255,255,0.25)');
  });

  it('picks strings for the device language over the default, and rejects unknown versions', () => {
    const strings = { default: 'en', en: { placeholder: 'Type…' }, ar: { placeholder: 'اكتب…' } };
    expect(resolveConfig({ strings }, 'light', 'ar-KW').config.strings.placeholder).toBe('اكتب…');
    expect(resolveConfig({ strings }, 'light', 'fr-FR').config.strings.placeholder).toBe('Type…');
    const v2 = resolveConfig({ schemaVersion: 2, theme: { spacing: 8 } });
    expect(v2.config.spacing).toBe(4);
    expect(v2.warnings[0]).toContain('schemaVersion');
  });
});

describe('richText', () => {
  it('parses markup and links without touching paths, fractions or snake_case', () => {
    expect(parseRichText('Order *#4821* is _out_ now, see https://acme.com/x.')).toEqual([
      { text: 'Order ' },
      { text: '#4821', bold: true },
      { text: ' is ' },
      { text: 'out', underline: true },
      { text: ' now, see ' },
      { text: 'https://acme.com/x', url: 'https://acme.com/x' },
      { text: '.' },
    ]);
    expect(parseRichText('and/or 1/2 snake_case_name')).toEqual([{ text: 'and/or 1/2 snake_case_name' }]);
    expect(parseRichText('/soft/ ~old~ `code`')).toEqual([
      { text: 'soft', italic: true },
      { text: ' ' },
      { text: 'old', strike: true },
      { text: ' ' },
      { text: 'code', code: true },
    ]);
  });

  it('links emails, bare domains and phones, and leaves dates, ids and versions plain', () => {
    expect(parseRichText('mail sam@acme.com now')).toEqual([
      { text: 'mail ' },
      { text: 'sam@acme.com', url: 'mailto:sam@acme.com' },
      { text: ' now' },
    ]);
    expect(parseRichText('see mehery.com.')).toEqual([
      { text: 'see ' },
      { text: 'mehery.com', url: 'https://mehery.com' },
      { text: '.' },
    ]);
    expect(parseRichText('call +91 98765 43210')).toEqual([
      { text: 'call ' },
      { text: '+91 98765 43210', url: 'tel:+919876543210' },
    ]);
    expect(parseRichText('or 202-555-0100')).toEqual([
      { text: 'or ' },
      { text: '202-555-0100', url: 'tel:2025550100' },
    ]);
    for (const plain of ['2026-11-16', 'TXN-20261116-01', '1.2.3', '12345']) {
      expect(parseRichText(plain)).toEqual([{ text: plain }]);
    }
    const long = `https://example.com/${'a'.repeat(100)}`;
    expect(long).toHaveLength(120);
    expect(parseRichText(long)).toEqual([
      { text: `${long.slice(0, 24)}…${long.slice(-25)}`, url: long },
    ]);
  });

  it('slices ranges across styled segments for the reveal', () => {
    const segs = parseRichText('one *two* three');
    expect(sliceRange(segs, 2, 6)).toEqual([{ text: 'e ' }, { text: 'tw', bold: true }]);
    expect(sliceRange(segs, 0, 99)).toEqual(segs);
  });

  it('never stops the reveal inside an emoji or combining mark', () => {
    expect(revealStops('ab')).toEqual([1, 2]);
    expect(revealStops('a\u{1F44B}\u{1F3FD}b')).toEqual([1, 5, 6]); // wave + skin tone
    expect(revealStops('\u{1F1F0}\u{1F1FC}')).toEqual([4]); // flag
    expect(revealStops('\u{1F468}‍\u{1F469}‍\u{1F467}')).toEqual([8]); // ZWJ family
    expect(revealStops('é')).toEqual([2]); // combining accent
    expect(revealStops('❤️!')).toEqual([2, 3]); // heart + variation selector
  });

  it('detects direction from the first strong character', () => {
    expect(isRTL('مرحبا hello')).toBe(true);
    expect(isRTL('123 hello مرحبا')).toBe(false);
  });
});
