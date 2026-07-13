/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        warden: {
          bg: '#0f1224',
          card: '#14182b',
          border: '#262f56',
          accent: '#3a6ed2',
          accentLight: '#7fa4ec',
          text: '#e7ebfa',
          muted: '#9aa4c7',
        },
      },
    },
  },
  plugins: [],
};
