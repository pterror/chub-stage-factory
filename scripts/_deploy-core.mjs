#!/usr/bin/env node
/*
 * _deploy-core.mjs — shared zip-and-POST logic used by deploy-example.mjs
 *                    and the deploy.mjs written into promoted repos.
 *
 * NOT intended to be run directly. Import `deployDist` and call it.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Zip `distDir` and POST it to the Chub extension API.
 *
 * @param {object} opts
 * @param {string} opts.distDir  Absolute path to the built dist directory.
 * @param {string} opts.stageId  Chub extension/stage id.
 * @param {string} opts.token    CHUB_AUTH_TOKEN value.
 * @param {string} opts.zipPath  Absolute path for the temporary zip file.
 * @param {string} [opts.label]  Label for log output (e.g. example name or "stage").
 */
export function deployDist({ distDir, stageId, token, zipPath, label = "stage" }) {
  if (!existsSync(distDir)) {
    console.error(`no build at ${distDir}; run build first`);
    process.exit(2);
  }
  execSync(`rm -f ${zipPath} && cd ${distDir} && zip -r ${zipPath} *`, { stdio: "inherit" });
  execSync(
    `curl -fsSL -H "CH-API-KEY: ${token}" -F "file=@${zipPath}" https://api.chub.ai/extension/${stageId}/upload`,
    { stdio: "inherit" },
  );
  execSync(`rm -f ${zipPath}`, { stdio: "inherit" });
  console.log(`[deploy] ${label} -> ${stageId}: OK`);
}
