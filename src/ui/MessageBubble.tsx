import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Animated, Platform, Pressable, Text, View, type ViewStyle } from 'react-native';
import { isDelivered, isFormCard, visibleAttachments } from '../core/client';
import { withAlpha } from '../core/config';
import { formatStamp, isRTL, parseRichText, revealStops, sliceRange, type Segment } from '../core/richText';
import type { Message } from '../types';
import { useMehery } from '../react/context';
import { FormCard } from './FormCard';
import { RefImage } from './RefImage';
import { FileRow } from './media/FileRow';
import { MessageMedia } from './media/MessageMedia';
import { Txt, fontStyle, useEntrance, useMotionMode } from './primitives';

// Ids that already animated, so scrolling a message off and back on doesn't replay it.
const played = new Set<string>();
const REVEAL_LIMIT = 600;

interface Props {
  message: Message;
  /** First / last of a run of messages from the same author. */
  isFirst: boolean;
  isLast: boolean;
  onImagePress(url: string, urls: string[]): void;
  /** This message is the latest one, so its contact card can still be filled in. */
  formActive?: boolean;
  filled?: Record<string, string>;
  /** This is a contact-card submission: the filled card above it already shows what was sent. */
  hideSubmitted?: boolean;
}

export const MessageBubble = memo(function MessageBubble({ message, isFirst, isLast, onImagePress, formActive, filled, hideSubmitted }: Props) {
  const { config, client, rtl, locale } = useMehery();
  const mine = message.author === 'user';
  const key = message.localId ?? message.id;
  const animate = !!message.fresh && !played.has(key);
  useEffect(() => {
    played.add(key);
  }, [key]);
  const entrance = useEntrance(animate, { fromY: 12 });

  // The form card's own "Submitted" send (and the server's echo of it) is a trigger for the bot, not
  // something to read: the filled card above it already shows what was sent. A failed one stays visible to retry.
  // Matched by the flag (ours) or by position (the server's echo, right after the card), never by the text alone:
  // a customer who types "Submitted" still sees their message.
  if (mine && hideSubmitted && message.text === 'Submitted' && !message.attachments?.length && message.status !== 'failed') return null;

  if (message.author === 'system') {
    return (
      <Txt variant="caption" color={config.colors.muted} style={{ textAlign: 'center', marginVertical: config.spacing * 2 }}>
        {message.text}
      </Txt>
    );
  }

  const colors = mine ? config.userBubble : config.botBubble;
  const failed = message.status === 'failed';
  const shown = visibleAttachments(message.attachments);
  const files = shown.filter((a) => a.kind === 'file');
  const hasMedia = shown.some((a) => a.kind !== 'file');
  const showForm = isFormCard(message); // stays on screen after submit, filled in and read-only
  const hasBubble = message.text.length > 0 || files.length > 0 || showForm;
  const hasLinks = message.text.length > 0 && parseRichText(message.text).some((s) => s.url);
  if (!hasMedia && !hasBubble) return null;
  const showAvatar = config.features.avatars && !mine;
  const name = mine ? config.strings.you : config.header.title;

  return (
    <View style={{ marginTop: isFirst ? config.spacing * 5 : config.spacing * 1.5, flexDirection: 'row', justifyContent: mine ? 'flex-end' : 'flex-start', alignItems: 'flex-end' }}>
      {showAvatar && (
        <View style={{ width: 28, marginEnd: config.spacing * 2 }}>
          {isLast && config.header.logo ? (
            <RefImage src={config.header.logo} height={28} round />
          ) : null}
        </View>
      )}
      <Animated.View
        style={[{ maxWidth: showForm ? '100%' : '80%', flex: showForm ? 1 : undefined, alignItems: showForm ? 'stretch' : mine ? 'flex-end' : 'flex-start', transformOrigin: mine !== rtl ? 'bottom right' : 'bottom left' }, entrance]}
      >
        <Frame
          pressable={!showForm}
          failed={failed}
          // A message with links is not grouped into one element: the links must stay reachable by screen readers.
          accessible={failed || (!message.attachments?.length && !hasLinks)}
          onRetry={() => client.retry(message.id)}
          label={`${name}: ${message.text || message.attachments?.map((a) => a.name ?? a.kind).join(', ') || ''}${failed ? `. ${config.strings.notSent}` : ''}`}
          style={{ opacity: message.status === 'sending' && !hasMedia ? 0.6 : 1, gap: config.spacing }}
        >
          {hasMedia ? (
            <MessageMedia attachments={shown} messageKey={key} mine={mine} sending={message.status === 'sending'} onImagePress={onImagePress} />
          ) : null}
          {hasBubble && (
            <View
              style={{
                backgroundColor: colors.background,
                borderRadius: config.radius.bubble,
                paddingHorizontal: showForm ? config.spacing * 4 : config.spacing * 3.5,
                paddingTop: showForm ? config.spacing * 4 : config.spacing * 2.25,
                paddingBottom: showForm ? config.spacing * 4 : config.spacing * 2.25,
                gap: showForm ? config.spacing * 4 : config.spacing * 2,
                borderWidth: failed ? 1 : 0,
                borderColor: config.colors.error,
              }}
            >
              {message.text.length > 0 && (
                <View style={showForm ? { paddingVertical: config.spacing * 1.5 } : undefined}>
                  <RichText text={message.text} color={colors.text} label={`${name}: ${message.text}`} stream={animate && !mine && !showForm} />
                </View>
              )}
              {files.map((a) => (
                <FileRow key={a.url} attachment={a} color={colors.text} />
              ))}
              {showForm ? <FormCard inputs={message.inputs!} active={!!formActive} filled={filled} /> : null}
            </View>
          )}
        </Frame>
        {failed ? (
          <Txt variant="caption" color={config.colors.error} style={{ marginTop: config.spacing }}>
            {config.strings.notSent}
          </Txt>
        ) : config.features.timestamps && isLast ? (
          <Txt variant="caption" color={config.colors.muted} style={{ marginTop: config.spacing }}>
            {formatStamp(message.createdAt, Date.now(), locale)}
            {isDelivered(message) ? ' ✓' : ''}
          </Txt>
        ) : null}
      </Animated.View>
    </View>
  );
});

