import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { carimboDeBuild } from "./vite.carimbo.js";

const APP_ROOT = dirname(fileURLToPath(import.meta.url));

/**
 * Build 3 de 3 — o content script que monta o painel dentro do WhatsApp Web.
 *
 * IIFE porque content script não aceita ES modules. O CSS entra no bundle via
 * `?inline` e é injetado no Shadow DOM — nunca como <link>, que vazaria estilo
 * para dentro do WhatsApp.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // O wa-js roda no mundo principal (manifest world: MAIN), fora deste
      // bundle. Preferimos o build NIGHTLY vendorado: o WhatsApp muda a
      // estrutura interna com frequência e a release do npm fica para trás.
      // Quando o console encher de erro de ChatStore/MsgCollection, rode
      // `npm run update-wa-js` e rebuilde.
      name: "emyleads-copy-wa-js",
      closeBundle() {
        const vendor = resolve(APP_ROOT, "vendor/wa-js.js");
        const fallback = resolve(APP_ROOT, "../../node_modules/@wppconnect/wa-js/dist/wppconnect-wa.js");
        const origem = existsSync(vendor) ? vendor : fallback;
        if (!existsSync(origem)) {
          console.warn(
            "[EmyLeads] wa-js não encontrado. Rode `npm install` ou `npm run update-wa-js`."
          );
          return;
        }
        const destino = resolve(APP_ROOT, "dist/wa-js.js");
        mkdirSync(dirname(destino), { recursive: true });
        copyFileSync(origem, destino);
      },
    },
  ],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    ...carimboDeBuild(),
  },
  build: {
    outDir: "dist",
    emptyOutDir: false,
    cssCodeSplit: false,
    lib: {
      entry: "src/content/index.jsx",
      formats: ["iife"],
      name: "EmyLeads",
      fileName: () => "content.js",
    },
  },
});
