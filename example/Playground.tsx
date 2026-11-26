import { type ReactNode } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  resolveConfig,
  type AttachmentType,
  type LauncherIcon,
  type LauncherShape,
  type MeheryConfig,
  type MotionPreset,
  type Palette,
} from 'react-native-mehery-chat';
import { ColorField } from './ColorPicker';
import { PRESETS } from './presets';

export type Source = 'live' | 'mock';

/** Fields the playground edits on top of a preset. Empty = use the preset. */
export interface PlaygroundOverrides {
  brandName?: string;
  palette?: Partial<Palette>;
  headerBackground?: string;
  headerText?: string;
  logo?: string;
  wordmark?: string;
  wordmarkPosition?: 'left' | 'center' | 'right';
  userBubbleBackground?: string;
  userBubbleText?: string;
  botBubbleBackground?: string;
  botBubbleText?: string;
  radiusBubble?: number;
  radiusComposer?: number;
  radiusChip?: number;
  spacing?: number;
  motion?: MotionPreset;
  revealText?: boolean;
  icon?: LauncherIcon;
  shape?: LauncherShape;
  launcherPosition?: 'bottom-right' | 'bottom-left';
  launcherSize?: number;
  launcherMargin?: number;
  launcherBackground?: string;
  launcherIconColor?: string;
  launcherShadow?: boolean;
  showHeader?: boolean;
  timestamps?: boolean;
  avatars?: boolean;
  closeButton?: boolean;
  backgroundAudio?: boolean;
  attribution?: boolean;
  attachments?: AttachmentType[];
  maxAttachmentMB?: number;
  phoneDialCode?: string;
  autoOpen?: boolean;
  placeholder?: string;
  emptyTitle?: string;
  emptyBody?: string;
}

const ICONS: [LauncherIcon, string][] = [
  ['chat', 'Chat'],
  ['chat-outline', 'Outline'],
  ['bubbles', 'Bubbles'],
  ['sparkle', 'Sparkle'],
  ['help', 'Help'],
  ['headset', 'Headset'],
  ['mail', 'Mail'],
  ['star', 'Star'],
  ['none', 'None'],
];

const SHAPES: [LauncherShape, string][] = [
  ['circle', 'Circle'],
  ['rounded', 'Rounded'],
  ['square', 'Square'],
  ['none', 'No background'],
];

