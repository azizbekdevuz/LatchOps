/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // LatchOps "control-room ink" palette — mirrors globals.css :root
        'bg-primary': '#06080b',
        'bg-secondary': '#0b0f14',
        'bg-tertiary': '#131a21',
        'border-color': '#1d2630',
        'border-strong': '#2b3845',
        'text-primary': '#e9eef3',
        'text-secondary': '#93a1ae',
        'text-muted': '#5b6873',
        'accent-blue': '#62b6cb',
        'accent-green': '#34e0a1',
        'accent-red': '#ff5d55',
        'accent-yellow': '#e3a13c',
        'accent-purple': '#9a8cff',
      },
      fontFamily: {
        sans: ['var(--font-inter)', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        display: ['var(--font-grotesk)', 'var(--font-inter)', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      transitionTimingFunction: {
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
        spring: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
      },
    },
  },
  plugins: [],
}
