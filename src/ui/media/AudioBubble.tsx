import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View } from 'react-native';
import { withAlpha } from '../../core/config';
import { formatDuration, waveform } from '../../core/media';
import { useMehery } from '../../react/context';
import type { Attachment } from '../../types';
import { ContainedRender } from '../Guard';
import { Txt, useMotionMode, usePressScale } from '../primitives';
import { PauseIcon, PlayIcon } from './icons';
import { AdapterCall, OnMount } from './VideoTile';
import { mediaId, play, stop, usePlaying } from './playback';

const BARS = 30;
const BAR = 3;
const BAR_GAP = 2;
const WAVE_HEIGHT = 26;
const WAVE_WIDTH = BARS * BAR + (BARS - 1) * BAR_GAP;

/**
 * A voice note / audio clip: play-pause button, a calm waveform (stable per URL) that fills as it
 * plays, and elapsed / total time. Plays through the host's `renderAudio`; without one, or after
 * an error, tapping opens the clip outside the app.
 */
export function AudioBubble({ attachment, messageKey, mine }: { attachment: Attachment; messageKey: string; mine: boolean }) {
  const { config, client, openLink, renderAudio } = useMehery();
  const mode = useMotionMode();
  const id = mediaId(messageKey, attachment.url);
  const playing = usePlaying(id);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState(0); // remounts the player: a fresh start from 0
  const [time, setTime] = useState({ pos: 0, dur: attachment.durationMs ?? 0 });
  const bars = useMemo(() => waveform(attachment.url, BARS), [attachment.url]);
  const fill = useRef(new Animated.Value(0)).current;
  const { scale, onPressIn, onPressOut } = usePressScale(0.9);
  useEffect(() => () => stop(id), [id]);

  // Glide between progress reports (players send a few per second) instead of stepping.
  const progress = time.dur ? Math.min(1, time.pos / time.dur) : 0;
  useEffect(() => {
    if (!playing || mode === 'none' || progress === 0) return fill.setValue(progress);
    const anim = Animated.timing(fill, { toValue: progress, duration: 260, easing: Easing.linear, useNativeDriver: false });
    anim.start();
    return () => anim.stop();
  }, [progress, playing, mode, fill]);

  const colors = mine ? config.userBubble : config.botBubble;
  const inline = !!renderAudio && !failed;
  const report = (cause: unknown) => {
    setFailed(true);
    setStarted(false);
    stop(id);
    client.report({ code: 'MEDIA', message: 'An audio clip failed to play; it opens outside the app instead', cause });
  };
  const ended = () => {
    stop(id);
    setStarted(false);
    setTime((t) => ({ pos: 0, dur: t.dur }));
  };
  const press = () => {
    if (!inline) return openLink(attachment.url);
    if (playing) return stop(id);
    // Paused right at the end (no onEnd came): start over instead of "playing" a finished clip.
    if (time.dur && time.pos >= time.dur - 250) {
      setRun((n) => n + 1);
      setTime((t) => ({ pos: 0, dur: t.dur }));
    }
    setStarted(true);
    play(id);
  };

  const s = config.strings;
  const total = time.dur ? formatDuration(time.dur) : '';
  const clock = started ? `${formatDuration(time.pos)}${total ? ` / ${total}` : ''}` : total;
  const name = attachment.caption ?? attachment.name ?? s.voiceMessage;
  const wave = (color: string) => (
    <View style={{ width: WAVE_WIDTH, height: WAVE_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: BAR_GAP }}>
      {bars.map((h, i) => (
        <View key={i} style={{ width: BAR, height: Math.max(BAR, h * WAVE_HEIGHT), borderRadius: BAR / 2, backgroundColor: color }} />
      ))}
    </View>
  );

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: config.spacing * 3,
        paddingVertical: config.spacing * 2.25,
        paddingStart: config.spacing * 2.25,
        paddingEnd: config.spacing * 3.5,
        borderRadius: config.radius.bubble,
        backgroundColor: colors.background,
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Pressable
          testID="mehery-audio"
          onPress={press}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
          accessibilityRole="button"
          accessibilityLabel={[playing ? s.pause : s.play, name, total, failed ? s.mediaFailed : ''].filter(Boolean).join(', ')}
          style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.text }}
        >
          {playing ? <PauseIcon color={colors.background} size={14} /> : <PlayIcon color={colors.background} size={14} />}
        </Pressable>
      </Animated.View>
      <View style={{ gap: 2 }}>
        <View>
          {wave(withAlpha(colors.text, 0.3))}
          <Animated.View
            style={{ position: 'absolute', top: 0, start: 0, height: WAVE_HEIGHT, overflow: 'hidden', width: fill.interpolate({ inputRange: [0, 1], outputRange: [0, WAVE_WIDTH] }) }}
          >
            {wave(colors.text)}
          </Animated.View>
        </View>
        <Txt variant="caption" color={withAlpha(colors.text, 0.7)} style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {failed ? s.mediaFailed : clock || name}
        </Txt>
      </View>
      {started && renderAudio ? (
        <View pointerEvents="none" style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}>
          <ContainedRender where="renderAudio" fallback={<OnMount run={() => setFailed(true)} />}>
            <AdapterCall
              key={run}
              render={() =>
                renderAudio({
                  uri: attachment.url,
                  paused: !playing,
                  onProgress: (pos, dur) => setTime((t) => ({ pos, dur: dur > 0 ? dur : t.dur })),
                  onEnd: ended,
                  onError: report,
                })
              }
            />
          </ContainedRender>
        </View>
      ) : null}
    </View>
  );
}
