import { memo, useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type RefObject } from 'react';
import { Animated, Modal, Pressable, TextInput, View, type TextStyle } from 'react-native';
import { isEmailInput, isPhoneInput, isValidInput, limitPhoneDigits, phoneDigitCount, phoneLimit } from '../core/client';
import type { AttachmentType } from '../core/config';
import type { PickedFile } from '../types';
import { formatDuration } from '../core/media';
import { isRTL } from '../core/richText';
import { useChatState, useMehery } from '../react/context';
import { ArrowUpIcon, MicIcon, PlusIcon, Txt, fontStyle, usePressScale } from './primitives';

export function Composer({ bottomInset, focusTick = 0 }: { bottomInset: number; focusTick?: number }) {
  const { config, client, pickAttachment, voiceRecorder } = useMehery();
  const { pendingInput } = useChatState();
  // Uncontrolled input: native owns the text, JS only tracks it. A controlled `value` echoes
  // every keystroke back from JS; when JS is busy (streaming reveal, open animation) a stale echo
  // overwrites what was typed and the field gets stuck at one letter.
  const text = useRef('');
  const [canSend, setCanSend] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sheet, setSheet] = useState(false);
  const chooseRef = useRef<((type: AttachmentType) => Promise<void>) | null>(null);
  const s = config.strings;
  const phoneMax = config.features.phoneMaxDigits;
  const tooLong = s.phoneTooLong.replace('{n}', String(phoneMax));
  const emailField = isEmailInput(pendingInput);
  const phoneField = isPhoneInput(pendingInput);
  const sendScale = usePressScale(0.88);
  const sendOpacity = useRef(new Animated.Value(0.3)).current;
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (focusTick > 0) input.current?.focus();
  }, [focusTick]);

  useEffect(() => {
    // JS-driven on purpose: the native-driven version was not applied on the New Architecture,
    // leaving the button looking disabled while it worked. One opacity value is cheap on JS.
    Animated.timing(sendOpacity, { toValue: canSend || pendingInput ? 1 : 0.3, duration: 140, useNativeDriver: false }).start();
  }, [canSend, pendingInput, sendOpacity]);

  const submit = () => {
    const value = text.current;
    if (!value.trim()) {
      // A field the bot is asking for is mandatory: say so instead of silently doing nothing.
      if (pendingInput) setError(s.required);
      return;
    }
    // Web: the composer checks an EMAIL field ("Invalid Input"); the card checks every field.
    if (emailField && !isValidInput(pendingInput, value)) {
      setError(s.invalidEmail);
      return;
    }
    if (phoneField && !isValidInput(pendingInput, value, phoneMax)) {
      setError(phoneDigitCount(value) > phoneLimit(value, phoneMax) ? tooLong : s.invalidPhone);
      return;
    }
    client.send(value);
    input.current?.clear();
    text.current = '';
    setCanSend(false);
    setRtl(false);
    setError(null);
  };

  // The text field is memoised and gets stable callbacks (via a ref to the latest closures), so a
  // re-render of the composer (canSend flipping, a poll, an error line) never re-commits the native
  // input mid-keystroke: on iOS that drops keystrokes (stuck after one character).
  const latest = useRef({ error, phoneField, tooLong, phoneMax });
  latest.current = { error, phoneField, tooLong, phoneMax };
  const onText = useCallback((t: string) => {
    const { error: err, phoneField: phone, tooLong: long, phoneMax: max } = latest.current;
    const next = phone ? limitPhoneDigits(t, max) : t;
    const overflow = phone && phoneDigitCount(t) > phoneLimit(t, max);
    if (next !== t) input.current?.setNativeProps({ text: next });
    text.current = next;
    // These only re-render when they actually flip, not on every keystroke.
    setCanSend(next.trim().length > 0);
    setRtl(isRTL(next));
    // Keep the message while the field is still sitting on the 10-digit cap. A native
    // echo of the trimmed value would otherwise clear it on the same keystroke.
    const stillAtCap = err === long && phone && phoneDigitCount(next) >= phoneLimit(next, max);
    if (overflow) setError(long);
    else if (err && !stillAtCap) setError(null);
  }, []);
  const submitRef = useRef<() => void>(() => {});
  submitRef.current = submit;
  const onSubmit = useCallback(() => submitRef.current(), []);
  const bodyFont = useMemo(() => fontStyle(config, 'body'), [config]);

  const attach = () => {
    if (!pickAttachment) return;
    const choose = (chooseRef.current = async (type: AttachmentType) => {
      // The picker is host code: a sync throw, a rejection or a malformed result must not crash.
      let file: PickedFile | null = null;
      try {
        file = await pickAttachment(type);
      } catch (cause) {
        client.report({ code: 'PICKER', message: 'The attachment picker failed', cause });
        return;
      }
      if (!file || typeof file.uri !== 'string' || !file.uri) return;
      if (file.size && file.size > config.features.maxAttachmentMB * 1024 * 1024) {
        setError(s.tooLarge.replace('{mb}', String(config.features.maxAttachmentMB)));
        return;
      }
      setError(null);
      client.sendFile(file);
    });
    const types = config.features.attachments;
    if (types.length === 1) return void choose(types[0]!);
    setSheet(true);
  };

  const pick = (type: AttachmentType) => {
    setSheet(false);
    void chooseRef.current?.(type);
  };

  // Mic tap starts recording; the bar below shows a timer with cancel and send.
  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - t0), 250);
    return () => clearInterval(timer);
  }, [recording]);
  // Leaving the screen mid-recording discards it. Keyed to unmount, not to the recorder object's identity.
  const live = useRef({ recording, voiceRecorder });
  live.current = { recording, voiceRecorder };
  useEffect(() => () => void (live.current.recording ? Promise.resolve(live.current.voiceRecorder?.cancel()).catch(() => {}) : undefined), []);

  const record = async () => {
    if (!voiceRecorder || recording) return;
    try {
      await voiceRecorder.start();
      setError(null);
      setRecording(true);
    } catch (cause) {
      client.report({ code: 'PICKER', message: 'Voice recording could not start', cause });
    }
  };
  const finishRecording = async (send: boolean) => {
    if (!voiceRecorder) return;
    setRecording(false);
    try {
      if (!send) return await voiceRecorder.cancel();
      const file = await voiceRecorder.stop();
      if (file && typeof file.uri === 'string' && file.uri) client.sendFile(file);
    } catch (cause) {
      client.report({ code: 'PICKER', message: 'Voice recording failed', cause });
    }
  };

  const showAttach = !!pickAttachment && config.features.attachments.length > 0;
  const showMic = !!voiceRecorder && !canSend && !pendingInput;
  const placeholder = pendingInput?.label ?? s.placeholder;

  return (
    <View
      style={{
        paddingHorizontal: config.spacing * 3,
        paddingTop: config.spacing * 2,
        paddingBottom: bottomInset + config.spacing * 2,
        backgroundColor: config.colors.background,
      }}
    >
      <Modal visible={sheet} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setSheet(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setSheet(false)} accessibilityLabel={s.cancel}>
          <View
            style={{
              backgroundColor: config.colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: config.spacing * 4,
              paddingBottom: bottomInset + config.spacing * 4,
              gap: config.spacing * 2,
            }}
          >
            <Txt variant="title" color={config.colors.text} style={{ marginBottom: config.spacing }}>
              {s.attach}
            </Txt>
            {([['image', s.photo], ['document', s.document]] as const).map(([type, label]) => (
              <Pressable
                key={type}
                onPress={() => pick(type)}
                accessibilityRole="button"
                style={{ padding: config.spacing * 4, borderRadius: config.radius.chip, backgroundColor: config.colors.surface }}
              >
                <Txt color={config.colors.text}>{label}</Txt>
              </Pressable>
            ))}
            <Pressable onPress={() => setSheet(false)} accessibilityRole="button" style={{ padding: config.spacing * 3, alignItems: 'center' }}>
              <Txt color={config.colors.muted}>{s.cancel}</Txt>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
      {error ? (
        <Txt variant="caption" color={config.colors.error} style={{ marginBottom: config.spacing * 1.5, marginHorizontal: config.spacing * 2 }} accessibilityLiveRegion="polite">
          {error}
        </Txt>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: config.spacing * 2 }}>
        {showAttach && (
          <Pressable
            testID="mehery-attach"
            onPress={attach}
            accessibilityRole="button"
            accessibilityLabel={s.attach}
            hitSlop={6}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: config.colors.surface }}
          >
            <PlusIcon color={config.colors.text} size={16} />
          </Pressable>
        )}
        <View
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'flex-end',
            minHeight: 44,
            borderRadius: config.radius.composer,
            backgroundColor: config.colors.surface,
            paddingStart: config.spacing * 4,
            paddingEnd: 4,
            paddingVertical: 4,
          }}
        >
          {recording ? (
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: config.spacing * 2 }}>
              <Pressable testID="mehery-record-cancel" onPress={() => void finishRecording(false)} accessibilityRole="button" accessibilityLabel={s.cancel} hitSlop={8}>
                <Txt color={config.colors.muted}>{s.cancel}</Txt>
              </Pressable>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: config.colors.error }} />
              <Txt style={{ fontVariant: ['tabular-nums'], flex: 1 }} color={config.colors.text}>
                {formatDuration(elapsed)}
              </Txt>
              <Pressable
                testID="mehery-record-send"
                onPress={() => void finishRecording(true)}
                accessibilityRole="button"
                accessibilityLabel={s.send}
                hitSlop={6}
                style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: config.colors.accent }}
              >
                <ArrowUpIcon color={config.colors.onAccent} size={13} />
              </Pressable>
            </View>
          ) : null}
          <ComposerField
            inputRef={input}
            onText={onText}
            onSubmit={onSubmit}
            placeholder={placeholder}
            mutedColor={config.colors.muted}
            textColor={config.colors.text}
            maxScale={config.font.maxScale}
            kind={emailField ? 'email' : phoneField ? 'phone' : 'text'}
            rtl={rtl}
            bodyFont={bodyFont}
            hidden={recording}
          />
          {/* Opacity (JS-driven) and press scale (native-driven) live on separate views. */}
          {recording ? null : (
          <Animated.View style={{ opacity: sendOpacity }}>
            <Animated.View style={{ transform: [{ scale: sendScale.scale }] }}>
              {showMic ? (
                <Pressable
                  testID="mehery-mic"
                  onPress={() => void record()}
                  accessibilityRole="button"
                  accessibilityLabel={s.voiceMessage}
                  hitSlop={6}
                  style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: config.colors.accent }}
                >
                  <MicIcon color={config.colors.onAccent} size={16} />
                </Pressable>
              ) : (
                <Pressable
                  testID="mehery-send"
                  onPress={submit}
                  onPressIn={sendScale.onPressIn}
                  onPressOut={sendScale.onPressOut}
                  disabled={!canSend && !pendingInput}
                  accessibilityRole="button"
                  accessibilityLabel={s.send}
                  accessibilityState={{ disabled: !canSend && !pendingInput }}
                  hitSlop={6}
                  style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: config.colors.accent }}
                >
                  <ArrowUpIcon color={config.colors.onAccent} size={13} />
                </Pressable>
              )}
            </Animated.View>
          </Animated.View>
          )}
        </View>
      </View>
      {config.features.attribution ? (
        <Txt
          variant="caption"
          color={config.colors.muted}
          accessibilityRole="text"
          style={{ textAlign: 'center', fontSize: 11, lineHeight: 14, marginTop: config.spacing * 2, opacity: 0.85 }}
        >
          {s.poweredBy}
        </Txt>
      ) : null}
    </View>
  );
}

