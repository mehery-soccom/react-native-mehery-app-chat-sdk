# Web parity plan

Fixes the gaps found by auditing the Mehery web widget (build `2026-11-04 17:51 UTC.5982782`, chunk
`03162c4f`, module `510c`). The web widget is the source of truth for what the user sees and what
gets posted. We copy its visible result, not its bugs.

Design doc (approved): `~/.gstack/projects/react-native-mehery-app-chat-sdk/neil-unknown-design-20261116-190738.md`
Approach (D10): patches + **web contract tests**.

One step = one change + its tests. Run `npm test && npm run typecheck` after each step, and don't
start the next step until it's green. The order puts what the live bot on
`customer.mehery.com / web:wwwmeherycom` sends today (greeting → 3-field card) first.

```
wire JSON ──► mapMeheryMessage ──► normalizeMessage ──► ChatClient.state ──► UI
(meheryTransport.ts)  (safe.ts)        (client.ts)            (MessageList/Bubble/FormCard/Composer)
                                            │
user action ──► client.send/sendForm/sendQuickReply ──► transport.send ──► POST body
                                                                          ▲
              parity contract test asserts THIS, from wire JSON in ───────┘
```

---

## Step 0: parity harness (no behavior change)

Add a `describe('web parity contract')` block to `src/core/meheryTransport.test.ts`. It reuses
that file's `fakeFetch`, `FakeSocket` and `flush`, so there's no new file and nothing extra
ships in the package (review 7A).

Each row is `{ name, wire: [raw server messages], act(client), body }`:
1. The fake fetch serves `wire` from auth/v2 and from the poll.
2. `createMeheryTransport` feeds a real `ChatClient`.
3. The row's action runs.
4. The test asserts that the JSON POST body equals `body` exactly.

The first rows use the payloads captured live during the audit: greeting `I`, 3-field card `O`,
submit echo with `text: null`. Rows for behavior that's still broken are `it.fails`, and each step
flips its rows to `it`.

## Step 1: bind the composer to `inputs[0]` like the web (gaps 1 + 6b)

**Web rule.** `onMessageRecvd: form_input = e.data.inputs ? e.data.inputs[0] : null` runs for every
received message, customer echoes included, in server order. The next composer message is
sent as `form[form_input.name] = text`. The email check runs only when `form_input.type == "EMAIL"`.

**Change** (`client.ts`, `Composer.tsx`)
- Delete `composerInput`.
- `receive`: set `pendingInput: message.inputs?.[0] ?? null` for every author.
- `start`: set `pendingInput: last?.inputs?.[0] ?? null`.
- Composer (review 4A): call `isValidInput` only when `pendingInput.type.toUpperCase() === 'EMAIL'`,
  and always show the `invalidEmail` error. `isValidInput` (public, `index.ts:6`) stays as the
  card's check, with type comparisons made case-insensitive.

**Tests**
- Flip "does not steal the composer": after the 3-field card, `pendingInput.name === 'name'`,
  and `send('hi')` sends `form: { name: 'hi' }`.
- Re-arm regression (**CRITICAL**: today a re-polled prompt turns the binding back on after it
  was answered): prompt → answer → prompt again (exists) → user echo gives `pendingInput === null`.
- `start()` with history ending on the card → armed.
- Parity row: composer "hi" while the card is latest → `{ message:"hi", from, form:{ name:"hi" } }`.

## Step 2: quick replies send `replyIdExt` (gap 7)

**Web body.** `form: { reply_id: <name>, reply_title: <label>, replyIdExt: <bot messageId> }`

**Change.** `client.sendQuickReply(button, replyIdExt?)`. `QuickReplies` in `MessageList.tsx`
passes `last.id`. `types.ts` and `safe.ts` don't change.

**Tests.** Update the quick-reply expectation, and add a parity row.

## Step 3: one-field card (gap 6a) + unknown input types (gap 9)