/** Pressable for a failed send (tap to retry). A contact card is a plain view so its fields receive taps. */
function Frame({
  pressable,
  failed,
  accessible,
  onRetry,
  label,
  style,
  children,
}: {
  pressable: boolean;
  failed: boolean;
  accessible: boolean;
  onRetry(): void;
  label: string;
  style: ViewStyle;
  children: ReactNode;
}) {
  if (!pressable) return <View style={style}>{children}</View>;
  return (
    <Pressable disabled={!failed} accessible={accessible} onPress={onRetry} accessibilityRole={failed ? 'button' : undefined} accessibilityLabel={label} style={style}>
      {children}
    </Pressable>
  );
}

// Opacity steps of the soft edge where streamed text fades in (each step ~2 characters).
const FADE = [0.55, 0.28, 0.1];
const FADE_STEP = 2;
const STREAM_DELAY_MS = 120;

/**
 * Styled text with tappable links. New bot messages stream in character by character, once per
 * display frame, with a soft fading edge. The full text is laid out from the first frame (the
 * unrevealed part is transparent), so the bubble never resizes and the list never jumps.
 */
function RichText({ text, color, stream, label }: { text: string; color: string; stream: boolean; label: string }) {
  const { config, openLink } = useMehery();
  const mode = useMotionMode();
  const segments = useMemo(() => parseRichText(text), [text]);
  const plain = useMemo(() => segments.map((s) => s.text).join(''), [segments]);
  const stops = useMemo(() => revealStops(plain), [plain]);
  const links = useMemo(() => segments.filter((s) => s.url), [segments]);
  const animate = stream && config.motion.revealText && mode === 'spring' && plain.length <= REVEAL_LIMIT;
  const [shown, setShown] = useState(animate ? 0 : stops.length); // index into stops
  // Not animating (the message was refreshed mid-reveal, or motion is off): show it all, never a half-drawn bubble.
  const done = !animate || shown >= stops.length;

  useEffect(() => {
    if (!animate) return;
    // ~70 characters per second, clamped so short replies don't blink and long ones don't drag.
    const duration = Math.min(1800, Math.max(450, plain.length * 14));
    let start: number | undefined;
    let frame = 0;
    const tick = (now: number) => {
      start ??= now + STREAM_DELAY_MS;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const eased = 1 - Math.pow(1 - t, 1.4); // gentle ease-out
      setShown(Math.round(eased * stops.length));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, plain.length, stops.length]);

  const rtl = isRTL(plain);
  const at = (i: number) => (i <= 0 ? 0 : (stops[Math.min(i, stops.length) - 1] ?? plain.length));
  const ranges: [number, number, string][] = done
    ? [[0, plain.length, color]]
    : [
        [0, at(shown), color],
        ...FADE.map((alpha, k): [number, number, string] => [at(shown + k * FADE_STEP), at(shown + (k + 1) * FADE_STEP), withAlpha(color, alpha)]),
        [at(shown + FADE.length * FADE_STEP), plain.length, 'transparent'],
      ];

  return (
    <Text
      onPress={done ? undefined : () => setShown(stops.length)}
      // The links are read as separate actions; a plain label would hide them.
      accessibilityLabel={links.length ? label : plain}
      accessibilityActions={links.length ? links.map((l, i) => ({ name: `link-${i}`, label: l.text })) : undefined}
      onAccessibilityAction={links.length ? (e) => { const l = links[Number(e.nativeEvent.actionName.slice(5))]; if (l?.url) openLink(l.url); } : undefined}
      maxFontSizeMultiplier={config.font.maxScale}
      style={[fontStyle(config, 'body'), { color, writingDirection: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left' }]}
    >
      {ranges.flatMap(([from, to, tint], r) =>
        sliceRange(segments, from, to).map((s, i) => (
          <Text
            key={`${r}-${i}`}
            style={[segmentStyle(s, config.font.bold), tint !== color && { color: tint }]}
            onPress={s.url ? () => openLink(s.url!) : undefined}
          >
            {s.text}
          </Text>
        )),
      )}
    </Text>
  );
}

function segmentStyle(s: Segment, boldFamily?: string) {
  return {
    ...(s.bold ? (boldFamily ? { fontFamily: boldFamily } : { fontWeight: '600' as const }) : {}),
    ...(s.italic ? { fontStyle: 'italic' as const } : {}),
    ...(s.underline || s.url ? { textDecorationLine: 'underline' as const } : {}),
    ...(s.strike ? { textDecorationLine: 'line-through' as const } : {}),
    ...(s.code ? { fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo', fontSize: 13 } : {}),
  };
}
