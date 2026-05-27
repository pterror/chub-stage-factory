#!/usr/bin/env node
/*
 * build-example.mjs — produce a Chub-deployable bundle for one example.
 *
 *   node scripts/build-example.mjs <name>
 *
 * Passes the example's asset directory to Vite via VITE_PUBLIC_DIR so
 * that vite uses examples/<name>/ as the public dir directly — no
 * backup/wipe/restore of public/ needed.
 */

import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const name = process.argv[2];
if (!name) {
  console.error("usage: node scripts/build-example.mjs <name>");
  process.exit(2);
}

const exampleDir = join(repo, "examples", name);
if (!existsSync(exampleDir)) {
  console.error(`unknown example: ${name} (no directory ${exampleDir})`);
  process.exit(2);
}

const distDir = join(repo, "dist", name);
rmSync(distDir, { recursive: true, force: true });

console.log(`[build-example] ${name}: vite build -> ${distDir}`);
try {
  execSync(`npx vite build --outDir dist/${name}`, {
    cwd: repo,
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_EXAMPLE: name,
      VITE_PUBLIC_DIR: exampleDir,
    },
  });
} catch (err) {
  console.error(`[build-example] ${name}: build failed:`, err.message ?? err);
  process.exit(1);
}
