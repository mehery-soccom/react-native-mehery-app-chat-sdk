import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, FlatList, Pressable, View } from 'react-native';
import { backgroundTrack, isFormCard, isIcebreaker } from '../core/client';
import type { ChatButton, Message } from '../types';
import { useChatState, useMehery, type EmptyStateProps, type QuickReplyProps } from '../react/context';
import { ContainedRender, Slot } from './Guard';
import { MessageBubble } from './MessageBubble';
import { PauseIcon, PlayIcon } from './media/icons';
import { PLAYBACK_VIEWABILITY, pauseOffscreen } from './media/playback';
import { AdapterCall, OnMount } from './media/VideoTile';
import { usePullNewChat } from './NewChatPull';
import { ArrowUpIcon, Txt, spring, useEntrance, useMotionMode, usePressScale } from './primitives';

const GROUP_GAP_MS = 3 * 60_000;
const sameGroup = (a?: Message, b?: Message) =>
  !!a && !!b && a.author === b.author && Math.abs(a.createdAt - b.createdAt) < GROUP_GAP_MS;

export function MessageList({ onImagePress, onNewChat }: { onImagePress(url: string, urls: string[]): void; onNewChat(): void }) {
  const { config, components, renderAudio } = useMehery();
  const { messages, thinking, connection, forms } = useChatState();
  const listRef = useRef<FlatList<Message>>(null);
  const pull = usePullNewChat(messages.length > 0, onNewChat, listRef);
  // Inverted list: newest first, so the conversation sticks to the bottom and grows upward.
  const data = useMemo(() => [...messages].reverse(), [messages]);
  const last = messages[messages.length - 1];
  const buttons = last?.author === 'bot' ? last.buttons : undefined;
  const formId = last && isFormCard(last) ? last.id : undefined;
  const track = backgroundTrack(messages, config.features.backgroundAudio);
  const [pausedFor, setPausedFor] = useState<string | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const showBg = !!track && !!renderAudio && failedFor !== track;
  const bgPaused = !!track && pausedFor === track;

  if (isIcebreaker(messages)) return <Icebreaker message={messages[0]!} />;

  if (messages.length === 0 && connection !== 'connecting' && !thinking) {
    return <Slot name="EmptyState" custom={components.EmptyState} builtIn={EmptyState} props={{ title: config.strings.emptyTitle, body: config.strings.emptyBody }} />;
  }

  return (
    <View style={{ flex: 1 }} collapsable={false}>
      <Animated.View style={[{ flex: 1 }, pull.shiftStyle]}>
        <FlatList
          ref={listRef}
          style={{ flex: 1 }}
          inverted
          data={data}
          bounces
          onScroll={pull.onScroll}
          onScrollEndDrag={pull.onScrollEndDrag}
          onTouchStart={pull.onTouchStart}
          onTouchMove={pull.onTouchMove}
          onTouchEnd={pull.onTouchEnd}
          onTouchCancel={pull.onTouchCancel}
          scrollEventThrottle={16}
          keyExtractor={(m) => m.localId ?? m.id}
          onViewableItemsChanged={pauseOffscreen}
          viewabilityConfig={PLAYBACK_VIEWABILITY}
          renderItem={({ item, index }) => (
        // One message that fails to render shows a note instead of taking the list down.
        <ContainedRender
          where="Message"
          fallback={
            <Txt variant="caption" color={config.colors.muted} style={{ textAlign: 'center', marginVertical: config.spacing * 2 }}>
              {config.strings.messageUnavailable}
            </Txt>
          }
        >
          <MessageBubble
            message={item}
            isFirst={!sameGroup(item, data[index + 1])}
            isLast={!sameGroup(item, data[index - 1])}
            onImagePress={onImagePress}
            formActive={item.id === formId}
            hideSubmitted={!!item.formSubmit || isFormCard(data[index + 1])}
            filled={forms?.[item.id]}
          />
        </ContainedRender>
          )}
          ListHeaderComponent={
        <View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: config.spacing * 2 }}>
            {showBg && track ? (
              <BgToggle
                paused={bgPaused}
                onPress={() => setPausedFor(bgPaused ? null : track)}
              />
            ) : null}
            {buttons?.length ? <QuickReplies key={last!.id} messageId={last!.id} buttons={buttons} /> : null}
          </View>
          {thinking ? <Slot name="ThinkingIndicator" custom={components.ThinkingIndicator} builtIn={ThinkingIndicator} props={{}} /> : null}
        </View>
          }
          contentContainerStyle={{ paddingHorizontal: config.spacing * 4, paddingVertical: config.spacing * 3 }}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        />
      </Animated.View>
      {pull.indicator}
      {showBg && track ? (
        <BackgroundPlayer
          key={track}
          url={track}
          paused={bgPaused}
          onEnd={() => setPausedFor(track)}
          onFail={() => setFailedFor(track)}
        />
      ) : null}
    </View>
  );
}

