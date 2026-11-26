import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Image, Modal, PanResponder, Pressable, StatusBar, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { formatDuration } from '../../core/media';
import { useMehery } from '../../react/context';
import type { Attachment } from '../../types';
import { ContainedRender } from '../Guard';
import { CloseIcon, Txt, useMotionMode } from '../primitives';
import { PauseIcon, PlayIcon } from './icons';
import { mediaId, play, stop, usePlaying } from './playback';
import { useSwipeDismiss } from './swipeDismiss';
import { AdapterCall, OnMount } from './VideoTile';

const HIDE_AFTER_MS = 2500;
const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;

interface Props {
  attachment: Attachment;
  messageKey: string;
  open: boolean;
  onClose(): void;
  /** The clip can't play: the thumbnail switches to "tap to open outside the app". */
  onFailed(): void;
}

/**
 * Full-screen video player around the host's `renderVideo`: black backdrop, the video fitted,
 * autoplay, minimal controls (play/pause, scrubber with elapsed and remaining time, close) that
 * hide after 2.5 s while playing; a tap toggles them. Swipe down to dismiss like the photo viewer.
 * The player is unmounted on close. Opens with a fade and slight zoom (fade only under Reduce Motion).
 */
export function VideoViewer({ attachment, messageKey, open, onClose, onFailed }: Props) {
  const { config, client, openLink, renderVideo } = useMehery();
  const mode = useMotionMode();
  const { width: W, height: H } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const id = mediaId(messageKey, attachment.url);
  const playing = usePlaying(id);
  const [shown, setShown] = useState(false);
  const [time, setTime] = useState({ pos: 0, dur: attachment.durationMs ?? 0 });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ended, setEnded] = useState(false);
  const [run, setRun] = useState(0); // remounts the player for a fresh start
  const [seekTo, setSeekTo] = useState<{ positionMs: number }>();
  const [scrub, setScrub] = useState<number | null>(null);
  const [controls, setControls] = useState(true);
  const [poke, setPoke] = useState(0); // restarts the auto-hide timer
  const appear = useRef(new Animated.Value(0)).current;
  const controlsFade = useRef(new Animated.Value(1)).current;
  const closing = useRef(false);

  const finish = () => {
    closing.current = false;
    stop(id);
    setShown(false);
    onClose();
  };
  const { drag, panHandlers, away } = useSwipeDismiss(finish);
  const close = () => {
    if (closing.current) return;
    closing.current = true;
    stop(id);
    Animated.timing(appear, { toValue: 0, duration: mode === 'none' ? 0 : 200, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(finish);
  };

  useEffect(() => {
    if (!open) return;
    closing.current = false;
    drag.setValue(0);
    setShown(true);
    setReady(false);
    setFailed(false);
    setEnded(false);
    setSeekTo(undefined);
    setScrub(null);
    setTime({ pos: 0, dur: attachment.durationMs ?? 0 });
    setRun((n) => n + 1);
    setControls(true);
    setPoke((n) => n + 1); // restart the auto-hide timer even if controls were already "on"
    controlsFade.setValue(1);
    play(id);
    appear.setValue(0);
    const anim = Animated.timing(appear, { toValue: 1, duration: mode === 'none' ? 0 : 240, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [open]); // once per opening, by design

  useEffect(() => {
    Animated.timing(controlsFade, { toValue: controls ? 1 : 0, duration: mode === 'none' ? 0 : 200, useNativeDriver: true }).start();
    if (!controls || !playing || scrub !== null) return;
    const timer = setTimeout(() => setControls(false), HIDE_AFTER_MS);
    return () => clearTimeout(timer);
  }, [controls, playing, scrub, poke, mode, controlsFade]);

  const fail = (cause: unknown) => {
    setFailed(true);
    setControls(true);
    stop(id);
    onFailed();
    client.report({ code: 'MEDIA', message: 'A video failed to play; it opens outside the app instead', cause });
  };
  const restart = () => {
    setEnded(false);
    setSeekTo(undefined);
    setRun((n) => n + 1);
    setTime((t) => ({ pos: 0, dur: t.dur }));
  };
  const toggle = () => {
    setPoke((n) => n + 1);
    if (failed) return openLink(attachment.url);
    if (playing) return stop(id);
    if (ended) restart();
    play(id);
  };
  const seek = (ms: number) => {
    setScrub(null);
    setPoke((n) => n + 1);
    setEnded(false);
    setSeekTo({ positionMs: ms });
    setTime((t) => ({ pos: ms, dur: t.dur }));
  };

  const s = config.strings;
  const pos = scrub ?? time.pos;
  const name = attachment.caption ?? attachment.name ?? s.video;
  const zoomIn = mode === 'spring' ? appear.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) : 1;
  const poster = attachment.thumbnailUrl;

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, backgroundColor: '#000', opacity: Animated.multiply(appear, away(1, 0)) }} />
      {shown ? (
        <Animated.View style={{ flex: 1, opacity: appear, transform: [{ translateY: drag }, { scale: away(1, 0.82) }, { scale: zoomIn }] }} {...panHandlers}>
          {renderVideo && !failed ? (
            <View style={[FILL, { alignItems: 'center', justifyContent: 'center' }]}>
              <ContainedRender where="renderVideo" fallback={<OnMount run={() => fail(new Error('renderVideo threw'))} />}>
                <AdapterCall
                  key={run}
                  render={() =>
                    renderVideo({
                      uri: attachment.url,
                      width: W,
                      height: H,
                      paused: !playing,
                      ...(seekTo ? { seekTo } : {}),
                      onProgress: (p, d) => {
                        if (p > 0) setReady(true);
                        setTime((t) => ({ pos: p, dur: d > 0 ? d : t.dur }));
                      },
                      onEnd: () => {
                        stop(id);
                        setEnded(true);
                        setControls(true);
                        setTime((t) => ({ pos: t.dur, dur: t.dur }));
                      },
                      onError: fail,
                    })
                  }
                />
              </ContainedRender>
            </View>
          ) : null}
          {poster && !ready ? <Image pointerEvents="none" source={{ uri: poster }} resizeMode="contain" style={{ position: 'absolute', left: 0, top: 0, width: W, height: H }} /> : null}
          <Pressable
            testID="mehery-video-viewer"
            onPress={failed ? () => openLink(attachment.url) : () => setControls((c) => !c)}
            accessibilityLabel={failed ? `${name}. ${s.mediaFailed}` : name}
            accessibilityHint={s.swipeToClose}
            style={[FILL, { alignItems: 'center', justifyContent: 'center', padding: 32 }]}
          >
            {failed ? (
              <Txt color="#FFFFFF" style={{ textAlign: 'center' }}>
                {s.mediaFailed}
              </Txt>
            ) : !ready && !ended && playing ? (
              <ActivityIndicator size="large" color="#FFFFFF" />
            ) : null}
          </Pressable>
          <Animated.View
            pointerEvents={controls ? 'box-none' : 'none'}
            accessibilityElementsHidden={!controls}
            importantForAccessibility={controls ? 'auto' : 'no-hide-descendants'}
            style={[FILL, { opacity: controlsFade }]}
          >
            {failed || (!ready && playing) ? null : (
              <View pointerEvents="box-none" style={[FILL, { alignItems: 'center', justifyContent: 'center' }]}>
                <Pressable
                  testID="mehery-video-toggle"
                  onPress={toggle}
                  accessibilityRole="button"
                  accessibilityLabel={playing ? s.pause : s.play}
                  style={{ width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' }}
                >
                  {playing ? <PauseIcon color="#FFFFFF" size={22} /> : <PlayIcon color="#FFFFFF" size={22} />}
                </Pressable>
              </View>
            )}
            {failed ? null : (
              // Media timelines run left to right in every language.
              <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 16, direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Txt variant="caption" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'], minWidth: 36 }}>
                  {formatDuration(pos)}
                </Txt>
                <Scrubber pos={pos} dur={time.dur} onScrub={setScrub} onSeek={seek} label={name} />
                <Txt variant="caption" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'right' }}>
                  {`-${formatDuration(Math.max(0, time.dur - pos))}`}
                </Txt>
              </View>
            )}
          </Animated.View>
          <Animated.View style={{ position: 'absolute', top: insets.top + 12, right: 16, opacity: controlsFade }} pointerEvents={controls || failed ? 'auto' : 'none'}>
            <Pressable
              testID="mehery-video-close"
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel={s.close}
              style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' }}
            >
              <CloseIcon color="#FFFFFF" size={14} />
            </Pressable>
          </Animated.View>
        </Animated.View>
      ) : null}
    </Modal>
  );
}

