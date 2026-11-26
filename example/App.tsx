import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, Pressable, StatusBar, Text, useColorScheme } from 'react-native';
import Sound from 'react-native-nitro-sound';
import { launchImageLibrary } from 'react-native-image-picker';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { SvgUri, SvgXml } from 'react-native-svg';
import Video, { type VideoRef } from 'react-native-video';
import {
  MeheryChat,
  MeheryChatProvider,
  createMeheryTransport,
  createMockTransport,
  useMeheryChat,
  type AttachmentType,
  type BrandAsset,
  type KeyValueStorage,
  type PickedFile,
  type SvgRenderer,
  type AudioRenderer,
  type VideoRenderer,
  type VoiceRecorder,
} from 'react-native-mehery-chat';
import { PRESETS } from './presets';
import { PlaygroundScreen, buildConfig, type PlaygroundOverrides, type Source } from './Playground';

// Images bundled in the app, referenced from the JSON as "asset:<name>".
const ASSETS: Record<string, BrandAsset> = {
  acmeWordmark: require('./assets/acme-wordmark.png'),
};

// Hermes provides atob at runtime; React Native's TS lib doesn't declare it.
declare const atob: (data: string) => string;

// SVG adapter: the SDK has no SVG dependency; apps that use SVG logos pass this in.
const renderSvg: SvgRenderer = ({ uri, width, height }) => {
  const inline = uri.match(/^data:image\/svg\+xml(;base64)?,(.*)$/);
  if (inline) {
    const xml = inline[1] ? atob(inline[2]!) : decodeURIComponent(inline[2]!);
    return <SvgXml xml={xml} width={width} height={height} />;
  }
  return <SvgUri uri={uri} width={width} height={height} />;
};

// Media adapters: the SDK has no native player; react-native-video plays both video and audio.
function VideoPlayer(p: Parameters<VideoRenderer>[0]) {
  const ref = useRef<VideoRef>(null);
  useEffect(() => {
    try {
      if (p.seekTo) Promise.resolve(ref.current?.seek(p.seekTo.positionMs / 1000)).catch(() => {});
    } catch {
      // ignored
    }
  }, [p.seekTo]);
  return (
    <Video
      ref={ref}
      source={{ uri: p.uri }}
      paused={p.paused}
      resizeMode="contain"
      ignoreSilentSwitch="ignore"
      style={{ width: p.width, height: p.height }}
      onProgress={(e) => p.onProgress(e.currentTime * 1000, e.seekableDuration * 1000)}
      onEnd={p.onEnd}
      onError={p.onError}
    />
  );
}
const renderVideo: VideoRenderer = (p) => <VideoPlayer {...p} />;
const renderAudio: AudioRenderer = (p) => (
  <Video
    source={{ uri: p.uri }}
    paused={p.paused}
    ignoreSilentSwitch="ignore"
    playInBackground={false}
    style={{ width: 1, height: 1 }}
    onProgress={(e) => p.onProgress(e.currentTime * 1000, e.seekableDuration * 1000)}
    onEnd={p.onEnd}
    onError={p.onError}
  />
);

const voiceRecorder: VoiceRecorder = {
  async start() {
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (r !== PermissionsAndroid.RESULTS.GRANTED) throw new Error('Microphone permission denied');
    }
    await Sound.startRecorder();
  },
  async stop() {
    const uri = await Sound.stopRecorder();
    return uri ? { uri, name: 'voice.m4a', mimeType: 'audio/mp4' } : null;
  },
  async cancel() {
    await Sound.stopRecorder().catch(() => {});
  },
};

async function pickAttachment(type: AttachmentType): Promise<PickedFile | null> {
  if (type === 'image') {
    const result = await launchImageLibrary({ mediaType: 'photo', quality: 0.8, selectionLimit: 1 });
    const asset = result.didCancel ? undefined : result.assets?.[0];
    if (!asset?.uri) return null;
    return { uri: asset.uri, name: asset.fileName ?? 'photo.jpg', mimeType: asset.type ?? 'image/jpeg', ...(asset.fileSize ? { size: asset.fileSize } : {}) };
  }
  try {
    const [file] = await pick();
    if (!file) return null;
    return { uri: file.uri, name: file.name ?? 'file', mimeType: file.type ?? 'application/octet-stream', ...(file.size ? { size: file.size } : {}) };
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) return null;
    throw e;
  }
}

