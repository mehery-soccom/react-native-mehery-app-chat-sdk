# Add Mehery chat to your app with Cursor or Claude Code

This prompt makes an AI coding agent install `react-native-mehery-chat` in **your** React Native or Expo app and wire it up end to end.

**How to use it**

1. Open your app's repository (not this SDK's) in Cursor (Agent mode) or Claude Code.
2. Copy the prompt below, and fill in the **My settings** block at the top. You only need the three channel values; everything else has a sensible default.
3. Paste it and let the agent run. It asks before anything it can't decide on its own.
4. When it finishes, it gives you a short checklist to test on a device.

> **Claude Code tip:** save the prompt as `.claude/commands/add-mehery-chat.md` in your app repo, and run it any time with `/add-mehery-chat`.

---

````markdown
# Task: integrate the Mehery chat SDK (`react-native-mehery-chat`) into this app

You are working in my React Native / Expo app. Add the Mehery chat so customers can talk to our Mehery bot. Follow the steps in order. Read before you write, make the smallest change that works, and don't touch unrelated code or reformat files.

## My settings

```yaml
# Required: from the WebChat channel in Mehery admin
domain: acme.mehery.io          # bare host name, no https://, no path
channelId: web:acme.mehery.io
channelKey: YOUR_CHANNEL_KEY    # a public channel key, safe to ship in the app

# How customers open the chat: launcher | my-button | screen
#   launcher  = floating chat button in the bottom corner (default)
#   my-button = no floating button; I open it from a button/menu item in my app
#   screen    = a full screen in my navigator (embedded)
presentation: launcher

# Branding (optional)
brandName: Acme Support
accentColor: "#0D2B4E"          # buttons, my messages, launcher
onAccentColor: "#FFFFFF"        # text/icons on top of accentColor
logoUrl:                        # optional https URL, shown as a round avatar in the header

# Features: yes | no
signedInUsers: yes              # pass the logged-in user to Mehery and wipe the chat on sign-out
attachments: yes                # customers can send photos and documents
voiceNotes: no                  # record and send voice notes (needs a native module)
mediaPlayback: no               # play bot videos/voice notes in the app (needs a native module)
```

## Ground rules

- **The source of truth is the SDK's README** at `node_modules/react-native-mehery-chat/README.md` and its types at `node_modules/react-native-mehery-chat/lib/typescript/src/`. Read the README after installing. Use only props and options that exist there; never invent API.
- There is exactly **one** `<MeheryChatProvider>`, at the app root, wrapping the navigator.
- **Create the transport once.** Use module scope, or `useMemo` keyed on the signed-in user's id. Never create it inside render: a new transport object starts a new conversation.
- Put the channel values in **one** place:
  - If the app already uses env config (`EXPO_PUBLIC_*`, `react-native-config`, `app.config.js` extra), follow that pattern.
  - Otherwise use a single constants file.
- Never pass the app's login token, JWT, session cookie or API key to the SDK (`user.token` / `getIdentityToken`). Mehery stores that value unverified.
- Install only the libraries the enabled features need. Match the app's package manager (lockfile) and its existing versions.
  - In Expo, use `npx expo install` for native libraries.
  - In bare React Native, run `cd ios && pod install` after adding native libraries.
- Match the app's language (TypeScript or JavaScript), file layout, import style and lint rules.
- If something blocks you, stop and ask me with the exact error. Don't work around it silently. Examples: the package 404s on npm, the React Native version is below 0.76, or you can't find the app root.

## Step 1: Inspect the app (read only)

Find out, and tell me in 3–6 lines:

- **Expo managed, Expo with prebuild/dev client, or bare React Native.** Check `app.json` / `app.config.*`, the `expo` dependency, and whether `ios/` and `android/` exist.
- React and React Native versions. You need React ≥ 18 and React Native ≥ 0.76; stop if they are lower.
- Package manager (from the lockfile), and TypeScript or JavaScript.
- The root component (`App.tsx`, `app/_layout.tsx` for expo-router, or the `index.js` registration), and whether `SafeAreaProvider` is already used.
- Navigation library (React Navigation, expo-router or none), and where a "Help/Support" entry would fit.
- How auth works: where the current user lives (context, store, hook), its id/name/email/phone fields, and where sign-out happens.
- Whether `expo-secure-store`, `react-native-keychain`, `@react-native-async-storage/async-storage`, or a picker/video/svg library is already installed.

