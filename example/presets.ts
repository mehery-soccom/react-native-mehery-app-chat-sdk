import type { MeheryConfig } from 'react-native-mehery-chat';

// What a client would host as JSON and pass to the SDK.
export const PRESETS: Record<string, { label: string; locale?: string; config: MeheryConfig }> = {
  minimal: {
    label: 'Minimal',
    config: {
      schemaVersion: 1,
      features: { closeButton: false },
      // Local app image: registered in App.tsx as assets={{ acmeWordmark: require(...) }}.
      // Centred wordmark is the brand name; position "center" hides the title.
      // height and width are pixels. 91 matches the 78×24 asset at height 28.
      components: { header: { title: 'Support', brand: { image: 'asset:acmeWordmark', position: 'center', height: 28, width: 91 } } },
    },
  },
  ocean: {
    label: 'Ocean',
    config: {
      schemaVersion: 1,
      theme: {
        colors: {
          light: { accent: '#174EA6', onAccent: '#FFFFFF', surface: '#EEF3FB', border: '#D6E2F5' },
          dark: { accent: '#8AB4F8', onAccent: '#0B1A33', background: '#0B1220', surface: '#16213A', border: '#22304D' },
        },
        radius: { bubble: 16, chip: 12, composer: 16 },
      },
      motion: { preset: 'playful' },
      components: {
        // Remote PNG wordmark (any S3 / CloudFront / CDN URL works the same), centred.
        header: {
          title: 'Ocean Bank',
          logo: 'https://dummyimage.com/120x120/ffffff/174ea6.png&text=OB',
          background: 'accent',
          text: 'onAccent',
          brand: { image: 'https://dummyimage.com/300x64/174ea6/ffffff.png&text=OCEAN+BANK', position: 'center', height: 24 },
        },
      },
      features: { avatars: true, timestamps: true },
    },
  },
  midnight: {
    label: 'Midnight',
    config: {
      schemaVersion: 1,
      theme: {
        colors: {
          light: { accent: '#FFFFFF', onAccent: '#000000', background: '#000000', surface: '#161616', text: '#FFFFFF', muted: '#8A8A8A', border: '#1F1F1F' },
          dark: { accent: '#FFFFFF', onAccent: '#000000', background: '#000000', surface: '#161616', text: '#FFFFFF', muted: '#8A8A8A', border: '#1F1F1F' },
        },
        radius: { bubble: 6, chip: 6, composer: 8 },
      },
      // SVG logo mark on the right (drawn through the renderSvg adapter in App.tsx).
      components: {
        header: {
          title: 'NOIR',
          brand: {
            image:
              'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjZmZmZmZmIiBzdHJva2Utd2lkdGg9IjIuNSIvPjxyZWN0IHg9IjciIHk9IjExIiB3aWR0aD0iMTAiIGhlaWdodD0iMi41IiByeD0iMS4yNSIgZmlsbD0iI2ZmZmZmZiIvPjwvc3ZnPgo=',
            position: 'right',
            height: 24,
            width: 24,
          },
        },
      },
    },
  },
  arabic: {
    label: 'العربية',
    locale: 'ar-KW',
    config: {
      schemaVersion: 1,
      theme: { colors: { light: { accent: '#0F766E' } } },
      strings: {
        default: 'en',
        ar: {
          title: 'الدعم',
          placeholder: 'اكتب رسالة…',
          offline: 'أنت غير متصل',
          connecting: 'جارٍ الاتصال…',
          notSent: 'لم يتم الإرسال. اضغط لإعادة المحاولة.',
          emptyTitle: 'كيف يمكننا مساعدتك؟',
          emptyBody: 'اسأل أي شيء وسنرد هنا.',
        },
      },
    },
  },
};
