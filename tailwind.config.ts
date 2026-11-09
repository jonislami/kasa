import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './kontabilist.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          900: '#10241B',
          800: '#1B3A2C',
          600: '#0E6B4E',
          400: '#3FBF86',
          100: '#E3F1EA',
        },
        ink: '#14201A',
        muted: '#56645C',
        line: '#E2E7E3',
        field: '#CBD5CE',
        bg: '#F4F6F3',
        warn: { 700: '#9A3412', 100: '#FFEDE0' },
        amber: { 700: '#854D0E', 100: '#FEF3C7' },
        bt: { 600: '#1D4ED8' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '14px',
        ctl: '10px',
      },
      minHeight: { btn: '44px' },
      height: { btn: '44px' },
    },
  },
  plugins: [],
} satisfies Config