/** Thin seek bar: tap or drag anywhere on it (a 32 pt tall touch strip around a 3 pt line). */
function Scrubber({ pos, dur, onScrub, onSeek, label }: { pos: number; dur: number; onScrub(ms: number): void; onSeek(ms: number): void; label: string }) {
  const width = useRef(1);
  const startX = useRef(0);
  const latest = useRef({ dur, onScrub, onSeek });
  latest.current = { dur, onScrub, onSeek };
  const pan = useMemo(() => {
    const at = (x: number) => Math.min(1, Math.max(0, x / width.current)) * latest.current.dur;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.dur > 0,
      onMoveShouldSetPanResponder: () => latest.current.dur > 0,
      // Don't let the swipe-to-dismiss steal a scrub that drifts vertically.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        startX.current = e.nativeEvent.locationX;
        latest.current.onScrub(at(startX.current));
      },
      onPanResponderMove: (_, g) => latest.current.onScrub(at(startX.current + g.dx)),
      onPanResponderRelease: (_, g) => latest.current.onSeek(at(startX.current + g.dx)),
      onPanResponderTerminate: (_, g) => latest.current.onSeek(at(startX.current + g.dx)),
    });
  }, []);
  const p = dur > 0 ? Math.min(1, pos / dur) : 0;
  const step = dur / 10;
  return (
    <View
      testID="mehery-video-scrubber"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${formatDuration(pos)} / ${formatDuration(dur)}` }}
      onAccessibilityAction={(e) => {
        if (dur > 0) onSeek(Math.min(dur, Math.max(0, pos + (e.nativeEvent.actionName === 'increment' ? step : -step))));
      }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onLayout={(e) => {
        width.current = Math.max(1, e.nativeEvent.layout.width);
      }}
      style={{ flex: 1, height: 32, justifyContent: 'center' }}
      {...pan.panHandlers}
    >
      <View pointerEvents="none" style={{ height: 3, borderRadius: 1.5, backgroundColor: 'rgba(255,255,255,0.3)' }}>
        <View style={{ width: `${p * 100}%`, height: 3, borderRadius: 1.5, backgroundColor: '#FFFFFF' }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${p * 100}%`, width: 12, height: 12, marginLeft: -6, borderRadius: 6, backgroundColor: '#FFFFFF' }} />
    </View>
  );
}
