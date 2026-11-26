import { useState } from 'react';
import { Animated, Pressable, TextInput, View } from 'react-native';
import { formFields, isEmailInput, isPhoneInput, isValidInput, limitPhoneDigits, phoneDigitCount, phoneLimit, withDialCode } from '../core/client';
import type { FormInput } from '../types';
import { useMehery } from '../react/context';
import { Txt, fontStyle, usePressScale } from './primitives';

/** Placeholder the web widget uses: a label if the bot sent one, otherwise Name / Email / Phone Number (from `strings`). */
function fieldHint(input: FormInput, s: { fieldName: string; fieldEmail: string; fieldPhone: string }): string {
  if (input.label) return input.label;
  const hints: Record<string, string> = { name: s.fieldName, email: s.fieldEmail, phone: s.fieldPhone };
  return hints[input.name.toLowerCase()] ?? hints[input.type.toLowerCase()] ?? input.name;
}

function fieldKind(input: FormInput): 'name' | 'email' | 'phone' | 'text' {
  const type = input.type.toUpperCase();
  const name = input.name.toLowerCase();
  if (type === 'EMAIL' || name === 'email') return 'email';
  if (type === 'PHONE' || name === 'phone') return 'phone';
  if (name === 'name') return 'name';
  return 'text';
}

/**
 * The card the web widget draws inside a bot message (`options.inputs`: one field or many).
 * Submit posts every field together as "Submitted"; the composer separately answers `inputs[0]`.
 */
