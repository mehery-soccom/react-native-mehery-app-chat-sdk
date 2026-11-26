import { Pressable, View } from 'react-native';
import { withAlpha } from '../../core/config';
import { fileBadge, formatBytes } from '../../core/media';
import { useMehery } from '../../react/context';
import type { Attachment } from '../../types';
import { Txt } from '../primitives';

/** A document in a message: type badge, name (truncated in the middle, so the extension stays), size. Tap opens it. */
export function FileRow({ attachment, color }: { attachment: Attachment; color: string }) {
  const { config, openLink } = useMehery();
  const badge = fileBadge(attachment.name, attachment.mimeType, attachment.url);
  const name = attachment.name ?? config.strings.document;
  const size = attachment.size ? formatBytes(attachment.size) : '';
  return (
    <Pressable
      testID="mehery-file"
      onPress={() => openLink(attachment.url)}
      accessibilityRole="link"
      accessibilityLabel={[name, badge, size].filter(Boolean).join(', ')}
      style={{ flexDirection: 'row', alignItems: 'center', gap: config.spacing * 2.5, minHeight: 44 }}
    >
      <View style={{ width: 38, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(color, 0.12) }}>
        <Txt weight="bold" color={color} style={{ fontSize: badge.length > 3 ? 9 : 11, lineHeight: 13, letterSpacing: 0.3 }} numberOfLines={1}>
          {badge.slice(0, 5)}
        </Txt>
      </View>
      <View style={{ flexShrink: 1 }}>
        <Txt weight="medium" color={color} numberOfLines={1} ellipsizeMode="middle">
          {name}
        </Txt>
        <Txt variant="caption" color={withAlpha(color, 0.65)}>
          {size || config.strings.document}
        </Txt>
      </View>
    </Pressable>
  );
}
