#!/usr/bin/env node
/*
 * deploy-delegator.mjs — zip dist/delegator/ and POST it to the Chub extension API.
 *
 *   STAGE_ID_DELEGATOR=... CHUB_AUTH_TOKEN=... node scripts/deploy-delegator.mjs
 *
 * Run build:delegator first to produce dist/delegator/.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(repo, "dist", "delegator");

if (!existsSync(distDir)) {
  console.error(`no build at ${distDir}; run scripts/build-delegator.mjs first`);
  process.exit(2);
}

const stageId = process.env.STAGE_ID_DELEGATOR;
const token = process.env.CHUB_AUTH_TOKEN;
if (!stageId) {
  console.error("STAGE_ID_DELEGATOR not set");
  process.exit(2);
}
if (!token) {
  console.error("CHUB_AUTH_TOKEN not set");
  process.exit(2);
}

const zip = join(repo, "build-delegator.zip");
execSync(`rm -f ${zip} && cd ${distDir} && zip -r ${zip} *`, { stdio: "inherit" });
execSync(
  `curl -fsSL -H "CH-API-KEY: ${token}" -F "file=@${zip}" https://api.chub.ai/extension/${stageId}/upload`,
  { stdio: "inherit" },
);
execSync(`rm -f ${zip}`, { stdio: "inherit" });
console.log(`[deploy-delegator] delegator -> ${stageId}: OK`);
