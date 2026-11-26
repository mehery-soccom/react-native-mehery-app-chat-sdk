import { useEffect, useState, type ReactNode } from 'react';
import { Animated, Image, Pressable, View } from 'react-native';
import { formatDuration } from '../../core/media';
import { useMehery } from '../../react/context';
import type { Attachment } from '../../types';
import { Txt, usePressScale } from '../primitives';
import { PlayIcon } from './icons';
import { MEDIA_WIDTH } from './ImageGrid';
import { VideoViewer } from './VideoViewer';
import { ContainedRender } from '../Guard';

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;

/** Calls a host adapter inside its own component, so a throw is caught by the surrounding Guard. */
export function AdapterCall({ render }: { render(): ReactNode }) {
  return <>{render()}</>;
}

/** Runs once when shown: lets a Guard fallback flip the owner into its failed state. */
export function OnMount({ run }: { run(): void }) {
  useEffect(run, []);
  return null;
}

/**
 * A video in a message: a still thumbnail (poster or a neutral tile), a play button and the
 * duration. Tap opens the full-screen player (VideoViewer) through the host's `renderVideo`.
 * Without an adapter, or after a playback error, tapping opens the video outside the app.
 */
export function VideoTile({ attachment, messageKey }: { attachment: Attachment; messageKey: string }) {
  const { config, client, openLink, renderVideo } = useMehery();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const { scale, onPressIn, onPressOut } = usePressScale(0.97);

  const W = MEDIA_WIDTH;
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 16 / 9;
  const H = Math.round(Math.min(320, Math.max(135, W / ratio)));
  const poster = attachment.thumbnailUrl;
  const inline = !!renderVideo && !failed;
  // No poster from the server: let the host's player draw the first frame, paused, behind the play button.
  const preview = inline && !open && (!poster || posterFailed) && !previewFailed;
  const s = config.strings;
  const total = attachment.durationMs ? formatDuration(attachment.durationMs) : '';
  const label = [attachment.caption ?? attachment.name ?? s.video, total, failed ? s.mediaFailed : ''].filter(Boolean).join(', ');

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        testID="mehery-video"
        onPress={inline ? () => setOpen(true) : () => openLink(attachment.url)}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={inline ? s.play : undefined}
        style={{ width: W, height: H, borderRadius: config.radius.bubble, overflow: 'hidden', backgroundColor: config.colors.surface, alignItems: 'center', justifyContent: 'center', padding: config.spacing * 3 }}
      >
        {poster && !posterFailed ? (
          <Image
            source={{ uri: poster }}
            resizeMode="cover"
            style={FILL}
            onError={(e) => {
              setPosterFailed(true);
              client.report({ code: 'MEDIA', message: 'A video poster failed to load; showing a plain tile', cause: e.nativeEvent?.error });
            }}
          />
        ) : null}
        {preview ? (
          <View pointerEvents="none" style={FILL}>
            <ContainedRender where="renderVideo" fallback={<OnMount run={() => setPreviewFailed(true)} />}>
              <AdapterCall
                render={() =>
                  renderVideo!({
                    uri: attachment.url,
                    width: W,
                    height: H,
                    paused: true,
                    volume: 0,
                    onProgress: () => {},
                    onEnd: () => {},
                    onError: () => setPreviewFailed(true),
                  })
                }
              />
            </ContainedRender>
          </View>
        ) : null}
        {failed ? (
          <Txt variant="caption" color={config.colors.muted} style={{ textAlign: 'center' }}>
            {s.mediaFailed}
          </Txt>
        ) : (
          <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.48)' }}>
            <PlayIcon color="#FFFFFF" size={20} />
          </View>
        )}
        {total && !failed ? (
          <View style={{ position: 'absolute', bottom: 8, end: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <Txt variant="caption" color="#FFFFFF" style={{ fontVariant: ['tabular-nums'] }}>
              {total}
            </Txt>
          </View>
        ) : null}
      </Pressable>
      {renderVideo ? (
        <VideoViewer attachment={attachment} messageKey={messageKey} open={open} onClose={() => setOpen(false)} onFailed={() => setFailed(true)} />
      ) : null}
    </Animated.View>
  );
}
