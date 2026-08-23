import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { carimboDeBuild } from "./vite.carimbo.js";

/**
 * Build 1 de 3 — a página de gestão (aba própria da extensão).
 *
 * São três passagens porque o MV3 exige formatos diferentes e o Vite só aceita
 * um formato de saída por build:
 *   1. esta        → gestao.html + assets (app web normal)
 *   2. vite.sw     → service worker, IIFE autocontido
 *   3. vite.content→ content script, IIFE com o CSS embutido
 *
 * Esta é a primeira e a única que limpa o dist/ — as outras duas apendam.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: carimboDeBuild(),
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { gestao: "gestao.html" },
    },
  },
});
