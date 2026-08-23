import { defineConfig } from "vite";
import { carimboDeBuild } from "./vite.carimbo.js";

/**
 * Build 2 de 3 — o service worker.
 *
 * IIFE autocontido de propósito, em vez de ESM: um service worker em módulo
 * precisa que todo import relativo resolva dentro do dist/, e qualquer chunk
 * compartilhado que o Rollup decida criar vira um caminho quebrado em runtime,
 * que só aparece quando o worker acorda. IIFE não tem esse modo de falha.
 *
 * Sem React e sem CSS aqui: o worker só roteia mensagens e fala com o IndexedDB.
 */
export default defineConfig({
  define: carimboDeBuild(),
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: "src/background/index.js",
      formats: ["iife"],
      name: "EmyLeadsWorker",
      fileName: () => "service-worker.js",
    },
  },
});
