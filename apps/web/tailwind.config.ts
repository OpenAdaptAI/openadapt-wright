import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        wright: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#b9dffd',
          300: '#7cc5fc',
          400: '#36a8f8',
          500: '#0c8de9',
          600: '#006fc7',
          700: '#0059a2',
          800: '#054b85',
          900: '#0a3f6e',
          950: '#072849',
        },
      },
    },
  },
  plugins: [],
}
export default config
