import { defineConfig } from "vite";

// Vite-Konfiguration des Spiel-Clients. 127.0.0.1 statt localhost: sicherer Kontext für WebGPU
// und stabile URL für Prüf-Agenten (strictPort).
export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    watch: {
      // Werkzeuge, Modul, Laufzeitdaten und Rohmodelle lösen kein Neuladen aus
      ignored: ["**/.temp/**", "**/tools/**", "**/mounts/**", "**/server/**", "**/dist/**"],
    },
  },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  worker: { format: "es" },
  build: {
    target: "es2023",
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
});
