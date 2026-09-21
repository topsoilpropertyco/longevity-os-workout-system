import type { Config } from 'tailwindcss';

/**
 * Tailwind v3. Every colour is a CSS custom property defined in globals.css so
 * that light/dark swap in one place and nothing here hardcodes a hex.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        line: 'var(--line)',
        ink: 'var(--ink)',
        ink2: 'var(--ink-2)',
        ink3: 'var(--ink-3)',
        accent: 'var(--accent)',
        accentInk: 'var(--accent-ink)',
        accentSoft: 'var(--accent-soft)',
        good: 'var(--good)',
        warn: 'var(--warn)',
        bad: 'var(--bad)',
        info: 'var(--info)',
        s1: 'var(--s1)',
        s2: 'var(--s2)',
        s3: 'var(--s3)',
        s4: 'var(--s4)',
        s5: 'var(--s5)',
      },
      fontFamily: {
        display: 'var(--font-display)',
        sans: 'var(--font-sans)',
      },
      borderRadius: {
        xl2: '1.25rem',
        xl3: '1.75rem',
      },
      spacing: {
        tap: '2.75rem', // 44px — the floor for every tap target
        nav: 'var(--nav-h)',
      },
      boxShadow: {
        card: '0 1px 0 0 var(--line), 0 18px 40px -28px rgba(0,0,0,0.65)',
        sheet: '0 -20px 60px -24px rgba(0,0,0,0.6)',
      },
      transitionTimingFunction: {
        out2: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'sheet-in': {
          from: { transform: 'translateY(101%)' },
          to: { transform: 'translateY(0)' },
        },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        pulse2: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'sheet-in': 'sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        'fade-in': 'fade-in 180ms ease-out',
        'rise-in': 'rise-in 260ms cubic-bezier(0.22, 1, 0.36, 1)',
        pulse2: 'pulse2 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
