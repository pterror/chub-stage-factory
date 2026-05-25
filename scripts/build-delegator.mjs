#!/usr/bin/env node
/*
 * build-delegator.mjs — produce a Chub-deployable bundle for the top-level
 * delegator stage (src/Stage.tsx).
 *
 *   node scripts/build-delegator.mjs
 *
 * Backs up public/ to a temp dir, copies root-level chub_meta.yaml,
 * scenario.yaml into public/, runs `vite build --outDir dist/delegator`,
 * then restores public/.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(repo, "dist", "delegator");
const publicDir = join(repo, "public");
const backup = mkdtempSync(join(tmpdir(), "chub-public-delegator-"));

console.log(`[build-delegator] backing public/ -> ${backup}`);
cpSync(publicDir, backup, { recursive: true });

let failed = false;
try {
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });

  for (const asset of ["chub_meta.yaml", "scenario.yaml"]) {
    const src = join(repo, asset);
    if (existsSync(src)) cpSync(src, join(publicDir, asset));
  }

  rmSync(distDir, { recursive: true, force: true });
  console.log(`[build-delegator] vite build -> ${distDir}`);
  execSync(`npx vite build --outDir dist/delegator`, {
    cwd: repo,
    stdio: "inherit",
  });
} catch (err) {
  failed = true;
  console.error("[build-delegator] build failed:", err.message ?? err);
} finally {
  console.log("[build-delegator] restoring public/");
  rmSync(publicDir, { recursive: true, force: true });
  cpSync(backup, publicDir, { recursive: true });
  rmSync(backup, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
