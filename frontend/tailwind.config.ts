import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        soft: "0 18px 60px rgba(15, 23, 42, 0.08)"
      },
      animation: {
        "fade-up": "fadeUp 420ms ease-out both",
        "bar-grow": "barGrow 620ms ease-out both"
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" }
        },
        barGrow: {
          "0%": { transform: "scaleX(0)" },
          "100%": { transform: "scaleX(1)" }
        }
      }
    }
  },
  plugins: []
} satisfies Config;
