#!/usr/bin/env node
/*
 * build-all-examples.mjs — loop build-example.mjs over every example
 * directory under examples/<name>/.
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const examplesDir = join(repo, "examples");

const names = readdirSync(examplesDir).filter((n) => {
  if (n.startsWith("_")) return false;
  const p = join(examplesDir, n);
  return statSync(p).isDirectory() && existsSync(join(p, "Stage.tsx"));
});

let failed = 0;
for (const name of names) {
  console.log(`\n=== ${name} ===`);
  try {
    execSync(`node scripts/build-example.mjs ${name}`, { cwd: repo, stdio: "inherit" });
  } catch {
    failed += 1;
    console.error(`[build-all] ${name} FAILED`);
  }
}

console.log(`\n[build-all] ${names.length - failed}/${names.length} succeeded`);
process.exit(failed > 0 ? 1 : 0);
