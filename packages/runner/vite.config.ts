import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Standalone runner dev/build config. Lives in its own workspace package so
// it can pull in server-side deps (hono, ai-sdk) without polluting the Chub
// stage's own vite.config.ts / build output. The stage source under
// ../../src is consumed via relative imports (see src/main.tsx), not an
// alias, but we still declare one here for editor/tsc ergonomics and to
// keep a single indirection point if the stage source ever moves.
export default defineConfig({
  root: __dirname,
  plugins: [react()],
  resolve: {
    alias: {
      "@stage": resolve(__dirname, "../../src"),
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});
