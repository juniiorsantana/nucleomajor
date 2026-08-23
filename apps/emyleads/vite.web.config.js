import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { carimboDeBuild } from "./vite.carimbo.js";

export default defineConfig({
  base: "/app/",
  plugins: [react(), tailwindcss()],
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
    outDir: "../../public/app",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: resolve(process.cwd(), "index.html"),
    },
  },
  server: {
    port: 4173,
    strictPort: true,
  },
});
