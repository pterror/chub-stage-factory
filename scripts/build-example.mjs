#!/usr/bin/env node
/*
 * build-example.mjs — produce a Chub-deployable bundle for one example.
 *
 *   node scripts/build-example.mjs <name>
 *
 * Backs up public/ to a temp dir, copies examples/<name>/{chub_meta.yaml,
 * scenario.yaml, characters/} into public/, runs `VITE_EXAMPLE=<name>
 * vite build --outDir dist/<name>`, then restores public/ regardless of
 * build outcome.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
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

const publicDir = join(repo, "public");
const distDir = join(repo, "dist", name);
const backup = mkdtempSync(join(tmpdir(), `chub-public-${name}-`));

console.log(`[build-example] ${name}: backing public/ -> ${backup}`);
cpSync(publicDir, backup, { recursive: true });

let failed = false;
try {
  // Wipe public/ and copy this example's assets in. Keep public/ as a directory
  // so vite's publicDir resolution doesn't change.
  rmSync(publicDir, { recursive: true, force: true });
  mkdirSync(publicDir, { recursive: true });
  for (const asset of ["chub_meta.yaml", "scenario.yaml"]) {
    const src = join(exampleDir, asset);
    if (existsSync(src)) cpSync(src, join(publicDir, asset));
  }
  const chars = join(exampleDir, "characters");
  if (existsSync(chars)) cpSync(chars, join(publicDir, "characters"), { recursive: true });

  rmSync(distDir, { recursive: true, force: true });
  console.log(`[build-example] ${name}: vite build -> ${distDir}`);
  execSync(`npx vite build --outDir dist/${name}`, {
    cwd: repo,
    stdio: "inherit",
    env: { ...process.env, VITE_EXAMPLE: name },
  });
} catch (err) {
  failed = true;
  console.error(`[build-example] ${name}: build failed:`, err.message ?? err);
} finally {
  console.log(`[build-example] ${name}: restoring public/`);
  rmSync(publicDir, { recursive: true, force: true });
  cpSync(backup, publicDir, { recursive: true });
  rmSync(backup, { recursive: true, force: true });
}

process.exit(failed ? 1 : 0);
