# Changelog

## Unreleased (0.1.0 → 1.0)

### Changed
- A new `transport` prop starts a new conversation (it was ignored).
- The provider no longer wraps your app in a view or sets its layout direction.
- `useMeheryChat().newGuest` is gone; use `logout()`.
- `isValidInput` is no longer exported.
- `MeheryError.cause` is reduced by default; pass `debug` to the provider for the raw cause.
- Phone numbers typed with `+` may have up to 15 digits; `features.phoneMaxDigits` sets the limit without it (default 10).
- Peer dependencies now have minimums (React 18, React Native 0.76, safe-area-context 4.5). The unused `thinking-orbs` dependency is removed.

### Added
- `offline`/`online` reported from real request results; `onConnectionChange`.
- `AUTH_FAILED` for 401/403 with no retry loop; one sign-in and replay for a send refused with 401.
- `getIdentityToken`; `useMeheryTheme()`; `UseMeheryChatResult`.
- `features.thinkingTimeoutMs`, `features.phoneMaxDigits`; new string keys for the previously hardcoded English; timestamps follow `locale`.
- Messages are ordered by time when a poll back-fills one.
- Screen readers: links are reachable as actions, new replies are announced, the typing indicator is a live region.
- `prepare`/`prepublishOnly` build scripts.

### Fixed
- One long unbroken string could freeze the JS thread in link detection; text over 20,000 characters is shown as is.
- Connecting twice, or stop then start, could leave two live sockets.
- A customer typing "Submitted" saw their message disappear.
- Voice recording was cancelled whenever the host re-rendered with a new recorder object.
- Large uploads timed out after 15 s.
- The types build failed under TypeScript 6; compiled test files shipped in the package.
- `features.persistHistory` and `features.notifications` now warn that they are not implemented.
