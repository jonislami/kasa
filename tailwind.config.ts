import type { Config } from 'tailwindcss'

// KontoSef.app design tokens: deep navy ink + one calm "ledger blue", cool neutrals.
// Token names are kept from the first version so every screen picks up the new palette.
export default {
  content: ['./index.html', './kontabilist.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          950: '#0A1322',
          900: '#0F1B2D', // dark surfaces (phone header, safe-area strip, marketing footer)
          800: '#1B2A40', // hover on dark
          700: '#1A4390', // primary hover
          600: '#1F4FA8', // primary action, links, active
          400: '#8AAEEB', // accent in the logo
          100: '#EBF1FB', // active background
          50: '#F5F8FD',
        },
        ink: '#0F172A',
        muted: '#5F6B7A',
        line: '#E6E8EC',
        field: '#D0D5DD',
        bg: '#F7F8FA',
        ok: { 700: '#0B6B4B', 100: '#E6F4EE' },
        warn: { 700: '#B42318', 100: '#FEF1EF' },
        amber: { 700: '#8A5A00', 100: '#FDF3DC' },
        bt: { 600: '#1D4ED8' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: '12px',
        ctl: '8px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04)',
        pop: '0 12px 32px -8px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.06)',
      },
      minHeight: { btn: '44px' },
      height: { btn: '44px' },
    },
  },
  plugins: [],
} satisfies Config
