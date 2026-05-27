#!/usr/bin/env node
/*
 * status.mjs — local-loop project state surface.
 *
 *   node scripts/status.mjs
 *
 * Prints in ~20 lines: git state, STATUS.md summary, latest deploy status.
 * Exit code: always 0 (informational).
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { encoding: "utf8", cwd: ROOT, ...opts }).trim();
  } catch {
    return null;
  }
}

function section(label) {
  console.log(`\n${BOLD}${CYAN}── ${label}${RESET}`);
}

// ── Git state ──────────────────────────────────────────────────────────────

section("Git");

const branch = run("git rev-parse --abbrev-ref HEAD") ?? "(unknown)";
const statusOut = run("git status --porcelain") ?? "";
const changedLines = statusOut.split("\n").filter(Boolean);
const changedCount = changedLines.length;

const changedLabel =
  changedCount === 0
    ? `${GREEN}clean${RESET}`
    : `${YELLOW}${changedCount} uncommitted change${changedCount !== 1 ? "s" : ""}${RESET}`;

console.log(`  branch: ${BOLD}${branch}${RESET}   ${changedLabel}`);

const logLines = run("git log --oneline -3") ?? "";
if (logLines) {
  for (const line of logLines.split("\n")) {
    const [hash, ...rest] = line.split(" ");
    console.log(`  ${DIM}${hash}${RESET} ${rest.join(" ")}`);
  }
}

// ── STATUS.md summary ──────────────────────────────────────────────────────

section("STATUS.md");

let statusMd;
try {
  statusMd = readFileSync(join(ROOT, "STATUS.md"), "utf8");
} catch {
  console.log(`  ${YELLOW}STATUS.md not found${RESET}`);
  statusMd = null;
}

if (statusMd !== null) {
  // Front-matter fields
  const phase = statusMd.match(/^phase:\s*(.+)$/m)?.[1]?.trim();
  const lastUpdated = statusMd.match(/^last-updated:\s*(.+)$/m)?.[1]?.trim();

  if (phase) console.log(`  phase: ${BOLD}${phase}${RESET}`);
  if (lastUpdated) console.log(`  last-updated: ${DIM}${lastUpdated}${RESET}`);

  // Active section: find the current in-progress heading
  const inProgressMatch = statusMd.match(/^##\s+(.+)/m);
  if (inProgressMatch) {
    const firstSection = inProgressMatch[1];
    console.log(`  active section: ${firstSection}`);
  }

  // Open TODOs: lines with unchecked markdown tasks [ ]
  const todos = [...statusMd.matchAll(/^\s*[-*]\s+\[ \]\s+(.+)$/gm)].map(
    (m) => m[1]
  );
  if (todos.length === 0) {
    // Also look for plain bullet items in task list sections
    const taskSection = statusMd.match(
      /##\s+Task list\n([\s\S]*?)(?=\n##|\s*$)/
    )?.[1];
    const bullets = taskSection
      ? [...taskSection.matchAll(/^\s*[-*]\s+(?!\[)(.+)$/gm)].map((m) => m[1])
      : [];
    if (bullets.length > 0) {
      console.log(`  tasks (${bullets.length}):`);
      for (const t of bullets.slice(0, 5))
        console.log(`    ${DIM}•${RESET} ${t}`);
    } else {
      console.log(`  ${DIM}no open tasks found${RESET}`);
    }
  } else {
    const shown = todos.slice(0, 5);
    console.log(`  open TODOs (${todos.length}):`);
    for (const t of shown) console.log(`    ${YELLOW}☐${RESET} ${t}`);
    if (todos.length > 5)
      console.log(`    ${DIM}… and ${todos.length - 5} more${RESET}`);
  }

  // Blockers
  const blockerSection = statusMd.match(
    /##\s+Blockers\n([\s\S]*?)(?=\n##|\s*$)/
  )?.[1];
  const blockers = blockerSection
    ? [...blockerSection.matchAll(/^\s*[-*]\s+(.+)$/gm)].map((m) => m[1])
    : [];
  if (blockers.length > 0) {
    console.log(`  ${RED}blockers (${blockers.length}):${RESET}`);
    for (const b of blockers.slice(0, 3))
      console.log(`    ${RED}✗${RESET} ${b}`);
  }
}

// ── Deploy status (one line) ───────────────────────────────────────────────

section("Deploy");

let deployRaw;
try {
  deployRaw = execSync(
    "gh run list --workflow=deploy.yml --limit 1 --json status,conclusion,createdAt,headBranch,displayTitle",
    { encoding: "utf8", cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] }
  ).trim();
} catch {
  deployRaw = null;
}

if (!deployRaw) {
  console.log(`  ${DIM}deploy status unavailable (gh not configured?)${RESET}`);
} else {
  let runs;
  try {
    runs = JSON.parse(deployRaw);
  } catch {
    runs = null;
  }

  if (!runs || runs.length === 0) {
    console.log(`  ${YELLOW}no deploy.yml runs found${RESET}`);
  } else {
    const run0 = runs[0];
    const { status, conclusion, createdAt, headBranch, displayTitle } = run0;

    let icon, color, label;
    if (status === "completed") {
      if (conclusion === "success") {
        icon = "✓";
        color = GREEN;
        label = "success";
      } else if (conclusion === "failure") {
        icon = "✗";
        color = RED;
        label = "failed";
      } else {
        icon = "~";
        color = YELLOW;
        label = conclusion;
      }
    } else {
      icon = "…";
      color = YELLOW;
      label = status;
    }

    const date = new Date(createdAt).toLocaleString();
    console.log(
      `  ${color}${icon} ${label}${RESET}  ${displayTitle}  ${DIM}(${headBranch} · ${date})${RESET}`
    );
  }
}

console.log();
