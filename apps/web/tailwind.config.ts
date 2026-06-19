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
        // Paleta de marca CICANET — metálico: navy profundo + plata + dorado, fibra azul acero
        cica: {
          black: "#04060C",
          navy: "#0A0E1A",
          panel: "#0E1322",
          border: "#222B40",
          steel: "#3E6FB0", // fibra / azul acero (secundario)
          steelLight: "#7FA8DD",
          gold: "#F5C518", // acento dorado principal
          amber: "#C8860D", // dorado profundo (inicio de degradados)
          glow: "#FFD24A", // brillo dorado
          silver: "#E9EDF5", // texto plateado
          muted: "#8B96AC",
        },
        status: {
          ftth: "#22E0A1",
          parcial: "#FFB02E",
          sin: "#FF4D6D",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(245, 197, 24, 0.35)",
        "glow-strong": "0 0 30px rgba(245, 197, 24, 0.55)",
        panel: "0 8px 40px rgba(0, 0, 0, 0.5)",
      },
      backgroundImage: {
        "cica-radial":
          "radial-gradient(circle at 30% 20%, rgba(245,197,24,0.10), transparent 45%), radial-gradient(circle at 80% 70%, rgba(62,111,176,0.12), transparent 40%)",
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