/** Play/pause for the BG_VOICE track. The player itself sits outside the list. */
function BgToggle({ paused, onPress }: { paused: boolean; onPress(): void }) {
  const { config } = useMehery();
  const s = config.strings;
  return (
    <Pressable
      testID="mehery-bg-audio"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={paused ? s.play : s.pause}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: config.spacing,
        minHeight: 36,
        marginTop: config.spacing * 3,
        paddingHorizontal: config.spacing * 3,
        borderRadius: config.radius.chip,
        borderWidth: 1,
        borderColor: config.colors.border,
        backgroundColor: config.colors.background,
      }}
    >
      {paused ? <PlayIcon color={config.colors.text} size={12} /> : <PauseIcon color={config.colors.text} size={12} />}
      <Txt weight="medium" color={config.colors.text}>
        {paused ? s.play : s.pause}
      </Txt>
    </Pressable>
  );
}

/**
 * One soundtrack for the latest bot message. Not registered with playback.ts, so a voice note
 * can play at the same time. Volume matches the web (0.2).
 */
function BackgroundPlayer({ url, paused, onEnd, onFail }: { url: string; paused: boolean; onEnd(): void; onFail(): void }) {
  const { client, renderAudio } = useMehery();
  if (!renderAudio) return null;
  const fail = (cause: unknown) => {
    client.report({ code: 'MEDIA', message: 'Background audio failed to play', cause });
    onFail();
  };
  return (
    <View pointerEvents="none" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
      <ContainedRender where="renderAudio" fallback={<OnMount run={() => fail(new Error('renderAudio threw'))} />}>
        <AdapterCall
          render={() =>
            renderAudio({
              uri: url,
              paused,
              volume: 0.2,
              onProgress: () => {},
              onEnd,
              onError: fail,
            })
          }
        />
      </ContainedRender>
    </View>
  );
}

/** Landing card for the single `icebrakerMsg` the server sends on auth. Any send returns to the thread. */
function Icebreaker({ message }: { message: Message }) {
  const { config, client } = useMehery();
  const buttons = message.buttons ?? [];
  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: config.spacing * 6, gap: config.spacing * 4 }}>
      {message.text ? (
        <Txt variant="title" weight="bold" style={{ textAlign: 'center' }}>
          {message.text}
        </Txt>
      ) : null}
      {buttons.length ? (
        <View style={{ gap: config.spacing * 2 }}>
          <Txt variant="caption" weight="medium" color={config.colors.muted}>
            {config.strings.quickLinks}
          </Txt>
          {buttons.map((b) => (
            <Pressable
              key={b.id || b.label}
              onPress={() => client.sendText(b.id)}
              accessibilityRole="button"
              accessibilityLabel={b.label}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                paddingHorizontal: config.spacing * 4,
                borderRadius: config.radius.chip,
                borderWidth: 1,
                borderColor: config.colors.border,
                backgroundColor: config.colors.background,
              }}
            >
              <Txt weight="medium">{b.label}</Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Pressable
        onPress={() => client.sendText('#')}
        accessibilityRole="button"
        accessibilityLabel={config.strings.chatWithHuman}
        style={{
          minHeight: 44,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: config.radius.composer,
          backgroundColor: config.colors.accent,
        }}
      >
        <Txt weight="medium" color={config.colors.onAccent}>
          {config.strings.chatWithHuman}
        </Txt>
      </Pressable>
    </View>
  );
}

function QuickReplies({ messageId, buttons }: { messageId: string; buttons: ChatButton[] }) {
  const { config, components, client, openLink } = useMehery();
  const press = (b: ChatButton) => {
    // Existing web flow: URL buttons open; every other type is sent back with its code.
    if (b.type === 'URL' && b.url) openLink(b.url);
    else client.sendQuickReply(b, messageId);
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: config.spacing * 2, marginTop: config.spacing * 3 }}>
      {buttons.map((b, i) => (
        <Stagger key={b.id || b.label} index={i}>
          <Slot name="QuickReply" custom={components.QuickReply} builtIn={QuickReply} props={{ button: b, onPress: () => press(b) }} />
        </Stagger>
      ))}
    </View>
  );
}

