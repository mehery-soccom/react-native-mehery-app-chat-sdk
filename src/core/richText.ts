/**
 * Message text → styled segments. Same markup the web chat supports (msgdown):
 * *bold* /italic/ _underline_ ~strike~ `code`, plus auto-linked URLs. Never HTML.
 */
export interface Segment {
  text: string;
  url?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
}

// The web runs Autolinker 1.8.3 with its defaults: urls, emails and phone numbers. One pass, in
// this order: scheme/www link, email, phone (Autolinker's two shapes: [+cc] 3-3-4, or + then 7-14
// digits), bare domain.
// ponytail: short TLD list for bare domains; use a full list if links go missing.
const LINK_RE = new RegExp(
  [
    String.raw`(?<url>\b(?:https?:\/\/|www\.)[^\s<]+)`,
    // The lookbehinds make a match start only at the head of a run, so a long unbroken string is
    // scanned once, not once per character (that was quadratic).
    String.raw`(?<email>(?<![\w.+-])[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})`,
    String.raw`(?<phone>(?:\+\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}(?![\d-])|\+\d{1,3}[-. ]?(?:\d[-. ]?){6,12}\d(?![\d-]))`,
    String.raw`(?<domain>(?<![\w.-])[a-z\d][\w-]*(?:\.[\w-]+)*\.(?:com|in|org|net|io|co|ai|app)\b(?:\/[^\s<]*)?)`,
  ].join('|'),
  'gi',
);
const MAX_LINK_TEXT = 50; // Autolinker truncate: { length: 50, location: 'smart' }

function link(m: RegExpMatchArray): { text: string; url: string } | null {
  const g = m.groups ?? {};
  if (g.email) return { text: g.email, url: `mailto:${g.email}` };
  if (g.phone) {
    // A number glued to a word or another digit run (ids like "TXN20261116") is not a phone.
    const before = m.input?.[(m.index ?? 0) - 1] ?? '';
    return /[\w+]/.test(before) ? null : { text: g.phone, url: `tel:${g.phone.replace(/[^\d+]/g, '')}` };
  }
  const text = (g.url ?? g.domain ?? '').replace(/[.,!?;:)\]]+$/, '');
  return { text, url: /^https?:\/\//i.test(text) ? text : `https://${text}` };
}

/** Long link text is cut in the middle so both ends stay readable; the link itself is untouched. */
const shorten = (text: string) =>
  text.length <= MAX_LINK_TEXT ? text : `${text.slice(0, MAX_LINK_TEXT / 2 - 1)}…${text.slice(-(MAX_LINK_TEXT / 2))}`;
