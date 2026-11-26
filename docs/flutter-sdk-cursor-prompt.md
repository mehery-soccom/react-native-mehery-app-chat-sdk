# Mehery Chat SDK for Flutter: Cursor build prompts

The goal is a Flutter package, `mehery_chat`, that behaves exactly like `react-native-mehery-chat`. It uses the same backend protocol, the same config JSON, the same rules and the same UI, and it has tests for every rule.

The work is split into 14 phases. Each phase is one Cursor Agent prompt. Each phase ends with tests that the agent writes and runs, and **you only move on when they are all green.**

---

## 0. One-time setup (do this before Phase 0)

1. **Copy the React Native SDK in as reference.** This is the single most important step. Ask for the RN repo and copy these into the new Flutter repo:
   ```
   reference/src/                 ← the whole RN src/ folder (core logic + UI + tests)
   reference/README.md
   reference/example/App.tsx
   reference/example/presets.ts
   reference/example/e2e/          ← Maestro flows
   reference/qa/                   ← test bot scripts + chat-ui-test-cases.csv
   reference/screenshots/          ← docs/qa/screenshots/*.png + the 4 root PNGs
   ```
   Add `reference/` to `.pubignore` so it never ships. Cursor reads these files with `@reference/...`. When this document doesn't cover something, **the TypeScript in `reference/src` is the source of truth.**

2. **Create the project:**
   ```bash
   flutter create --template=package mehery_chat
   cd mehery_chat
   flutter create --org io.mehery --platforms=ios,android example
   ```

3. **Save Section 1 below as `.cursor/rules/mehery-sdk.mdc`** (copy the block exactly, including the frontmatter). Cursor then applies it to every prompt.

4. **Create `PROGRESS.md`** in the root with a checklist of Phases 0–13. The agent ticks it off.

5. **The loop for each phase:**
   - Open a **new** Agent chat (this keeps the context clean).
   - Paste the phase prompt from Section 2.
   - Let it write the code and tests and run them.
   - If anything fails, paste the failure back with: *"Fix the implementation, not the test, unless the test contradicts the spec or reference. Re-run."*
   - Only when `dart format`, `flutter analyze` and `flutter test` are all clean: commit, then start the next phase.

---

## 1. MASTER SPEC: save as `.cursor/rules/mehery-sdk.mdc`

````markdown
---
description: Mehery Chat Flutter SDK. Exact port of react-native-mehery-chat. Always apply.
globs:
alwaysApply: true
---

# Mission
Build `mehery_chat`, a Flutter package that is a behaviour-exact port of the React Native SDK in
`reference/src/`. Same backend protocol, same config JSON schema, same validation rules, same
defaults, same strings, same error codes, same UI layout and motion. A host app must be able to
take the SAME config JSON it gives the RN SDK and get the same chat.

When unsure: open the matching TypeScript file in `reference/src/` and port its logic line by line.
Comments in the reference explain WHY; keep the important ones as Dart comments.

# Hard rules
1. Parity over invention. Don't add features, options or "improvements" that aren't in the reference,
   unless this spec says so for a Flutter-specific reason.
2. Core logic (`lib/src/core/`) is pure Dart: no `package:flutter` imports. It must be testable with
   `flutter test` without widgets.
3. Runtime dependencies are ONLY: `http`, `web_socket_channel`, `url_launcher`, `intl`.
   Dev dependency: `fake_async`. Add packages with `flutter pub add` (never hand-write versions).
   No state-management library, no codegen (no freezed/json_serializable), no rxdart.
   Media, pickers, SVG, voice recording and secure storage are HOST ADAPTERS (callbacks the app
   passes in), exactly like the RN SDK. The `example/` app may depend on anything.
4. Every injected dependency (HTTP client, WebSocket factory, storage, clock/timers via fake_async)
   is injectable so the tests never touch the network.
5. Host callbacks can never crash the chat: wrap every call into host code with `safeCall`.
6. Never weaken or delete a test to make it pass. A failing test means the implementation is wrong,
   unless the test contradicts this spec or the reference; then say so explicitly.
7. Keep the same test IDs as the RN SDK as widget Keys AND semantics identifiers:
   `Key('mehery-send')` + `Semantics(identifier: 'mehery-send')`. This lets Maestro e2e flows be reused.
8. Public API is exported only from `lib/mehery_chat.dart`. Everything else lives in `lib/src/`.

# Package layout (mirror the RN file split)
lib/mehery_chat.dart                  exports
lib/src/core/types.dart               Message, Attachment, ChatButton, FormInput, PickedFile, OutgoingMessage,
                                      SendReceipt, TransportHandlers, ChatTransport, MeheryError(+Code)
lib/src/core/safe.dart                safeCall, normalizeMessage
lib/src/core/security.dart            safeLink, safeMediaUrl, redactUrl, isHostname, isContextPath,
                                      isSafeToken, randomHex, safeFileName, checkFile, FilePolicy
lib/src/core/config.dart              resolveConfig, ResolvedConfig, defaults (LIGHT, DARK, DEFAULT_STRINGS),
                                      withAlpha, contrast, isImageRef, isSvgRef, parseHexColor
lib/src/core/rich_text.dart           parseRichText, revealStops, sliceRange, formatStamp, isRTL
lib/src/core/media.dart               thumbnailUrl, fileBadge, formatBytes, formatDuration, waveform
lib/src/core/client.dart              ChatClient + ChatState + form/phone helpers
lib/src/core/stomp.dart               stompFrame, parseStomp
lib/src/core/mehery_transport.dart    createMeheryTransport, mapMeheryMessage, KeyValueStorage,
                                      MemoryStorage, MeheryUser, MeherySocket
