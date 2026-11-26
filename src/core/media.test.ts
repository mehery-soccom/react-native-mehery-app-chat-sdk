import { describe, expect, it } from 'vitest';
import { fileBadge, formatBytes, formatDuration, thumbnailUrl, waveform } from './media';
import { normalizeMessage } from './safe';

describe('thumbnailUrl', () => {
  it('routes S3 uploads through ImageKit', () => {
    expect(thumbnailUrl('https://mehery-uploads.s3.amazonaws.com/chat/a b/photo.jpg', 240, 180)).toBe(
      'https://ik.imagekit.io/meherysoccom/mehery-uploads/chat/a b/photo.jpg?tr=w-240,h-180',
    );
    expect(thumbnailUrl('https://bucket.s3.ap-south-1.amazonaws.com/x.png', 100.4)).toBe('https://ik.imagekit.io/meherysoccom/bucket/x.png?tr=w-100');
  });

  it('leaves presigned S3 URLs alone', () => {
    const signed = 'https://bucket.s3.amazonaws.com/x.png?X-Amz-Signature=abc';
    expect(thumbnailUrl(signed, 100, 100)).toBe(signed);
  });

  it('replaces or inserts the Cloudinary transformation', () => {
    expect(thumbnailUrl('https://res.cloudinary.com/demo/image/upload/sample.jpg', 120, 90)).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_120,h_90,c_fill/sample.jpg',
    );
    expect(thumbnailUrl('https://res.cloudinary.com/demo/image/upload/c_crop,w_500/e_blur/v123/my_photos/a.jpg', 60)).toBe(
      'https://res.cloudinary.com/demo/image/upload/w_60/v123/my_photos/a.jpg',
    );
  });

  it('returns anything else unchanged', () => {
    for (const url of ['https://example.com/a.jpg', 'data:image/png;base64,AAAA', 'file:///tmp/a.jpg', 'https://res.cloudinary.com/demo/raw/fetch/x']) {
      expect(thumbnailUrl(url, 100, 100)).toBe(url);
    }
  });
});

describe('media formatting', () => {
  it('badges files by extension, then MIME type', () => {
    expect(fileBadge('Invoice-4821.pdf')).toBe('PDF');
    expect(fileBadge(undefined, undefined, 'https://x.com/report.docx?dl=1')).toBe('DOCX');
    expect(fileBadge('notes', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).toBe('DOC');
    expect(fileBadge('archive.backup', 'application/zip')).toBe('ZIP');
    expect(fileBadge()).toBe('FILE');
  });

  it('formats sizes and durations', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB');
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(83_400)).toBe('1:23');
    expect(formatDuration(3_723_000)).toBe('1:02:03');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });

  it('draws a stable waveform per URL', () => {
    const a = waveform('https://x.com/a.mp3', 32);
    expect(a).toHaveLength(32);
    expect(waveform('https://x.com/a.mp3', 32)).toEqual(a);
    expect(waveform('https://x.com/b.mp3', 32)).not.toEqual(a);
    expect(Math.min(...a)).toBeGreaterThanOrEqual(0.2);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
  });
});

describe('media attachment fields', () => {
  it('keeps valid optional media fields and drops bad ones', () => {
    const m = normalizeMessage({
      id: 'm1',
      attachments: [{ url: 'https://x.com/v.mp4', kind: 'video', thumbnailUrl: 'https://x.com/v.jpg', width: 854, height: 480, durationMs: 13_400, size: -1, caption: '' }],
    });
    expect(m?.attachments).toEqual([{ url: 'https://x.com/v.mp4', kind: 'video', thumbnailUrl: 'https://x.com/v.jpg', width: 854, height: 480, durationMs: 13_400 }]);
    const bg = normalizeMessage({
      id: 'bg',
      attachments: [
        { url: 'https://x/bg.mp3', kind: 'audio', background: true },
        { url: 'https://x/a.jpg', kind: 'image', background: 'yes' },
      ],
    });
    expect(bg?.attachments).toEqual([
      { url: 'https://x/bg.mp3', kind: 'audio', background: true },
      { url: 'https://x/a.jpg', kind: 'image' },
    ]);
  });
});
