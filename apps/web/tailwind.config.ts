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
        // Paleta de marca VISIONYX — degradado cian → azul → violeta sobre navy
        // profundo. Se conservan las claves `cica-*` (las usan los componentes)
        // pero sus valores ahora son los de VisionYX, así toda la UI hereda el
        // estilo sin reescribir cada vista.
        cica: {
          black: "#060B16", // fondo base
          navy: "#0B1326", // fondo alterno / barras
          panel: "#0F1A30", // superficies
          border: "#233150", // bordes
          steel: "#3B82F6", // azul de marca (secundario)
          steelLight: "#38BDF8", // azul-cian claro
          gold: "#A855F7", // ACENTO principal → violeta (fin de degradados)
          amber: "#22D3EE", // cian (inicio de degradados)
          glow: "#6366F1", // índigo (brillo)
          silver: "#EAF1FB", // texto claro
          muted: "#A6B6D4", // texto atenuado
        },
        status: {
          ftth: "#28E0A0",
          parcial: "#FFC14D",
          sin: "#FF5470",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(99, 102, 241, 0.40)",
        "glow-strong": "0 0 32px rgba(99, 102, 241, 0.60)",
        panel: "0 18px 50px rgba(0, 0, 0, 0.50)",
      },
      backgroundImage: {
        "cica-radial":
          "radial-gradient(circle at 28% 18%, rgba(34,211,238,0.10), transparent 45%), radial-gradient(circle at 82% 72%, rgba(168,85,247,0.12), transparent 42%)",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: "0.6", transform: "scale(1.15)" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 2s ease-in-out infinite",
        fadeUp: "fadeUp 0.35s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