/** Merge a preset with playground overrides. Same path for Live and Mock. */
export function buildConfig(
  presetKey: keyof typeof PRESETS,
  overrides: PlaygroundOverrides,
  opts: { embedded: boolean; dark: boolean },
): MeheryConfig {
  const base = PRESETS[presetKey]!.config;
  const scheme = opts.dark ? 'dark' : 'light';
  const shape = overrides.shape ?? base.components?.launcher?.shape ?? 'circle';
  const icon = overrides.icon ?? base.components?.launcher?.icon ?? 'chat';

  const header = { ...base.components?.header };
  if (overrides.brandName !== undefined) {
    header.title = overrides.brandName;
    if (overrides.brandName && header.brand) {
      header.brand = { ...header.brand, title: 'show' };
    }
  }
  if (overrides.headerBackground !== undefined) header.background = overrides.headerBackground;
  if (overrides.headerText !== undefined) header.text = overrides.headerText;
  if (overrides.logo !== undefined) header.logo = overrides.logo || undefined;
  if (overrides.wordmark !== undefined) {
    if (overrides.wordmark) {
      header.brand = {
        image: overrides.wordmark,
        position: overrides.wordmarkPosition ?? header.brand?.position ?? 'left',
        height: header.brand?.height ?? 28,
        ...(header.brand?.width ? { width: header.brand.width } : {}),
        title: header.brand?.title ?? 'show',
      };
    } else {
      delete header.brand;
    }
  } else if (overrides.wordmarkPosition !== undefined && header.brand) {
    header.brand = { ...header.brand, position: overrides.wordmarkPosition };
  }

  const colors = {
    light: { ...base.theme?.colors?.light },
    dark: { ...base.theme?.colors?.dark },
  };
  if (overrides.palette) {
    colors[scheme] = { ...colors[scheme], ...overrides.palette };
  }

  const radius = { ...base.theme?.radius };
  if (overrides.radiusBubble !== undefined) radius.bubble = overrides.radiusBubble;
  if (overrides.radiusComposer !== undefined) radius.composer = overrides.radiusComposer;
  if (overrides.radiusChip !== undefined) radius.chip = overrides.radiusChip;

  const features = { ...base.features };
  if (overrides.showHeader !== undefined) features.header = overrides.showHeader;
  if (overrides.timestamps !== undefined) features.timestamps = overrides.timestamps;
  if (overrides.avatars !== undefined) features.avatars = overrides.avatars;
  if (overrides.closeButton !== undefined) features.closeButton = overrides.closeButton;
  if (overrides.backgroundAudio !== undefined) features.backgroundAudio = overrides.backgroundAudio;
  if (overrides.attribution !== undefined) features.attribution = overrides.attribution;
  if (overrides.attachments !== undefined) features.attachments = overrides.attachments;
  if (overrides.maxAttachmentMB !== undefined) features.maxAttachmentMB = overrides.maxAttachmentMB;
  if (overrides.phoneDialCode !== undefined) features.phoneDialCode = overrides.phoneDialCode || undefined;

  const strings = { ...base.strings };
  const en = { ...(typeof strings.en === 'object' && strings.en ? strings.en : {}) };
  if (overrides.placeholder !== undefined) en.placeholder = overrides.placeholder;
  if (overrides.emptyTitle !== undefined) en.emptyTitle = overrides.emptyTitle;
  if (overrides.emptyBody !== undefined) en.emptyBody = overrides.emptyBody;
  if (Object.keys(en).length) strings.en = en;

  return {
    ...base,
    schemaVersion: 1,
    theme: {
      ...base.theme,
      colors,
      radius,
      ...(overrides.spacing !== undefined ? { spacing: overrides.spacing } : {}),
    },
    motion: {
      ...base.motion,
      preset: overrides.motion ?? base.motion?.preset ?? 'subtle',
      ...(overrides.revealText !== undefined ? { revealText: overrides.revealText } : {}),
    },
    components: {
      ...base.components,
      header,
      userBubble: {
        ...base.components?.userBubble,
        ...(overrides.userBubbleBackground !== undefined ? { background: overrides.userBubbleBackground } : {}),
        ...(overrides.userBubbleText !== undefined ? { text: overrides.userBubbleText } : {}),
      },
      botBubble: {
        ...base.components?.botBubble,
        ...(overrides.botBubbleBackground !== undefined ? { background: overrides.botBubbleBackground } : {}),
        ...(overrides.botBubbleText !== undefined ? { text: overrides.botBubbleText } : {}),
      },
      launcher: {
        ...base.components?.launcher,
        icon,
        shape,
        ...(shape === 'none' ? { iconSize: 40, size: 48 } : {}),
        ...(overrides.launcherPosition !== undefined ? { position: overrides.launcherPosition } : {}),
        ...(overrides.launcherSize !== undefined ? { size: overrides.launcherSize } : {}),
        ...(overrides.launcherMargin !== undefined ? { margin: overrides.launcherMargin } : {}),
        ...(overrides.launcherBackground !== undefined ? { background: overrides.launcherBackground } : {}),
        ...(overrides.launcherIconColor !== undefined ? { iconColor: overrides.launcherIconColor } : {}),
        ...(overrides.launcherShadow !== undefined ? { shadow: overrides.launcherShadow } : {}),
      },
    },
    features,
    behaviour: {
      presentation: opts.embedded ? 'embedded' : 'modal',
      launcher: !opts.embedded,
      ...(overrides.autoOpen !== undefined ? { autoOpen: overrides.autoOpen } : {}),
    },
    strings,
  };
}

