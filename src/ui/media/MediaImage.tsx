import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, View, type ImageLoadEvent } from 'react-native';
import { useMehery } from '../../react/context';
import { PhotoIcon, Txt, useMotionMode } from '../primitives';

const TIMEOUT_MS = 15_000;
type Load = 'loading' | 'loaded' | 'error';
const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;

interface Props {
  uri: string;
  /** Low-res preview shown first, then cross-faded to `uri`. Same as `uri` (or none): no preview. */
  thumb?: string | undefined;
  width: number;
  height: number;
  label: string;
  testID?: string;
  onPress(): void;
  /** Real aspect ratio, as soon as either image loads. */
  onRatio?: (ratio: number) => void;
  /** Overlays (e.g. "+3", a sending spinner). */
  children?: ReactNode;
}

/**
 * A photo in a fixed box: shimmer, then the thumbnail, then the full image fading in on top.
 * A failed or slow (15 s with nothing shown) load becomes a tap-to-retry tile and a 'MEDIA'
 * report. A broken thumbnail is ignored. If `uri` changes (a just-sent photo's local file
 * replaced by its uploaded copy), the old image stays underneath until the new one is in.
 * Retry remounts the images instead of changing the URL, so signed links keep working.
 */
export function MediaImage({ uri, thumb, width, height, label, testID, onPress, onRatio, children }: Props) {
  const { config, client } = useMehery();
  const mode = useMotionMode();
  const [attempt, setAttempt] = useState(0);
  const [full, setFull] = useState<Load>('loading');
  const [low, setLow] = useState<Load>('loading');
  const [under, setUnder] = useState<string>();
  const fullFade = useRef(new Animated.Value(0)).current;
  const lowFade = useRef(new Animated.Value(0)).current;
  const loadedUri = useRef<string>(undefined);
  const lowUri = under ?? (thumb && thumb !== uri ? thumb : undefined);
  const visible = full === 'loaded' || (!!lowUri && low === 'loaded');

  const firstUri = useRef(uri);
  useEffect(() => {
    if (uri === firstUri.current) return;
    firstUri.current = uri;
    if (loadedUri.current) {
      setUnder(loadedUri.current);
      setLow('loaded');
      lowFade.setValue(1);
    }
    setFull('loading');
    fullFade.setValue(0);
  }, [uri, fullFade, lowFade]);

  const fail = (cause: unknown) => {
    setFull('error');
    client.report({ code: 'MEDIA', message: 'An image failed to load; showing a retry tile', cause });
  };
  useEffect(() => {
    if (full !== 'loading' || visible) return;
    const timer = setTimeout(() => fail(new Error(`Timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [full, visible, attempt]);

  const fadeIn = (v: Animated.Value) => Animated.timing(v, { toValue: 1, duration: mode === 'none' ? 0 : 260, useNativeDriver: true }).start();
  const ratio = (e: ImageLoadEvent) => {
    const s = e.nativeEvent.source;
    if (onRatio && s?.width && s.height) onRatio(s.width / s.height);
  };
  const retry = () => {
    fullFade.setValue(0);
    lowFade.setValue(0);
    setUnder(undefined);
    setLow('loading');
    setFull('loading');
    setAttempt((n) => n + 1);
  };

  return (
    <Pressable
      testID={testID}
      // A tap while the photo is still loading opens the viewer anyway (it loads there too); ignoring
      // the tap read as the app lagging.
      onPress={full === 'error' ? retry : onPress}
      accessibilityRole={full === 'error' ? 'button' : 'imagebutton'}
      accessibilityLabel={full === 'error' ? `${label}. ${config.strings.imageFailed}` : label}
      style={{ width, height, overflow: 'hidden', backgroundColor: config.colors.surface }}
    >
      {full === 'error' ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: config.spacing * 2, padding: config.spacing * 3 }}>
          <PhotoIcon color={config.colors.muted} size={22} />
          {height >= 100 ? (
            <Txt variant="caption" color={config.colors.muted} style={{ textAlign: 'center' }} numberOfLines={3}>
              {config.strings.imageFailed}
            </Txt>
          ) : null}
        </View>
      ) : (
        <>
          {visible ? null : <Shimmer />}
          {lowUri && low !== 'error' ? (
            <Animated.Image
              key={`low-${attempt}-${lowUri}`}
              source={{ uri: lowUri }}
              resizeMode="cover"
              style={[FILL, { opacity: lowFade }]}
              onLoad={(e) => {
                ratio(e);
                setLow('loaded');
                fadeIn(lowFade);
              }}
              onError={() => setLow('error')}
            />
          ) : null}
          <Animated.Image
            key={`full-${attempt}-${uri}`}
            source={{ uri }}
            resizeMode="cover"
            style={[FILL, { opacity: fullFade }]}
            onLoad={(e) => {
              ratio(e);
              loadedUri.current = uri;
              setFull('loaded');
              fadeIn(fullFade);
            }}
            onError={(e) => fail(e.nativeEvent?.error)}
          />
        </>
      )}
      {children}
    </Pressable>
  );
}

/** Soft pulsing placeholder (static under Reduce Motion "none"). */
export function Shimmer() {
  const { config } = useMehery();
  const mode = useMotionMode();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (mode === 'none') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, pulse]);
  return <Animated.View style={[FILL, { backgroundColor: config.colors.border, opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] }) }]} />;
}