function Stagger({ index, children }: { index: number; children: ReactNode }) {
  const style = useEntrance(true, { fromY: 6, fromScale: 0.88, delay: 180 + index * 45 });
  return <Animated.View style={style}>{children}</Animated.View>;
}

export function QuickReply({ button, onPress }: QuickReplyProps) {
  const { config } = useMehery();
  const { scale, onPressIn, onPressOut } = usePressScale(0.94);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole={button.type === 'URL' ? 'link' : 'button'}
        style={{
          minHeight: 36,
          justifyContent: 'center',
          paddingHorizontal: config.spacing * 3.5,
          borderRadius: config.radius.chip,
          borderWidth: 1,
          borderColor: config.colors.border,
          backgroundColor: config.colors.background,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: config.spacing * 1.5 }}>
          <Txt weight="medium" color={config.colors.text}>
            {button.label}
          </Txt>
          {button.type === 'URL' ? (
            <View style={{ transform: [{ rotate: '45deg' }] }}>
              <ArrowUpIcon color={config.colors.muted} size={10} />
            </View>
          ) : null}
        </View>
      </Pressable>
    </Animated.View>
  );
}

export function ThinkingIndicator() {
  const { config } = useMehery();
  const mode = useMotionMode();
  const entrance = useEntrance(true, { fromY: 8 });
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (mode === 'none') return;
    const loop = Animated.loop(
      Animated.stagger(
        140,
        dots.map((d) =>
          Animated.sequence([
            mode === 'spring' ? spring(d, 1, config.motion.preset) : Animated.timing(d, { toValue: 1, duration: 250, useNativeDriver: true }),
            Animated.timing(d, { toValue: 0, duration: 260, useNativeDriver: true }),
          ]),
        ),
      ),
    );
    loop.start();
    return () => loop.stop();
  }, [dots, mode, config.motion.preset]);

  const bounce = mode === 'spring';
  return (
    <Animated.View
      accessibilityLabel={config.strings.typing}
      accessibilityLiveRegion="polite"
      style={[
        {
          alignSelf: 'flex-start',
          flexDirection: 'row',
          gap: 5,
          marginTop: config.spacing * 3,
          paddingHorizontal: config.spacing * 4,
          paddingVertical: config.spacing * 3.5,
          borderRadius: config.radius.bubble,
          backgroundColor: config.botBubble.background,
          transformOrigin: 'bottom left',
        },
        entrance,
      ]}
    >
      {dots.map((d, i) => (
        <Animated.View
          key={i}
          style={{
            width: 7,
            height: 7,
            borderRadius: 4,
            backgroundColor: config.botBubble.text,
            opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.9] }),
            transform: [{ translateY: bounce ? d.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) : 0 }],
          }}
        />
      ))}
    </Animated.View>
  );
}

export function EmptyState({ title, body }: EmptyStateProps) {
  const { config } = useMehery();
  const entrance = useEntrance(true, { fromY: 10 });
  return (
    <Animated.View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: config.spacing * 10, gap: config.spacing * 2 }, entrance]}>
      <Txt variant="title" weight="bold" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      <Txt color={config.colors.muted} style={{ textAlign: 'center' }}>
        {body}
      </Txt>
    </Animated.View>
  );
}
