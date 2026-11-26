import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { thumbnailUrl } from '../../core/media';
import { useMehery } from '../../react/context';
import type { Attachment } from '../../types';
import { Txt } from '../primitives';
import { MediaImage } from './MediaImage';

export const MEDIA_WIDTH = 240;
const GAP = 2;
const MAX_CELLS = 4;
const clamp = (v: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, v)));

interface Props {
  images: Attachment[];
  sending: boolean;
  onOpen(url: string, urls: string[]): void;
}

/**
 * The photos of one message: a single photo at its own aspect ratio (box reserved up front when
 * width/height are known), or a tidy grid for 2, 3, 4 and more (the fourth cell says "+N").
 */
export function ImageGrid({ images, sending, onOpen }: Props) {
  const { config } = useMehery();
  const [measured, setMeasured] = useState(4 / 3);
  const urls = images.map((a) => a.url);
  const n = images.length;

  const cell = (i: number, width: number, height: number, single = false) => {
    const a = images[i]!;
    const more = i === MAX_CELLS - 1 && n > MAX_CELLS ? n - MAX_CELLS : 0;
    const label = [a.caption ?? a.name ?? config.strings.photo, more ? config.strings.morePhotos.replace('{n}', String(more)) : ''].filter(Boolean).join(', ');
    return (
      <MediaImage
        key={i}
        uri={a.url}
        // Single photos keep their ratio (width only); grid cells are cropped to the cell.
        thumb={a.thumbnailUrl ?? (single ? thumbnailUrl(a.url, width, undefined, config.features.thumbnailProxy) : thumbnailUrl(a.url, width, height, config.features.thumbnailProxy))}
        width={width}
        height={height}
        label={label}
        testID={single ? 'mehery-image' : `mehery-grid-${i}`}
        onPress={() => onOpen(a.url, urls)}
        {...(single && !(a.width && a.height) ? { onRatio: setMeasured } : {})}
      >
        {more ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.42)' }}>
            <Txt variant="title" weight="bold" color="#FFFFFF">{`+${more}`}</Txt>
          </View>
        ) : null}
      </MediaImage>
    );
  };

  const W = MEDIA_WIDTH;
  const half = (W - GAP) / 2;
  let body;
  if (n === 1) {
    const a = images[0]!;
    const ratio = a.width && a.height ? a.width / a.height : measured;
    body = cell(0, W, clamp(W / ratio, 140, 300), true);
  } else if (n === 2) {
    body = (
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {cell(0, half, 168)}
        {cell(1, half, 168)}
      </View>
    );
  } else if (n === 3) {
    const big = Math.round((W - GAP) * 0.6);
    const H = 200;
    body = (
      <View style={{ flexDirection: 'row', gap: GAP }}>
        {cell(0, big, H)}
        <View style={{ gap: GAP }}>
          {cell(1, W - GAP - big, (H - GAP) / 2)}
          {cell(2, W - GAP - big, (H - GAP) / 2)}
        </View>
      </View>
    );
  } else {
    body = (
      <View style={{ width: W, flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        {[0, 1, 2, 3].map((i) => cell(i, half, half))}
      </View>
    );
  }

  return (
    <View style={{ borderRadius: config.radius.bubble, overflow: 'hidden', alignSelf: 'flex-start' }}>
      {body}
      {sending ? (
        <View
          accessibilityLabel={config.strings.sending}
          style={{ position: 'absolute', bottom: 8, end: 8, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' }}
        >
          <ActivityIndicator size="small" color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}
