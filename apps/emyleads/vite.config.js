import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { carimboDeBuild } from "./vite.carimbo.js";

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const REQUIRED_PUBLIC_ENV = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];

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
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, APP_ROOT, "");
  const missing = REQUIRED_PUBLIC_ENV.filter((name) => !String(env[name] || "").trim());
  if (missing.length) {
    throw new Error(
      `Build da extensão interrompido: configure ${missing.join(" e ")} em apps/emyleads/.env.local.`
    );
  }

  return {
    envDir: APP_ROOT,
    plugins: [react(), tailwindcss()],
    define: carimboDeBuild(),
    build: {
      outDir: "dist",
      emptyOutDir: true,
      rollupOptions: {
        input: { gestao: "gestao.html" },
      },
    },
  };
});
