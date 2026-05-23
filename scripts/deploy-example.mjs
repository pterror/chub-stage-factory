#!/usr/bin/env node
/*
 * deploy-example.mjs — zip dist/<name>/ and POST it to the Chub extension API.
 *
 *   STAGE_ID_<NAME_UPPER>=... CHUB_AUTH_TOKEN=... \
 *     node scripts/deploy-example.mjs <name>
 *
 * NAME_UPPER replaces '-' with '_' (e.g. cyber-slots -> CYBER_SLOTS).
 * Mirrors .github/workflows/deploy.yml; no GitHub Action involvement.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const name = process.argv[2];
if (!name) {
  console.error("usage: node scripts/deploy-example.mjs <name>");
  process.exit(2);
}

const distDir = join(repo, "dist", name);
if (!existsSync(distDir)) {
  console.error(`no build at ${distDir}; run scripts/build-example.mjs first`);
  process.exit(2);
}

const upper = name.toUpperCase().replace(/-/g, "_");
const stageId = process.env[`STAGE_ID_${upper}`];
const token = process.env.CHUB_AUTH_TOKEN;
if (!stageId) {
  console.error(`STAGE_ID_${upper} not set`);
  process.exit(2);
}
if (!token) {
  console.error("CHUB_AUTH_TOKEN not set");
  process.exit(2);
}

const zip = join(repo, `build-${name}.zip`);
execSync(`rm -f ${zip} && cd ${distDir} && zip -r ${zip} *`, { stdio: "inherit" });
execSync(
  `curl -fsSL -H "CH-API-KEY: ${token}" -F "file=@${zip}" https://api.chub.ai/extension/${stageId}/upload`,
  { stdio: "inherit" },
);
execSync(`rm -f ${zip}`, { stdio: "inherit" });
console.log(`[deploy-example] ${name} -> ${stageId}: OK`);
