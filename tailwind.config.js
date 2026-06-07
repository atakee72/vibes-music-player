/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        deep: '#150A24',
        surface: { DEFAULT: '#2A1A47', 2: '#37255C' },
        amber: '#FF9E5E',
        coral: '#FF6B6B',
        gold: '#FFC857',
        lilac: '#C9A8FF',
        violet: '#8B5CF6',
        cream: '#FDF4E8',
        muted: '#BBA9D6',
        faint: '#7C6B9A',
        danger: '#E5484D',
      },
      fontFamily: {
        display: ['Fraunces Variable', 'serif'],
        sans: ['Inter Variable', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono Variable', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '28px', sm2: '16px' },
      keyframes: {
        breathe: {
          '0%,100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.04)' },
        },
        spinSlow: { to: { transform: 'rotate(360deg)' } },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        marquee: { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(-50%)' } },
      },
      animation: {
        breathe: 'breathe 4s ease-in-out infinite',
        'spin-slow': 'spinSlow 24s linear infinite',
        'fade-in': 'fadeIn 400ms ease-out',
        marquee: 'marquee 12s linear infinite',
      },
    },
  },
  plugins: [],
};
