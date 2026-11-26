/**
 * The config JSON the host app passes in → a fully resolved, validated theme.
 * Every field is optional; anything invalid falls back to the default with a warning.
 * Declarative only: colours, numbers, flags, text, https image URLs. No code, CSS or HTML.
 */

export type ColorToken = 'accent' | 'onAccent' | 'background' | 'surface' | 'text' | 'muted' | 'border' | 'error';
export type Palette = Record<ColorToken, string>;
/** A hex colour (#RGB, #RRGGBB, #RRGGBBAA) or a palette token name such as "accent". */
export type ColorValue = string;
export type MotionPreset = 'none' | 'subtle' | 'playful';
export type LauncherIcon = 'chat' | 'chat-outline' | 'bubbles' | 'sparkle' | 'help' | 'headset' | 'mail' | 'star' | 'none';
export const LAUNCHER_ICONS: readonly LauncherIcon[] = ['chat', 'chat-outline', 'bubbles', 'sparkle', 'help', 'headset', 'mail', 'star', 'none'];
export type LauncherShape = 'circle' | 'rounded' | 'square' | 'none';

/**
 * An image in the config: an https:// URL (S3, CloudFront, any CDN; presigned links work),
 * file://, data:image/… (png, jpeg, gif, webp, svg+xml), or "asset:<name>" for an image the app
 * registered in code (`assets={{ name: require('./logo.png') }}` or an imported SVG component).
 * PNG/JPEG/WebP/GIF work everywhere; SVG URLs need the `renderSvg` adapter.
 */
export type ImageRef = string;

const IMAGE_REF = /^(https:\/\/\S+|file:\/\/\S+|data:image\/(png|jpe?g|gif|webp|svg\+xml)[;,]\S+|asset:[A-Za-z0-9_-]{1,64})$/;
export const isImageRef = (v: unknown): v is ImageRef => typeof v === 'string' && v.length <= 200_000 && IMAGE_REF.test(v);

