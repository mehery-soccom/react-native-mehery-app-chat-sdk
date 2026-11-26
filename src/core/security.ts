/**
 * Input checks for everything the SDK takes from the server (links, media, stomp ids) or from the
 * host (domain, files). Pure functions, no React Native.
 */

const CONTROL = /[\u0000-\u001f\u007f]/;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const DEFAULT_LINK_SCHEMES = ['https', 'mailto', 'tel'];

/**
 * A link that is safe to hand to Linking.openURL, or null. Allows https, mailto, tel and any
 * `extraSchemes` the host opted into (deep links). http is upgraded to https; "www.x.com" gets https.
 */
export function safeLink(url: unknown, extraSchemes: readonly string[] = []): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  if (!u || CONTROL.test(u)) return null;
  const scheme = SCHEME.exec(u)?.[1]?.toLowerCase();
  if (!scheme) return /^www\./i.test(u) ? `https://${u}` : null;
  if (scheme === 'http') return u.replace(/^http:/i, 'https:');
  const allowed = [...DEFAULT_LINK_SCHEMES, ...extraSchemes.map((s) => s.toLowerCase().replace(/:$/, ''))];
  return allowed.includes(scheme) ? u : null;
}

/** Media from the server: https only (http is upgraded). file:, data:, content: and the rest are dropped. */
export function safeMediaUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const u = url.trim().replace(/^http:\/\//i, 'https://');
  return /^https:\/\/[^\s\u0000-\u001f]+$/i.test(u) ? u : null;
}

/** scheme + host only, for error messages: a link may carry tokens or be long. */
export function redactUrl(url: string): string {
  const scheme = SCHEME.exec(url.trim())?.[1]?.toLowerCase();
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\s]+)/i.exec(url.trim())?.[1];
  return scheme ? `${scheme}:${host ? `//${host}` : ''}` : '(no scheme)';
}

const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i;
export const isHostname = (v: string) => v.length <= 253 && HOSTNAME.test(v);
export const isContextPath = (v: string) => /^(?:\/[\w.~-]+)*$/.test(v);

/** Ids and tokens from the server that end up inside STOMP destinations. */
export const isSafeToken = (v: unknown): v is string => typeof v === 'string' && /^[\w.:@-]{1,256}$/.test(v);

/** Hex from the platform's CSPRNG when there is one (Hermes has crypto.getRandomValues), else Math.random. */
export function randomHex(bytes: number): string {
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  let out = '';
  if (c?.getRandomValues) {
    for (const b of c.getRandomValues(new Uint8Array(bytes))) out += b.toString(16).padStart(2, '0');
    return out;
  }
  while (out.length < bytes * 2) out += Math.random().toString(16).slice(2);
  return out.slice(0, bytes * 2);
}

const LOCAL_FILE = /^(?:file|content|ph|assets-library):/i;
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'];
const DOC_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'];
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|heic|heif)$/i;
const DOC_MIME = /^(application\/(pdf|msword|vnd\.ms-(excel|powerpoint)|vnd\.openxmlformats-officedocument\.[\w.-]+)|text\/(plain|csv))$/i;

export interface FilePolicy {
  types: readonly ('image' | 'document')[];
  maxMB: number;
}

/** A file name with no path parts or control characters, at most 120 characters. */
export function safeFileName(name: unknown): string {
  const n = (typeof name === 'string' ? name : '').replace(/[\u0000-\u001f\u007f\\/]/g, '_').replace(/^\.+$/, '').slice(-120);
  return n || 'file';
}

/**
 * Why a picked or recorded file must not be sent, or null. The URI has to be a local file; with a
 * policy, the MIME type or extension has to match an enabled kind and a known size has to fit.
 * Audio from the voice recorder is always allowed.
 */
export function checkFile(file: { uri: string; name?: string; mimeType?: string; size?: number }, policy?: FilePolicy): string | null {
  if (!LOCAL_FILE.test(file.uri)) return 'the file is not a local file';
  if (!policy) return null;
  const mime = file.mimeType ?? '';
  if (/^audio\//i.test(mime)) return null;
  const ext = /\.([a-z0-9]{1,5})$/i.exec(file.name ?? file.uri.split(/[?#]/)[0] ?? '')?.[1]?.toLowerCase() ?? '';
  const ok = policy.types.some((t) => (t === 'image' ? IMAGE_MIME.test(mime) || IMAGE_EXT.includes(ext) : DOC_MIME.test(mime) || DOC_EXT.includes(ext)));
  if (!ok) return 'this file type is not allowed';
  if (file.size && file.size > policy.maxMB * 1024 * 1024) return `the file is larger than ${policy.maxMB} MB`;
  return null;
}
