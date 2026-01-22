/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "#2563eb", // Royal Blue
                secondary: "#10b981", // Emerald Green
                dark: "#0f172a", // Slate 900
                card: "#1e293b", // Slate 800
                text: "#f8fafc", // Slate 50
                muted: "#94a3b8", // Slate 400
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
        },
    },
    plugins: [
        function ({ addVariant }) {
            addVariant('light', ['&.light', '.light &'])
        },
    ],
}