/** True for SVG images, which React Native's Image can't draw. */
export const isSvgRef = (ref: string): boolean =>
  ref.startsWith('data:image/svg+xml') || /\.svg($|[?#])/i.test(ref);
export type AttachmentType = 'image' | 'document';

export interface Strings {
  title: string;
  placeholder: string;
  offline: string;
  connecting: string;
  notSent: string;
  emptyTitle: string;
  emptyBody: string;
  invalidEmail: string;
  invalidPhone: string;
  /** Phone or number field over the limit; "{n}" is the digit limit. */
  phoneTooLong: string;
  /** Empty required field on a contact card. */
  required: string;
  /** Contact-card button. The web widget labels this Submit. */
  submit: string;
  /** Welcome card: heading above the quick links. */
  quickLinks: string;
  /** Welcome card: hands the chat to a person. */
  chatWithHuman: string;
  /** Spoken label of the typing indicator. */
  typing: string;
  /** Spoken hint on full-screen photos and videos. */
  swipeToClose: string;
  /** Launcher label suffix; "{n}" is the unread count. */
  unreadCount: string;
  /** Line under the composer (shown when `features.attribution` is on). */
  poweredBy: string;
  /** Contact-card placeholders when the bot sends no label. */
  fieldName: string;
  fieldEmail: string;
  fieldPhone: string;
  /** "{mb}" is replaced with the size limit. */
  tooLarge: string;
  imageFailed: string;
  /** Offline banner action. */
  reconnect: string;
  chatUnavailable: string;
  tryAgain: string;
  messageUnavailable: string;
  send: string;
  attach: string;
  close: string;
  /** Shown under the pull-up ring that starts a fresh conversation. */
  newChat: string;
  /** Header subtitle; the customer's name, once given, follows it. */
  botTalking: string;
  openChat: string;
  photo: string;
  document: string;
  cancel: string;
  you: string;
  bot: string;
  video: string;
  voiceMessage: string;
  play: string;
  pause: string;
  sending: string;
  /** "{n}" is replaced with the number of photos not shown in the grid. */
  morePhotos: string;
  /** A video or audio clip that couldn't play; tapping opens it outside the app. */
  mediaFailed: string;
}

export interface MeheryConfig {
  schemaVersion?: 1;
  theme?: {
    colors?: { light?: Partial<Palette>; dark?: Partial<Palette> };
    font?: {
      regular?: string;
      medium?: string;
      bold?: string;
      size?: { body?: number; caption?: number; title?: number };
      maxScale?: number;
    };
    radius?: { bubble?: number; composer?: number; chip?: number };
    spacing?: number;
  };
  motion?: { preset?: MotionPreset; revealText?: boolean };
  components?: {
    header?: {
      title?: string;
      /** Small round avatar beside the title. Same image formats as `brand.image`. */
      logo?: ImageRef;
      background?: ColorValue;
      text?: ColorValue;
      /** Brand image (wordmark or logo) in the header. `height` and `width` are this image's size in pixels, separate from the round `logo` avatar. */
      brand?: {
        image: ImageRef;
        /** Default "left". "center" hides the title unless `title: "show"`. */
        position?: 'left' | 'center' | 'right';
        /** Brand image height in pixels, 16–48. Default 28. Stays inside the 56px header. */
        height?: number;
        /** Brand image width in pixels, 16–280. Omit it and the width follows the image aspect ratio at `height`. */
        width?: number;
        title?: 'show' | 'hide';
      };
    };
    userBubble?: { background?: ColorValue; text?: ColorValue };
    botBubble?: { background?: ColorValue; text?: ColorValue };
    launcher?: {
      position?: 'bottom-right' | 'bottom-left';
      /** Distance from the screen edges (inside the safe area), 0–48. Default 20. */
      margin?: number;
      /** The container around the icon. "none" shows the bare icon. */
      shape?: LauncherShape;
      /** Container width and height, 32–96. Default 58. */
      size?: number;
      /** Hex, palette token, or "transparent". */
      background?: ColorValue;
      /** Ring around the container: hex, token or "transparent", width 0–6. */
      borderColor?: ColorValue;
      borderWidth?: number;
      /** Drop shadow. Turned off automatically when there's no visible background. */
      shadow?: boolean;
      /** Built-in icon, or "none". Ignored when `image` is set. */
      icon?: LauncherIcon;
      /** Icon (or image) size, 12–80. Default 24. */
      iconSize?: number;
      iconColor?: ColorValue;
      /** Your own icon as an https image URL. */
      image?: string;
    };
  };
  features?: {
    header?: boolean;
    timestamps?: boolean;
    avatars?: boolean;
    attachments?: AttachmentType[];
    maxAttachmentMB?: number;
    /** Resize S3 photos through ImageKit (the web chat's way). Set false to load them straight from S3. Default true. */
    thumbnailProxy?: boolean;
    /** How long the typing indicator waits for a reply, 5000–120000 ms. Default 20000. */
    thinkingTimeoutMs?: number;
    /** Most digits in a phone number typed without "+", 7–15. Default 10. A "+" number may have up to 15. */
    phoneMaxDigits?: number;
    closeButton?: boolean;
    persistHistory?: boolean;
    notifications?: { enabled?: boolean; preview?: boolean; title?: string; requestPermission?: 'firstMessage' | 'manual' };
    /** Country calling code for PHONE card fields, e.g. "+91". Numbers typed without "+" are sent as "+91 98765 43210". */
    phoneDialCode?: string;
    /** BG_VOICE tracks autoplay beside the thread. Default on. Off hides the player and its toggle. */
    backgroundAudio?: boolean;
    /** "Powered by Mehery Soccom" under the composer. Default on. */
    attribution?: boolean;
  };
  behaviour?: { presentation?: 'modal' | 'embedded'; launcher?: boolean; autoOpen?: boolean };
  strings?: { default?: string } & Record<string, Partial<Strings> | string | undefined>;
}

export interface ResolvedConfig {
  colors: Palette;
  font: { regular?: string; medium?: string; bold?: string; size: { body: number; caption: number; title: number }; maxScale: number };
  radius: { bubble: number; composer: number; chip: number };
  spacing: number;
  motion: { preset: MotionPreset; revealText: boolean };
  header: {
    title: string;
    logo?: ImageRef;
    background: string;
    text: string;
    brand?: { image: ImageRef; position: 'left' | 'center' | 'right'; height: number; width?: number; showTitle: boolean };
  };
  userBubble: { background: string; text: string };
  botBubble: { background: string; text: string };
  launcher: {
    position: 'bottom-right' | 'bottom-left';
    margin: number;
    shape: LauncherShape;
    size: number;
    /** Corner radius derived from shape and size. */
    radius: number;
    background: string;
    borderColor: string;
    borderWidth: number;
    shadow: boolean;
    icon: LauncherIcon;
    iconSize: number;
    iconColor: string;
    image?: string;
  };
  features: {
    header: boolean;
    timestamps: boolean;
    avatars: boolean;
    attachments: AttachmentType[];
    maxAttachmentMB: number;
    thumbnailProxy: boolean;
    thinkingTimeoutMs: number;
    phoneMaxDigits: number;
    closeButton: boolean;
    persistHistory: boolean;
    notifications: { enabled: boolean; preview: boolean; title?: string; requestPermission: 'firstMessage' | 'manual' };
    phoneDialCode?: string;
    backgroundAudio: boolean;
    attribution: boolean;
  };
  behaviour: { presentation: 'modal' | 'embedded'; launcher: boolean; autoOpen: boolean };
  strings: Strings;
}

export const LIGHT: Palette = {
  accent: '#111111',
  onAccent: '#FFFFFF',
  background: '#FFFFFF',
  surface: '#F4F4F5',
  text: '#0A0A0A',
  muted: '#71717A',
  border: '#E4E4E7',
  error: '#DC2626',
};

export const DARK: Palette = {
  accent: '#FAFAFA',
  onAccent: '#0A0A0A',
  background: '#0A0A0A',
  surface: '#1C1C1F',
  text: '#FAFAFA',
  muted: '#A1A1AA',
  border: '#27272A',
  error: '#F87171',
};

export const DEFAULT_STRINGS: Strings = {
  title: 'Support',
  placeholder: 'Message…',
  offline: "You're offline",
  connecting: 'Connecting…',
  notSent: 'Not sent. Tap to retry.',
  emptyTitle: 'How can we help?',
  emptyBody: "Ask anything and we'll reply right here.",
  invalidEmail: 'Please enter a valid email address.',
  invalidPhone: 'Please enter a valid phone number.',
  phoneTooLong: 'Please enter a number with at most {n} digits.',
  quickLinks: 'Quick Links',
  chatWithHuman: 'Chat with human',
  typing: 'Typing',
  swipeToClose: 'Swipe down to close',
  unreadCount: '{n} unread',
  poweredBy: 'Powered by Mehery Soccom',
  fieldName: 'Name',
  fieldEmail: 'Email',
  fieldPhone: 'Phone Number',
  required: 'This field is required.',
  submit: 'Submit',
  tooLarge: 'Files must be smaller than {mb} MB.',
  imageFailed: "Couldn't load image. Tap to retry.",
  reconnect: 'Tap to reconnect',
  chatUnavailable: "Chat couldn't load right now.",
  tryAgain: 'Try again',
  messageUnavailable: "This message couldn't be shown.",
  send: 'Send',
  attach: 'Attach a file',
  close: 'Close chat',
  newChat: 'New chat',
  botTalking: 'Bot is talking',
  openChat: 'Open chat',
  photo: 'Photo',
  document: 'Document',
  cancel: 'Cancel',
  you: 'You',
  bot: 'Support',
  video: 'Video',
  voiceMessage: 'Voice message',
  play: 'Play',
  pause: 'Pause',
  sending: 'Sending',
  morePhotos: '{n} more',
  mediaFailed: "Couldn't play this. Tap to open.",
};

const TOKENS = Object.keys(LIGHT) as ColorToken[];
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const TOP_LEVEL = ['schemaVersion', 'theme', 'motion', 'components', 'features', 'behaviour', 'strings'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function resolveConfig(
  input: unknown,
  scheme: 'light' | 'dark' = 'light',
  locale = 'en',
): { config: ResolvedConfig; warnings: string[] } {
  const warnings: string[] = [];
  const warn = (path: string, problem: string) => warnings.push(`config.${path}: ${problem}`);

  let raw: Obj = {};
  if (input !== undefined && input !== null) {
    if (!isObj(input)) warn('', 'must be an object; using defaults');
    else if (input.schemaVersion !== undefined && input.schemaVersion !== 1)
      warn('schemaVersion', `${String(input.schemaVersion)} is not supported by this SDK; using defaults`);
    else raw = input;
  }
  for (const key of Object.keys(raw)) if (!TOP_LEVEL.includes(key)) warn(key, 'unknown key, ignored');

  const at = (path: string): Obj => {
    let node: unknown = raw;
    for (const part of path.split('.')) node = isObj(node) ? node[part] : undefined;
    if (node === undefined) return {};
    if (!isObj(node)) {
      warn(path, 'must be an object');
      return {};
    }
    return node;
  };
  const read = <T>(o: Obj, key: string, path: string, ok: (v: unknown) => v is T, fallback: T, rule: string): T => {
    const v = o[key];
    if (v === undefined) return fallback;
    if (ok(v)) return v;
    warn(`${path}.${key}`, `${rule}; using default`);
    return fallback;
  };
  const bool = (o: Obj, k: string, p: string, d: boolean) => read(o, k, p, (v): v is boolean => typeof v === 'boolean', d, 'must be true or false');
  const num = (o: Obj, k: string, p: string, d: number, min: number, max: number) =>
    read(o, k, p, (v): v is number => typeof v === 'number' && v >= min && v <= max, d, `must be a number from ${min} to ${max}`);
  const str = (o: Obj, k: string, p: string) =>
    read<string | undefined>(o, k, p, (v): v is string => typeof v === 'string' && v.length <= 200, undefined, 'must be text up to 200 characters');
  const oneOf = <T extends string>(o: Obj, k: string, p: string, d: T, options: readonly T[]) =>
    read(o, k, p, (v): v is T => options.includes(v as T), d, `must be one of ${options.join(', ')}`);
  const image = (o: Obj, k: string, p: string) =>
    read<string | undefined>(o, k, p, isImageRef, undefined, 'must be an https:// URL (S3, CDN…), file://, data:image/…, or "asset:<name>" for an image registered in the app');

  // Palette for the active scheme.
  const colors = at('theme.colors');
  const palette = (name: 'light' | 'dark', base: Palette): Partial<Palette> => {
    const o = at(`theme.colors.${name}`);
    const out: Partial<Palette> = {};
    for (const key of Object.keys(o)) {
      if (!TOKENS.includes(key as ColorToken)) warn(`theme.colors.${name}.${key}`, `unknown colour, expected one of ${TOKENS.join(', ')}`);
      else if (typeof o[key] === 'string' && HEX.test(o[key] as string)) out[key as ColorToken] = o[key] as string;
      else warn(`theme.colors.${name}.${key}`, 'must be a hex colour like #174EA6; using default');
    }
    return { ...base, ...out };
  };
  const light = palette('light', LIGHT) as Palette;
  let active: Palette = light;
  if (scheme === 'dark') {
    active = palette('dark', DARK) as Palette;
    // No dark accent given: keep the brand accent only if it stays readable on the dark background.
    if (!isObj(colors.dark) || !('accent' in colors.dark)) {
      if (light.accent !== LIGHT.accent && contrast(light.accent, active.background) >= 3) {
        active = { ...active, accent: light.accent, onAccent: light.onAccent };
      }
    }
  }
  const color = (o: Obj, k: string, p: string, d: ColorToken): string => {
    const v = o[k];
    if (v === undefined) return active[d];
    if (typeof v === 'string' && HEX.test(v)) return v;
    if (typeof v === 'string' && TOKENS.includes(v as ColorToken)) return active[v as ColorToken];
    warn(`${p}.${k}`, `must be a hex colour or one of ${TOKENS.join(', ')}; using default`);
    return active[d];
  };

  const font = at('theme.font');
  const size = at('theme.font.size');
  const radius = at('theme.radius');
  const theme = at('theme');
  const motion = at('motion');
  const header = at('components.header');
  const user = at('components.userBubble');
  const botB = at('components.botBubble');
  const launcher = at('components.launcher');
  const features = at('features');
  const notifications = at('features.notifications');
  const behaviour = at('behaviour');

  let attachments: AttachmentType[] = ['image', 'document'];
  if (features.attachments !== undefined) {
    const v = features.attachments;
    if (Array.isArray(v) && v.every((x) => x === 'image' || x === 'document')) attachments = v as AttachmentType[];
    else warn('features.attachments', 'must be a list of "image" and/or "document"; using default');
  }

  const strings = resolveStrings(at('strings'), locale, warn);
  const title = str(header, 'title', 'components.header') ?? strings.title;
  const notificationTitle = str(notifications, 'title', 'features.notifications');

  const config: ResolvedConfig = {
    colors: active,
    font: {
      size: {
        body: num(size, 'body', 'theme.font.size', 15, 11, 24),
        caption: num(size, 'caption', 'theme.font.size', 12, 9, 18),
        title: num(size, 'title', 'theme.font.size', 17, 12, 28),
      },
      maxScale: num(font, 'maxScale', 'theme.font', 1.6, 1, 3),
    },
    radius: {
      bubble: num(radius, 'bubble', 'theme.radius', 20, 0, 40),
      composer: num(radius, 'composer', 'theme.radius', 22, 0, 40),
      chip: num(radius, 'chip', 'theme.radius', 18, 0, 40),
    },
    spacing: num(theme, 'spacing', 'theme', 4, 2, 8),
    motion: {
      preset: oneOf(motion, 'preset', 'motion', 'subtle', ['none', 'subtle', 'playful'] as const),
      revealText: bool(motion, 'revealText', 'motion', true),
    },
    header: {
      title,
      background: color(header, 'background', 'components.header', 'background'),
      text: color(header, 'text', 'components.header', 'text'),
    },
    userBubble: {
      background: color(user, 'background', 'components.userBubble', 'accent'),
      text: color(user, 'text', 'components.userBubble', 'onAccent'),
    },
    botBubble: {
      background: color(botB, 'background', 'components.botBubble', 'surface'),
      text: color(botB, 'text', 'components.botBubble', 'text'),
    },
    launcher: resolveLauncher(launcher, { color, num, bool, oneOf }),
    features: {
      header: bool(features, 'header', 'features', true),
      timestamps: bool(features, 'timestamps', 'features', false),
      avatars: bool(features, 'avatars', 'features', false),
      attachments,
      maxAttachmentMB: num(features, 'maxAttachmentMB', 'features', 10, 1, 100),
      thumbnailProxy: bool(features, 'thumbnailProxy', 'features', true),
      thinkingTimeoutMs: num(features, 'thinkingTimeoutMs', 'features', 20_000, 5_000, 120_000),
      phoneMaxDigits: num(features, 'phoneMaxDigits', 'features', 10, 7, 15),
      closeButton: bool(features, 'closeButton', 'features', true),
      persistHistory: bool(features, 'persistHistory', 'features', true),
      notifications: {
        enabled: bool(notifications, 'enabled', 'features.notifications', false),
        preview: bool(notifications, 'preview', 'features.notifications', true),
        requestPermission: oneOf(notifications, 'requestPermission', 'features.notifications', 'firstMessage', ['firstMessage', 'manual'] as const),
      },
      backgroundAudio: bool(features, 'backgroundAudio', 'features', true),
      attribution: bool(features, 'attribution', 'features', true),
    },
    behaviour: {
      presentation: oneOf(behaviour, 'presentation', 'behaviour', 'modal', ['modal', 'embedded'] as const),
      launcher: bool(behaviour, 'launcher', 'behaviour', false),
      autoOpen: bool(behaviour, 'autoOpen', 'behaviour', false),
    },
    strings,
  };
  // Accepted for compatibility, not implemented: say so instead of silently doing nothing.
  if (features.persistHistory !== undefined) warn('features.persistHistory', 'not implemented yet; ignored (history is always loaded from the server)');
  if (Object.keys(notifications).length) warn('features.notifications', 'not implemented yet; ignored');
  const logo = image(header, 'logo', 'components.header');
  if (logo) config.header.logo = logo;
  const launcherImage = image(launcher, 'image', 'components.launcher');
  if (launcherImage) config.launcher.image = launcherImage;
  const brand = at('components.header.brand');
  const brandImage = image(brand, 'image', 'components.header.brand');
  if (brandImage) {
    const position = oneOf(brand, 'position', 'components.header.brand', 'left', ['left', 'center', 'right'] as const);
    const width = num(brand, 'width', 'components.header.brand', 0, 16, 280);
    config.header.brand = {
      image: brandImage,
      position,
      height: num(brand, 'height', 'components.header.brand', 28, 16, 48),
      // A centred logo usually replaces the title; at the sides it sits beside it.
      showTitle: oneOf(brand, 'title', 'components.header.brand', position === 'center' ? 'hide' : 'show', ['show', 'hide'] as const) === 'show',
      ...(width ? { width } : {}),
    };
  } else if (Object.keys(brand).length) {
    warn('components.header.brand', 'needs an image; ignored');
  }
  if (notificationTitle) config.features.notifications.title = notificationTitle;
  const dialCode = str(features, 'phoneDialCode', 'features');
  if (dialCode && /^\+\d{1,4}$/.test(dialCode)) config.features.phoneDialCode = dialCode;
  else if (dialCode) warn('features.phoneDialCode', 'must look like "+91"; ignored');
  for (const [key, value] of [['regular', str(font, 'regular', 'theme.font')], ['medium', str(font, 'medium', 'theme.font')], ['bold', str(font, 'bold', 'theme.font')]] as const) {
    if (value) config.font[key] = value;
  }
  return { config, warnings };
}

type Readers = {
  color: (o: Obj, k: string, p: string, d: ColorToken) => string;
  num: (o: Obj, k: string, p: string, d: number, min: number, max: number) => number;
  bool: (o: Obj, k: string, p: string, d: boolean) => boolean;
  oneOf: <T extends string>(o: Obj, k: string, p: string, d: T, options: readonly T[]) => T;
};

function resolveLauncher(o: Obj, { color, num, bool, oneOf }: Readers): ResolvedConfig['launcher'] {
  const p = 'components.launcher';
  // "transparent" is allowed for the container and ring only.
  const shape = oneOf(o, 'shape', p, 'circle', ['circle', 'rounded', 'square', 'none'] as const);
  const size = num(o, 'size', p, 58, 32, 96);
  const background = shape === 'none' || o.background === 'transparent' ? 'transparent' : color(o, 'background', p, 'accent');
  const borderWidth = shape === 'none' ? 0 : num(o, 'borderWidth', p, 0, 0, 6);
  const borderColor = o.borderColor === undefined || o.borderColor === 'transparent' ? 'transparent' : color(o, 'borderColor', p, 'border');
  return {
    position: oneOf(o, 'position', p, 'bottom-right', ['bottom-right', 'bottom-left'] as const),
    margin: num(o, 'margin', p, 20, 0, 48),
    shape,
    size,
    radius: shape === 'circle' || shape === 'none' ? size / 2 : shape === 'rounded' ? Math.round(size * 0.3) : 0,
    background,
    borderColor,
    borderWidth,
    shadow: background !== 'transparent' && bool(o, 'shadow', p, true),
    icon: oneOf(o, 'icon', p, 'chat', LAUNCHER_ICONS),
    // A bare icon may fill the whole tap target; inside a container it stays within it.
    iconSize: Math.min(num(o, 'iconSize', p, 24, 12, 80), shape === 'none' ? size : size - 8),
    // Default icon colour stays readable on whatever sits behind it.
    iconColor: color(o, 'iconColor', p, background === 'transparent' ? 'accent' : 'onAccent'),
  };
}

function resolveStrings(o: Obj, locale: string, warn: (p: string, m: string) => void): Strings {
  const fallback = typeof o.default === 'string' ? o.default : 'en';
  const lang = locale.split('-')[0] ?? 'en';
  const pick = (key: string): Partial<Strings> => {
    const v = o[key];
    if (v === undefined) return {};
    if (!isObj(v)) {
      warn(`strings.${key}`, 'must be an object of text');
      return {};
    }
    const out: Partial<Strings> = {};
    for (const [k, text] of Object.entries(v)) {
      if (!(k in DEFAULT_STRINGS)) warn(`strings.${key}.${k}`, 'unknown text key, ignored');
      else if (typeof text === 'string' && text.length <= 300) out[k as keyof Strings] = text;
      else warn(`strings.${key}.${k}`, 'must be text up to 300 characters');
    }
    return out;
  };
  const exact = o[locale] !== undefined ? locale : lang;
  return { ...DEFAULT_STRINGS, ...pick(fallback), ...(exact !== fallback ? pick(exact) : {}) };
}

/** A validated hex colour at a given opacity, as rgba(). */
export function withAlpha(hex: string, alpha: number): string {
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const base = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${+(base * alpha).toFixed(3)})`;
}

/** WCAG contrast ratio between two hex colours. */
export function contrast(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const channel = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}
