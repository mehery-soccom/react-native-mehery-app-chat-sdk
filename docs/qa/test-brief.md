# Mehery Chat SDK — test brief

## Purpose

Manual test of the example app as a stand-in for a host app. The Acme Store screen writes the same `config` object a host passes to `MeheryChatProvider`; the chat it opens is the SDK's own UI.

## Build

```bash
cd example
npm install
npm run ios   # or npm run android
```

Mock works with no secrets. Live needs `example/live.local.ts`, copied from `example/live.local.example.ts` and filled in. When that file exists the app launches on Live, so tap Mock first for mock cases.

## Pass rule

A case passes only when the visible result matches the Expected column. Console warnings are noted, not treated as failures, unless the Expected column says so.

Known in the current iOS build: the voice recorder's native module (NitroModules) does not load. A red LogBox toast shows on launch and the mic cannot record. Run the voice cases, record the result and add a note.

## Reset

Use Reset guest (testing) between session cases. Switching Preset clears playground overrides. The mock bot keeps no history across app launches; the live channel does.

## Out of scope

- Unit tests already in `src/` (`npm test` at the repo root).
- `features.persistHistory` and `features.notifications`. Both are accepted and ignored.
- Backend scriptus authoring.

## Sheets

Cases are in `mehery-chat-testcases.xlsx`. Its sheets: Index, Smoke, Playground, Chat, Media, Session, Config, Security. Start with the three cases named on Index. Rows marked "(requires live.local.ts)" need the configured live channel. Config cases edit `example/presets.ts`; revert the edit afterwards.

The deck `mehery-chat-sdk.pptx` maps the app. Its screenshots are in `screenshots/`.