## Step 2: Install

```bash
# Expo
npx expo install react-native-safe-area-context expo-secure-store
npm install react-native-mehery-chat           # use the app's package manager

# Bare React Native
npm install react-native-mehery-chat react-native-safe-area-context @react-native-async-storage/async-storage
cd ios && pod install
```

- Skip anything that is already installed.
- **Session storage:** if `expo-secure-store` is available (any Expo app, or a bare app with `expo-modules`), use it through the wrapper in Step 3. Otherwise use AsyncStorage.
- If `react-native-mehery-chat` isn't found on npm, **stop and ask me** for the tarball path or git URL.

Then read `node_modules/react-native-mehery-chat/README.md`.

## Step 3: Create the chat setup in one folder

Create `src/chat/` (or the app's equivalent). Keep it to as few files as the app's style allows.

**a) Storage.** Only if you are using expo-secure-store. Its keys can't contain `:` (the SDK's do) and it has no `removeItem`, so wrap it exactly like this:

```ts
import * as SecureStore from 'expo-secure-store';
import type { KeyValueStorage } from 'react-native-mehery-chat';

const safeKey = (key: string) => key.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

export const chatStorage: KeyValueStorage = {
  getItem: (key) => SecureStore.getItemAsync(safeKey(key)),
  setItem: (key, value) => SecureStore.setItemAsync(safeKey(key), value),
  removeItem: (key) => SecureStore.deleteItemAsync(safeKey(key)),
};
```

Otherwise use `export const chatStorage = AsyncStorage;`.

**b) Config.** Build a `MeheryConfig` from my settings:

```ts
import type { MeheryConfig } from 'react-native-mehery-chat';

export const chatConfig: MeheryConfig = {
  schemaVersion: 1,
  components: { header: { title: BRAND_NAME /* , logo: LOGO_URL if set */ } },
  theme: { colors: { light: { accent: ACCENT, onAccent: ON_ACCENT } } },
  features: { attachments: ['image', 'document'] /* or [] when attachments: no */ },
  behaviour: { presentation: 'modal', launcher: true },
  // my-button → { presentation: 'modal', launcher: false }
  // screen    → { presentation: 'embedded' }
};
```

Leave out anything I left blank. If the app has a dark theme, add `theme.colors.dark` with a readable accent, and pass `colorScheme` from the app's theme when the app overrides the system setting.

**c) Provider component.** For example `ChatProvider`:

```tsx
import { useMemo, type ReactNode } from 'react';
import { MeheryChatProvider, createMeheryTransport } from 'react-native-mehery-chat';

export function ChatProvider({ children }: { children: ReactNode }) {
  const user = useCurrentUser(); // ← the app's real auth hook/store; omit if signedInUsers: no
  const transport = useMemo(
    () =>
      createMeheryTransport({
        domain: MEHERY_DOMAIN,
        channelId: MEHERY_CHANNEL_ID,
        channelKey: MEHERY_CHANNEL_KEY,
        storage: chatStorage,
        user: user ? { id: String(user.id), name: user.name, email: user.email, phone: user.phone } : null,
      }),
    [user?.id],
  );
  return (
    <MeheryChatProvider
      transport={transport}
      config={chatConfig}
      onError={(e) => console.warn('[mehery]', e.code, e.message)} // or the app's logger / crash reporter
      // pickAttachment / voiceRecorder / renderVideo / renderAudio go here (Step 6)
    >
      {children}
    </MeheryChatProvider>
  );
}
```

- Only include `user` fields the app actually has.
- If `signedInUsers: no`, create the transport at module scope instead, with no `useMemo` and no `user`.
- If the app already reports errors (Sentry, Crashlytics, its own logger), send `onError` there.