export function PlaygroundScreen({
  dark,
  live,
  source,
  onSource,
  preset,
  onPreset,
  overrides,
  onOverrides,
  embedded,
  onEmbedded,
  onDark,
  offline,
  onOffline,
  config,
  openButton,
}: {
  dark: boolean;
  live: boolean;
  source: Source;
  onSource(s: Source): void;
  preset: keyof typeof PRESETS;
  onPreset(p: keyof typeof PRESETS): void;
  overrides: PlaygroundOverrides;
  onOverrides(patch: PlaygroundOverrides | ((prev: PlaygroundOverrides) => PlaygroundOverrides)): void;
  embedded: boolean;
  onEmbedded(v: boolean): void;
  onDark(v: boolean): void;
  offline: boolean;
  onOffline(v: boolean): void;
  config: MeheryConfig;
  openButton: ReactNode;
}) {
  const scheme = dark ? 'dark' : 'light';
  const resolved = resolveConfig(config, scheme).config;
  const set = <K extends keyof PlaygroundOverrides>(key: K, value: PlaygroundOverrides[K]) =>
    onOverrides((prev) => ({ ...prev, [key]: value }));
  const setPalette = (key: keyof Palette, hex: string) =>
    onOverrides((prev) => ({ ...prev, palette: { ...prev.palette, [key]: hex } }));

  const paletteValue = (key: keyof Palette) => overrides.palette?.[key] ?? resolved.colors[key];
  const attachments = overrides.attachments ?? resolved.features.attachments;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: dark ? '#0A0A0A' : '#FAFAFA' }}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 28, fontWeight: '700', color: dark ? '#FAFAFA' : '#0A0A0A' }}>Acme Store</Text>
        <Text style={{ color: '#71717A', marginTop: 4, marginBottom: 20 }}>
          {live ? 'Host app — live Mehery channel (customer.mehery.com)' : 'Host app — Mehery chat playground (mock bot)'}
        </Text>

        <Row label="Channel">
          <Segments
            options={[
              ['live', 'Live'],
              ['mock', 'Mock'],
            ]}
            value={source}
            onChange={onSource}
            dark={dark}
          />
        </Row>
        <Row label="Preset">
          <Segments
            options={Object.entries(PRESETS).map(([k, v]) => [k, v.label])}
            value={preset}
            onChange={(p) => {
              onPreset(p);
              onOverrides({});
            }}
            dark={dark}
          />
        </Row>

        <Section title="Brand" dark={dark}>
          <Field
            label="Brand name"
            value={overrides.brandName ?? resolved.header.title}
            dark={dark}
            onChangeText={(t) => set('brandName', t)}
            placeholder="Support"
          />
          <Toggle label="Show header" value={overrides.showHeader ?? resolved.features.header} onChange={(v) => set('showHeader', v)} dark={dark} />
          <Toggle label="Close button" value={overrides.closeButton ?? resolved.features.closeButton} onChange={(v) => set('closeButton', v)} dark={dark} />
          <Toggle label="Powered by Mehery Soccom" value={overrides.attribution ?? resolved.features.attribution} onChange={(v) => set('attribution', v)} dark={dark} />
          <Field label="Logo URL" value={overrides.logo ?? resolved.header.logo ?? ''} dark={dark} onChangeText={(t) => set('logo', t)} placeholder="https://… or asset:name" />
          <Field
            label="Wordmark URL"
            value={overrides.wordmark ?? resolved.header.brand?.image ?? ''}
            dark={dark}
            onChangeText={(t) => set('wordmark', t)}
            placeholder="https://… or asset:name"
          />
          <Row label="Wordmark position">
            <Segments
              options={[
                ['left', 'Left'],
                ['center', 'Center'],
                ['right', 'Right'],
              ]}
              value={overrides.wordmarkPosition ?? resolved.header.brand?.position ?? 'left'}
              onChange={(v) => set('wordmarkPosition', v)}
              dark={dark}
            />
          </Row>
        </Section>

        <Section title="Colours" dark={dark}>
          <Text style={{ color: '#71717A', fontSize: 12, marginBottom: 8 }}>Editing the {scheme} palette. Switch Dark mode to edit the other.</Text>
          {(
            [
              ['accent', 'Accent'],
              ['onAccent', 'On accent'],
              ['background', 'Background'],
              ['surface', 'Surface'],
              ['text', 'Text'],
              ['muted', 'Muted'],
              ['border', 'Border'],
              ['error', 'Error'],
            ] as const
          ).map(([key, label]) => (
            <ColorField key={key} label={label} value={paletteValue(key)} dark={dark} onChange={(hex) => setPalette(key, hex)} />
          ))}
          <ColorField
            label="Header background"
            value={overrides.headerBackground ?? resolved.header.background}
            dark={dark}
            onChange={(hex) => set('headerBackground', hex)}
          />
          <ColorField label="Header text" value={overrides.headerText ?? resolved.header.text} dark={dark} onChange={(hex) => set('headerText', hex)} />
          <ColorField
            label="Outgoing bubble"
            value={overrides.userBubbleBackground ?? resolved.userBubble.background}
            dark={dark}
            onChange={(hex) => set('userBubbleBackground', hex)}
          />
          <ColorField
            label="Outgoing text"
            value={overrides.userBubbleText ?? resolved.userBubble.text}
            dark={dark}
            onChange={(hex) => set('userBubbleText', hex)}
          />
          <ColorField
            label="Incoming bubble"
            value={overrides.botBubbleBackground ?? resolved.botBubble.background}
            dark={dark}
            onChange={(hex) => set('botBubbleBackground', hex)}
          />
          <ColorField label="Incoming text" value={overrides.botBubbleText ?? resolved.botBubble.text} dark={dark} onChange={(hex) => set('botBubbleText', hex)} />
          <ColorField
            label="Launcher background"
            value={overrides.launcherBackground ?? resolved.launcher.background}
            dark={dark}
            onChange={(hex) => set('launcherBackground', hex)}
          />
          <ColorField
            label="Launcher icon"
            value={overrides.launcherIconColor ?? resolved.launcher.iconColor}
            dark={dark}
            onChange={(hex) => set('launcherIconColor', hex)}
          />
        </Section>

        <Section title="Launcher" dark={dark}>
          <Row label="Icon">
            <Segments options={ICONS} value={overrides.icon ?? resolved.launcher.icon} onChange={(v) => set('icon', v)} dark={dark} />
          </Row>
          <Row label="Shape">
            <Segments options={SHAPES} value={overrides.shape ?? resolved.launcher.shape} onChange={(v) => set('shape', v)} dark={dark} />
          </Row>
          <Row label="Position">
            <Segments
              options={[
                ['bottom-right', 'Bottom right'],
                ['bottom-left', 'Bottom left'],
              ]}
              value={overrides.launcherPosition ?? resolved.launcher.position}
              onChange={(v) => set('launcherPosition', v)}
              dark={dark}
            />
          </Row>
          <NumField label="Size" value={overrides.launcherSize ?? resolved.launcher.size} min={32} max={96} dark={dark} onChange={(n) => set('launcherSize', n)} />
          <NumField label="Margin" value={overrides.launcherMargin ?? resolved.launcher.margin} min={0} max={48} dark={dark} onChange={(n) => set('launcherMargin', n)} />
          <Toggle label="Shadow" value={overrides.launcherShadow ?? resolved.launcher.shadow} onChange={(v) => set('launcherShadow', v)} dark={dark} />
        </Section>

        <Section title="Geometry" dark={dark}>
          <NumField label="Bubble radius" value={overrides.radiusBubble ?? resolved.radius.bubble} min={0} max={40} dark={dark} onChange={(n) => set('radiusBubble', n)} />
          <NumField label="Composer radius" value={overrides.radiusComposer ?? resolved.radius.composer} min={0} max={40} dark={dark} onChange={(n) => set('radiusComposer', n)} />
          <NumField label="Chip radius" value={overrides.radiusChip ?? resolved.radius.chip} min={0} max={40} dark={dark} onChange={(n) => set('radiusChip', n)} />
          <NumField label="Spacing unit" value={overrides.spacing ?? resolved.spacing} min={2} max={8} dark={dark} onChange={(n) => set('spacing', n)} />
        </Section>

        <Section title="Motion" dark={dark}>
          <Row label="Preset">
            <Segments
              options={[
                ['subtle', 'Subtle'],
                ['playful', 'Playful'],
                ['none', 'None'],
              ]}
              value={overrides.motion ?? resolved.motion.preset}
              onChange={(v) => set('motion', v)}
              dark={dark}
            />
          </Row>
          <Toggle label="Reveal text" value={overrides.revealText ?? resolved.motion.revealText} onChange={(v) => set('revealText', v)} dark={dark} />
        </Section>

        <Section title="Features" dark={dark}>
          <Toggle label="Timestamps" value={overrides.timestamps ?? resolved.features.timestamps} onChange={(v) => set('timestamps', v)} dark={dark} />
          <Toggle label="Avatars" value={overrides.avatars ?? resolved.features.avatars} onChange={(v) => set('avatars', v)} dark={dark} />
          <Toggle label="Background audio" value={overrides.backgroundAudio ?? resolved.features.backgroundAudio} onChange={(v) => set('backgroundAudio', v)} dark={dark} />
          <Toggle
            label="Allow images"
            value={attachments.includes('image')}
            onChange={(v) => set('attachments', v ? [...new Set([...attachments, 'image' as const])] : attachments.filter((a) => a !== 'image'))}
            dark={dark}
          />
          <Toggle
            label="Allow documents"
            value={attachments.includes('document')}
            onChange={(v) =>
              set('attachments', v ? [...new Set([...attachments, 'document' as const])] : attachments.filter((a) => a !== 'document'))
            }
            dark={dark}
          />
          <NumField
            label="Max attachment MB"
            value={overrides.maxAttachmentMB ?? resolved.features.maxAttachmentMB}
            min={1}
            max={100}
            dark={dark}
            onChange={(n) => set('maxAttachmentMB', n)}
          />
          <Field
            label="Phone dial code"
            value={overrides.phoneDialCode ?? resolved.features.phoneDialCode ?? ''}
            dark={dark}
            onChangeText={(t) => set('phoneDialCode', t)}
            placeholder="+91"
          />
        </Section>

        <Section title="Copy" dark={dark}>
          <Field
            label="Placeholder"
            value={overrides.placeholder ?? resolved.strings.placeholder}
            dark={dark}
            onChangeText={(t) => set('placeholder', t)}
          />
          <Field label="Empty title" value={overrides.emptyTitle ?? resolved.strings.emptyTitle} dark={dark} onChangeText={(t) => set('emptyTitle', t)} />
          <Field label="Empty body" value={overrides.emptyBody ?? resolved.strings.emptyBody} dark={dark} onChangeText={(t) => set('emptyBody', t)} />
        </Section>

        <Section title="Behaviour" dark={dark}>
          <Toggle label="Embedded (instead of modal + launcher)" value={embedded} onChange={onEmbedded} dark={dark} />
          <Toggle label="Dark mode" value={dark} onChange={onDark} dark={dark} />
          <Toggle label="Auto-open" value={overrides.autoOpen ?? resolved.behaviour.autoOpen} onChange={(v) => set('autoOpen', v)} dark={dark} />
          {source === 'mock' ? <Toggle label="Simulate offline" value={offline} onChange={onOffline} dark={dark} /> : null}
        </Section>

        {openButton}

        <Text style={{ color: '#71717A', marginTop: 16, lineHeight: 20 }}>
          {live
            ? 'Live channel web:wwwmeherycom on customer.mehery.com. Say hello — the bot asks for your name, email, and phone.'
            : 'Try: tap a quick reply, "track my order" then an email, "talk to a person", "invoice", "gallery", "video", "voice", "fail" (then tap to retry), Arabic text, or attach a photo.'}
        </Text>

        <Section title="Config JSON" dark={dark}>
          <Text style={{ color: '#71717A', fontSize: 12, marginBottom: 8 }}>Passed to MeheryChatProvider. Copy this into a host app.</Text>
          <Text
            selectable
            style={{
              fontFamily: 'Menlo',
              fontSize: 11,
              lineHeight: 16,
              color: dark ? '#A1A1AA' : '#3F3F46',
              backgroundColor: dark ? '#1C1C1F' : '#FFFFFF',
              borderRadius: 12,
              padding: 12,
              borderWidth: 1,
              borderColor: dark ? '#27272A' : '#E4E4E7',
            }}
          >
            {JSON.stringify(config, null, 2)}
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, dark, children }: { title: string; dark: boolean; children: ReactNode }) {
  return (
    <View style={{ marginTop: 8, marginBottom: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '700', color: dark ? '#FAFAFA' : '#0A0A0A', marginBottom: 8 }}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ color: '#71717A', marginBottom: 8, fontSize: 13 }}>{label}</Text>
      {children}
    </View>
  );
}