export function FormCard({ inputs: all, active = true, filled }: { inputs: FormInput[]; active?: boolean; filled?: Record<string, string> }) {
  const inputs = formFields(all);
  const { config, client } = useMehery();
  const [values, setValues] = useState<Record<string, string>>({});
  // Per-field inline errors, set on submit and cleared the moment that field is edited.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const press = usePressScale(0.98);
  // Once answered (or superseded) the card stays put, read-only, showing what was submitted.
  const locked = !active || !!filled;
  const s = config.strings;
  const dialCode = config.features.phoneDialCode;
  const phoneMax = config.features.phoneMaxDigits;
  const tooLong = s.phoneTooLong.replace('{n}', String(phoneMax));
  // lineHeight on a single-line TextInput clips the glyphs. Keep size and family only.
  const inputFont = { ...fontStyle(config, 'body') };
  delete inputFont.lineHeight;

  const submit = () => {
    const form: Record<string, string> = {};
    const found: Record<string, string> = {};
    for (const input of inputs) {
      const value = values[input.name] ?? '';
      if (!isValidInput(input, value, phoneMax)) {
        if (isEmailInput(input)) found[input.name] = s.invalidEmail;
        else if (isPhoneInput(input) && phoneDigitCount(value) > phoneLimit(value, phoneMax)) found[input.name] = tooLong;
        else if (isPhoneInput(input)) found[input.name] = s.invalidPhone;
        else found[input.name] = s.required;
        continue;
      }
      form[input.name] = fieldKind(input) === 'phone' ? withDialCode(value, dialCode) : value.trim();
    }
    setErrors(found);
    if (Object.keys(found).length === 0) client.sendForm(form);
  };

  return (
    <View style={{ gap: config.spacing * 2 }}>
      {inputs.map((input) => {
        const kind = fieldKind(input);
        const hint = fieldHint(input, s);
        const error = errors[input.name];
        return (
          <View key={input.name} style={{ gap: config.spacing }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 48,
                borderRadius: config.radius.composer,
                borderWidth: 1,
                borderColor: error ? config.colors.error : config.colors.border,
                backgroundColor: config.colors.background,
                paddingHorizontal: config.spacing * 3,
                gap: config.spacing * 2,
              }}
            >
              <FieldIcon kind={kind} color={config.colors.muted} />
              {kind === 'phone' && dialCode ? <Txt color={config.colors.muted}>{dialCode}</Txt> : null}
              <TextInput
                testID={`mehery-form-${input.name}`}
                // Locked cards show the saved submission, or what was typed in this mounted card.
                value={locked ? (filled?.[input.name] ?? values[input.name] ?? '') : (values[input.name] ?? '')}
                editable={!locked}
                onChangeText={(text) => {
                  const phone = kind === 'phone';
                  const next = phone ? limitPhoneDigits(text, phoneMax) : text;
                  setValues((prev) => ({ ...prev, [input.name]: next }));
                  setErrors((prev) => {
                    if (phone && phoneDigitCount(text) > phoneLimit(text, phoneMax)) return { ...prev, [input.name]: tooLong };
                    if (!prev[input.name]) return prev;
                    const { [input.name]: _gone, ...rest } = prev;
                    return rest;
                  });
                }}
                placeholder={hint}
                placeholderTextColor={config.colors.muted}
                accessibilityLabel={hint}
                maxFontSizeMultiplier={config.font.maxScale}
                keyboardType={kind === 'email' ? 'email-address' : kind === 'phone' ? 'phone-pad' : 'default'}
                autoCapitalize={kind === 'email' || kind === 'phone' ? 'none' : kind === 'name' ? 'words' : 'sentences'}
                autoComplete={kind === 'email' ? 'email' : kind === 'phone' ? 'tel' : kind === 'name' ? 'name' : 'off'}
                textContentType={kind === 'email' ? 'emailAddress' : kind === 'phone' ? 'telephoneNumber' : kind === 'name' ? 'name' : 'none'}
                autoCorrect={kind === 'text'}
                style={[
                  inputFont,
                  {
                    flex: 1,
                    alignSelf: 'stretch',
                    color: config.colors.text,
                    paddingVertical: 12,
                    margin: 0,
                    includeFontPadding: false,
                    textAlignVertical: 'center',
                  },
                ]}
              />
            </View>
            {error ? (
              <Txt variant="caption" color={config.colors.error} accessibilityLiveRegion="polite" style={{ marginHorizontal: config.spacing * 2 }}>
                {error}
              </Txt>
            ) : null}
          </View>
        );
      })}
      {locked ? null : (
        <Animated.View style={{ transform: [{ scale: press.scale }] }}>
          <Pressable
            testID="mehery-form-submit"
            onPress={submit}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            accessibilityRole="button"
            accessibilityLabel={s.submit}
            style={{
              minHeight: 48,
              borderRadius: config.radius.composer,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: config.colors.accent,
            }}
          >
            <Txt weight="medium" color={config.colors.onAccent}>
              {s.submit}
            </Txt>
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

function FieldIcon({ kind, color }: { kind: 'name' | 'email' | 'phone' | 'text'; color: string }) {
  let icon = (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 3,
        borderWidth: 1.5,
        borderColor: color,
      }}
    />
  );
  if (kind === 'email') icon = <EnvelopeIcon color={color} />;
  if (kind === 'phone') icon = <PhoneIcon color={color} />;
  if (kind === 'name') icon = <PersonIcon color={color} />;
  return (
    <View
      style={{
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {icon}
    </View>
  );
}

function PersonIcon({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 16,
        height: 16,
        alignItems: 'center',
        justifyContent: 'flex-end',
      }}
    >
      <View
        style={{
          position: 'absolute',
          top: 0,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: 12,
          height: 6,
          borderTopLeftRadius: 6,
          borderTopRightRadius: 6,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

function EnvelopeIcon({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 16,
        height: 12,
        borderRadius: 2,
        borderWidth: 1.5,
        borderColor: color,
        overflow: 'hidden',
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 10,
          height: 10,
          borderRightWidth: 1.5,
          borderBottomWidth: 1.5,
          borderColor: color,
          transform: [{ rotate: '-45deg' }, { translateY: -6 }],
        }}
      />
    </View>
  );
}

function PhoneIcon({ color }: { color: string }) {
  return (
    <View
      style={{
        width: 10,
        height: 16,
        borderRadius: 2,
        borderWidth: 1.5,
        borderColor: color,
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingBottom: 1,
      }}
    >
      <View
        style={{
          width: 3,
          height: 3,
          borderRadius: 1.5,
          backgroundColor: color,
        }}
      />
    </View>
  );
}