## Step 4: Mount it at the root

Wrap the app's navigator (or the expo-router root `<Stack>` / `<Slot>` in `app/_layout.tsx`) with `<ChatProvider>`. If the app already has a `SafeAreaProvider`, put `ChatProvider` inside it; if it doesn't, add one around both.

`ChatProvider` must sit **inside** whatever provides the current user, and **inside** any theme provider it reads from.

## Step 5: Give customers a way in

- **launcher:** nothing more to do. The floating button appears in the bottom corner. Check that it doesn't cover a tab bar or a primary button; if it does, raise it with `components.launcher.margin` (0–48) or move it with `position: 'bottom-left'`.
- **my-button:** add a "Help" / "Chat with us" entry where Step 1 found a natural place (profile/settings menu, help screen, header icon). Call `useMeheryChat().open()` from it. Show `unread` as a badge if the app has a badge style.
- **screen:** add a `Support` screen to the navigator that renders `<MeheryChat onClose={navigation.goBack} />` inside a `View` with `flex: 1`. Add an entry point to it as in my-button. If the navigator shows its own header, set `features.header: false` in the config.

## Step 6: Optional features (only those set to yes)

Copy the matching recipe from the SDK README section **"Adapters (attachments, voice, media, SVG)"**:

- **attachments: yes**
  - Expo: `npx expo install expo-image-picker expo-document-picker` and the README's Expo `pickAttachment` recipe.
  - Bare: `react-native-image-picker` and `@react-native-documents/picker` with the README's CLI recipe.
  - Add the photo-library permission text: `NSPhotoLibraryUsageDescription` in `Info.plist`, or the `expo-image-picker` config plugin `photosPermission` in `app.json`.
- **voiceNotes: yes**
  - Install `react-native-nitro-sound` and `react-native-nitro-modules`, and use the README's `voiceRecorder` recipe.
  - Add `NSMicrophoneUsageDescription` (iOS) and the `RECORD_AUDIO` permission (Android).
  - In Expo this needs a dev build (`npx expo run:ios`); tell me it no longer runs in Expo Go.
- **mediaPlayback: yes**
  - Install `react-native-video` and use the README's `renderVideo` and `renderAudio` recipes.
  - Same dev-build note for Expo.

Put adapters in `src/chat/` and pass them to `<MeheryChatProvider>`.

## Step 7: Sign-out (only if signedInUsers: yes)

Find every place the app signs the user out. **Before** the app clears its user, call:

```ts
await chat.logout(); // const chat = useMeheryChat();
```

This deletes the customer's chat session from the device, so the next person on the device starts fresh.

- If sign-out runs outside React (a store action, an API interceptor on 401), expose `logout` through a small ref or callback that `ChatProvider` registers. Don't create a second provider.
- If there are several sign-out paths, cover all of them.

## Step 8: Verify

1. Run the type checker (`npx tsc --noEmit`) and the linter if the project has them. Fix what you introduced.
2. Build and run the app (`npx expo start`, or `npx expo run:ios` / `npm run ios` when you added native modules).
3. If you can't run it, say so. Don't claim it works.

## Step 9: Report back

Reply with:

- **Files** created and changed, one line each.
- **Dependencies** added.
- **Manual steps** left for me: pod install, dev build, permission texts to review, env values to set in CI.
- **Device test checklist:**
  - [ ] The chat opens (launcher / my button / support screen).
  - [ ] The bot's welcome message arrives, and I can send a message and get a reply.
  - [ ] Kill and relaunch the app: the conversation history is still there.
  - [ ] Turn on airplane mode: the offline banner shows; turn it off and tap it to reconnect.
  - [ ] (attachments) Send a photo and a PDF.
  - [ ] (signedInUsers) Sign out, then sign in as another user: their chat starts empty and doesn't show the first user's messages.
  - [ ] Dark mode, if the app supports it: the chat is readable.
````

---

**When something goes wrong**, paste the error back into the agent with: *"Check the Troubleshooting table in node_modules/react-native-mehery-chat/README.md, fix the root cause, and re-run the verification."*
