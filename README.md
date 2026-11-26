# react-native-mehery-chat

Native chat SDK for Mehery chatbots in React Native and Expo apps. You pass a channel and a JSON `config`. The SDK draws the chat, talks to Mehery and keeps the guest's session between launches. Every config value is checked, and a bad value falls back to its default with a warning, never a crash.

> **Using Cursor or Claude Code?** Copy the prompt in [docs/AI_INTEGRATION_PROMPT.md](docs/AI_INTEGRATION_PROMPT.md), fill in your channel, and paste it into the agent in your app's repo. It installs and wires the whole SDK.

**Contents:** [Requirements](#requirements) · [Install](#install) · [Quick start](#quick-start) · [Ways to show the chat](#ways-to-show-the-chat) · [How the connection works](#how-the-connection-works) · [Signed-in customers](#signed-in-customers-and-sign-out) · [Storing the session securely](#storing-the-session-securely) · [Adapters](#adapters-attachments-voice-media-svg) · [API reference](#api-reference) · [Configuration JSON](#configuration-json) · [Connection and errors](#connection-and-errors) · [Security](#security) · [Troubleshooting](#troubleshooting) · [Example app](#example-app)

## Requirements

| | Minimum |
|---|---|
| React | 18 |
| React Native | 0.76 (new or old architecture) |
| `react-native-safe-area-context` | 4.5 |
| Expo | Any SDK that ships React Native 0.76+ (SDK 52+). Works in Expo Go. |

The SDK is plain JavaScript with no native code of its own, so there is no `pod install` or rebuild for the SDK itself. The optional adapters (pickers, media players, recorder) do have native code. See [Adapters](#adapters-attachments-voice-media-svg).

You also need a **WebChat channel** in Mehery admin, which gives you three values:

| Value | Example | Where |
|---|---|---|
| `domain` | `acme.mehery.io` | The channel's domain, a bare host name with no `https://` and no path |
| `channelId` | `web:acme.mehery.io` | Channel settings |
| `channelKey` | `a1b2c3…` | Channel settings. A public key, not a secret (see [Security](#security)) |

## Install

**React Native CLI**

```bash
npm install react-native-mehery-chat react-native-safe-area-context @react-native-async-storage/async-storage
cd ios && pod install   # for safe-area-context and async-storage
```

**Expo**

```bash
npx expo install react-native-safe-area-context @react-native-async-storage/async-storage
npm install react-native-mehery-chat
```

`@react-native-async-storage/async-storage` keeps the guest's session between launches. You can use any store with `getItem` / `setItem` / `removeItem` instead; an encrypted one is better (see [Storing the session securely](#storing-the-session-securely)). Without a store, every launch is a new contact with no history.

<details>
<summary>Installing before the package is on npm</summary>

Build a tarball from this repo and install that:

```bash
# in this repo
npm install && npm pack            # → react-native-mehery-chat-0.1.0.tgz
# in your app
npm install /path/to/react-native-mehery-chat-0.1.0.tgz
```

A git URL also works (`npm install git+https://…/react-native-mehery-chat.git`). The `prepare` script builds `lib/` on install.

</details>

## Quick start

A floating chat button in the corner opens the chat as a full-screen sheet.

```tsx
// App.tsx
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MeheryChatProvider, createMeheryTransport, type MeheryConfig } from 'react-native-mehery-chat';

// Create the transport once, outside render. A new transport means a new conversation.
const transport = createMeheryTransport({
  domain: 'acme.mehery.io',
  channelId: 'web:acme.mehery.io',
  channelKey: 'YOUR_CHANNEL_KEY',
  storage: AsyncStorage,
});

const config: MeheryConfig = {
  schemaVersion: 1,
  components: { header: { title: 'Acme Support' } },
  theme: { colors: { light: { accent: '#0D2B4E', onAccent: '#FFFFFF' } } },
  behaviour: { presentation: 'modal', launcher: true },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <MeheryChatProvider transport={transport} config={config}>
        <YourApp />
      </MeheryChatProvider>
    </SafeAreaProvider>
  );
}
```

Put `MeheryChatProvider` **once**, at the root, around your navigator. It draws the launcher and the chat sheet on top of your app and doesn't change your layout. `SafeAreaProvider` is recommended; without it the SDK reads the insets itself.

No credentials yet? Use `transport={createMockTransport()}`. It runs a scripted demo bot, so you can check the UI first.

## Ways to show the chat

**1. Floating launcher.** Set `behaviour: { presentation: 'modal', launcher: true }`, as in the quick start.

**2. Your own button.** Keep `presentation: 'modal'`, leave `launcher` off, and call `open()` from anywhere inside the provider:

```tsx
import { useMeheryChat } from 'react-native-mehery-chat';

function HelpButton() {
  const { open, unread } = useMeheryChat();
  return <Button title={unread ? `Help (${unread})` : 'Help'} onPress={open} />;
}
```

**3. Embedded screen.** Set `behaviour: { presentation: 'embedded' }` and mount `<MeheryChat />` in a screen of your own. It fills its parent, so give the parent `flex: 1`:

```tsx
import { MeheryChat } from 'react-native-mehery-chat';

function SupportScreen({ navigation }) {
  return (
    <View style={{ flex: 1 }}>
      <MeheryChat onClose={navigation.goBack} />
    </View>
  );
}
```

Your navigator's header owns the top inset; `<MeheryChat />` pads only the bottom (change it with `edges`). To hide the SDK header and keep your navigator's, set `features: { header: false }`. The provider must still wrap the navigator.

## How the connection works

- **The chat connects the first time it is shown.** That is when the modal first opens or `<MeheryChat />` first mounts. Nothing touches the network before then, so `unread` and `onMessageReceived` stay quiet until the customer has opened the chat once.
- After that, the connection stays up while the provider is mounted. Closing the modal keeps it open, so replies that arrive while it is closed count as unread.
- It uses a live socket plus a polling fallback. When it goes offline, the header shows a banner the customer can tap to reconnect. Coming back to the foreground also reconnects.
- **History comes from the server** each time the chat connects, for the session saved in `storage`.
- The `transport` object is the conversation. Pass the same object on every render, from module scope, `useState` or `useMemo`. A new object closes the old conversation and starts a new one.
- `createMeheryTransport` throws straight away if `domain` isn't a bare host name. Create it where an error would show up in development, not inside a `try` that swallows it.

## Signed-in customers and sign-out

Guests need nothing extra. For a signed-in customer, pass `user` and create **one transport per customer**:

```tsx
function ChatRoot({ user, children }) {
  const transport = useMemo(
    () =>
      createMeheryTransport({
        domain: 'acme.mehery.io',
        channelId: 'web:acme.mehery.io',
        channelKey: 'YOUR_CHANNEL_KEY',
        storage: secureStorage,
        user: user ? { id: user.id, name: user.name, email: user.email, phone: user.phone } : null,
        // Optional: a short-lived, chat-only token from your backend, fetched before every sign-in.
        getIdentityToken: user ? () => api.getChatToken() : undefined,
      }),
    [user?.id],
  );
  return <MeheryChatProvider transport={transport} config={config}>{children}</MeheryChatProvider>;
}
```

- Each `user.id` gets its own saved session, so two customers on one device never share a conversation.
- **On sign-out**, call `await useMeheryChat().logout()` *before* you clear your user. It stops the chat, empties the screen and deletes the saved session from the device. The next time the chat opens, it connects as a new guest.
- `getIdentityToken` is sent as `userToken`. **The Mehery backend doesn't verify it yet, so `user.id` is a claim, not proof.** Don't rely on it to protect a customer's private history, and never pass your app's login JWT or API key as `user.token` or from `getIdentityToken`.

```tsx
function SignOutButton() {
  const chat = useMeheryChat();
  return <Button title="Sign out" onPress={async () => { await chat.logout(); await auth.signOut(); }} />;
}
```

## Storing the session securely

The saved session (contact id and session id) is stored as plain text in whatever `storage` you pass. AsyncStorage works, but it isn't encrypted. Use the Keychain/Keystore where you can.

`expo-secure-store` **can't be passed directly**. Its keys allow only letters, digits, `.`, `-` and `_`, but the SDK's keys contain `:`. It also has no `removeItem`, so `logout()` couldn't delete anything. Use this small wrapper (it works in Expo and in bare apps that have `expo-modules` installed):

```ts
// meheryStorage.ts
import * as SecureStore from 'expo-secure-store';
import type { KeyValueStorage } from 'react-native-mehery-chat';

// Escape every character SecureStore refuses. "_" is escaped too, so two different keys never collide.
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export const secureStorage: KeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(safeKey(key)),
  setItem: (key, value) => SecureStore.setItemAsync(safeKey(key), value),
  removeItem: (key) => SecureStore.deleteItemAsync(safeKey(key)),
};
```

## Adapters (attachments, voice, media, SVG)

The SDK has no native dependencies, so a few features turn on only when you pass an adapter. Without the adapter, that feature is hidden or falls back gracefully. You can pass adapters inline: the SDK reads them when they are called, so a new function on every render doesn't rebuild the chat.

| Feature | Prop | Without it |
|---|---|---|
| Send photos / documents | `pickAttachment` | The attach button is hidden |
| Record voice notes | `voiceRecorder` | The mic button is hidden |
| Play video in the chat | `renderVideo` | Tapping a video opens it outside the app |
| Play voice notes / audio | `renderAudio` | Tapping audio opens it outside the app |
| SVG logos and SVG images | `renderSvg` | SVG URLs aren't drawn (PNG, JPEG, WebP and GIF always work) |
| Bundled logos (`asset:name`) | `assets` | `asset:` refs are ignored |

### `pickAttachment`: Expo

```bash
npx expo install expo-image-picker expo-document-picker
```

```ts
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import type { AttachmentType, PickedFile } from 'react-native-mehery-chat';

export async function pickAttachment(type: AttachmentType): Promise<PickedFile | null> {
  if (type === 'image') {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    const a = r.canceled ? undefined : r.assets[0];
    if (!a) return null;
    return { uri: a.uri, name: a.fileName ?? 'photo.jpg', mimeType: a.mimeType ?? 'image/jpeg', ...(a.fileSize ? { size: a.fileSize } : {}) };
  }
  const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  const f = r.canceled ? undefined : r.assets[0];
  if (!f) return null;
  return { uri: f.uri, name: f.name, mimeType: f.mimeType ?? 'application/octet-stream', ...(f.size ? { size: f.size } : {}) };
}
```

### `pickAttachment`: React Native CLI

```bash
npm install react-native-image-picker @react-native-documents/picker && cd ios && pod install
```

```ts
import { launchImageLibrary } from 'react-native-image-picker';
import { errorCodes, isErrorWithCode, pick } from '@react-native-documents/picker';
import type { AttachmentType, PickedFile } from 'react-native-mehery-chat';

export async function pickAttachment(type: AttachmentType): Promise<PickedFile | null> {
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
```

The adapter rules:

- Return `null` on cancel.
- Return a **local** URI (`file:`, `content:`, `ph:` or `assets-library:`). Anything else is refused with `ATTACHMENT_REJECTED`.
- The file must match `features.attachments` and fit `features.maxAttachmentMB` when its size is known.
- If the adapter throws, the error is reported as `PICKER`.

### `voiceRecorder`, `renderVideo`, `renderAudio`: React Native CLI or an Expo dev build

These use `react-native-video` and `react-native-nitro-sound`, which aren't in Expo Go. In Expo, build a dev client (`npx expo run:ios`).

```bash
npm install react-native-video react-native-nitro-sound react-native-nitro-modules && cd ios && pod install
```

```tsx
import { useEffect, useRef } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import Video, { type VideoRef } from 'react-native-video';
import Sound from 'react-native-nitro-sound';
import type { AudioRenderer, VideoRenderer, VoiceRecorder } from 'react-native-mehery-chat';

function VideoPlayer(p: Parameters<VideoRenderer>[0]) {
  const ref = useRef<VideoRef>(null);
  useEffect(() => {
    if (p.seekTo) Promise.resolve(ref.current?.seek(p.seekTo.positionMs / 1000)).catch(() => {});
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
export const renderVideo: VideoRenderer = (p) => <VideoPlayer {...p} />;

// Audio: a 1x1 <Video> mounted off-screen while a clip plays.
export const renderAudio: AudioRenderer = (p) => (
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

export const voiceRecorder: VoiceRecorder = {
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
```

The player contract (`MediaPlayerProps`) works like this:

- The SDK owns play and pause and passes `paused`.
- Your player calls `onProgress(positionMs, durationMs)` a few times a second while playing, `onEnd()` when the clip finishes, and `onError(e)` if it can't play.
- `seekTo` changes when the customer scrubs. Supporting it is optional.
- Any other player works if it follows this contract.

### `renderSvg` and `assets`

```bash
npm install react-native-svg   # Expo: npx expo install react-native-svg
```

```tsx
import { SvgUri, SvgXml } from 'react-native-svg';
import type { SvgRenderer } from 'react-native-mehery-chat';

declare const atob: (data: string) => string; // provided by Hermes

export const renderSvg: SvgRenderer = ({ uri, width, height }) => {
  const inline = uri.match(/^data:image\/svg\+xml(;base64)?,(.*)$/);
  if (inline) return <SvgXml xml={inline[1] ? atob(inline[2]!) : decodeURIComponent(inline[2]!)} width={width} height={height} />;
  return <SvgUri uri={uri} width={width} height={height} />;
};
```

Logos bundled in the app are registered by name and referenced from the config as `asset:<name>`:

```tsx
<MeheryChatProvider
  assets={{ wordmark: require('./assets/logo.png') }}   // or an SVG component from react-native-svg-transformer
  config={{ components: { header: { brand: { image: 'asset:wordmark', height: 28 } } } }}
  …
/>
```

### Permissions

| Adapter | iOS `Info.plist` | Android |
|---|---|---|
| Photo picker | `NSPhotoLibraryUsageDescription` | none on Android 13+ (system photo picker) |
| Voice notes | `NSMicrophoneUsageDescription` | `RECORD_AUDIO` (requested at runtime in the recipe above) |

In Expo, set these through the libraries' config plugins in `app.json`, for example `["expo-image-picker", { "photosPermission": "…" }]`.

## API reference

### `<MeheryChatProvider>`

| Prop | Type | Default | Notes |
|---|---|---|---|
| `transport` | `ChatTransport` | **required** | `createMeheryTransport(…)` or `createMockTransport()`. A new object starts a new conversation. |
| `config` | `MeheryConfig \| null` | defaults | Appearance and behaviour. See [Configuration JSON](#configuration-json). Can be fetched at runtime; changing it never resets the chat. |
| `colorScheme` | `'light' \| 'dark'` | device | Force light or dark. |
| `locale` | `string` | device | SDK text language and time format, for example `"ar-KW"`. RTL languages lay out right to left. |
| `pickAttachment` | `(type) => Promise<PickedFile \| null>` | — | See [Adapters](#adapters-attachments-voice-media-svg). |
| `voiceRecorder` | `VoiceRecorder` | — | |
| `renderVideo` | `VideoRenderer` | — | |
| `renderAudio` | `AudioRenderer` | — | |
| `renderSvg` | `SvgRenderer` | — | |
| `assets` | `Record<string, BrandAsset>` | — | Images for `asset:<name>` refs. |
| `components` | `Partial<MeheryComponents>` | built-ins | Replace `Header`, `Launcher`, `QuickReply`, `EmptyState`, `ThinkingIndicator`. |
| `onLinkPress` | `(url) => boolean \| void` | — | Return `true` if you handled the link (for example in-app navigation). Otherwise the SDK opens it. |
| `allowedLinkSchemes` | `string[]` | — | Extra link schemes, for example `['myapp']` for deep links. |
| `onMessageReceived` | `(message: Message) => void` | — | Every message from the bot or an agent. |
| `onUnreadCountChange` | `(count: number) => void` | — | Replies received while the chat is closed. |
| `onConnectionChange` | `(status) => void` | — | `'connecting' \| 'online' \| 'offline'`. |
| `onError` | `(error: MeheryError) => void` | — | See [Connection and errors](#connection-and-errors). Send it to your crash reporter. |
| `onOpenChange` | `(open: boolean) => void` | — | The modal finished opening or closing. |
| `debug` | `boolean` | `false` | Include the raw `cause` in `onError`. |
| `children` | `ReactNode` | — | Your app. Rendered as is. |

### `<MeheryChat />`

The chat screen, for `presentation: 'embedded'`. In modal mode the provider renders it for you.

| Prop | Type | Default | Notes |
|---|---|---|---|
| `onClose` | `() => void` | — | Shows a close button in the header (when `features.closeButton` is on). |
| `edges` | `('top' \| 'bottom')[]` | `['bottom']` | Safe-area edges to pad. Add `'top'` if no navigator header sits above it. |
| `style` | `StyleProp<ViewStyle>` | — | |

### `useMeheryChat()`

Call it inside the provider; outside it throws. It returns the chat state and actions:

| Field | Type | Notes |
|---|---|---|
| `messages` | `Message[]` | In conversation order. |
| `connection` | `'connecting' \| 'online' \| 'offline'` | |
| `unread` | `number` | Replies received while the chat is closed. |
| `thinking` | `boolean` | A reply is expected (the typing indicator is shown). |
| `isOpen` | `boolean` | The modal is open. |
| `visible` | `boolean` | The chat screen is on screen (modal or embedded). |
| `userName` | `string` | The customer's name, once given. |
| `pendingInput`, `forms` | | Bot form state, for custom UIs. |
| `open()` / `close()` | | Open or close the modal. They do nothing in embedded mode. |
| `send(text)` | | Send a text message. |
| `sendQuickReply(button)` | | Tap a bot button. |
| `sendFile(file: PickedFile)` | | Send a file you picked yourself. |
| `retry(id)` | | Resend a failed message. |
| `newChat()` | `Promise<void>` | Start a fresh conversation for the same customer. |
| `logout()` | `Promise<void>` | Stop the chat and delete the saved session. See [Sign-out](#signed-in-customers-and-sign-out). |

### `useMeheryTheme()`

Returns the resolved config (`colors`, `font`, `radius`, `spacing`, `strings`, …), so a custom slot component can match the chat.

### `createMeheryTransport(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `domain` | `string` | **required** | Bare host name, for example `acme.mehery.io`. Throws if invalid. |
| `channelId` | `string` | **required** | |
| `channelKey` | `string` | **required** | |
| `storage` | `KeyValueStorage` | — | Keeps the session between launches. Without it, every launch is a new contact. |
| `user` | `MeheryUser \| null` | guest | `{ id, name?, email?, phone?, token? }`. |
| `getIdentityToken` | `() => Promise<string \| undefined>` | — | Asked before every sign-in; sent as `userToken`. |
| `context` | `string` | `"/postman"` | Server context path. Change it only if Mehery tells you to. |
| `pollIntervalMs` | `number` | `3000` | Polling interval while the live socket is down. |
| `requestTimeoutMs` | `number` | `15000` | Per-request timeout. Uploads get 60 s plus 10 s per MB. |

### `createMockTransport(options?)`

A scripted demo bot that needs no network. It covers quick replies, a link button, forms, images, files, an agent handoff, and a failed send when you type `fail`.

- `latencyMs` sets the simulated delay (default 350).
- `transport.setOnline(false)` simulates going offline.

### Component slots

```tsx
<MeheryChatProvider components={{ Header: MyHeader, Launcher: MyLauncher, QuickReply: MyChip, EmptyState: MyEmpty, ThinkingIndicator: MyTyping }} … />
```

| Slot | Props |
|---|---|
| `Header` | `{ title, logo?, brand?, connection, onClose? }` |
| `Launcher` | `{ unread, onPress }` |
| `QuickReply` | `{ button, onPress }` |
| `EmptyState` | `{ title, body }` |
| `ThinkingIndicator` | none |

The built-in `Header`, `Launcher`, `QuickReply`, `EmptyState` and `ThinkingIndicator` are exported, so you can wrap them. If a slot throws, the SDK reports `RENDER` and falls back to the built-in.

### Exported types

`MeheryConfig`, `ResolvedConfig`, `Strings`, `Palette`, `ImageRef`, `AttachmentType`, `LauncherIcon`, `LauncherShape`, `MotionPreset`, `ChatState`, `Message`, `Attachment`, `ChatButton`, `FormInput`, `PickedFile`, `ConnectionStatus`, `ChatTransport`, `OutgoingMessage`, `SendReceipt`, `TransportHandlers`, `MeheryError`, `MeheryErrorCode`, `MeheryTransportOptions`, `MeheryUser`, `KeyValueStorage`, `MockTransport`, `MockTransportOptions`, `MeheryChatProviderProps`, `MeheryChatProps`, `UseMeheryChatResult`, `MeheryComponents`, `HeaderProps`, `LauncherProps`, `QuickReplyProps`, `EmptyStateProps`, `BrandAsset`, `SvgRenderer`, `VideoRenderer`, `AudioRenderer`, `MediaPlayerProps`, `VoiceRecorder`.

`resolveConfig(config, scheme?, locale?)` returns `{ config, warnings }`. Use it to validate a config on your server or in a test.

## Configuration JSON

Pass a `MeheryConfig` object as the `config` prop. Every field is optional, so you can store this JSON on your server and change the chat without an app release.

Invalid values fall back to their defaults. The warnings are reported to `onError` as `CONFIG_INVALID`, and in `__DEV__` they are also printed with `console.warn`, with the exact path, for example `config.theme.radius.bubble: must be a number from 0 to 40`.

### Complete example

```json
{
  "schemaVersion": 1,
  "theme": {
    "colors": {
      "light": {
        "accent": "#174EA6",
        "onAccent": "#FFFFFF",
        "background": "#FFFFFF",
        "surface": "#EEF3FB",
        "text": "#0A0A0A",
        "muted": "#71717A",
        "border": "#D6E2F5",
        "error": "#DC2626"
      },
      "dark": {
        "accent": "#8AB4F8",
        "onAccent": "#0B1A33",
        "background": "#0B1220",
        "surface": "#16213A",
        "text": "#FAFAFA",
        "muted": "#A1A1AA",
        "border": "#22304D",
        "error": "#F87171"
      }
    },
    "font": {
      "regular": "Inter-Regular",
      "medium": "Inter-Medium",
      "bold": "Inter-Bold",
      "size": { "body": 15, "caption": 12, "title": 17 },
      "maxScale": 1.6
    },
    "radius": { "bubble": 20, "composer": 22, "chip": 18 },
    "spacing": 4
  },
  "motion": { "preset": "subtle", "revealText": true },
  "components": {
    "header": {
      "title": "Acme Support",
      "logo": "https://cdn.example.com/mark.png",
      "background": "accent",
      "text": "onAccent",
      "brand": {
        "image": "asset:wordmark",
        "position": "center",
        "height": 28,
        "width": 91,
        "title": "show"
      }
    },
    "userBubble": { "background": "#0D2B4E", "text": "#FFFFFF" },
    "botBubble": { "background": "surface", "text": "text" },
    "launcher": {
      "position": "bottom-right",
      "margin": 20,
      "shape": "circle",
      "size": 58,
      "background": "accent",
      "borderColor": "transparent",
      "borderWidth": 0,
      "shadow": true,
      "icon": "chat",
      "iconSize": 24,
      "iconColor": "onAccent"
    }
  },
  "features": {
    "header": true,
    "timestamps": false,
    "avatars": false,
    "attachments": ["image", "document"],
    "maxAttachmentMB": 10,
    "closeButton": true,
    "backgroundAudio": true,
    "attribution": true,
    "phoneDialCode": "+91"
  },
  "behaviour": {
    "presentation": "modal",
    "launcher": true,
    "autoOpen": false
  },
  "strings": {
    "default": "en",
    "en": {
      "title": "Support",
      "placeholder": "Message…",
      "emptyTitle": "How can we help?",
      "emptyBody": "Ask anything and we'll reply right here."
    }
  }
}
```

### Top-level keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `schemaVersion` | `1` | — | Any other value discards the whole object and uses the defaults |
| `theme` | object | see below | Colours, fonts, radii, spacing |
| `motion` | object | `{ preset: "subtle", revealText: true }` | Entrance animation and streaming text |
| `components` | object | — | Header, bubbles, launcher |
| `features` | object | see below | What is shown and what the customer can do |
| `behaviour` | object | `{ presentation: "modal", launcher: false, autoOpen: false }` | How the chat is presented |
| `strings` | object | English | SDK text, per language |

Unknown keys are ignored with a warning.

### Brand name

There is no separate `brandName` key. The name in the header is `components.header.title`; if you leave it out, the SDK uses `strings.title` (default `"Support"`).

### Colours

There are eight palette tokens: `accent`, `onAccent`, `background`, `surface`, `text`, `muted`, `border` and `error`.

- **Palette values** under `theme.colors.light` / `theme.colors.dark` must be hex: `#RGB`, `#RRGGBB` or `#RRGGBBAA`.
- **Component colours** (`components.header.*`, `userBubble`, `botBubble`, `launcher.*`) take a hex or a token name, so `"accent"` follows the palette in both light and dark.
- `"transparent"` is allowed only for `launcher.background` and `launcher.borderColor`.
- **Dark mode without a dark accent:** the light `accent` is kept only if it stays readable on the dark background (contrast 3:1 or more). Otherwise the default dark accent is used.

Default palettes:

| Token | Light | Dark |
|---|---|---|
| `accent` | `#111111` | `#FAFAFA` |
| `onAccent` | `#FFFFFF` | `#0A0A0A` |
| `background` | `#FFFFFF` | `#0A0A0A` |
| `surface` | `#F4F4F5` | `#1C1C1F` |
| `text` | `#0A0A0A` | `#FAFAFA` |
| `muted` | `#71717A` | `#A1A1AA` |
| `border` | `#E4E4E7` | `#27272A` |
| `error` | `#DC2626` | `#F87171` |

### Image refs

`components.header.logo`, `components.header.brand.image` and `components.launcher.image` accept:

- `https://…` (CDN, S3 or CloudFront, including presigned URLs)
- `file://…`
- `data:image/png|jpeg|gif|webp|svg+xml,…`
- `asset:<name>`, an image registered with the provider's `assets` prop (see [`renderSvg` and `assets`](#rendersvg-and-assets))

SVG needs `renderSvg`.

### `theme`

| Path | Type | Default | Range / notes |
|---|---|---|---|
| `colors.light.*` / `colors.dark.*` | hex | see palette table | The eight tokens above |
| `font.regular` / `medium` / `bold` | string | system | Font family names already linked in your app |
| `font.size.body` | number | `15` | 11–24 |
| `font.size.caption` | number | `12` | 9–18 |
| `font.size.title` | number | `17` | 12–28 |
| `font.maxScale` | number | `1.6` | 1–3. Upper limit for the system text size setting |
| `radius.bubble` | number | `20` | 0–40 |
| `radius.composer` | number | `22` | 0–40 |
| `radius.chip` | number | `18` | 0–40 |
| `spacing` | number | `4` | 2–8. Base unit; the layout multiplies it |

### `motion`

| Key | Type | Default | Notes |
|---|---|---|---|
| `preset` | `"none"` \| `"subtle"` \| `"playful"` | `"subtle"` | The system Reduce Motion setting always wins |
| `revealText` | boolean | `true` | New bot text streams in |

### `components.header`

| Key | Type | Default | Notes |
|---|---|---|---|
| `title` | string | `strings.title` | The brand name in the header (up to 200 characters) |
| `logo` | image ref | — | Round avatar beside the title |
| `background` | colour | `background` | |
| `text` | colour | `text` | |
| `brand.image` | image ref | — | Wordmark. Required when `brand` is set |
| `brand.position` | `"left"` \| `"center"` \| `"right"` | `"left"` | `"center"` hides the title unless `brand.title` is `"show"` |
| `brand.height` | number | `28` | 16–48 |
| `brand.width` | number | from aspect ratio | 16–280 |
| `brand.title` | `"show"` \| `"hide"` | `"hide"` when centred, otherwise `"show"` | |

### `components.userBubble` / `botBubble`

| Key | Type | Default |
|---|---|---|
| `background` | colour | user: `accent`, bot: `surface` |
| `text` | colour | user: `onAccent`, bot: `text` |

### `components.launcher`

| Key | Type | Default | Notes |
|---|---|---|---|
| `position` | `"bottom-right"` \| `"bottom-left"` | `"bottom-right"` | |
| `margin` | number | `20` | 0–48, inside the safe area |
| `shape` | `"circle"` \| `"rounded"` \| `"square"` \| `"none"` | `"circle"` | `"none"` shows the bare icon |
| `size` | number | `58` | 32–96 |
| `background` | colour or `"transparent"` | `accent` | |
| `borderColor` | colour or `"transparent"` | `"transparent"` | |
| `borderWidth` | number | `0` | 0–6 |
| `shadow` | boolean | `true` | Turned off when there is no background |
| `icon` | see below | `"chat"` | Ignored when `image` is set |
| `iconSize` | number | `24` | 12–80, capped to fit the container |
| `iconColor` | colour | `onAccent` (`accent` when there is no background) | |
| `image` | image ref | — | Your own launcher icon |

**Launcher `icon` values:** `chat`, `chat-outline`, `bubbles`, `sparkle`, `help`, `headset`, `mail`, `star`, `none`.

### `features`

| Key | Type | Default | Notes |
|---|---|---|---|
| `header` | boolean | `true` | Set `false` to use your own navigator header |
| `timestamps` | boolean | `false` | |
| `avatars` | boolean | `false` | Bot avatar (the header `logo`) beside bot messages |
| `attachments` | `("image" \| "document")[]` | `["image","document"]` | Needs `pickAttachment`. `[]` hides the attach button |
| `maxAttachmentMB` | number | `10` | 1–100 |
| `closeButton` | boolean | `true` | |
| `backgroundAudio` | boolean | `true` | Plays the bot's background voice tracks. Needs `renderAudio` |
| `attribution` | boolean | `true` | `false` hides "Powered by Mehery Soccom" |
| `phoneDialCode` | string | — | For example `"+91"`. Prefixed to phone numbers typed without `+` |
| `phoneMaxDigits` | number | `10` | 7–15. Digit limit for numbers typed without `+`; a `+` number may have 15 |
| `thinkingTimeoutMs` | number | `20000` | 5000–120000. How long the typing indicator waits for a reply |
| `thumbnailProxy` | boolean | `true` | Resizes S3 photos through ImageKit. `false` loads them straight from S3 |
| `persistHistory` | boolean | — | **Not implemented.** Ignored with a warning; history always comes from the server |
| `notifications` | object | — | **Not implemented.** Ignored with a warning |

### `behaviour`

| Key | Type | Default | Notes |
|---|---|---|---|
| `presentation` | `"modal"` \| `"embedded"` | `"modal"` | `"embedded"` needs `<MeheryChat />` on one of your screens |
| `launcher` | boolean | `false` | Floating button (modal only) |
| `autoOpen` | boolean | `false` | Opens the modal on mount (modal only) |

### `strings`

`strings` is a map from language code to a partial table of SDK text, plus an optional `default` language:

```json
{ "strings": { "default": "en", "en": { "title": "Help" }, "ar": { "title": "المساعدة", "placeholder": "اكتب رسالة…" } } }
```

- The SDK picks the table for the provider's `locale`. It tries the exact code (`ar-KW`) first, then the language (`ar`), then `default`, then the built-in English.
- Each string can be up to 300 characters.
- `{n}` and `{mb}` are replaced where the defaults below use them.
- **The SDK ships English only.** Translate every key your customers will see.

<details>
<summary>All string keys and their English defaults</summary>

| Key | Default |
|---|---|
| `title` | Support |
| `placeholder` | Message… |
| `offline` | You're offline |
| `connecting` | Connecting… |
| `reconnect` | Tap to reconnect |
| `notSent` | Not sent. Tap to retry. |
| `emptyTitle` | How can we help? |
| `emptyBody` | Ask anything and we'll reply right here. |
| `quickLinks` | Quick Links |
| `chatWithHuman` | Chat with human |
| `botTalking` | Bot is talking |
| `typing` | Typing |
| `newChat` | New chat |
| `poweredBy` | Powered by Mehery Soccom |
| `fieldName` | Name |
| `fieldEmail` | Email |
| `fieldPhone` | Phone Number |
| `submit` | Submit |
| `required` | This field is required. |
| `invalidEmail` | Please enter a valid email address. |
| `invalidPhone` | Please enter a valid phone number. |
| `phoneTooLong` | Please enter a number with at most {n} digits. |
| `tooLarge` | Files must be smaller than {mb} MB. |
| `imageFailed` | Couldn't load image. Tap to retry. |
| `mediaFailed` | Couldn't play this. Tap to open. |
| `chatUnavailable` | Chat couldn't load right now. |
| `tryAgain` | Try again |
| `messageUnavailable` | This message couldn't be shown. |
| `morePhotos` | {n} more |
| `unreadCount` | {n} unread |
| `send` | Send |
| `attach` | Attach a file |
| `close` | Close chat |
| `openChat` | Open chat |
| `photo` | Photo |
| `document` | Document |
| `video` | Video |
| `voiceMessage` | Voice message |
| `play` | Play |
| `pause` | Pause |
| `sending` | Sending |
| `cancel` | Cancel |
| `you` | You |
| `bot` | Support |
| `swipeToClose` | Swipe down to close |

Some of these are never shown on screen and are read only by screen readers: `typing`, `swipeToClose`, `unreadCount`, `send`, `attach`, `close`, `openChat`, `play`, `pause`, `sending`, `you`, `bot`.

</details>

### Runtime updates

- **A new `config`** re-resolves the theme and updates the open chat without resetting the conversation.
- **A new `transport`** starts a new conversation: the old connection is closed and the chat reconnects on the new one.
- **Remounting `MeheryChatProvider`** also reconnects. History is loaded again from the server for the same saved session.

## Connection and errors

`onConnectionChange(status)` reports `connecting`, `online` and `offline`. The status goes `offline` when a request or reconnect gets no answer, and the header then shows a banner with a reconnect tap. Tapping it, or coming back to the foreground, signs in again, reopens the live socket and catches up on missed messages.

`onError` receives `{ code, message, cause? }`. By default `cause` is reduced to the error's name, message and HTTP status; pass `debug` to the provider for the raw cause. Once the provider is mounted, the SDK doesn't throw into your app: every failure goes to `onError`, and a UI part that fails to draw is replaced with a fallback. Only setup mistakes throw: an invalid `domain` in `createMeheryTransport`, or using the hook outside the provider.

| `code` | Meaning |
|---|---|
| `NETWORK` | No answer, or a 5xx. Retried with backoff (2 s, doubling up to 30 s). |
| `AUTH_FAILED` | 401/403: the channel key or session was refused. Not retried; check `channelId` / `channelKey`. A send refused with 401 signs in once more and is sent again. |
| `SEND_FAILED`, `UPLOAD_FAILED` | A message didn't go out. It stays on screen with a retry tap. Before a retry, the SDK checks the server's copy, so a message whose reply was lost isn't sent twice. |
| `ATTACHMENT_REJECTED` | A file was refused: wrong type, too large, or not a local file. |
| `LINK_BLOCKED` | A bot link used a scheme that isn't allowed. |
| `CONFIG_INVALID` | Warnings from reading your config. |
| `BAD_MESSAGE` | The backend sent something that isn't a usable message. It was skipped. |
| `RENDER` | Part of the UI (or one of your slot components) failed to draw. It was replaced with a fallback. |
| `PICKER` | Your `pickAttachment` or `voiceRecorder` threw. |
| `MEDIA` | A photo, video or audio clip failed to load or play. |
| `UNKNOWN` | Anything else. |

## Security

- **Links.** Bot links open only if they are `https` (http is upgraded), `mailto` or `tel`. Anything else is blocked and reported as `LINK_BLOCKED`. For deep links, pass `allowedLinkSchemes={['myapp']}`.
- **Media.** Photos, video and files from the server must be `https`; `file:`, `data:` and `content:` URLs are dropped. `features.thumbnailProxy: false` stops S3 photos going through ImageKit.
- **Attachments.** Every file (from the picker, the recorder or `sendFile`) must be a local file, match `features.attachments`, and fit `maxAttachmentMB` when its size is known. Otherwise it is refused with `ATTACHMENT_REJECTED`. File names are cleaned before upload.
- **Saved session.** The contact id and session id are kept in the `storage` you pass, as plain text. Use an encrypted store ([how](#storing-the-session-securely)). Signed-in customers each get their own record, and `logout()` deletes it.
- **`user.token` / `getIdentityToken`.** Mehery stores this value and doesn't verify it. Never pass a long-lived auth token, JWT or API key. In development the SDK warns if `user.token` looks like a JWT.
- **`channelKey`** is sent in the request URL and form body, as the web chat does. Treat it as a public channel key, not a secret. It is safe to ship in the app.
- **`domain`** must be a bare host name. The transport refuses responses redirected to another host.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `react-native-mehery-chat: wrap your app in <MeheryChatProvider>` | `useMeheryChat()` or `<MeheryChat />` was used outside the provider. Move the provider up to the app root. |
| Nothing appears | `behaviour.launcher` defaults to `false`. Set it to `true`, or call `useMeheryChat().open()`. In embedded mode, mount `<MeheryChat />`. |
| `createMeheryTransport: "domain" must be a bare host name` | Pass `acme.mehery.io`, not a URL with a path. |
| Header shows "You're offline"; `onError` reports `AUTH_FAILED` | Wrong `channelId` or `channelKey`, or the channel is disabled in Mehery admin. |
| Every launch starts a new conversation | No `storage` was passed, or the transport is recreated with a different `user.id`. |
| The conversation resets on every render | The transport is created inside render. Move it to module scope or `useMemo`. |
| `unread` stays 0 | The chat connects only after it has been opened once (see [How the connection works](#how-the-connection-works)). |
| No attach button | Pass `pickAttachment`, and keep `features.attachments` non-empty. |
| No mic button | Pass `voiceRecorder`. The mic shows only while the composer is empty. |
| Videos or voice notes open in the browser | Pass `renderVideo` / `renderAudio`. |
| SVG logo is missing | Pass `renderSvg`. |
| `ATTACHMENT_REJECTED: the file is not a local file` | Your picker returned a remote URL. Return the local `file://` / `content://` URI. |
| Fonts don't change | `theme.font.*` takes family names that are already linked in your app (`expo-font` or native assets). The SDK doesn't load fonts. |
| `CONFIG_INVALID` warnings | Read the message: each line names the config path and the rule it broke. |

## Example app

The example app is a playground that edits every config field live, with presets (Minimal, Ocean, Midnight, Arabic), a colour picker, launcher icons and the brand name, and shows the JSON passed to the provider. It runs the mock bot by default. To use a real channel, copy `example/live.local.example.ts` to `example/live.local.ts` (gitignored) and fill it in.

```bash
cd example
npm install
npm run ios   # or npm run android
```

`example/App.tsx` wires every adapter, so it is a good reference to copy from.
# react-native-mehery-app-chat-sdk