interface FieldProps {
  inputRef: RefObject<ComponentRef<typeof TextInput> | null>;
  onText(t: string): void;
  onSubmit(): void;
  placeholder: string;
  mutedColor: string;
  textColor: string;
  maxScale: number | undefined;
  kind: 'text' | 'email' | 'phone';
  rtl: boolean;
  bodyFont: TextStyle;
  hidden: boolean;
}

/** The message box. Memoised: it only re-renders when one of these few props actually changes. */
const ComposerField = memo(function ComposerField({ inputRef, onText, onSubmit, placeholder, mutedColor, textColor, maxScale, kind, rtl, bodyFont, hidden }: FieldProps) {
  const style = useMemo(
    () => [bodyFont, { flex: 1, color: textColor, maxHeight: 120, paddingTop: 8, paddingBottom: 8, textAlignVertical: 'center' as const, textAlign: rtl ? ('right' as const) : ('left' as const), writingDirection: rtl ? ('rtl' as const) : ('ltr' as const) }],
    [bodyFont, textColor, rtl],
  );
  // Kept mounted (hidden) while recording so the typed text and native input survive.
  const shown = useMemo(() => (hidden ? [style, { display: 'none' as const }] : style), [style, hidden]);
  return (
    <TextInput
      ref={inputRef}
      testID="mehery-input"
      onChangeText={onText}
      placeholder={placeholder}
      placeholderTextColor={mutedColor}
      accessibilityLabel={placeholder}
      multiline
      submitBehavior="submit"
      returnKeyType="send"
      onSubmitEditing={onSubmit}
      maxFontSizeMultiplier={maxScale}
      // 'phone-pad' has no letters, so a stale phone prompt would make it impossible to type anything else ("menu").
      keyboardType={kind === 'email' ? 'email-address' : kind === 'phone' ? 'numbers-and-punctuation' : 'default'}
      autoCapitalize={kind === 'text' ? 'sentences' : 'none'}
      autoComplete={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : 'off'}
      style={shown}
    />
  );
});