lib/src/core/mock_transport.dart      createMockTransport (scripted demo bot)
lib/src/ui/...                        widgets (one file per RN ui file, same names in snake_case)
lib/src/ui/media/...                  media widgets
test/core/*_test.dart, test/ui/*_test.dart, test/parity/*_test.dart

# Dart conventions
- Dart 3, null-safe, `analysis_options.yaml` = flutter_lints + `strict-casts`, `strict-inference`,
  `strict-raw-types`. Zero analyzer issues.
- Immutable models with const constructors, `copyWith`, and value `==`/`hashCode`.
- Enums: Author {user, bot, system}; MessageStatus {sending, sent, failed};
  ConnectionStatus {connecting, online, offline}; AttachmentKind {image, audio, video, file};
  MeheryErrorCode {network, authFailed, sendFailed, uploadFailed, configInvalid, badMessage, render,
  picker, attachmentRejected, linkBlocked, media, unknown}. Each code also has `wireName`
  ('NETWORK', 'AUTH_FAILED', ...) matching the RN docs.
- Times are `int` milliseconds since epoch (like JS `Date.now()`).
- JSON numbers may arrive as int OR double: always read them as `num`.
- Timers: `dart:async` Timer only, so `fake_async` controls them in tests.

# PARITY TRAPS (read before writing any code)
1. URL/form encoding: use `Uri.encodeComponent` and build query strings BY HAND, like the reference
   `query()`. NEVER use `Uri(queryParameters:)` or `http`'s `body: Map` (they encode spaces as '+';
   the RN SDK sends '%20'). Skip null/empty values. The form-encoded auth body is the same string
   without the leading '?'.
2. Path segments for channelId/channelKey: `Uri.encodeComponent(v).replaceAll(RegExp('%3A', caseSensitive: false), ':')`.
3. Cookies: RN `fetch(credentials:'include')` keeps the server's session cookie automatically.
   Dart `http` does NOT. Implement a minimal in-memory cookie jar in the transport (name=value
   pairs from `set-cookie`, sent back as a `Cookie` header on every HTTP request and on the WebSocket
   handshake). `http` joins multiple set-cookie headers with ',', so split with
   `RegExp(r',(?=\s*[^;,=\s]+=)')`. Ignore attributes and expiry. Add the comment
   `// ponytail: in-memory jar, name=value only; the stored session id covers app restarts`.
4. Redirects: set `followRedirects = false` on every request. Any 3xx answer, or a final URL that
   is not https on the same host, throws `Exception('Mehery: the request was redirected to another host')`,
   which counts as "no answer" (reports offline), exactly like the reference.
5. Strings are UTF-16 in both JS and Dart, so string indices match. Port index math 1:1.
   Use `String.codeUnitAt`/`runes` the way the reference uses `charCodeAt`/`codePointAt`.
6. JS `new Date(2026, 10, 16)` is 16 NOVEMBER (months are 0-based). Dart `DateTime(2026, 11, 16)`.
   Convert months carefully when porting date tests.
7. The reference `str(v)` treats '' as missing. `isObj(v)` is "a Map, not a List, not null".
8. `icebrakerMsg` is the backend's real (misspelled) id. Keep the typo.
9. Hex colours `#RRGGBBAA` have alpha LAST. Flutter's `Color(0xAARRGGBB)` has alpha first: convert.
10. Regex: Dart RegExp uses JavaScript regex syntax (named groups, lookbehind, `\uXXXX` escapes inside
    raw strings `r'...'` all work). Port the patterns character for character, with
    `caseSensitive: false` where JS uses /i. For code points above U+FFFF use `unicode: true` + `\u{...}`.
11. JSON maps: keep insertion order when building bodies (Dart map literals keep order). Tests compare
    decoded JSON, so order only matters for readability.
12. Waveform hash uses 32-bit unsigned math: `& 0xFFFFFFFF` after every multiply/add (mobile VM only;
    don't target Flutter web).

# Test conventions
- `flutter_test` + `fake_async`. Async flush helper: `await pumpEventQueue();`.
- Fakes live in `test/support/`: FakeTransport (port of `fakeTransport()` in reference core.test.ts),
  fake HTTP via `package:http/testing.dart` `MockClient`, FakeSocket (records sent frames, can push
  frames, `close()` fires onClose), MemoryStorage.
- Port EVERY test in reference `*.test.ts` that belongs to the phase. Same names, same fixtures,
  same expectations (adjusted only for Dart types). Then add the extra cases each phase lists.
- Widget tests use `motion: {preset: 'none'}` in the config unless they test motion.

# Definition of done (every phase)
`dart format --set-exit-if-changed .` ✔  `flutter analyze` (0 issues) ✔  `flutter test` (all pass) ✔
No TODOs left in code. Tick the phase in PROGRESS.md with a 2-line note on anything that differs from
the reference and why.
````

---

## 2. Phase prompts

> Paste each block into a **fresh** Cursor Agent chat. Every prompt assumes the rule file above is active.

---

### Phase 0: Scaffold

```
Phase 0 of the Mehery Flutter SDK (see .cursor/rules/mehery-sdk.mdc).

Set up the package skeleton only. No features yet.

1. pubspec.yaml: name mehery_chat, description "Native chat SDK for Mehery chatbots in Flutter apps.",
   sdk constraints for Dart 3 / current stable Flutter. Run:
   flutter pub add http web_socket_channel url_launcher intl
   flutter pub add --dev fake_async
2. analysis_options.yaml: include flutter_lints, enable strict-casts, strict-inference, strict-raw-types.
3. Create every file from the "Package layout" in the rule, each with a one-line library doc comment
   and no code yet. Create lib/mehery_chat.dart that will export them.
4. Create test/support/ (empty helpers for now) and test/smoke_test.dart that imports
   package:mehery_chat/mehery_chat.dart and asserts true.
5. .pubignore containing reference/ and example/build/.
6. PROGRESS.md with a checklist of Phases 0–13.

TESTS: smoke_test passes. Gate: dart format, flutter analyze (0 issues), flutter test.
```

---

### Phase 1: Types, safety helpers, security

```
Phase 1. Port the data types and the input-safety layer.
Reference: @reference/src/types.ts @reference/src/core/safe.ts @reference/src/core/security.ts

A) lib/src/core/types.dart
- Attachment {url, kind, name?, mimeType?, thumbnailUrl?, width?, height?, durationMs?, size?, caption?,
  background=false}. ChatButton {id, label, type, url?}. FormInput {name, type, label?}.
- Message {id, author, text, createdAt(int ms), status?, attachments=const[], buttons=const[],
  inputs=const[], fresh=false, localId?, contactName?, formSubmit=false} + copyWith + value equality.
- PickedFile {uri, name, mimeType, size?}. OutgoingMessage {text, form (Map<String,String>?), file?}
  with value equality where form null != form {} (tests rely on this).
  SendReceipt {id, createdAt, attachments?}.
- TransportHandlers {void Function(Message) onMessage; void Function(ConnectionStatus) onConnection}.
- abstract class ChatTransport: Future<List<Message>> connect(TransportHandlers);
  Future<SendReceipt> send(OutgoingMessage); void disconnect();
  and optional methods with no-op defaults: Future<void> restart({bool guest=false}); Future<void> reconnect();
  Future<void> clear(); void setActive(bool active).
- MeheryErrorCode enum (+ wireName) and MeheryError {code, message, cause?}.

B) lib/src/core/safe.dart
- void safeCall(FutureOr<void> Function()? fn): runs host code; swallows sync throws and async errors;
  debugPrint "[mehery_chat] Your callback threw; the chat carried on." only in debug (use
  `const bool.fromEnvironment('dart.vm.product') == false`, no Flutter import).
- Message? normalizeMessage(Object? raw): port of the RN function. Accepts a Map in SDK shape
  (or a Message, via its toJson). Rules: id = non-empty string, or finite number -> String; no id -> null.
  author not in enum -> bot. text: String, null -> '', other -> toString(). createdAt: finite num -> int, else now.
  attachments: drop entries without url; unknown kind -> file; name/mimeType/thumbnailUrl/caption only if
  non-empty strings; background only if === true; width/height/durationMs/size only if finite and > 0.
  buttons: need non-empty label; id = id ?? label; type ?? 'QUICK_REPLY'; url if non-empty.
  inputs: need non-empty name; type ?? 'TEXT'; label if non-empty. contactName trimmed, kept if non-empty.
  status only if valid. localId if non-empty. fresh only if true.

C) lib/src/core/security.dart: port 1:1: safeLink(url, [extraSchemes]), safeMediaUrl, redactUrl,
  isHostname, isContextPath, isSafeToken, randomHex(bytes) (Random.secure), safeFileName, FilePolicy,
  checkFile(file, [policy]).
  FLUTTER DIFFERENCE in checkFile: "local file" means the uri starts with `file:` OR is an absolute
  path starting with `/` (Flutter pickers return paths). content:, ph:, assets-library:, http(s) are
  NOT local. Everything else (extension lists, MIME regexes, audio always allowed, size check) is identical.
  Return the same reason strings: 'the file is not a local file', 'this file type is not allowed',
  'the file is larger than {maxMB} MB'.

TESTS (test/core/security_test.dart, test/core/safe_test.dart). Port from reference security.test.ts
and media.test.ts ("media attachment fields"), plus:
- safeLink: 'https://a.co/x' same; 'http://a.co' -> 'https://a.co'; 'MAILTO:a@b.co' kept;
  'tel:+911234567890' kept; 'www.a.co' -> 'https://www.a.co'; null for: 'javascript:alert(1)',
  'file:///etc/hosts', 'intent://x#Intent;end', 'sms:1', 'market://x', 'myapp://x', 'data:text/html,x',
  ' java\nscript:x', 'https://a.co/\u0000', '', null, 5.
  safeLink('myapp://order/1', ['myapp']) kept; safeLink('other://x', ['myapp']) null.
- redactUrl('https://a.co/path?token=SECRET') == 'https://a.co'; redactUrl('javascript:alert(1)') == 'javascript:'.
- safeMediaUrl keeps https, upgrades http, drops file:, data:, content:, garbage.
- isHostname: 'acme.mehery.io' true, 'a.co:8443' true; false for 'evil.com/x','a@evil.com','evil.com#','a b.com','','evil.com?x=1'.
  isContextPath('') true, '/postman' true, '/a/../b?x' false.
- isSafeToken: 'abc-1.2:3@x' true; 'a/b', 'a b', '' and a 257-char string false.
- randomHex(12) is 24 lowercase hex chars; two calls differ.
- safeFileName('../../etc/passwd') == '.._.._etc_passwd'; safeFileName('..') == 'file';
  control chars replaced; keeps the LAST 120 chars.
- checkFile with policy {image, document; 1 MB}: 'https://x/a.jpg' -> /local/; 'file:///a.jpg' image/jpeg -> null;
  '/data/user/0/app/cache/a.jpg' image/jpeg -> null; 'content://x/1' -> /local/;
  a.exe application/x-msdownload -> /type/; 2 MB jpeg -> /larger/; image with policy [document] -> /type/;
  'file:///r.m4a' audio/mp4 -> null (voice notes always allowed).
- normalizeMessage: {} -> null; the "bad backend data" object from reference core.test.ts
  ({id:7, text:null, createdAt:NaN, author:'alien', buttons:[{label:'Ok'},{},null],
  attachments:[{url:''},{url:'https://x/a.png',kind:'gif'}]}) -> id '7', text '', author bot,
  buttons [{id:'Ok',label:'Ok',type:'QUICK_REPLY'}], attachments [{url:'https://x/a.png',kind:file}],
  finite createdAt. Media fields case from media.test.ts (size -1 and caption '' dropped; background 'yes' dropped).
- safeCall: a sync throw and a Future.error inside fn do not propagate.
- OutgoingMessage(text:'a') != OutgoingMessage(text:'a', form:{}); equal when same text and same form map.

Gate: format, analyze, test.
```

---

### Phase 2: Config resolver

```
Phase 2. Port the config resolver exactly.
Reference: @reference/src/core/config.ts and the "Configuration JSON" section of @reference/README.md

lib/src/core/config.dart:
- resolveConfig(Object? input, {String scheme = 'light', String locale = 'en'})
  returns ({ResolvedConfig config, List<String> warnings}).
  Input is decoded JSON (Map<String, dynamic>), the SAME JSON the RN SDK takes.
- Port LIGHT, DARK, DEFAULT_STRINGS (every key and English value, character for character,
  including the '…' ellipsis and curly quotes), LAUNCHER_ICONS, every range, every default.
- Keep the EXACT evaluation order of the reference function: warnings come out in that order and a
  test checks it. Warning format: 'config.<path>: <problem>' with the same problem texts.
- Rules to keep: schemaVersion other than 1 -> whole config ignored + warning; a non-Map input -> defaults
  + warning; unknown top-level keys warned; palette tokens must be #RGB/#RRGGBB/#RRGGBBAA;
  component colours accept hex or token names; dark-mode brand accent kept only when there is no dark
  accent and contrast(light.accent, dark background) >= 3; launcher rules (shape none -> transparent bg,
  no border, no shadow; "transparent" for background/borderColor; radius from shape; iconSize capped to
  size-8 (or size when shape none); default iconColor accent when transparent else onAccent);
  brand needs image (else warning 'needs an image; ignored'); brand title default hide when centred;
  phoneDialCode must match ^\+\d{1,4}$; persistHistory and notifications accepted but warned as
  'not implemented yet; ignored ...'; strings: locale exact match, else language part, over `default`
  fallback, over English; unknown string keys warned; max 300 chars; str fields max 200 chars;
  image refs per IMAGE_REF regex and max length 200000.
- ResolvedConfig keeps colours as validated hex strings or 'transparent' (like the reference).
  Add Flutter-free helpers: `int parseHexColor(String hex)` returning 0xAARRGGBB (handles #RGB,
  #RRGGBB, #RRGGBBAA with alpha LAST in the input), `withAlpha(hex, alpha)` returning 0xAARRGGBB int
  (alpha multiplies an existing #RRGGBBAA alpha, like the reference), `contrast(a, b)` WCAG ratio,
  isImageRef, isSvgRef.

TESTS (test/core/config_test.dart). Port every resolveConfig test from reference core.test.ts, plus:
- no config -> warnings [], userBubble.background '#111111', strings.placeholder 'Message…'.
- the token/fallback case: accent '#174EA6', surface 'blue' -> '#F4F4F5' + warning,
  botBubble.background 'accent' -> '#174EA6', radius.bubble 99 -> 20, header.logo 'http://insecure.png'
  -> null, attachments ['image','video'] -> ['image','document'], top-level 'surprise' warned.
  Warning paths in EXACT order: config.surprise, config.theme.colors.light.surface,
  config.features.attachments, config.theme.radius.bubble, config.components.header.logo.
- brand image accepted for: an S3 presigned URL, 'asset:wordmark', 'file:///var/app/logo.png',
  'data:image/svg+xml;base64,PHN2Zy8+', 'https://cdn.acme.com/logo.svg' -> {position left, height 28,
  showTitle true}, no warnings. Centred {asset:logo, center, height 40, width 120} -> showTitle false.
  brand 'http://insecure/logo.png' + logo 'javascript:alert(1)' -> both null, warnings in order:
  components.header.logo, components.header.brand.image, components.header.brand.
  isSvgRef('https://x.s3.amazonaws.com/a.SVG?sig=1') true; isSvgRef('asset:logo') false.
- launcher: {icon sparkle, shape rounded, size 64, image https://x.co/i.png, iconColor accent} ->
  iconColor '#111111', radius 19. Icons help/headset/mail/star accepted. {icon rocket, size 200} ->
  chat/58/circle/radius 29 with 2 warnings. {shape none, iconSize 40, size 44, background #ff0000} ->
  background transparent, shadow false, borderWidth 0, iconSize 40, iconColor '#111111'.
  {background transparent, borderColor accent, borderWidth 2, iconSize 70} -> borderColor '#111111',
  iconSize 50, no warnings. iconSize 90 -> 24.
- dark mode: light accent '#174EA6' + scheme dark -> accent '#FAFAFA'; light accent '#8AB4F8' -> kept.
  contrast('#000000','#FFFFFF') ~ 21. withAlpha('#174EA6', 0.5) has r=23 g=78 b=166 a=~128.
  withAlpha('#FFF', 0.25) is white at ~64 alpha.
- strings {default:'en', en:{placeholder:'Type…'}, ar:{placeholder:'اكتب…'}}: locale 'ar-KW' -> 'اكتب…',
  'fr-FR' -> 'Type…'. schemaVersion 2 -> spacing stays 4 and warning mentions schemaVersion.
- phoneDialCode '+91' kept; '91' -> null + warning containing 'phoneDialCode'.
- features.backgroundAudio and attribution default true, false when set false.
- parseHexColor('#F00') == 0xFFFF0000; parseHexColor('#11223344') == 0x44112233.

Gate: format, analyze, test.
```

---

### Phase 3: Rich text, media helpers, time stamps

```
Phase 3. Port text and media helpers (pure Dart).
Reference: @reference/src/core/richText.ts @reference/src/core/media.ts

rich_text.dart: Segment {text, url?, bold, italic, underline, strike, code}. parseRichText (same LINK_RE
with named groups url/email/phone/domain, MARK_RE, CODE_RE, MAX_PARSED_LENGTH 20000, the phone-glued-to-word
rule, middle truncation to 50 chars), revealStops, sliceRange, isRTL (RTL ranges U+0590–U+08FF,
U+FB1D–U+FDFF, U+FE70–U+FEFF; LTR = A–Z a–z U+00C0–U+024F U+0370–U+03FF U+0400–U+04FF),
formatStamp(ts, {int? now, String? locale}): English format by hand ("9:05 am", "3:05 pm Fri",
"12:30 am 04 Oct 26"); any other locale via intl DateFormat (call initializeDateFormatting once,
lazily; on any error fall back to English).
media.dart: thumbnailUrl(url, width, {height, proxy=true}) (S3 -> ImageKit
https://ik.imagekit.io/meherysoccom/{bucket}/{key}?tr=w-W[,h-H]; Cloudinary transform replace/insert;
presigned S3 untouched), fileBadge, formatBytes, formatDuration, waveform (FNV-1a + LCG, 32-bit math).

TESTS (test/core/rich_text_test.dart, test/core/media_test.dart). Port all richText, media and
"parseRichText stays fast" tests, including:
- 'Order *#4821* is _out_ now, see https://acme.com/x.' -> [Order ][#4821 bold][ is ][out underline]
  [ now, see ][https://acme.com/x url same][.]
- 'and/or 1/2 snake_case_name' -> one plain segment. '/soft/ ~old~ `code`' -> italic, ' ', strike, ' ', code.
- 'mail sam@acme.com now' -> mailto link. 'see mehery.com.' -> https://mehery.com + '.'.
  'call +91 98765 43210' -> tel:+919876543210. 'or 202-555-0100' -> tel:2025550100.
  Plain (no links): '2026-11-16', 'TXN-20261116-01', '1.2.3', '12345'.
  120-char URL -> text = first 24 + '…' + last 25, url untouched.
- sliceRange(parse('one *two* three'), 2, 6) == [{e }, {tw bold}]; (0,99) == all.
- revealStops: 'ab' [1,2]; 'a👋🏽b' [1,5,6]; '🇰🇼' [4]; '👨‍👩‍👧' [8]; 'é' (e + U+0301) [2]; '❤️!' [2,3].
- isRTL('مرحبا hello') true; isRTL('123 hello مرحبا') false.
- formatStamp with now = DateTime(2026,11,16,15,0): DateTime(2026,11,16,9,5) -> '9:05 am';
  DateTime(2026,11,13,15,5) -> '3:05 pm Fri'; DateTime(2026,10,4,0,30) -> '12:30 am 04 Oct 26'.
  With locale 'ar' returns a non-empty string different from the English one and does not throw.
- A 25,000-char string returns one plain segment and finishes in < 50 ms; 'x'*5000 + ' https://a.co'
  still links normally under the cap.
- thumbnailUrl cases from media.test.ts (S3 with space in path, ap-south-1 bucket with width 100.4 -> w-100,
  presigned untouched, Cloudinary insert 'w_120,h_90,c_fill', chained-transform replace -> 'w_60/v123/...',
  others unchanged incl. data:/file:/cloudinary raw). proxy:false leaves S3 unchanged.
- fileBadge('Invoice-4821.pdf') PDF; (null,null,'https://x.com/report.docx?dl=1') DOCX; ('notes', wordprocessingml) DOC;
  ('archive.backup','application/zip') ZIP; () FILE.
- formatBytes 512 '512 B', 1536 '1.5 KB', 2 MiB '2 MB', 250 MiB '250 MB'. formatDuration 0 '0:00',
  83400 '1:23', 3723000 '1:02:03', NaN '0:00'.
- waveform('https://x.com/a.mp3', 32): length 32, deterministic, differs for b.mp3, all values in [0.2, 1].

Gate: format, analyze, test.
```

---

### Phase 4: The conversation engine (ChatClient)

```
Phase 4. Port the conversation engine exactly. This is the heart of the SDK; go slowly.
Reference: @reference/src/core/client.ts (port EVERY function and comment-documented rule)

lib/src/core/client.dart:
- Helpers: attachmentKind(mime), isDelivered, formFields (TEXT/EMAIL/PHONE, case-insensitive),
  isFormCard, isIcebreaker (exactly one message with id 'icebrakerMsg'), visibleAttachments,
  backgroundTrack(messages, enabled), withDialCode, PHONE_MAX_DIGITS 10, PHONE_MAX_INTERNATIONAL 15,
  phoneLimit, isEmailInput, isPhoneInput, phoneDigitCount, limitPhoneDigits, isValidInput
  (EMAIL ^[^\s@]+@[^\s@]+\.[^\s@]+$, PHONE ^\+?[\d\s()-]{6,}$).
- ChatState (immutable): messages, connection, thinking, unread, visible, pendingInput, forms
  (Map<messageId, Map<field, value>>), userName.
- ChatClient extends ChangeNotifier (getter `state`; every update replaces the state object and calls
  notifyListeners). Constructor (ChatTransport transport, {ClientEvents events}).
  ClientEvents: onMessageReceived, onUnreadCountChange, onError, onConnectionChange.
  Public: report(MeheryError), start(), newChat({guest}), reconnect(), stop(), send(text, [form]),
  sendText(text), sendForm(values), sendQuickReply(button, [replyIdExt]), setFilePolicy(policy),
  sendFile(picked), logout(), retry(id), setVisible(bool), receive(Object? raw),
  thinkingTimeoutMs (default 20000).
- Keep EVERY rule: epoch guard (newChat/logout bump it; stale connects, sends and handlers are
  dropped); started/stopped flags; connect failure -> offline, AUTH_FAILED (no retry) when the cause is
  an HTTP 401/403 (MeheryHttpException with .status, defined in mehery_transport.dart or a shared
  file), otherwise NETWORK + backoff 2s,4s,8s… max 30s; history sorted by createdAt and merged;
  pendingInput = inputs[0] of the latest message; knownName from contactName; outbox + awaitingReply
  logic so typing never turns on after the reply is already shown; thinking timer; receipt without id
  keeps the local id; duplicate server id removes the local copy; receipt createdAt replaces local time;
  send() binds pendingInput as form {name: text} and sets userName when the field is 'name';
  sendForm trims, drops empty fields, records forms[cardId], sends text 'Submitted' with formSubmit=true;
  sendQuickReply form {reply_id, reply_title, replyIdExt?}; sendFile runs checkFile and reports
  ATTACHMENT_REJECTED with 'File not sent: <reason>'; receive(): normalize (BAD_MESSAGE when null),
  merge, only the latest message changes pendingInput, unchanged repeat = no new state and no notify,
  unread++ only for new bot messages while hidden, a bot message clears thinking and awaitingReply;
  setVisible(false) marks every message not fresh; mergeAll ordering (insert after the last settled
  message that is not newer; sending/failed messages hold their place); sameMessage ignores `fresh`.
- Local ids are 'local-1', 'local-2', ... per client.

test/support/fake_transport.dart: port fakeTransport() and scripted() from reference tests.

TESTS (test/core/client_test.dart). Port ALL "ChatClient" tests from reference core.test.ts and ALL
"ChatClient ordering and state" tests from resilience.test.ts. Use fake_async for timer tests. List:
- sends optimistically ('  hi  ' -> text 'hi', status sending), then id 's1' sent, thinking true;
  a bot message clears thinking.
- bot reply arrives before the receipt (gated send): thinking stays false before AND after the receipt.
- thinking clears exactly at 20000 ms (true at 19999).
- failure -> status failed + SEND_FAILED; retry sends the same payload (OutgoingMessage(text:'hello')).
- form prompt: pendingInput email; send('a@b.co') -> {text, form:{email}}; pendingInput null;
  sendQuickReply(Track) -> form {reply_id:'track', reply_title:'Track'}.
- contact card: pendingInput 'name'; sendForm with ' 09938374 ' -> trimmed; last message 'Submitted';
  re-pushed card does NOT re-arm; next send('hi') has no form.
- re-polled prompt + customer echo -> pendingInput null; send('thanks') no form.
- contactName 'Neil' from history -> userName; later 'Neil K' updates.
- history ending on a form arms the composer.
- isFormCard / formFields rules (CHECKBOX, radio dropped; 'text' lowercase counts).
- isValidInput case-insensitive type; the full email/phone table (10-digit default, '+' lifts to 15,
  phoneMax 12 override, NUMBER type, name 'phone' with TEXT type, null input -> true);
  limitPhoneDigits('+91 98765 43210 99999') -> '+91 98765 43210 999'; '(555) 123-456789' -> '(555) 123-4567';
  '555123456789' -> '5551234567'. phoneDigitCount('(555) 123-4567') 10.
- isDelivered table. attachmentKind('audio/mpeg') audio; sendFile of a voice note keeps
  {url, kind audio, name, mimeType}.
- visibleAttachments / backgroundTrack table.
- isIcebreaker table.
- repeat poll of an unchanged message: identical(state) and listener NOT called; an edited text
  -> new state, fresh true, listener called once.
- withDialCode table ('98765 43210' -> '+91 98765 43210'; '09876543210' -> '+91 9876543210';
  ' +1 202-555-0100 ' -> '+1 202-555-0100'; no code -> unchanged).
- dedupe by id; unread only while hidden; onUnreadCountChange calls [[1],[0]]; history not fresh;
  setVisible(false) -> no fresh messages.
- bad backend data + throwing host callbacks (sync throw and Future.error) do not throw; BAD_MESSAGE reported.
- newChat while a send is in flight: the late receipt is dropped; messages [], thinking false, pendingInput null.
- receipt without id -> id 'local-1', status sent.
- connect fails twice then succeeds at 2s + 4s; onError twice; stop() cancels a pending retry.
- back-filled message (a@100, c@300, then b@200) ends [a, b, c].
- reply arriving while a send is pending goes after it; the sent message takes the server time 5001.
- sendForm then a typed 'Submitted': formSubmit flags [true, false].
- onConnectionChange once per change: ['online','offline','online'].
- thinkingTimeoutMs = 20 respected.
- reconnect() on a started client calls transport.reconnect exactly once.
- EXTRA: logout() clears messages, userName, forms and calls transport.clear(); a send resolving after
  logout does not reappear.

Gate: format, analyze, test.
```

---

### Phase 5: Mehery transport, HTTP side (auth, send, upload, poll, storage, cookies)

```
Phase 5. Port the REST half of the real transport. NO WebSocket yet: in this phase openSocket() just
calls startPolling(). Phase 6 adds STOMP.
Reference: @reference/src/core/meheryTransport.ts (top-of-file comment lists the 4 endpoints)

lib/src/core/mehery_transport.dart:
- KeyValueStorage (abstract): FutureOr<String?> getItem(key); FutureOr<void> setItem(key, value);
  FutureOr<void> removeItem(key) with a DEFAULT implementation that calls setItem(key, '')
  (this mirrors "storage without removeItem" in the reference). MemoryStorage (Map-backed, overrides removeItem).
- MeheryUser {id, name?, email?, phone?, token?}.
- MeheryTransportOptions {domain, channelId, channelKey, user?, storage?, getIdentityToken?,
  context='/postman', pollIntervalMs=3000, requestTimeoutMs=15000, http.Client? client,
  SocketFactory? socketFactory}.
- createMeheryTransport(options) returns ChatTransport. Domain: strip http(s):// and trailing '/', must pass
  isHostname else throw ArgumentError containing 'domain'; context must pass isContextPath else throw
  containing 'context'. In debug, warn if user.token looks like a JWT.
- mapMeheryMessage(raw): port exactly (messageId ?? id; type 'I' -> user else bot; text ?? message;
  timestamp > 0 else now; attachments via safeMediaUrl, mediaType IMAGE/AUDIO/VIDEO else file,
  name = mediaName ?? mediaCaption, caption, mimeType, BG_VOICE -> background; buttons: label required,
  id = name ?? code ?? label, type default QUICK_REPLY, url; inputs: name ?? code, type default TEXT,
  label; contact.name -> contactName).
- Session {installId, csid?, webSessionKey?, webSessionId?, ticketHash?, fresh?} persisted as JSON under
  storageKey = 'mehery:{domain}:{channelId}' + (user != null ? ':u:{user.id}' : ''); metaKey =
  'mehery:{domain}:{channelId}:meta' holding {"webSessionKey": ...}. loadSession/saveSession/absorb/
  sessionParam exactly as the reference (incl. a user with no saved record on a device that has a
  metaKey gets webSessionId = randomHex(12)).
- request(): hand-built query strings (PARITY TRAP 1), Accept: application/json, cookie jar (TRAP 3),
  followRedirects=false + redirect refusal (TRAP 4), per-request timeout (Future.timeout), non-2xx ->
  MeheryHttpException(status, 'Mehery {status}[: body.message ?? body.error]'). A successful answer while
  reported offline -> report online. Any non-HTTP failure (timeout, socket, redirect) -> report offline, rethrow.
  report() only fires on change and never after disconnect.
- auth(): POST {base}/ext/plugin/outbound/web/auth/v2{?key=id}, content-type
  'application/x-www-form-urlencoded;charset=UTF-8', fields in this order: number, csid, browserfp,
  channelId, channelKey, visitorId (all four ids = installId), userCode, userToken
  (getIdentityToken() ?? user.token, asked on EVERY auth, its throw ignored), userName, userEmail, userPhone.
- connect(): exactly the reference sequence (generation guard, report connecting, auth, absorb,
  history = fresh ? [] : mapped results, known ids, then online + openSocket + updateSafetyPoll).
- send(): exactly the reference: nonce path /ext/plugin/inbound/v2/web/callback/{nonce}/{seg(channelId)}/{seg(channelKey)};
  text -> POST JSON {message, from: csid, form: form ?? {}, session?: {ticketHash}} + ?{key}={id};
  file -> PUT http.MultipartRequest field 'file' (filename safeFileName, contentType from mimeType,
  bytes read from the path: 'file://' via Uri.toFilePath(), or the absolute path) with ?from=csid&{key}={id},
  timeout max(requestTimeoutMs, 60000 + ceil(size/1MiB)*10000);
  401/403 -> auth once and replay; any other non-HTTP failure on a TEXT send -> look for the echo via
  callback/v2 (type 'I', same text, id not known, timestamp >= start-60s) and use it, else rethrow.
  Receipt {id: messageId ?? '', createdAt, attachments mapped}. Clear session.fresh, absorb meta.
- poll / fetchResults: GET {base}/ext/plugin/outbound/web/callback/v2?number=csid&csid=csid&channelId=..&sessionId=..
  (nothing when no csid or fresh). startPolling chain every pollIntervalMs while no live socket.
- disconnect, reconnect, clear (logout), restart ({guest}) exactly as the reference.

test/support/: http MockClient helpers (route by URL substring, record method/url/headers/body),
FakeSocket stub that never opens (for Phase 6 it gets real behaviour).

TESTS (test/core/transport_http_test.dart). Fixtures: copy AUTH and SENT from Appendix A. Port:
- auth/v2 like loadChats(): URL exactly https://acme.mehery.io/postman/ext/plugin/outbound/web/auth/v2,
  POST, content-type contains x-www-form-urlencoded, number=csid=browserfp=installId, channelId and
  channelKey present, no userCode for a guest, history ids ['icebrakerMsg']. Same storage next launch:
  same installId, URL contains '?web-session-id_web_acme=S9'.
- signed-in user: userCode 42, userName Sam, userEmail s@a.co, no userPhone.
- send text: URL matches ^https://acme\.mehery\.io/postman/ext/plugin/inbound/v2/web/callback/[^/]+/web:acme\.mehery\.io/KEY123$,
  body {message:'Sales', from:'gINSTALL', form:{reply_id:'sales', reply_title:'Sales'}}, receipt {id 'm-1', createdAt 2000};
  the next send URL contains '?web-session-id_web_acme=S1'.
- upload: method PUT, URL contains '?from=gINSTALL', body is multipart with a 'file' part.
- encoding: channelKey 'a b/c?d' stays in ONE path segment ('a%20b%2Fc%3Fd'); auth body encodes a space
  as %20 never '+'; channelId keeps its ':'.
- hardening: bad domains throw /domain/; context '/a/../b?x' throws /context/;
  domain 'https://acme.mehery.io/' OK; a 302 answer -> connect throws /redirected/.
- offline/online: requests failing -> 'offline' reported ONCE; first success -> 'online'.
- 401 on connect through ChatClient -> errors ['AUTH_FAILED'], exactly 1 HTTP call even after 60 ms
  (fake_async), connection offline. 503 -> ['NETWORK'].
- send refused with 401 once -> 2 auth calls, 2 inbound calls, receipt 'm-1'.
- timeouts (fake_async, requestTimeoutMs 15): a POST that never answers fails at 15 ms; a 5 MB PUT is
  still pending at 60 ms.
- clear() then connect: first auth body has userCode=A, second has no userCode and no 'Ann', and the
  second URL matches web-session-id_acme=[0-9a-f]{24}.
- customer B after A on the same storage: body userCode=B and URL has a fresh 24-hex session id.
- getIdentityToken called per auth: 'userToken=signed-1' then 'userToken=signed-2'.
- storage keys: users A, B and a guest create exactly the 3 keys
  'mehery:acme.mehery.io:web:acme.mehery.io', '...:u:A', '...:u:B' (plus ':meta'), 3 distinct installIds.
- logout via ChatClient: before = 2 keys (session + meta); after = only the ':meta' key; messages [].
- storage without removeItem override: after clear() the record is ''.
- lost reply: POST throws, poll returns {messageId 'srv-1', type 'I', text 'hello', timestamp now}
  -> send resolves id 'srv-1', poll called once. No echo -> rethrows 'timeout'. HTTP 500 -> throws /500/.
- cookie jar: a response with 'set-cookie: JSESSIONID=abc; Path=/; HttpOnly, web-session-id_x=S1; Path=/'
  -> the next request carries 'Cookie' containing both JSESSIONID=abc and web-session-id_x=S1.
- mapMeheryMessage cases from reference meheryTransport.test.ts (customer/bot/socket, buttons, inputs,
  attachments incl. http->https upgrade, missing mediaURL dropped, BG_VOICE, no id -> null).

Gate: format, analyze, test.
```

---

### Phase 6: STOMP live socket, polling fallback, safety poll

```
Phase 6. Add the live socket half of the transport.
Reference: @reference/src/core/meheryTransport.ts (stompFrame, parseStomp, openSocket, updateSafetyPoll)

- lib/src/core/stomp.dart: stompFrame(command, headers, [body='']) with header escaping (\\ \r \n :)
  and NUL terminator; parseStomp(buffer) -> ({List<StompMessage> frames, String rest}), skipping
  heart-beat newlines and unescaping headers.
- MeherySocket (abstract): onOpen, onMessage(String), onClose callbacks + send(String) + close().
  Default implementation wraps web_socket_channel IOWebSocketChannel.connect(uri, headers: {Cookie})
  (ready -> onOpen; String data -> onMessage; done/error -> onClose fired ONCE).
  typedef SocketFactory = MeherySocket Function(Uri url, Map<String, String> headers).
- openSocket(): exactly the reference: no factory or no xsessionId -> polling; close the previous socket
  but keep polling; URL wss://{domain}{context}/stomp-tunnel/websocket; on open CONNECT
  {accept-version:'1.2,1.1,1.0', heart-beat:'0,0', user:'guest', token: randomId(), xSessionId};
  on CONNECTED subscribe the meta path /app/stomp/tunnel/meta/{x}/{j}; on its answer read
  x-tenant-token, x-session-uid, tags (isSafeToken only) and subscribe, in order:
  /topic/_/message/receive/new, /topic/{tenant}/message/receive/new, /queue/{sessionUid}/message/receive/new,
  /tag/{tenant}/{tag}/message/receive/new per tag, /topic/_/stomp/tunnel/health; then socketUp,
  reset backoff, stop polling, report online, catch-up poll. MESSAGE routes by the subscription header;
  body JSON {data: OutboxMessage} or the message itself; ERROR closes. A replaced socket must deliver
  nothing and send nothing. Liveness: 150 s without traffic closes the socket.
  On close: start polling, reconnect after min(30s, 2s*2^attempt); from the 2nd attempt re-auth first.
- Safety poll: while setActive(true) and socket up, poll every 10 s unless a live message arrived in the
  last 2 s; setActive(true) also polls immediately; none while inactive.

test/support/fake_socket.dart: port FakeSocket from the reference tests (records sent frames, serverSends(frame),
close() fires onClose synchronously, lastFrame(), subscriptions()).

TESTS (test/core/stomp_test.dart, test/core/transport_socket_test.dart):
- STOMP round trip: frame('SEND', {destination:'/a:b', 'x-n':'l1\nl2'}, '{"x":1}') parsed back equal;
  frame + '\n' + partial -> 1 frame + rest kept; completing rest -> 1 more frame, rest ''.
- live flow exactly like tunnel.client.js: socket URL wss://acme.mehery.io/postman/stomp-tunnel/websocket;
  CONNECT has xSessionId X1 and heart-beat 0,0; after CONNECTED the meta destination is
  /app/stomp/tunnel/meta/X1/J1; after the meta answer {x-session-uid SU, x-tenant-token TT2, tags [tagB]}
  subscriptions include /topic/_/message/receive/new, /topic/TT2/..., /queue/SU/..., /tag/TT2/tagB/...,
  /topic/_/stomp/tunnel/health; last connection report 'online'; a MESSAGE on the tag subscription with
  {data:{messageId r1, message 'Reply from bot'}} reaches onMessage as a bot message.
- socket drop -> polling callback/v2 with csid=gINSTALL and channelId=web%3Aacme.mehery.io; polled message delivered.
- safety poll (fake_async): 30 s inactive -> no extra polls; setActive(true) -> +1 immediately; +20 s -> +2 more;
  setActive(false) + 30 s -> no more.
- connect twice concurrently, then again -> exactly ONE open socket; disconnect closes all.
- a replaced socket receiving CONNECTED sends no SUBSCRIBE.
- unsafe tags ('a/b', '../x') are never subscribed; header values with CR/LF are escaped.
- reconnect backoff (fake_async): the socket closes 3 times; reopen delays are 2 s, 4 s, 8 s; an auth call
  happens before the 2nd and later attempts.
- liveness: no frames for 150 s -> socket closed and polling resumes.
- new chat through ChatClient (port the reference test): after newChat the last auth URL does not contain
  S1 but has 'web-session-id_web_acme=', messages are [], the next send URL lacks S1 and its body has
  session.ticketHash.

Gate: format, analyze, test.
```

---

### Phase 7: Web parity contract + mock bot

```
Phase 7. Lock down the exact wire behaviour end to end, and port the demo bot.
Reference: the "Web parity contract" block in @reference/src/core/meheryTransport.test.ts and
@reference/src/core/mockTransport.ts

1. test/parity/web_contract_test.dart: helper webBody(wire, act) that loads `wire` as auth history,
   runs `act(client)`, and returns the decoded JSON of the inbound POST. Full stack:
   mapMeheryMessage -> normalizeMessage -> ChatClient -> transport -> MockClient. Use the LIVE_* fixtures
   from Appendix A. Assert these EXACT bodies:
   - card Submit -> {message:'Submitted', from:'gINSTALL', form:{name:'Sam', email:'sam@acme.com', phone:'+1 202-555-0100'}}
   - card Submit with withDialCode('09876543210','+91') -> phone '+91 9876543210'
   - composer 'hi' while the card is latest -> {message:'hi', from:'gINSTALL', form:{name:'hi'}}
   - one-field card Submit -> form {email}
   - one-field prompt answered in the composer -> {message:'sam@acme.com', ..., form:{email:'sam@acme.com'}}
   - quick reply -> {message:'Sales', ..., form:{reply_id:'sales', reply_title:'Sales', replyIdExt:'menu-1'}}
   - icebreaker quick link sendText('track') -> form {}
   - 'Chat with human' sendText('#') -> {message:'#', ..., form:{}}
   - message after the customer answered -> form {}

2. lib/src/core/mock_transport.dart: createMockTransport({latencyMs = 350}) with setOnline(bool).
   Port every scripted reply word for word (welcome with Track my order / Talk to a person / Help center URL,
   email prompt, order reply with image, agent handoff in 2 messages, gallery of 5 photos, video, voice,
   'contact me' 3-field card, invoice file, Arabic reply, 'fail' -> send throws, default long reply with
   markup and a link). Use the same media URLs. Timers must be cancelled by restart() (generation).

TESTS (also test/core/mock_transport_test.dart, fake_async):
- connect -> online; the welcome message with 3 buttons arrives after 500 ms, only once per session.
- 'track' quick reply -> an email prompt with inputs [{name email, type EMAIL}].
- form {email} -> reply with 1 image attachment.
- 'fail' -> send throws; setOnline(false) -> connect throws and onConnection('offline').
- restart() cancels pending replies and the welcome comes back on the next connect.
- 'contact me' -> inputs name/email/phone; 'gallery' -> 5 image attachments with width/height.

Gate: format, analyze, test.
```

---

### Phase 8: Provider, theme, public API (no chat UI yet)

```
Phase 8. Build the Flutter-facing API shell. Chat screen widgets come in Phase 9; use a placeholder body.
Reference: @reference/src/react/Provider.tsx @reference/src/react/context.ts @reference/src/ui/Guard.tsx @reference/src/index.ts

Public API (exported from lib/mehery_chat.dart):

MeheryChatProvider (StatefulWidget). Recommended host placement, documented in its doc comment:
  MaterialApp(builder: (context, child) => MeheryChatProvider(..., child: child!))
  so the launcher and modal sit above every route (like RN's Modal).
Params (same names/meaning as RN props): transport, config (Map<String,dynamic>?), colorScheme
(Brightness? null = follow the platform), locale (String? null = device locale via
PlatformDispatcher.instance.locale.toLanguageTag()), debug, components (MeheryComponents),
pickAttachment, voiceRecorder, assets (Map<String, BrandAsset>), renderSvg, renderVideo, renderAudio,
onLinkPress (bool Function(String url)), allowedLinkSchemes, onOpenChange, onMessageReceived,
onUnreadCountChange, onError, onConnectionChange, child.

Behaviour to port:
- One ChatClient per transport. A new transport object -> stop the old client and create a new one
  (didUpdateWidget). Disposing the provider stops the client.
- Callbacks are read from the LATEST widget at call time (never captured), so inline closures are fine.
- Config resolved with resolveConfig(config, scheme, locale) and re-resolved when config/scheme/locale
  change (without resetting the conversation). If resolving throws, use defaults + a warning.
  Warnings -> debugPrint in debug AND one onError(CONFIG_INVALID, warnings joined by '\n') per distinct
  warning text.
- client.thinkingTimeoutMs and setFilePolicy follow the config.
- onError gets a REDACTED error unless debug: cause reduced to {type: runtimeType, message, status?}.
- openLink(raw): safeLink(raw, allowedLinkSchemes) else report LINK_BLOCKED 'Blocked a link: {redactUrl}';
  call onLinkPress (a throw -> report UNKNOWN and open anyway); if not handled, url_launcher
  launchUrl(mode externalApplication); a failure -> UNKNOWN 'Could not open {redacted}'.
- App lifecycle (AppLifecycleListener): on resume, if connection is offline -> client.reconnect().
- rtl = locale language in (ar, he, iw, fa, ur, ps, sd, ug, yi, dv, ckb).
- Reduce motion: MediaQuery.disableAnimations -> motion mode 'fade'; preset none -> 'none'; else 'spring'.
- Font scaling: clamp text scaling to config.font.maxScale inside the SDK's own widgets only
  (MediaQuery.withClampedTextScaling around the chat, never around the host).
- The chat layer needs its own Overlay and Material ancestor because it sits ABOVE the Navigator
  (otherwise TextField throws "No Overlay widget found"). Wrap the SDK layer in
  Overlay(initialEntries: [OverlayEntry(builder: ...)]) + Material(type: transparency).
- Access from anywhere below: MeheryChatProvider.of(context) -> MeheryChatController with the ChatState
  fields + isOpen, open(), close(), send(text), sendQuickReply(button), sendFile(file), retry(id),
  newChat(), logout(). MeheryChatProvider.themeOf(context) -> ResolvedConfig (RN useMeheryTheme).
  Use InheritedNotifier so dependents rebuild on state changes.
- Modal presentation: isOpen starts as presentation=='modal' && autoOpen. For this phase, when open,
  show a full-screen layer with the placeholder chat; launcher/zoom animation comes in Phase 12.
  Embedded: the host mounts MeheryChat(edges: ..., onClose: ...) (placeholder body for now).
- Error containment (RN Guard): Guarded(where:, fallback:, builder:) calls the builder inside try/catch
  at build time; on a throw: report RENDER '{where} failed to render and was replaced' and show the
  fallback (a fallback builder gets retry()). Slot(name, custom, builtIn, props): try the custom builder,
  fall back to the built-in, which itself falls back to SizedBox.shrink(). Doc-comment the Flutter limit:
  only throws from the builder itself are caught, not from descendant widgets' build().
- Adapter types: BrandAsset (sealed: BrandAsset.image(ImageProvider) | BrandAsset.builder(Widget Function(double w, double h))),
  SvgRenderer Widget Function(String uri, double width, double height),
  MediaPlayerProps {uri, paused, onProgress(int posMs, int durMs), onEnd(), onError(Object), seekTo (SeekRequest? positionMs), volume?},
  VideoRenderer Widget Function(MediaPlayerProps p, double width, double height),
  AudioRenderer Widget Function(MediaPlayerProps p),
  VoiceRecorder {Future<void> start(); Future<PickedFile?> stop(); Future<void> cancel();},
  pickAttachment Future<PickedFile?> Function(AttachmentType type).
  MeheryComponents {header, emptyState, launcher, quickReply, thinkingIndicator} builders with the same
  props as RN (HeaderProps {title, logo?, brand?, connection, onClose?}, LauncherProps {unread, onPress},
  QuickReplyProps {button, onPress}, EmptyStateProps {title, body}).

TESTS (test/ui/provider_test.dart, widget tests with FakeTransport):
- a new transport object stops the old client (old transport.disconnect called) and connects the new one;
  the same transport across rebuilds does NOT reconnect.
- changing config keeps messages (no reconnect) and the theme updates.
- an invalid config calls onError once with CONFIG_INVALID; rebuilding with the same config doesn't repeat it.
- onError without debug: cause is reduced (no original object); with debug: raw cause.
- openLink('javascript:x') -> LINK_BLOCKED, launcher not called; onLinkPress returning true -> not
  launched; allowedLinkSchemes ['myapp'] lets 'myapp://x' through (stub url_launcher with a fake
  UrlLauncherPlatform).
- autoOpen in modal opens on mount; embedded never opens a layer.
- lifecycle resume while offline calls transport.reconnect / client.start.
- a custom header builder that throws -> built-in header shown + RENDER reported.
- MeheryChatProvider.of(context).send('hi') reaches the transport.
- a TextField inside the chat layer under MaterialApp.builder builds without an Overlay error.

Gate: format, analyze, test.
```

---

### Phase 9: Chat screen: header, banner, list, bubbles, rich text

```
Phase 9. Build the chat screen except the composer, form card and media (placeholders for those).
Reference: @reference/src/ui/MeheryChat.tsx @reference/src/ui/Header.tsx @reference/src/ui/MessageList.tsx
@reference/src/ui/MessageBubble.tsx @reference/src/ui/primitives.tsx @reference/src/ui/RefImage.tsx
Look at the images in @reference/screenshots for the intended look.

Port faithfully (sizes are logical pixels; `s` = config.spacing):
- MeheryChat: on mount client.setVisible(true) + client.start(); on dispose setVisible(false).
  Layout: header strip (padded for the top safe area when edges contains top) with header background,
  then a body with background colour: ConnectionBanner, MessageList, Composer placeholder. Keyboard:
  pad the body by MediaQuery.viewInsets.bottom; when the keyboard is up, drop the bottom safe inset.
  New bot replies (fresh, with text) are announced: SemanticsService.announce('{title}: {text}').
  If the screen build throws -> fallback with strings.chatUnavailable, "Try again" (accent pill) and Close.
- Txt/fontStyle: sizes from config, lineHeight = round(size*1.38)/size, weights regular 400,
  medium 500, bold 600 (a configured family per weight replaces fontWeight).
- Header (height 56, bottom border): optional round logo (30), brand image left/center/right rules,
  title (bold, 1 line) with the subtitle line 'Bot is talking' or 'Bot is talking · {userName}',
  close button 36x36 (Key 'mehery-close') when features.closeButton && onClose. Brand image load failure
  -> show the title instead. Centred brand is inset 56 on both sides when there is a close button.
- RefImage: https -> Image.network, file:// -> Image.file, data:image (non-SVG) -> Image.memory,
  asset:name -> assets map, SVG (isSvgRef) -> renderSvg or BrandAsset.builder; otherwise report UNKNOWN
  "Image ... couldn't be shown: ..." and render nothing + call onFail. Width follows the image's aspect
  ratio at the given height unless width is set; capped at 280; round = circle.
- ConnectionBanner: 0 height online; 'Connecting…' only after 1200 ms of connecting; offline immediately
  as '{offline} · {reconnect}' tappable (Key 'mehery-reconnect') -> client.reconnect(). Animate height 0<->28 over 200 ms.
- MessageList: ListView.builder(reverse: true) over messages reversed, key = localId ?? id.
  Grouping: same author and within 3 minutes. Header area (visually at the bottom): background-audio
  toggle placeholder, quick replies of the LATEST message only when it is a bot message, thinking indicator.
  Icebreaker landing when isIcebreaker(messages): title text, 'Quick Links' caption, a button per
  ChatButton -> client.sendText(button.id), and an accent 'Chat with human' button -> sendText('#').
  Empty state when no messages && connection != connecting && !thinking (Slot 'EmptyState').
  A message whose build throws shows strings.messageUnavailable instead.
- QuickReply chip: min height 36, chip radius, border, label; URL type shows a 45°-rotated arrow and
  calls openLink(url); others -> client.sendQuickReply(button, messageId). Staggered entrance
  delay 180 + 45*i ms (spring mode only).
- ThinkingIndicator: bot-bubble-coloured pill with 3 dots (7px) pulsing in a 140 ms stagger;
  semantics label strings.typing, liveRegion.
- MessageBubble: hide the user's 'Submitted' when hideSubmitted (formSubmit flag, or the previous
  message is a form card) and it has no attachments and isn't failed; system author -> centred caption;
  max width 80% (100% for a form card); top margin s*5 for the first of a group else s*1.5; avatar
  (28, logo on the last of a group) when features.avatars and bot; bubble colours from user/bot bubble
  config; padding s*3.5 x s*2.25; failed -> error border + 'Not sent. Tap to retry.' under it, tap -> retry;
  sending (no media) opacity 0.6; timestamp under the last of a group when features.timestamps:
  formatStamp + ' ✓' when isDelivered. Entrance (fade + rise 12 + scale 0.96) only for fresh messages,
  once per key (a static Set like the reference `played`).
- RichText: TextSpans from parseRichText (bold/italic/underline/strike/code monospace 13; links underlined
  with TapGestureRecognizer, dispose them!). Streaming reveal for fresh bot text (not form cards) when
  motion.revealText && mode spring && length <= 600: 120 ms delay, duration clamp(len*14, 450, 1800) ms,
  ease 1-(1-t)^1.4, cut only at revealStops, 3 fading steps after the cursor (alpha 0.55, 0.28, 0.1, 2 stops
  each), the rest transparent (full text laid out from frame 1, so no resize). Tap finishes it.
  Text direction from isRTL(text).
- Keys: 'mehery-close', 'mehery-reconnect'. Semantics: header title is a header; links are separate
  semantics actions; failed bubble is a button.

TESTS (test/ui/chat_screen_test.dart; FakeTransport; preset none unless noted):
- empty state shows emptyTitle/emptyBody when online with no messages; not while connecting.
- the icebreaker landing renders quick links; tapping one sends sendText(id) (OutgoingMessage form {});
  'Chat with human' sends '#'.
- quick replies render only for the latest bot message; tapping sends reply_id/reply_title/replyIdExt;
  a URL chip calls openLink and sends nothing.
- user bubble right-aligned with the userBubble colours, bot left with botBubble colours.
- failed send shows 'Not sent. Tap to retry.'; tapping retries.
- timestamps appear only when features.timestamps; '✓' only for delivered user messages.
- a typed 'Submitted' is visible; a card submission 'Submitted' is hidden.
- the thinking indicator shows after a send receipt and hides when the bot replies.
- banner: connecting text appears only after 1200 ms; offline text is immediate and tapping calls reconnect.
- header: title/subtitle with userName; close button hidden when closeButton false; a missing
  'asset:x' brand falls back to the title and reports UNKNOWN.
- rich text: '*bold*' renders a bold span; a link span has a recognizer that calls openLink.
- streaming (preset subtle): at t=0 the visible prefix is empty, at the end the full text, and a tap
  completes it immediately; history messages never stream.
- an Arabic message renders RTL.
- golden-free visual check: take screenshots of the chat with presets Minimal/Ocean/Midnight in an
  integration test or a manual run and compare to @reference/screenshots (note differences in PROGRESS.md).

Gate: format, analyze, test.
```

---

### Phase 10: Composer + contact form card

```
Phase 10. Composer and FormCard.
Reference: @reference/src/ui/Composer.tsx @reference/src/ui/FormCard.tsx

Composer (port every rule):
- Row: attach button 44x44 round surface (Key 'mehery-attach'), shown when pickAttachment != null and
  features.attachments non-empty; input pill (min 44, composer radius, surface, max text height 120,
  multiline, keyboard 'send' action submits); send button 34x34 accent with up arrow (Key 'mehery-send'),
  opacity 0.3 when it can't send, enabled when there is text OR a pendingInput.
- Placeholder = pendingInput.label ?? strings.placeholder. Keyboard: email field -> emailAddress,
  phone field -> text keyboard with telephone autofill hint (NOT a phone pad: a stale phone prompt must
  still allow typing "menu"), else text with sentence capitalisation.
- Text direction follows isRTL(current text).
- Submit: empty + pendingInput -> error strings.required; email field invalid -> invalidEmail;
  phone field invalid -> phoneTooLong ('{n}' = phoneMaxDigits) when over the limit else invalidPhone;
  else client.send(text), clear the field, clear the error.
- Phone field live limit: digits past phoneLimit are removed as you type (keep formatting chars) and the
  phoneTooLong error shows; it stays while the field sits at the cap, clears on other edits.
- Do NOT rebuild the TextField on every keystroke (use a TextEditingController owned by the composer state).
- Attach: one allowed type -> picker directly; two -> bottom sheet titled strings.attach with Photo /
  Document / Cancel. Picker throw -> report PICKER; null or empty uri -> nothing; size over maxAttachmentMB
  -> error tooLarge ('{mb}'); else client.sendFile(file).
- Voice: mic button (Key 'mehery-mic') replaces send when voiceRecorder != null && no text && no pendingInput.
  Tap -> recorder.start() (throw -> PICKER 'Voice recording could not start'); recording bar: Cancel
  (Key 'mehery-record-cancel'), red dot, elapsed time (updates every 250 ms, formatDuration), send
  (Key 'mehery-record-send'). Send -> stop() -> sendFile(file); cancel -> cancel(). The text field stays
  mounted (hidden) during recording. Disposing mid-recording calls cancel().
- focusTick: when it increments (new chat) the input gets focus.
- Attribution line strings.poweredBy (11 pt, centred, muted, 0.85 opacity) when features.attribution.
- Keys: 'mehery-input' on the TextField.

FormCard (inside the bot bubble of a form message):
- Fields = formFields(inputs). Each: 48 min height, composer radius, border (error colour on error),
  icon by kind (name/email/phone/text), dial code prefix for phone when configured, hint = label ??
  Name/Email/Phone Number strings by name or type ?? name. Keys 'mehery-form-{name}'.
- Keyboard per kind (email, phone pad, name with word caps, text). Phone fields live-limited like the composer.
- Submit (Key 'mehery-form-submit', accent, 48 high): validate every field (email -> invalidEmail;
  phone over limit -> phoneTooLong; phone invalid -> invalidPhone; empty -> required), per-field errors
  that clear when that field is edited; if none -> client.sendForm(values), phone values via withDialCode.
- Locked (read-only, no submit button) when the card is not the latest message or it was already
  submitted; locked cards show the submitted values from state.forms.

TESTS (test/ui/composer_test.dart, test/ui/form_card_test.dart):
- send button disabled with only spaces; 'hello there' sends and clears the field.
- pending email prompt: 'abc' shows invalidEmail and sends nothing; 'qa@example.com' sends form {email}.
- pending email prompt + empty submit -> 'This field is required.'.
- pending phone prompt: typing '555123456789' leaves '5551234567' in the field and shows
  'Please enter a number with at most 10 digits.'; '+965 5555 1234' is accepted.
- placeholder becomes the prompt label.
- attach with features.attachments ['image'] calls pickAttachment('image') directly; with both, the sheet
  shows Photo/Document; a picker throw reports PICKER; a 20 MB file shows 'Files must be smaller than 10 MB.'
- mic shown only with a recorder, no text, no prompt; start -> recording bar with 0:00; send -> sendFile
  with the recorder's file; cancel -> recorder.cancel(); start throwing -> PICKER.
- attribution hidden when features.attribution false.
- form card 3 fields: empty submit -> required x1 (name), invalidEmail, invalidPhone; fixing a field clears
  only its error; valid submit sends 'Submitted' with {name, email, phone}.
- phoneDialCode '+91': prefix shown; '09876543210' submits phone '+91 9876543210'.
- after submit the card is locked showing the values; an older card is locked; unknown input types
  ('CHECKBOX') render no card.

Gate: format, analyze, test.
```

---

### Phase 11: Media

```
Phase 11. Photos, video, audio, files, background audio, full-screen viewers.
Reference: @reference/src/ui/media/* @reference/src/ui/ImageViewer.tsx

- MessageMedia above the text bubble: ImageGrid for images, VideoTile per video, AudioBubble per audio;
  files render inside the bubble (FileRow). background attachments never render in a bubble.
  A media widget whose build throws -> 'This message couldn't be shown.' tile (240 wide).
- ImageGrid (width 240, gap 2, bubble radius, clipped): 1 photo at its ratio (width/height known, else
  measured, default 4/3) with height clamp 140..300 (Key 'mehery-image'); 2 -> side by side 168 high;
  3 -> big left (60%) + 2 stacked, 200 high; 4+ -> 2x2, the 4th says '+N' over a 42% black scrim.
  Grid cells Key 'mehery-grid-{i}'. Thumbs via a.thumbnailUrl ?? thumbnailUrl(...) honoring
  features.thumbnailProxy. Sending -> small spinner badge bottom-end.
- MediaImage: shimmer -> low-res thumb -> full image cross-fade (260 ms); 15 s with nothing shown or an
  error -> tile with photo icon + strings.imageFailed, report MEDIA; tap retries (remount, same URL);
  a tap while loading still opens the viewer; when the uri changes (local file -> uploaded URL) keep the
  old image underneath until the new one loads.
- ImageViewer (overlay inside the chat, NOT a new route): black backdrop, PageView over the message's
  photos starting at the tapped one (always LTR), InteractiveViewer maxScale 4, '2 / 5' counter (Key
  'mehery-viewer-counter'), close button (Key 'mehery-viewer-close'), page Key 'mehery-viewer-pager',
  image Key 'mehery-viewer'. Swipe up/down to dismiss when not zoomed: follows the finger, past 120 px or
  900 px/s flies off (200 ms) else springs back; backdrop and scale (1 -> 0.82) follow. Screen-sized image
  via thumbnailUrl(min(1440, width*dpr)) with the 240 thumb underneath; precache neighbours. Android back
  closes the viewer first.
- VideoTile (240 wide, height clamp 135..320 from ratio, default 16:9, Key 'mehery-video'): poster or
  (no poster + renderVideo) a paused muted preview via renderVideo; play badge; duration pill. Without
  renderVideo or after a failure, tap -> openLink(url). With it -> VideoViewer: fullscreen black,
  autoplay, controls (play/pause Key 'mehery-video-toggle', scrubber Key 'mehery-video-scrubber' with
  elapsed/remaining, close Key 'mehery-video-close'), auto-hide after 2.5 s while playing, tap toggles,
  swipe to dismiss, fade+zoom open (fade only in reduce motion); player unmounted on close; onError ->
  report MEDIA and the tile shows strings.mediaFailed.
- Playback singleton (port playback.ts): one clip plays app-wide; starting one stops the other; app going
  to background stops it; scrolling its message out of view stops it.
- AudioBubble (Key 'mehery-audio'): 38px play/pause circle, 30-bar waveform (3 px bars, gap 2, height 26,
  from waveform(url)), progress fill animating, 'pos / total' clock; renders renderAudio offscreen only
  while started; restart from 0 if paused at the end; without renderAudio or after error -> openLink.
- FileRow (Key 'mehery-file'): badge tile (fileBadge, 38x42, alpha 0.12), name middle-ellipsis, size or
  strings.document; tap -> openLink(url).
- Background audio: backgroundTrack(messages, features.backgroundAudio) plays via renderAudio offscreen at
  volume 0.2, not registered with the playback singleton; toggle chip (Key 'mehery-bg-audio') Play/Pause
  next to the quick replies; on end -> paused; on failure -> hidden + MEDIA.

TESTS (test/ui/media_test.dart, with fake adapters that record MediaPlayerProps):
- 1/2/3/5 photo layouts have the expected cell counts and sizes; 5 photos show '+1'.
- an image error shows imageFailed and reports MEDIA; tapping retries.
- tapping photo 2 of 3 opens the viewer at page 2 with counter '2 / 3'; close button closes it;
  a drag of 200 px down closes it; a drag of 50 px springs back.
- video without renderVideo -> tap calls openLink; with it -> viewer opens and the adapter gets paused false;
  onError -> MEDIA + mediaFailed text.
- starting audio B stops audio A (A's adapter gets paused true / unmounted).
- audio without renderAudio -> openLink.
- file row shows 'PDF', name and '13 KB'-style size; tap -> openLink.
- BG_VOICE: no bubble; the toggle shows only when backgroundAudio is on and renderAudio exists;
  adapter volume 0.2; toggle pauses.

Gate: format, analyze, test.
```

---

### Phase 12: Modal, launcher, motion, gestures, a11y

```
Phase 12. Presentation polish: launcher, open/close zoom, header swipe-to-close, pull-up "New chat",
back button, status bar, accessibility, RTL.
Reference: @reference/src/react/Provider.tsx (ChatWindow, launcher frame) @reference/src/ui/Launcher.tsx
@reference/src/ui/NewChatPull.tsx @reference/src/ui/newChatPullMath.ts @reference/src/ui/primitives.tsx

- Launcher (modal + behaviour.launcher): positioned bottom-right/left at margin inside the safe area;
  LauncherFace = container size/radius/background/border/shadow + glyph (custom image via RefImage, or the
  built-in icon: chat (dots show the background as holes), chat-outline, bubbles, sparkle, help, headset,
  mail, star, none). Draw the icons with CustomPainter, proportions from primitives.tsx.
  Tap target at least 44 (expand hit area). Entrance: delay 250 ms, rise 16, scale 0.6. Press scale 0.9.
  Unread badge (error colour, 20 high, white border, '9+' over 9). Semantics label 'Open chat' or
  'Open chat, {n} unread'. Key 'mehery-launcher'. Stays mounted but invisible while the chat is up.
- ChatWindow open/close: one critically damped spring (mass 1, stiffness 180, damping 27) driving
  p 0->1. Frame lerps from the launcher rect to full screen; corner radius launcher radius -> 44 at
  p=0.92 -> 0 at 1; window background fades in over p 0..0.3; content scaled from launcherSize/W to 1
  (top-left origin) and fades in over p 0.22..0.6; the launcher face fades out over p 0..0.32; black scrim
  0 -> 0.22; shadow while zooming if launcher.shadow. Start only after the first frame is laid out.
  Reduce motion -> 220 ms easeOutCubic cross-fade; preset none -> instant. onOpenChange(true/false) when
  settled. Content gets the real full-size layout once at rest.
- Header swipe down (the header strip incl. status-bar area): the window follows the finger (translateY),
  scales 1 -> 0.82 over the screen height, rounds corners 0 -> 36 over the first 80 px, scrim fades;
  release past 110 px or > 800 px/s closes, otherwise springs back. Starting the drag dismisses the keyboard.
  The close button still gets its taps.
- Pull up for New chat (port usePullNewChat + newChatPullMath exactly): only when there are messages and
  the list is at the newest end (offset <= 16); 16 px dead zone; flick (> 0.7 px/ms at activation) is left
  to the list; resisted(d) = d <= 24 ? d : 24 + 120*(1 - 1/((d-24)/120 + 1)); a ring of 12 dots above the
  composer lights up between 8 and 76; at >= 76 it becomes an accent circle with a tick and 'New chat' in
  bold accent; releasing then -> client.newChat() + focus the composer; otherwise spring back. Use a
  Listener on raw pointer events (works on Android where there is no overscroll bounce).
- Android back: while the chat is open, back closes the image/video viewer first, else the chat
  (WidgetsBindingObserver.didPopRoute returning true). When closed, back goes to the host.
- Status bar: AnnotatedRegion<SystemUiOverlayStyle> while open; dark icons when the header background is
  light (compare contrast with black vs white).
- RTL: the chat uses Directionality(rtl) when the locale is RTL; the photo pager stays LTR.
- Accessibility: every Key from the RN testIDs also as Semantics(identifier:); labels from strings;
  minimum 44x44 tap targets; the typing indicator is a live region.

TESTS (test/ui/presentation_test.dart, test/core/pull_math_test.dart):
- pull math (port newChatPullMath tests): resisted follows 1:1 up to 24; lags after; reaches ~76 around
  120 px of travel; marginal gain decreases; never negative. isFlick(any, 0.5) false, (any, 0.9) true.
- launcher shows when behaviour.launcher && modal; tapping opens; badge '3' with 3 unread while closed,
  '9+' with 12; semantics label includes the unread count.
- open/close (preset none): after open the chat is visible and onOpenChange(true) fires once; close ->
  onOpenChange(false); the launcher is hidden while open.
- (preset subtle) mid-animation at ~100 ms the window rect is between the launcher rect and full screen.
- header drag 150 px down closes; 60 px springs back; a tap on the close button still closes.
- pull-up: a slow 140 px upward drag on the newest messages calls transport.restart and clears messages;
  a 50 px pull does nothing; a fast flick does nothing; pulling while scrolled into history does nothing.
- back while the viewer is open closes only the viewer; back again closes the chat.
- Arabic locale -> Directionality rtl inside the chat.

Gate: format, analyze, test.
```

---

### Phase 13: Example app, README, e2e, live check

```
Phase 13. Ship it.
Reference: @reference/example/App.tsx @reference/example/presets.ts @reference/README.md @reference/example/e2e

1. example/ app (may use any packages): a host "Acme Store" screen with the provider in
   MaterialApp.builder; Mock / Live switch (Live reads lib/live_local.dart, gitignored, with domain,
   channelId, channelKey; a live_local.example.dart is committed); preset picker with the same 4 presets
   (Minimal, Ocean, Midnight, Arabic ar-KW) ported from presets.ts, with the same values; toggles for
   attribution, timestamps, avatars, launcher icon; "Copy JSON" of the config; "Simulate offline" for mock;
   "Reset guest (testing)" -> client.newChat(guest: true) via the controller; Logout button.
   Adapters: image_picker + file_picker (pickAttachment), video_player (renderVideo and renderAudio),
   record (voiceRecorder), flutter_svg (renderSvg), shared_preferences (KeyValueStorage) and show
   flutter_secure_storage in the README as the recommended store. Register a local wordmark asset as
   'asset:acmeWordmark'.
2. README.md for the Flutter package: install, quick start (same JSON as the RN README), the whole
   config table (copy from the RN README, same defaults), adapters, signed-in users + logout, errors table
   with wireNames, security notes, MaterialApp.builder placement, differences from RN (error boundary
   limit, local file paths instead of content:// URIs, in-memory cookie jar).
3. Maestro: port example/e2e/*.yaml to the Flutter example (appId changes; ids are the same Keys/
   semantics identifiers). At least conversation.yaml, contact-card.yaml, header-swipe-close.yaml, media.yaml.
4. Final widget test test/ui/end_to_end_mock_test.dart: with the mock transport (latency 0, preset none):
   open launcher -> welcome -> tap 'Track my order' -> email prompt -> type 'sam@acme.com' -> send ->
   order reply with an image -> type 'contact me' -> card -> fill + submit -> 'Submitted' hidden and the
   card locked.
5. LIVE PARITY CHECK (manual, write the results in PROGRESS.md): run the RN example and the Flutter example
   against the SAME live channel, and use the codes from @reference/qa/chat-ui-test-cases.csv
   (menu, text, rich, links, long, rtl, emoji, burst, delay, btn, btnmany, url, form1, form3, img, video,
   audio, doc). Confirm: same history after an app kill, no duplicate on retry after airplane mode,
   new chat doesn't bring old history back, logout + new user gets a new session, and the backend echo
   bodies (reply_id, replyIdExt, form fields, phone with dial code) are identical between RN and Flutter.

Gate: format, analyze, test, plus `flutter build apk --debug` and `flutter build ios --no-codesign` for the example.
```

---

## Appendix A: Wire fixtures (copy into `test/support/fixtures.dart`)

These are copied from the RN tests. Some of them were captured live from the Mehery backend.

```dart
// ignore_for_file: constant_identifier_names, non_constant_identifier_names
const base = (domain: 'acme.mehery.io', channelId: 'web:acme.mehery.io', channelKey: 'KEY123');

// auth/v2 response
const AUTH = {
  'results': [
    {'messageId': 'icebrakerMsg', 'text': 'Hi, how can we help?', 'type': 'O', 'timestamp': 1000,
     'options': {'buttons': [{'code': 'track', 'name': 'track', 'label': 'Track order', 'type': 'QUICK_REPLY'}]}},
  ],
  'meta': {
    'webSessionIdKey': 'web-session-id_web_acme',
    'webSessionId': null,
    'csid': 'gINSTALL',
    'stomp': {'xsessionId': 'X1', 'jsessionId': 'J1', 'tenantToken': 'TT', 'tags': ['tagA']},
  },
};

// inbound/v2 (send) response
const SENT = {
  'results': [{'messageId': 'm-1', 'timestamp': 2000, 'type': 'I', 'message': 'hello'}],
  'meta': {'webSessionIdKey': 'web-session-id_web_acme', 'webSessionId': 'S1'},
};

// Live payloads (customer.mehery.com, web:wwwmeherycom)
Map<String, dynamic> liveInput(String code, String type) => {
  'code': code, 'variable': null, 'label': null, 'type': type, 'desc': null, 'url': null,
  'shorturl': null, 'phone': null, 'action': null, 'uid': null, 'params': null, 'name': code,
};
const LIVE_HI = {'messageId': '6afb02704cf1e506faa5e6f2', 'type': 'I', 'text': 'Hi',
  'timestamp': 1794835054453, 'options': {'': ''}, 'attachments': null};
final LIVE_CARD = {'messageId': '6afb02704cf1e506faa5e6f3', 'type': 'O', 'text': 'Please enter your',
  'timestamp': 1794835054900,
  'options': {'inputs': [liveInput('name', 'TEXT'), liveInput('email', 'EMAIL'), liveInput('phone', 'PHONE')]},
  'attachments': null};
final EMAIL_PROMPT = {'messageId': 'ask-email', 'type': 'O', 'text': 'Your email?', 'timestamp': 1794835054900,
  'options': {'inputs': [liveInput('email', 'EMAIL')]}};
const MENU = {'messageId': 'menu-1', 'type': 'O', 'text': 'Pick one', 'timestamp': 1,
  'options': {'buttons': [{'code': 'sales', 'name': 'sales', 'label': 'Sales', 'type': 'QUICK_REPLY'}]}};
```

## Appendix B: Endpoints at a glance

| # | What | Request |
|---|---|---|
| 1 | Sign in + history | `POST https://{domain}/postman/ext/plugin/outbound/web/auth/v2[?{webSessionIdKey}={webSessionId}]`, form-encoded `number, csid, browserfp, channelId, channelKey, visitorId, userCode?, userToken?, userName?, userEmail?, userPhone?` → `{results: ChatMessageDTO[], meta: {webSessionIdKey, webSessionId, csid, stomp:{xsessionId, jsessionId, tenantToken, tags}}}` |
| 2 | Live | `wss://{domain}/postman/stomp-tunnel/websocket`, STOMP 1.2 text frames, heart-beat 0,0 |
| 3 | Send text | `POST .../ext/plugin/inbound/v2/web/callback/{nonce}/{channelId}/{channelKey}[?{key}={id}]` JSON `{message, from: csid, form, session?: {ticketHash}}` |
| 3b | Send file | `PUT` same path `?from={csid}[&{key}={id}]`, multipart field `file` |
| 4 | Poll | `GET .../ext/plugin/outbound/web/callback/v2?number={csid}&csid={csid}&channelId={channelId}&sessionId={webSessionId}` |

Timers: poll 3 s while the socket is down · safety poll 10 s while open (skipped if live traffic < 2 s ago) · liveness 150 s · reconnect backoff 2 s → 30 s · request timeout 15 s · upload 60 s + 10 s/MB · thinking 20 s (config 5–120 s).

## Appendix C: Out of scope (same as RN)

- `features.persistHistory` and `features.notifications` are accepted and warned as not implemented.
- Country picker for phone fields (RN TODOS.md). Use the one fixed `phoneDialCode`.
- Copying a quick-reply label into `form[inputs[0].name]` when a message has both inputs and buttons (RN TODOS.md).
- Flutter web and desktop.
