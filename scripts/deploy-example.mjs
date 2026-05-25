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

import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deployDist } from "./_deploy-core.mjs";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const name = process.argv[2];
if (!name) {
  console.error("usage: node scripts/deploy-example.mjs <name>");
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

deployDist({
  distDir: join(repo, "dist", name),
  stageId,
  token,
  zipPath: join(repo, `build-${name}.zip`),
  label: name,
});
