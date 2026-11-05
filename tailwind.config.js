/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec6ff',
          400: '#59a6ff',
          500: '#3385fb',
          600: '#1d66f0',
          700: '#164ed6',
          800: '#1841ae',
          900: '#193a89',
          950: '#142554',
        },
      },
      boxShadow: {
        soft: '0 2px 12px -2px rgba(0,0,0,0.08)',
        card: '0 4px 24px -8px rgba(0,0,0,0.12)',
      },
    },
  },
  plugins: [],
};
