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
        // GitHub-inspired dark theme
        'bg-primary': '#0d1117',
        'bg-secondary': '#161b22',
        'bg-tertiary': '#21262d',
        'border-color': '#30363d',
        'text-primary': '#c9d1d9',
        'text-secondary': '#8b949e',
        'text-muted': '#6e7681',
        'accent-blue': '#58a6ff',
        'accent-green': '#3fb950',
        'accent-red': '#f85149',
        'accent-yellow': '#d29922',
        'accent-purple': '#a371f7',
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo', 'Consolas', 'Liberation Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
