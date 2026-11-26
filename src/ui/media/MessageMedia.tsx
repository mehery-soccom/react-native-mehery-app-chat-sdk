import { View } from 'react-native';
import { useMehery } from '../../react/context';
import type { Attachment } from '../../types';
import { ContainedRender } from '../Guard';
import { Txt } from '../primitives';
import { AudioBubble } from './AudioBubble';
import { ImageGrid, MEDIA_WIDTH } from './ImageGrid';
import { VideoTile } from './VideoTile';

interface Props {
  attachments: Attachment[];
  /** The message's list key (localId ?? id): playback is tied to it. */
  messageKey: string;
  mine: boolean;
  sending: boolean;
  onImagePress(url: string, urls: string[]): void;
}

/** Photos, videos and audio of one message. Files render inside the text bubble (FileRow). */
export function MessageMedia({ attachments, messageKey, mine, sending, onImagePress }: Props) {
  const shown = attachments.filter((a) => !a.background);
  const images = shown.filter((a) => a.kind === 'image');
  return (
    <>
      {images.length ? (
        <ContainedRender where="Photos" fallback={<Broken />}>
          <ImageGrid images={images} sending={sending} onOpen={onImagePress} />
        </ContainedRender>
      ) : null}
      {shown.map((a, i) =>
        a.kind === 'video' || a.kind === 'audio' ? (
          <ContainedRender key={`${i}-${a.url}`} where={a.kind === 'video' ? 'Video' : 'Audio'} fallback={<Broken />}>
            {a.kind === 'video' ? <VideoTile attachment={a} messageKey={messageKey} /> : <AudioBubble attachment={a} messageKey={messageKey} mine={mine} />}
          </ContainedRender>
        ) : null,
      )}
    </>
  );
}

function Broken() {
  const { config } = useMehery();
  return (
    <View style={{ width: MEDIA_WIDTH, padding: config.spacing * 3, borderRadius: config.radius.bubble, backgroundColor: config.colors.surface }}>
      <Txt variant="caption" color={config.colors.muted}>
        {config.strings.messageUnavailable}
      </Txt>
    </View>
  );
}
