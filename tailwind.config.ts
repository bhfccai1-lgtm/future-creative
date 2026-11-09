import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#eef2f9', 100: '#d5deee', 600: '#1a3266', 700: '#132650', 800: '#0d1c3d', 900: '#0b1730', 950: '#060d1e' },
        gold: { 300: '#ecd58c', 400: '#e0c063', 500: '#d4af37', 600: '#b8932a' },
      },
      fontFamily: { sans: ['Cairo', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