// The real channel lives in live.local.ts (gitignored). Without it the example uses the mock chat.
let LIVE_CHANNEL: { domain: string; channelId: string; channelKey: string } | null = null;
try {
  LIVE_CHANNEL = require('./live.local').LIVE_CHANNEL;
} catch {
  // no live channel configured
}

const sessionStorage: KeyValueStorage = AsyncStorage;

export default function App() {
  const system = useColorScheme();
  const [source, setSource] = useState<Source>(LIVE_CHANNEL ? 'live' : 'mock');
  const [mock] = useState(() => createMockTransport());
  const [liveTransport] = useState(() => (LIVE_CHANNEL ? createMeheryTransport({ ...LIVE_CHANNEL, storage: sessionStorage }) : null));
  const transport = source === 'live' && liveTransport ? liveTransport : mock;
  const [preset, setPreset] = useState<keyof typeof PRESETS>('minimal');
  const [overrides, setOverrides] = useState<PlaygroundOverrides>({});
  const [embedded, setEmbedded] = useState(false);
  const [dark, setDark] = useState(system === 'dark');
  const [offline, setOffline] = useState(false);
  const [showEmbedded, setShowEmbedded] = useState(false);

  const chosen = PRESETS[preset]!;
  const live = source === 'live';
  const config = useMemo(() => buildConfig(preset, overrides, { embedded, dark }), [preset, overrides, embedded, dark]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <MeheryChatProvider
        key={source}
        transport={transport}
        config={config}
        colorScheme={dark ? 'dark' : 'light'}
        {...(chosen.locale ? { locale: chosen.locale } : {})}
        pickAttachment={pickAttachment}
        voiceRecorder={voiceRecorder}
        assets={ASSETS}
        renderSvg={renderSvg}
        renderVideo={renderVideo}
        renderAudio={renderAudio}
        onError={(e) => console.log('[mehery]', e.code, e.message)}
      >
        {embedded && showEmbedded ? (
          <SafeAreaView style={{ flex: 1, backgroundColor: dark ? '#0A0A0A' : '#FFFFFF' }} edges={['top']}>
            <Pressable onPress={() => setShowEmbedded(false)} style={{ padding: 16 }}>
              <Text style={{ color: dark ? '#FAFAFA' : '#0A0A0A', fontSize: 16 }}>Back to host app</Text>
            </Pressable>
            <MeheryChat />
          </SafeAreaView>
        ) : (
          <PlaygroundScreen
            dark={dark}
            live={live}
            source={source}
            onSource={setSource}
            preset={preset}
            onPreset={setPreset}
            overrides={overrides}
            onOverrides={setOverrides}
            embedded={embedded}
            onEmbedded={setEmbedded}
            onDark={setDark}
            offline={offline}
            onOffline={(v) => {
              setOffline(v);
              mock.setOnline(!v);
            }}
            config={config}
            openButton={<OpenButton embedded={embedded} onEmbedded={() => setShowEmbedded(true)} dark={dark} />}
          />
        )}
      </MeheryChatProvider>
    </SafeAreaProvider>
  );
}

function OpenButton({ embedded, onEmbedded, dark }: { embedded: boolean; onEmbedded(): void; dark: boolean }) {
  const chat = useMeheryChat();
  return (
    <>
      <Pressable
        onPress={embedded ? onEmbedded : chat.open}
        style={{ marginTop: 24, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: dark ? '#FAFAFA' : '#111111' }}
      >
        <Text style={{ color: dark ? '#111111' : '#FFFFFF', fontSize: 16, fontWeight: '600' }}>
          {embedded ? 'Open embedded chat' : `Open chat${chat.unread ? ` (${chat.unread})` : ''}`}
        </Text>
      </Pressable>
      <Pressable
        onPress={() => {
          // Wipe the stored identity first, then open: the chat connects as a brand-new guest.
          void chat.logout().then(chat.open);
        }}
        style={{
          marginTop: 16,
          width: '50%',
          height: 44,
          borderRadius: 22,
          alignSelf: 'flex-start',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: dark ? '#3F3F46' : '#D4D4D8',
        }}
      >
        <Text style={{ color: dark ? '#FAFAFA' : '#111111', fontSize: 13, fontWeight: '500' }}>Reset guest (testing)</Text>
      </Pressable>
    </>
  );
}
