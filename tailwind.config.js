/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#6DF56A",   // primary
          dark: "#34C759",      // action/hover
          fg: "#1E1E1E",        // text
          muted: "#F8F9F8",     // bg
          accent: "#2F80ED",
          error: "#E74C3C",
        },
      },
      fontFamily: {
        heading: ['Poppins', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: "16px",
        '2xl': "24px",
      },
      boxShadow: {
        soft: "0 2px 6px rgba(0,0,0,0.10)",
      },
    },
  },
  plugins: [],
}
