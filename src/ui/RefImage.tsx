import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';
import { isSvgRef } from '../core/config';
import { useMehery, type BrandAsset } from '../react/context';
import { ContainedRender } from './Guard';

type SvgComponent = ComponentType<{ width: number; height: number }>;
type Resolved =
  | { kind: 'raster'; source: ImageSourcePropType }
  | { kind: 'svg'; uri: string }
  | { kind: 'component'; Component: SvgComponent }
  | { kind: 'missing'; why: string };

/** Same cap as `components.header.brand.width`, so a configured pixel width is what gets drawn. */
const MAX_WIDTH = 280;

function isComponent(a: unknown): a is SvgComponent {
  // Function/class components, and memo/forwardRef objects (which carry $$typeof).
  return typeof a === 'function' || (typeof a === 'object' && a !== null && '$$typeof' in a);
}

function resolve(ref: string, assets: Record<string, BrandAsset>): Resolved {
  if (ref.startsWith('asset:')) {
    const name = ref.slice('asset:'.length);
    const asset = assets[name];
    if (asset == null) return { kind: 'missing', why: `no image registered as "${name}" in the assets prop` };
    if (isComponent(asset)) return { kind: 'component', Component: asset };
    const uri = typeof asset === 'object' && !Array.isArray(asset) ? (asset as { uri?: unknown }).uri : undefined;
    if (typeof uri === 'string' && isSvgRef(uri)) return { kind: 'svg', uri };
    return { kind: 'raster', source: asset as ImageSourcePropType };
  }
  return isSvgRef(ref) ? { kind: 'svg', uri: ref } : { kind: 'raster', source: { uri: ref } };
}

/**
 * Any config image (see ImageRef): https/S3/CDN, file://, data:, or "asset:<name>"; PNG, JPEG,
 * WebP, GIF, and SVG (bundled components, or URLs via the renderSvg adapter). An explicit `width`
 * draws the image at that pixel width and `height`. Omit `width` and a raster's width follows the
 * image's own shape at the given height. Anything that can't be shown calls `onFail` once and
 * renders nothing, so callers can fall back (e.g. to the title).
 */
export function RefImage({ src, height, width, round = false, onFail }: { src: string; height: number; width?: number; round?: boolean; onFail?: () => void }) {
  const { assets, renderSvg, client } = useMehery();
  const resolved = useMemo(() => resolve(src, assets), [src, assets]);
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const failRef = useRef(onFail);
  failRef.current = onFail;

  const fail = (why: string) => {
    setFailed(true);
    client.report({ code: 'UNKNOWN', message: `Image "${src.slice(0, 80)}" couldn't be shown: ${why}` });
    failRef.current?.();
  };

  useEffect(() => {
    setFailed(false);
    setRatio(null);
    if (resolved.kind === 'missing') return fail(resolved.why);
    if (resolved.kind === 'svg' && !renderSvg) return fail('SVG URLs need the renderSvg adapter (e.g. react-native-svg)');
    if (resolved.kind !== 'raster' || width) return;
    // Measure the image so its width follows its own shape at the requested height.
    const source = resolved.source;
    if (typeof source === 'number') {
      const meta = Image.resolveAssetSource(source);
      if (meta?.width && meta.height) setRatio(meta.width / meta.height);
      return;
    }
    const uri = !Array.isArray(source) ? (source as { uri?: string }).uri : undefined;
    if (uri) Image.getSize(uri, (w, h) => h > 0 && setRatio(w / h), () => {});
    // fail is stable enough for this effect; re-running on its identity would loop.
  }, [resolved, renderSvg, width]);

  if (failed || resolved.kind === 'missing') return null;
  const w = Math.min(MAX_WIDTH, width ?? (round ? height : ratio ? height * ratio : height));
  const shape = { width: w, height, borderRadius: round ? height / 2 : 0, overflow: 'hidden' as const };

  if (resolved.kind === 'raster') {
    return <Image source={resolved.source} style={shape} resizeMode={round ? 'cover' : width != null ? 'stretch' : 'contain'} onError={() => fail('it failed to load')} />;
  }
  const drawn =
    resolved.kind === 'component' ? <resolved.Component width={w} height={height} /> : renderSvg ? renderSvg({ uri: resolved.uri, width: w, height }) : null;
  return (
    <ContainedRender where="Logo" fallback={null}>
      <View style={shape}>{drawn}</View>
    </ContainedRender>
  );
}
