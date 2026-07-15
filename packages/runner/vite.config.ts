import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Standalone runner dev/build config. Lives in its own workspace package so
// it can pull in server-side deps (hono, ai-sdk) without polluting the Chub
// stage's own vite.config.ts / build output.
//
// The stage source consumed via the "@stage" alias (see src/main.tsx)
// defaults to this factory's own ../../src, but can be pointed at any
// external stage repo by setting STAGE_PATH (see .env.local.example). This
// lets the runner drive stages developed in their own repos (e.g.
// ~/git/space-ship-simulator) without copying them into this workspace.
export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, __dirname, "") };
  const stageRoot = env.STAGE_PATH
    ? resolve(env.STAGE_PATH)
    : resolve(__dirname, "../..");
  const stageSrc = resolve(stageRoot, "src");
  const stagePublic = resolve(stageRoot, "public");
  const stageNodeModules = resolve(stageRoot, "node_modules");

  return {
    root: __dirname,
    plugins: [react()],
    resolve: {
      alias: {
        "@stage": stageSrc,
        "@stage-public": stagePublic,
      },
      // Let Vite fall back to the external stage's own node_modules so its
      // dependencies resolve even when they're not hoisted into this
      // workspace's node_modules.
      modules: ["node_modules", stageNodeModules],
    },
    optimizeDeps: {
      // Force-include the external stage source in dependency pre-bundling
      // discovery; it lives outside this package's default crawl root.
      entries: ["src/**/*.{ts,tsx}", `${stageSrc}/**/*.{ts,tsx}`],
    },
    server: {
      port: 5174,
      fs: {
        // Allow serving stage source/assets from outside the workspace
        // root when STAGE_PATH points at an external repo.
        allow: [resolve(__dirname, "../.."), stageRoot],
      },
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
        "/chub-proxy": {
          target: "https://inference.chub.ai",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/chub-proxy/, ""),
          headers: {
            Referer: "https://chub.ai/",
            Origin: "https://chub.ai",
          },
        },
        "/chub-api-proxy": {
          target: "https://api.chub.ai",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/chub-api-proxy/, ""),
          headers: {
            Referer: "https://chub.ai/",
            Origin: "https://chub.ai",
          },
        },
      },
    },
    build: {
      outDir: resolve(__dirname, "dist"),
      emptyOutDir: true,
    },
  };
});