**Web rule.** `inputs.length > 0` → card. The checkbox and radio branches can never run, so any
other type draws an empty row and is left out of `form`.

**Change.**
- New exported `formFields(inputs)` in `client.ts`: keeps inputs whose type, uppercased, is TEXT,
  EMAIL or PHONE.
- `isFormCard = formFields(inputs).length > 0` (review 5A). A message whose inputs are all
  unknown types stays a normal bubble.
- `FormCard` renders `formFields(inputs)` only.
- The composer still binds to raw `inputs[0]`, like the web.

**Tests.**
- `isFormCard`: 1 field → true; all-CHECKBOX → false.
- `formFields` drops CHECKBOX and RADIO.
- Parity row: 1-field card Submit → `{ message:"Submitted", from, form:{ email:"…" } }`.

## Step 4: phone field sends a dial code (gap 2)

**Web.** vue-tel-input sends `+<cc> <national number>`, with the country taken from an IP lookup.

**Change.**
- Config `features.phoneDialCode?: string`, no default.
- Pure `withDialCode(value, code)`:
  - with a code and a value that doesn't start with `+`: strip leading `0`s (review 6A), then
    return `` `${code} ${rest}` ``;
  - otherwise: return the value unchanged.
- FormCard shows the code as a fixed prefix in the phone field.

**Not doing:** country picker (→ TODOS.md), IP lookup (privacy), libphonenumber (new dependency).

**Tests.** `'98765 43210'` → `'+91 98765 43210'`; `'09876543210'` → `'+91 9876543210'`;
`'+1 202…'` unchanged; no code → unchanged. Parity row for the 3-field Submit with the dial code.

**Before starting:** check how the audit's test lead stored its phone in Mehery admin (design doc
assignment), then delete that lead.

## Step 5: timestamps by age + sent check (gap 3)

**Web format.** Today `h:mm a`, under 7 days `h:mm a ddd`, otherwise `h:mm a DD MMM YY`.
Customer bubbles show a check.

**Change.**
- `formatStamp(ts, now)` in `src/core/richText.ts` (pure, no library); `MessageBubble` uses it.
- Check mark on user messages whose `status` is not `'sending'` or `'failed'` (review 8A). History
  messages have no `status`, and they should still get the check.

**Deliberate divergences.** Times stay on the last bubble of each 3-minute group. Device time zone.

**Tests.** `formatStamp` today, 3 days ago, 30 days ago. A history user message (no status)
counts as sent.

## Step 6: links: emails, phones, bare domains, truncation (gap 4)

**Web.** Autolinker 1.8.3 defaults; link text cut to 50 characters.

**Change** (`richText.ts`): one combined regex for
- `scheme|www` (as now);
- `name@host.tld` → `mailto:`;
- bare `host.(com|in|org|net|io|co|ai|app)` → `https://`, marked
  `// ponytail: short TLD list, use a full list if links go missing`;
