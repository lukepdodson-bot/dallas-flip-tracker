/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Warm paper and ink rather than the usual dashboard blue - this is a
        // gallery-facing product, and the palette should not fight the images.
        paper: { 50: '#fbfaf7', 100: '#f5f2ec', 200: '#e9e4da', 300: '#d8d1c3' },
        ink:   { 400: '#8a8579', 600: '#544f45', 800: '#2c2a25', 900: '#1a1916' },
        clay:  { 100: '#f3e7e0', 400: '#c08066', 500: '#a86a52', 600: '#8d5741' },
      },
      fontFamily: {
        display: ['Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
};
