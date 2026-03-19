/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        base: '#0f172a',
        panel: '#1a1f3a',
        hover: '#252d47',
        primaryText: '#f1f5f9',
        secondaryText: '#cbd5e1',
        tertiaryText: '#94a3b8',
        critical: '#ef4444',
        high: '#f97316',
        medium: '#f59e0b',
        low: '#6b7280',
        info: '#0ea5e9',
        success: '#14b8a6',
      },
      fontFamily: {
        mono: ['Space Mono', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
