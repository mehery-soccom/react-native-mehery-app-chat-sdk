import type { ChatTransport, Message, OutgoingMessage, SendReceipt, TransportHandlers } from '../types';
import { attachmentKind } from './client';

export interface MockTransport extends ChatTransport {
  /** Simulate losing and regaining the connection. */
  setOnline(online: boolean): void;
}

export interface MockTransportOptions {
  /** Network delay per request. Default 350 ms. */
  latencyMs?: number;
}

const ARABIC = /[؀-ۿ]/;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(() => r(), ms));

/**
 * A simulated bot that exercises every message type of the existing Mehery flow:
 * welcome with quick replies, a URL button, an email form prompt, a contact card, image and file replies,
 * a two-message agent handoff and a failed send (type "fail").
 * ponytail: scripted replies only; swap for the Mehery transport with real channel credentials.
 */
export function createMockTransport(options: MockTransportOptions = {}): MockTransport {
  const latency = options.latencyMs ?? 350;
  const log: Message[] = [];
  let handlers: TransportHandlers | null = null;
  let online = true;
  let seq = 0;
  let welcomed = false;
  let generation = 0;

  const id = () => `mock-${++seq}`;

  function bot(text: string, extra: Partial<Message> = {}, delay = 900 + Math.random() * 700) {
    const gen = generation;
    setTimeout(() => {
      if (gen !== generation) return;
      const message: Message = { id: id(), author: 'bot', text, createdAt: Date.now(), ...extra };
      log.push(message);
      handlers?.onMessage(message);
    }, delay);
  }

  function respond(msg: OutgoingMessage) {
    const text = msg.text.toLowerCase();
    if (msg.file) return bot(`Got your file *${msg.file.name}*. A teammate will take a look.`);
    if (ARABIC.test(msg.text)) return bot('شكراً لرسالتك! سيقوم أحد أعضاء فريقنا بالرد عليك قريباً.');
    if (msg.form?.email) {
      return bot('Thanks! Order *#4821* is _out for delivery_ and should arrive today before 6 pm.', {
        attachments: [{ url: 'https://dummyimage.com/800x600/e4e4e7/3f3f46.png&text=Order+4821', kind: 'image', name: 'order-4821.png' }],
      });
    }
    if (msg.form?.reply_id === 'track' || text.includes('track') || text.includes('order')) {
      return bot("Sure, what's the email address on the order?", {
        inputs: [{ name: 'email', type: 'EMAIL', label: 'Your email address' }],
      });
    }
    if (msg.form?.reply_id === 'human' || text.includes('person') || text.includes('agent')) {
      bot('Connecting you to a teammate…');
      return bot("Hi, I'm Sara from support. How can I help?", {}, 3200);
    }
    if (text.includes('gallery')) {
      const cdn = 'https://res.cloudinary.com/demo/image/upload/samples';
      return bot('A few photos from the spring catalogue.', {
        attachments: [
          { url: `${cdn}/landscapes/beach-boat.jpg`, kind: 'image', name: 'Beach', width: 2600, height: 1950 },
          { url: `${cdn}/landscapes/nature-mountains.jpg`, kind: 'image', name: 'Mountains', width: 3000, height: 2000 },
          { url: `${cdn}/food/dessert.jpg`, kind: 'image', name: 'Dessert', width: 1220, height: 813 },
          { url: `${cdn}/food/spices.jpg`, kind: 'image', name: 'Spices', width: 2000, height: 2000 },
          // Not a Cloudinary/S3 URL: no thumbnail, loads directly.
          { url: 'https://picsum.photos/id/1015/1200/800', kind: 'image', name: 'River valley', width: 1200, height: 800 },
        ],
      });
    }
    if (/\bvideo\b/.test(text)) {
      return bot('Here is a short clip.', {
        attachments: [
          {
            url: 'https://res.cloudinary.com/demo/video/upload/dog.mp4',
            kind: 'video',
            name: 'Clip',
            thumbnailUrl: 'https://res.cloudinary.com/demo/video/upload/dog.jpg',
            width: 854,
            height: 480,
            durationMs: 13_400,
          },
        ],
      });
    }
    if (/\b(voice|audio)\b/.test(text)) {
      return bot('', { attachments: [{ url: 'https://samplelib.com/mp3/sample-9s.mp3', kind: 'audio', name: 'Voice message', durationMs: 9_600 }] });
    }
    if (text.includes('contact me')) {
      return bot('Please enter your', {
        inputs: [
          { name: 'name', type: 'TEXT' },
          { name: 'email', type: 'EMAIL' },
          { name: 'phone', type: 'PHONE' },
        ],
      });
    }
    if (text.includes('invoice') || text.includes('file')) {
      return bot("Here's your latest invoice.", {
        attachments: [
          { url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', kind: 'file', name: 'Invoice-4821.pdf', size: 13_264 },
        ],
      });
    }
    return bot(
      "Here's a longer answer so you can see replies stream into the bubble word by word. " +
        'Read more at https://mehery.com, and *bold*, _underlined_ and ~struck~ text all work too.',
    );
  }

  return {
    async connect(h) {
      handlers = h;
      h.onConnection('connecting');
      await wait(600);
      if (!online) throw new Error('offline');
      h.onConnection('online');
      if (!welcomed) {
        welcomed = true;
        bot("Hi there. I'm the Acme assistant. What can I help you with today?", {
          buttons: [
            { id: 'track', label: 'Track my order', type: 'QUICK_REPLY' },
            { id: 'human', label: 'Talk to a person', type: 'QUICK_REPLY' },
            { id: 'help', label: 'Help center', type: 'URL', url: 'https://mehery.com' },
          ],
        }, 500);
      }
      return [...log];
    },

    async send(msg): Promise<SendReceipt> {
      await wait(latency);
      if (!online) throw new Error('offline');
      if (msg.text.toLowerCase() === 'fail') throw new Error('Simulated send failure');
      const receipt: SendReceipt = { id: id(), createdAt: Date.now() };
      if (msg.file) {
        receipt.attachments = [{ url: msg.file.uri, kind: attachmentKind(msg.file.mimeType), name: msg.file.name }];
      }
      log.push({ id: receipt.id, author: 'user', text: msg.text, createdAt: receipt.createdAt, status: 'sent', attachments: receipt.attachments });
      respond(msg);
      return receipt;
    },

    disconnect() {
      handlers = null;
    },

    restart() {
      generation += 1;
      log.length = 0;
      welcomed = false;
    },

    setOnline(next) {
      online = next;
      handlers?.onConnection(next ? 'online' : 'offline');
    },
  };
}
