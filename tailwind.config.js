/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral dark-gray NLE palette (CapCut/Premiere-style) — token names preserved
        ink: { 950: '#101012', 900: '#1A1A1D', 850: '#202024', 800: '#252529', 750: '#2A2A30', 700: '#323238', 600: '#3A3A42', 500: '#46464E' },
        line: { DEFAULT: '#2A2A30', bright: '#3E3E46' },
        // Single blue accent (Premiere #2680EB / CapCut #3E7BFA family)
        signal: { DEFAULT: '#4C9AFF', dim: '#2F7CD8', dark: '#173A5E' },
        pulse: { DEFAULT: '#38BDF8', dim: '#0E7FBF' },
        mind: { DEFAULT: '#C084FC', dim: '#8B5CF6', deep: '#5B21B6' },
        heat: { DEFAULT: '#FB7185', amber: '#FBBF24', green: '#34D399' },
        paper: { DEFAULT: '#EAEAEA', dim: '#A0A0A6', faint: '#6E6E76' },
      },
      fontFamily: {
        display: ['"Space Grotesk Variable"', 'system-ui', 'sans-serif'],
        body: ['"Inter Variable"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(76,154,255,0.20)',
        mind: '0 0 24px rgba(192,132,252,0.22)',
        panel: '0 8px 32px rgba(0,0,0,0.45)',
      },
    },
  },
  plugins: [],
};