- phones (review 9A, Autolinker's two shapes) → `tel:`:
  - `(\+\d{1,3}[-. ]?)?\(?\d{3}\)?[-. ]?\d{3}[-. ]?\d{4}`
  - `\+\d{1,3}[-. ]?(\d[-. ]?){6,12}\d`

Link text over 50 characters is cut in the middle; `Segment.url` keeps the full link.

**Not doing.** `^sup^` and `¡sub¡`.

**Tests.**
- Link: email, `mehery.com`, `+91 98765 43210`, `202-555-0100`.
- Stay plain: `2026-11-16`, `TXN-20261116-01`, `1.2.3`, `12345`.
- A 120-character URL: display truncated, `url` full.

## Step 7: BG_VOICE background audio (gap 8)

**Web.** `mediaSubType === "BG_VOICE"`: hidden from the bubble, autoplays at volume 0.2 while it
belongs to the latest non-customer message, with a play/pause toggle. It plays alongside other
audio.

**Change.**
- The mapper sets `Attachment.background = true` for `mediaSubType === 'BG_VOICE'`, and `safe.ts`
  keeps it.
- `MessageMedia` and `hasMedia` skip background attachments.
- One `renderAudio` player mounted in `MessageList`, **outside the FlatList** (review 2A). It's
  keyed to the latest bot message's background URL, gets `volume: 0.2`, and is **not** registered
  with `playback.ts`, so it plays alongside a voice note like the web. The toggle chip sits next to
  the quick replies.
- `MediaPlayerProps.volume?: number` (optional; hosts may ignore it).
- `features.backgroundAudio` defaults to `true` (review 3A). With it off, or with no
  `renderAudio`, there's no player and no toggle.

**Tests.** The mapper and `normalizeMessage` keep `background`; the bubble's media list skips it;
a pure `backgroundTrack(messages, enabled)` returns the URL or null (null when disabled, when the
latest message is from the customer, or when there's no flag).

## Step 8: voice note button (gap 11)

**Web.** The mic records `Recording.mp3` (`audio/mpeg`) and uploads it through the normal file `PUT`.

**Change.** Optional provider adapter `recordVoice?(): Promise<PickedFile | null>`, following the
`pickAttachment` pattern. The composer shows a mic while the text is empty, and the result goes
through `client.sendFile`.

**Tests.** Existing `sendFile` coverage, plus one `audio/mpeg` → `audio` attachment kind check.

## Step 9: icebreaker landing (gap 12, review 1A)

**Web.** If the list holds exactly one message and its `id == "icebrakerMsg"` (the backend's
`onAuthV2` returns it; see the fixture at `meheryTransport.test.ts:8`), the web shows a landing
card instead of the thread:
- title = the message text;
- "Quick Links" = its buttons; a tap sends `{ message: <code>, from, form: {} }`;
- "Chat with human" sends `{ message: "#", from, form: {} }`.

After any send, it goes back to the normal thread.

**Change.**
- `client.sendText(text)`: plain send with no reply form, used by the landing.
- `MessageList` renders an `Icebreaker` view when `messages.length === 1 && id === 'icebrakerMsg'`.

**Tests.** Two parity rows (Quick Link → code; human → `"#"`). With 2+ messages the landing
doesn't render (pure `isIcebreaker(messages)` helper).

## Step 10: stop poll churn (review 11A, existing code)

**Change.**
- `mergeAll` keeps the existing object when the incoming message has no field changes.
- `receive` skips `update()` when the messages array and `pendingInput` are both unchanged.

**Test.** Re-receiving an identical message → `getState()` is the same reference, and listeners
aren't called.

---

## No change (deliberate)

| Gap | Why |
|---|---|
| 5. Card on old messages, label placeholder, `code` dropped | Resubmitting old cards on the web is an accident. `label` is what the admin typed. `name == code` in every real payload. |
| 10. Video plays inline, file label | The SDK shows more than the web. Nothing breaks. |
| 11b. Emoji picker | The OS keyboard covers it, and the message sent is the same. |

## E2E (review 10A)

The mock bot answers "contact me" with the name/email/phone card. New
`example/e2e/contact-card.yaml` fills the card, submits, and asserts "Submitted". The existing
`conversation.yaml` still passes: it answers the 1-field prompt through the bound composer, and
screenshot 02 now also shows a 1-field card.

## Done when
- `npm test && npm run typecheck` pass after every step; no `it.fails` rows are left.
- `maestro test example/e2e` passes.
- Live check on `web:wwwmeherycom` with a fresh install: the card renders; typing in the composer
  sends `form.name`; Submit sends `{ message:"Submitted", form:{ name, email, phone } }`.

## NOT in scope
- Country picker for phone (→ TODOS.md).
- Quick reply + bound form field combination (→ TODOS.md).
- `^sup^` / `¡sub¡` markup: no bot uses it, and React Native has no sup/sub text.
- IP-based country lookup: it would send user IPs to a third party.
- Showing a timestamp on every bubble, and the web's "domain time" zone.
- Copying web bugs: unreachable checkbox/radio controls, the formData shared across cards,
  resubmitting old cards.

## What already exists
- `FormCard` + `client.sendForm`: the 3-field card and its Submit body already match the web, except the phone format. Reused.
- `QuickReplies` / `sendQuickReply`: reused; one extra field.
- `pickAttachment` adapter + `sendFile` + the PUT upload: reused for the mic.
- `renderAudio` adapter: reused for BG_VOICE.
- `fakeFetch` / `FakeSocket` in `meheryTransport.test.ts`: reused by the parity harness.
- Mock transport's 1-field email prompt: kept; one card reply added.

## Failure modes
| New path | Realistic failure | Test | Handling | User sees |
|---|---|---|---|---|
| Composer bound to card `inputs[0]` | Stale poll re-arms after an answer | Step 1 regression | Echo clears it | Correct |
| `withDialCode` | Trunk 0, or a pasted `+` number | Step 4 | Strip / pass through | Correct |
| Phone autolink | Dates/ids linked as phones | Step 6 negatives | Two web-shaped regexes | Plain text |
| BG player | `renderAudio` throws or fails to load | `backgroundTrack` | `ContainedRender` + `MEDIA` error | Silent: no autoplay (acceptable) |
| Icebreaker landing | Server sends a 2nd message mid-landing | `isIcebreaker` | Falls back to thread | Normal thread |
| Poll churn fix | A real field change gets skipped | Step 10 | Field-wise compare | Correct |

No critical gaps: every new path has a test or a handled fallback.

## Parallelization
Sequential implementation, no parallelization opportunity. Steps 1, 2, 3, 9 and 10 all touch
`client.ts`, and the parity rows share one test file.

## Implementation Tasks
- [ ] **T0 (P1, CC ~15 min)**: parity harness in `meheryTransport.test.ts` (Step 0). Verify: `npm test`.
- [ ] **T1 (P1, CC ~15 min)**: composer binding + re-arm fix + EMAIL-only composer gate (Step 1; review 4). Files: client.ts, Composer.tsx.
- [ ] **T2 (P1, CC ~5 min)**: `replyIdExt` (Step 2). Files: client.ts, MessageList.tsx.
- [ ] **T3 (P1, CC ~15 min)**: `formFields` + 1-field card (Step 3; review 5). Files: client.ts, FormCard.tsx.
- [ ] **T4 (P1, CC ~15 min)**: `withDialCode` + trunk-0 strip (Step 4; review 6). Files: FormCard.tsx, config.ts.
- [ ] **T5 (P2, CC ~15 min)**: `formatStamp` + sent check for history (Step 5; review 8). Files: richText.ts, MessageBubble.tsx.
- [ ] **T6 (P2, CC ~20 min)**: links with web-shaped phone regexes (Step 6; review 9). Files: richText.ts.
- [ ] **T7 (P2, CC ~30 min)**: BG_VOICE at list level + `backgroundAudio` flag (Step 7; reviews 2, 3). Files: meheryTransport.ts, safe.ts, types.ts, context.ts, config.ts, MessageList.tsx, MessageMedia.tsx.
- [ ] **T8 (P3, CC ~15 min)**: `recordVoice` adapter (Step 8). Files: Provider.tsx, context.ts, Composer.tsx.
- [ ] **T9 (P2, CC ~30 min)**: icebreaker landing (Step 9; review 1). Files: client.ts, MessageList.tsx.
- [ ] **T10 (P2, CC ~10 min)**: poll churn (Step 10; review 11). Files: client.ts.
- [ ] **T11 (P2, CC ~15 min)**: mock card + `contact-card.yaml` (review 10). Files: mockTransport.ts, example/e2e/.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | skipped (Codex not installed; subagent declined at D9) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 11 issues, 0 critical gaps (arch 3, quality 4, tests 3, perf 1), all folded |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **VERDICT:** ENG CLEARED, ready to implement.

NO UNRESOLVED DECISIONS
