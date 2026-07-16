import type { Config } from "tailwindcss";

// dgloss ブランド（BRAND.md 準拠）: Primary青 / Accent紫 / 白基調
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          primary: "#2563EB",
          accent: "#7C3AED",
        },
        ink: {
          DEFAULT: "#1A1A1A",
          muted: "#64748B",
          faint: "#94A3B8",
        },
        surface: {
          DEFAULT: "#FFFFFF",
          panel: "#F8FAFC",
          border: "#E2E8F0",
        },
        semantic: {
          success: "#059669",
          warn: "#F59E0B",
          danger: "#DC2626",
        },
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Hiragino Sans",
          "Noto Sans JP",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,.08)",
      },
      borderRadius: {
        card: "8px",
        pill: "99px",
      },
    },
  },
  plugins: [],
};

export default config;
