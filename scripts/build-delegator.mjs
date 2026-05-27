#!/usr/bin/env node
/*
 * build-delegator.mjs — produce a Chub-deployable bundle for the top-level
 * delegator stage (src/Stage.tsx).
 *
 *   node scripts/build-delegator.mjs
 *
 * Passes the repo root as VITE_PUBLIC_DIR so Vite picks up chub_meta.yaml
 * and scenario.yaml from there directly — no backup/wipe/restore of public/
 * needed.
 */

import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(repo, "dist", "delegator");

rmSync(distDir, { recursive: true, force: true });
console.log(`[build-delegator] vite build -> ${distDir}`);
try {
  execSync(`npx vite build --outDir dist/delegator`, {
    cwd: repo,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_PUBLIC_DIR: repo,
    },
  });
} catch (err) {
  console.error("[build-delegator] build failed:", err.message ?? err);
  process.exit(1);
}
