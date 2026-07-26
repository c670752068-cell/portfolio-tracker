/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: {
          base: '#0B0F14',
          raised: '#141A22',
          overlay: '#1C242E',
        },
        ink: {
          primary: '#E8EDF3',
          secondary: '#9BA8B8',
          muted: '#5F6C7C',
        },
        gain: '#2ECC71',
        loss: '#FF5A5F',
        buy: '#C77DFF',
        trim: '#FFB84D',
        cash: '#7C8B9A',
        neutral: '#3A4553',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"PingFang SC"', 'system-ui', 'sans-serif'],
        mono: ['"SF Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}
