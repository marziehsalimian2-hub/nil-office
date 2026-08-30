import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // NIL corporate identity: ink navy + restrained brass/seal accent.
        ink: {
          DEFAULT: "#12233b",
          soft: "#1c3350",
          muted: "#5a6b80",
        },
        seal: {
          DEFAULT: "#9a6a2e",
          soft: "#c79a5b",
          tint: "#f5ede0",
        },
        paper: {
          DEFAULT: "#f7f7f4",
          card: "#ffffff",
          line: "#e6e6e0",
        },
        status: {
          draft: "#6b7280",
          review: "#b45309",
          final: "#1d4ed8",
          sent: "#0e7490",
          waiting: "#a16207",
          received: "#15803d",
          closed: "#374151",
          cancelled: "#b91c1c",
        },
      },
      fontFamily: {
        sans: ["var(--font-vazir)", "Tahoma", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(18,35,59,0.04), 0 1px 3px rgba(18,35,59,0.06)",
      },
      borderRadius: {
        xl: "0.75rem",
      },
    },
  },
  plugins: [],
};

export default config;
