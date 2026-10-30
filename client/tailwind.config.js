/** Design tokens follow the Awadh Palace HMS UI Preview: navy sidebar, indigo accent, tinted status tiles. */
export default {
  // Button builds `btn-${variant}` dynamically, so these component classes must be safelisted or Tailwind purges them (btn-danger / btn-ghost rendered transparent).
  safelist: ['btn-primary', 'btn-secondary', 'btn-danger', 'btn-ghost'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] },
      colors: {
        brand: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81' },
        navy: { 700: '#1f2937', 800: '#151c2c', 900: '#0f1624' },
        surface: '#f8fafc',
      },
      boxShadow: { card: '0 1px 2px rgba(15,22,36,.04), 0 1px 0 rgba(15,22,36,.03)', pop: '0 12px 32px rgba(15,22,36,.14)' },
      borderRadius: { xl: '0.875rem' },
    },
  },
  plugins: [],
};
