#!/usr/bin/env node
/*
 * check-deploy.mjs — pretty-print the latest deploy workflow runs.
 *
 *   node scripts/check-deploy.mjs
 *
 * Exit codes:
 *   0  latest run succeeded
 *   1  latest run failed
 *   2  latest run is in progress
 *   3  no runs found
 */

import { execSync } from "node:child_process";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

let raw;
try {
  raw = execSync(
    "gh run list --workflow=deploy.yml --limit 5 --json status,conclusion,createdAt,headBranch,displayTitle",
    { encoding: "utf8" }
  );
} catch (err) {
  console.error("check-deploy: gh run list failed:", err.message ?? err);
  console.error("Is gh installed and authenticated? Is this a GitHub repo?");
  process.exit(3);
}

let runs;
try {
  runs = JSON.parse(raw);
} catch {
  console.error("check-deploy: unexpected output from gh:", raw);
  process.exit(3);
}

if (!Array.isArray(runs) || runs.length === 0) {
  console.log(`${YELLOW}No deploy.yml runs found.${RESET}`);
  process.exit(3);
}

console.log(`${CYAN}Latest deploy runs (deploy.yml):${RESET}\n`);

for (const run of runs) {
  const { status, conclusion, createdAt, headBranch, displayTitle } = run;

  let icon, color;
  if (status === "completed") {
    if (conclusion === "success") {
      icon = "✓";
      color = GREEN;
    } else if (conclusion === "failure") {
      icon = "✗";
      color = RED;
    } else {
      icon = "~";
      color = YELLOW;
    }
  } else {
    // in_progress, queued, waiting, etc.
    icon = "…";
    color = YELLOW;
  }

  const label = status === "completed" ? conclusion : status;
  const date = new Date(createdAt).toLocaleString();
  console.log(
    `${color}${icon} [${label}]${RESET} ${displayTitle} ${DIM}(${headBranch} · ${date})${RESET}`
  );
}

// Exit code based on latest run
const latest = runs[0];
if (latest.status !== "completed") process.exit(2);
if (latest.conclusion === "success") process.exit(0);
process.exit(1);