function Segments<T extends string>({
  options,
  value,
  onChange,
  dark,
}: {
  options: readonly (readonly [T | string, string])[];
  value: T;
  onChange(v: T): void;
  dark: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map(([key, label]) => {
        const active = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key as T)}
            style={{
              paddingHorizontal: 14,
              height: 36,
              borderRadius: 18,
              justifyContent: 'center',
              backgroundColor: active ? (dark ? '#FAFAFA' : '#111111') : dark ? '#1C1C1F' : '#FFFFFF',
              borderWidth: 1,
              borderColor: dark ? '#27272A' : '#E4E4E7',
            }}
          >
            <Text style={{ color: active ? (dark ? '#111111' : '#FFFFFF') : dark ? '#FAFAFA' : '#111111', fontWeight: '500' }}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Toggle({ label, value, onChange, dark }: { label: string; value: boolean; onChange(v: boolean): void; dark: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 }}>
      <Text style={{ color: dark ? '#FAFAFA' : '#0A0A0A', fontSize: 15, flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  );
}

function Field({
  label,
  value,
  dark,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  dark: boolean;
  onChangeText(t: string): void;
  placeholder?: string;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: '#71717A', marginBottom: 6, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#71717A"
        style={{
          height: 44,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: dark ? '#27272A' : '#E4E4E7',
          paddingHorizontal: 14,
          color: dark ? '#FAFAFA' : '#0A0A0A',
          backgroundColor: dark ? '#1C1C1F' : '#FFFFFF',
        }}
      />
    </View>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  dark,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  dark: boolean;
  onChange(n: number): void;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: '#71717A', marginBottom: 6, fontSize: 13 }}>
        {label} ({min}–{max})
      </Text>
      <TextInput
        value={String(value)}
        keyboardType="number-pad"
        onChangeText={(t) => {
          const n = Number(t);
          if (!Number.isFinite(n)) return;
          onChange(Math.min(max, Math.max(min, Math.round(n))));
        }}
        style={{
          height: 44,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: dark ? '#27272A' : '#E4E4E7',
          paddingHorizontal: 14,
          color: dark ? '#FAFAFA' : '#0A0A0A',
          backgroundColor: dark ? '#1C1C1F' : '#FFFFFF',
        }}
      />
    </View>
  );
}