// A marker opens at start or after space/bracket and closes before end, space or punctuation,
// so "and/or", "1/2" and snake_case stay plain.
const MARK_RE = /(^|[\s([{"'])([*_~/`])(?=\S)([^\n]*?\S)\2(?=$|[\s.,!?;:)\]}"'])/g;
const STYLE: Record<string, keyof Segment> = { '*': 'bold', '/': 'italic', _: 'underline', '~': 'strike', '`': 'code' };

// `code` is literal: no links, no nested styles. Taken first so a URL, email or phone inside it
// (a raw JSON dump, say) can't split the span and leave stray backticks.
const CODE_RE = /(^|[\s([{"'])`([^`\n]+)`(?=$|[\s.,!?;:)\]}"'])/g;

/** Longer text is shown as is: no links or styling, so one huge paste can't stall the JS thread. */
export const MAX_PARSED_LENGTH = 20_000;

export function parseRichText(input: string): Segment[] {
  if (input.length > MAX_PARSED_LENGTH) return [{ text: input }];
  const out: Segment[] = [];
  let last = 0;
  for (const m of input.matchAll(CODE_RE)) {
    const start = (m.index ?? 0) + (m[1]?.length ?? 0);
    out.push(...parseInline(input.slice(last, start)));
    out.push({ text: m[2]!, code: true });
    last = (m.index ?? 0) + m[0].length;
  }
  out.push(...parseInline(input.slice(last)));
  return out;
}

function parseInline(input: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of input.matchAll(LINK_RE)) {
    const found = link(m);
    if (!found) continue;
    const start = m.index ?? 0;
    pushMarked(out, input.slice(last, start));
    out.push({ text: shorten(found.text), url: found.url });
    last = start + found.text.length;
  }
  pushMarked(out, input.slice(last));
  return out;
}

function pushMarked(out: Segment[], text: string): void {
  let last = 0;
  for (const m of text.matchAll(MARK_RE)) {
    const [whole, lead = '', mark = '', inner = ''] = m;
    const start = (m.index ?? 0) + lead.length;
    if (start > last) out.push({ text: text.slice(last, start) });
    out.push({ text: inner, [STYLE[mark]!]: true });
    last = (m.index ?? 0) + whole.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
}

const isSkinTone = (cp: number) => cp >= 0x1f3fb && cp <= 0x1f3ff;
const isFlagLetter = (cp: number) => cp >= 0x1f1e6 && cp <= 0x1f1ff;
const isMark = (cp: number) =>
  cp === 0xfe0f || cp === 0xfe0e || cp === 0x20e3 || isSkinTone(cp) ||
  (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x064b && cp <= 0x065f) || cp === 0x0670;

/**
 * Offsets where the text can be cut for the streaming reveal without splitting a character:
 * never inside a surrogate pair, emoji sequence (ZWJ, skin tone, flag) or combining/Arabic mark.
 * Cutting there is what draws "?" boxes.
 */
export function revealStops(text: string): number[] {
  const stops: number[] = [];
  const width = (i: number) => ((text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1);
  let i = 0;
  while (i < text.length) {
    const first = text.codePointAt(i) ?? 0;
    i += width(i);
    if (isFlagLetter(first) && isFlagLetter(text.codePointAt(i) ?? 0)) i += width(i);
    while (i < text.length) {
      const next = text.codePointAt(i) ?? 0;
      if (next === 0x200d) {
        i += 1;
        if (i < text.length) i += width(i);
      } else if (isMark(next)) {
        i += width(i);
      } else break;
    }
    stops.push(i);
  }
  return stops;
}

/** Characters [start, end) of the segments, keeping their styles. */
export function sliceRange(segments: Segment[], start: number, end: number): Segment[] {
  const out: Segment[] = [];
  let offset = 0;
  for (const s of segments) {
    const from = Math.max(start - offset, 0);
    const to = Math.min(end - offset, s.text.length);
    if (to > from) out.push(from === 0 && to === s.text.length ? s : { ...s, text: s.text.slice(from, to) });
    offset += s.text.length;
    if (offset >= end) break;
  }
  return out;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The web chat's message time (formatters.formatDate): today "3:05 pm", this week "3:05 pm Tue",
 * older "3:05 pm 04 Nov 26". Device time zone.
 */
export function formatStamp(ts: number, now = Date.now(), locale?: string): string {
  const d = new Date(ts);
  // Other languages: let Intl write the day, month and clock the way that language does.
  if (locale && !/^en\b/i.test(locale)) {
    try {
      const sameDay = d.toDateString() === new Date(now).toDateString();
      const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
      if (sameDay) return time;
      const date = now - ts < 7 * 86_400_000 ? d.toLocaleDateString(locale, { weekday: 'short' }) : d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: '2-digit' });
      return `${time} ${date}`;
    } catch {
      // unknown locale or no Intl: fall back to the English format below
    }
  }
  const time = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`;
  if (d.toDateString() === new Date(now).toDateString()) return time;
  if (now - ts < 7 * 86_400_000) return `${time} ${DAYS[d.getDay()]}`;
  return `${time} ${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
}

const RTL_CHAR =/[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏͰ-ϿЀ-ӿ]/;

/** Direction from the first strong character, like dir="auto" on the web. */
export function isRTL(text: string): boolean {
  for (const ch of text) {
    if (RTL_CHAR.test(ch)) return true;
    if (LTR_CHAR.test(ch)) return false;
  }
  return false;
}
