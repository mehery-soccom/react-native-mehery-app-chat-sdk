/**
 * Pure media helpers (no React Native): thumbnail URLs, file badges, sizes, durations and the
 * voice-note waveform.
 */

const S3 = /^https:\/\/([a-z0-9.-]+)\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com\/([^?#]+)$/i;
const CLOUDINARY = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/[^/]+\/upload\/)(.+)$/;
// One part of a Cloudinary transformation segment ("w_300,c_fill"), by its known parameter keys.
const TRANSFORM_PART = /^(w|h|c|g|x|y|q|f|e|r|a|b|o|l|u|t|z|d|dpr|ar|bo|co|fl|fn|so|eo|du|vc|ac|br|pg|dn|cs|if)_/;
const isTransform = (segment: string) => segment.split(',').every((part) => TRANSFORM_PART.test(part));

/**
 * A smaller version of an uploaded image, the way the Mehery web chat requests it: S3 files go
 * through ImageKit, Cloudinary URLs get a resize transformation. Any other URL (and data: URIs)
 * comes back unchanged, meaning "no thumbnail". Omit `height` to keep the aspect ratio. `proxy: false`
 * (features.thumbnailProxy) keeps S3 URLs off the third-party ImageKit host.
 * ponytail: S3 URLs with a query string (presigned) are left alone; ImageKit can't reuse the signature.
 */
export function thumbnailUrl(url: string, width: number, height?: number, proxy = true): string {
  const w = Math.max(1, Math.round(width));
  const h = height ? Math.max(1, Math.round(height)) : undefined;
  const s3 = proxy ? url.match(S3) : null;
  if (s3) return `https://ik.imagekit.io/meherysoccom/${s3[1]}/${s3[2]}?tr=w-${w}${h ? `,h-${h}` : ''}`;
  const cl = url.match(CLOUDINARY);
  if (cl) {
    const path = cl[2]!.split('/');
    // Drop existing (possibly chained) transformations; always keep the file name.
    while (path.length > 1 && isTransform(path[0]!)) path.shift();
    // c_fill crops to the box instead of stretching (Cloudinary's default with both w and h).
    return `${cl[1]}w_${w}${h ? `,h_${h},c_fill` : ''}/${path.join('/')}`;
  }
  return url;
}

const MIME_BADGES: [RegExp, string][] = [
  [/pdf/, 'PDF'],
  [/wordprocessing|msword/, 'DOC'],
  [/spreadsheet|excel|csv/, 'XLS'],
  [/presentation|powerpoint/, 'PPT'],
  [/zip|compressed|tar|rar/, 'ZIP'],
  [/^text\//, 'TXT'],
  [/^audio\//, 'AUDIO'],
  [/^video\//, 'VIDEO'],
  [/^image\//, 'IMG'],
];

/** Short type label for a file row: the extension (from the name or URL) or one from the MIME type. */
export function fileBadge(name?: string, mimeType?: string, url?: string): string {
  for (const source of [name, url?.split(/[?#]/)[0]]) {
    const ext = source?.match(/\.([a-z0-9]{1,4})$/i)?.[1];
    if (ext) return ext.toUpperCase();
  }
  const mime = mimeType?.toLowerCase() ?? '';
  return MIME_BADGES.find(([re]) => re.test(mime))?.[1] ?? 'FILE';
}

/** 1536 -> "1.5 KB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} ${units[i]}`;
}

/** 83_000 -> "1:23", 3_723_000 -> "1:02:03". */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * Calm, stable pseudo-waveform for a voice note: `count` bar heights in 0.2...1, derived only from
 * `seed` (the URL), so the same note always draws the same shape.
 */
export function waveform(seed: string, count: number): number[] {
  // FNV-1a hash seeds a small LCG; neighbours are averaged so the shape rolls instead of jitters.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  const raw = Array.from({ length: count }, () => {
    h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
    return h / 0x100000000;
  });
  return raw.map((v, i) => {
    const near = [raw[i - 2], raw[i - 1], v, v, raw[i + 1], raw[i + 2]].map((x) => x ?? v);
    const avg = near.reduce((a, b) => a + b, 0) / near.length;
    // Stretch the averaged values (they bunch around 0.5) back over the full range.
    return Math.round((0.2 + Math.min(1, Math.max(0, (avg - 0.5) * 2.2 + 0.5)) * 0.8) * 100) / 100;
  });
}
