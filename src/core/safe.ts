import type { Attachment, Author, ChatButton, FormInput, Message } from '../types';

/**
 * Calls host-app code (callbacks, adapters) so that a throw or rejected promise in it can never
 * break the chat. Problems are logged in development only.
 */
export function safeCall<A extends unknown[]>(fn: ((...args: A) => unknown) | undefined, ...args: A): void {
  if (!fn) return;
  try {
    const result = fn(...args);
    if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(devWarn);
  } catch (error) {
    devWarn(error);
  }
}

export function devWarn(error: unknown): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('[react-native-mehery-chat] Your callback threw; the chat carried on.', error);
}

const AUTHORS: readonly Author[] = ['user', 'bot', 'system'];
const KINDS: readonly Attachment['kind'][] = ['image', 'audio', 'video', 'file'];
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * Repairs or rejects a message before it reaches the UI, so bad backend data can't crash
 * rendering. Missing text becomes '', a bad timestamp becomes now, malformed attachments,
 * buttons and inputs are dropped. Returns null when there is no usable id.
 */
export function normalizeMessage(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id) ?? (typeof m.id === 'number' && Number.isFinite(m.id) ? String(m.id) : undefined);
  if (!id) return null;

  const message: Message = {
    id,
    author: AUTHORS.includes(m.author as Author) ? (m.author as Author) : 'bot',
    text: typeof m.text === 'string' ? m.text : m.text == null ? '' : String(m.text),
    createdAt: typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) ? m.createdAt : Date.now(),
  };

  const attachments = list(m.attachments).flatMap((a): Attachment[] => {
    const url = str(a.url);
    if (!url) return [];
    const out: Attachment = { url, kind: KINDS.includes(a.kind as Attachment['kind']) ? (a.kind as Attachment['kind']) : 'file' };
    const name = str(a.name);
    const mimeType = str(a.mimeType);
    if (name) out.name = name;
    if (mimeType) out.mimeType = mimeType;
    const thumbnailUrl = str(a.thumbnailUrl);
    const caption = str(a.caption);
    if (thumbnailUrl) out.thumbnailUrl = thumbnailUrl;
    if (caption) out.caption = caption;
    if (a.background === true) out.background = true;
    for (const key of ['width', 'height', 'durationMs', 'size'] as const) {
      const n = a[key];
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[key] = n;
    }
    return [out];
  });
  const buttons = list(m.buttons).flatMap((b): ChatButton[] => {
    const label = str(b.label);
    if (!label) return [];
    const out: ChatButton = { id: str(b.id) ?? label, label, type: str(b.type) ?? 'QUICK_REPLY' };
    const url = str(b.url);
    if (url) out.url = url;
    return [out];
  });
  const inputs = list(m.inputs).flatMap((i): FormInput[] => {
    const name = str(i.name);
    if (!name) return [];
    const out: FormInput = { name, type: str(i.type) ?? 'TEXT' };
    const label = str(i.label);
    if (label) out.label = label;
    return [out];
  });

  if (attachments.length) message.attachments = attachments;
  if (buttons.length) message.buttons = buttons;
  if (typeof m.contactName === 'string' && m.contactName.trim()) message.contactName = m.contactName.trim();
  if (inputs.length) message.inputs = inputs;
  if (m.status === 'sending' || m.status === 'sent' || m.status === 'failed') message.status = m.status;
  const localId = str(m.localId);
  if (localId) message.localId = localId;
  if (m.fresh === true) message.fresh = true;
  return message;
}

function list(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
}
