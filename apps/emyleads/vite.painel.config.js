import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { carimboDeBuild } from "./vite.carimbo.js";

/**
 * O painel da plataforma (painel.nucleomajor.com). Mesmo código do portal —
 * componentes, provider web, tema —, outra entrada. Sai em `public/painel/` e
 * é servido na RAIZ do subdomínio pelo mesmo servidor Node, que escolhe a
 * pasta pelo `Host` (`src/server.mjs`). Por isso `base: "/"`.
 */
function paginaComoIndex() {
  // A entrada se chama `painel.html` para não disputar o `index.html` do
  // portal na mesma pasta; na saída, ela vira o `index.html` do painel.
  return {
    name: "painel-como-index",
    enforce: "post",
    generateBundle(_, bundle) {
      const pagina = bundle["painel.html"];
      if (!pagina) return;
      delete bundle["painel.html"];
      this.emitFile({ type: "asset", fileName: "index.html", source: pagina.source });
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), tailwindcss(), paginaComoIndex()],
  define: {
    ...carimboDeBuild(),
    __EMYLEADS_PLATFORM__: JSON.stringify("web"),
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "",
    ),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
    ),
    "import.meta.env.VITE_NUCLEO_PORTAL_URL": JSON.stringify(
      process.env.VITE_NUCLEO_PORTAL_URL || process.env.PUBLIC_ORIGIN || "",
    ),
  },
  build: {
    outDir: "../../public/painel",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: resolve(process.cwd(), "painel.html"),
    },
  },
  server: {
    port: 4174,
    strictPort: true,
  },
});
