#!/usr/bin/env node
/*
 * promote-example.mjs — copy one example out of the factory into a new
 * directory as a self-contained single-stage repo.
 *
 *   node scripts/promote-example.mjs <name> --out <dir> [--prune-lib] [--force]
 *
 * Options:
 *   --out <dir>    Required. Target directory (must not be the repo root).
 *   --force        Overrides the "non-empty out" safety check.
 *   --prune-lib    Conservative reachability-based deletion of unused
 *                  modules under <out>/src/lib/.
 *
 * After copying, runs `bun install && bun run build` in <out> to verify
 * the produced repo is self-consistent.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const name = args[0] && !args[0].startsWith("--") ? args[0] : null;
const getFlag = (flag) => {
  const i = args.indexOf(flag);
  if (i === -1) return null;
  return args[i + 1] ?? true;
};
const hasFlag = (flag) => args.includes(flag);

const outRaw = getFlag("--out");
const pruneLib = hasFlag("--prune-lib");
const force = hasFlag("--force");

if (!name || !outRaw || outRaw === true) {
  console.error(
    "usage: node scripts/promote-example.mjs <name> --out <dir> [--prune-lib] [--force]"
  );
  process.exit(2);
}

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const out = resolve(outRaw);

// Safety: refuse to operate in-place (into the repo root).
if (out === repo) {
  console.error("refuse: --out resolves to the source repo root. Use --force with a different path.");
  process.exit(2);
}

const exampleDir = join(repo, "examples", name);
if (!existsSync(exampleDir)) {
  console.error(`unknown example: "${name}" (no directory ${exampleDir})`);
  process.exit(2);
}

// Non-empty check.
if (existsSync(out) && readdirSync(out).length > 0 && !force) {
  console.error(`"${out}" is non-empty. Pass --force to overwrite.`);
  process.exit(2);
}

mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let copied = 0;
let deleted = 0;

function cp(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
  copied++;
}

function del(p) {
  if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
    deleted++;
  }
}

// ---------------------------------------------------------------------------
// 1. Copy repo root (excluding noisy/generated dirs)
// ---------------------------------------------------------------------------
const EXCLUDE_ROOT = new Set([
  "examples",
  "node_modules",
  "dist",
  ".git",
  "STATUS.md",
  "TODO.md",
  ".normalize",
]);

for (const entry of readdirSync(repo)) {
  if (EXCLUDE_ROOT.has(entry)) continue;
  cp(join(repo, entry), join(out, entry));
}
console.log(`[promote] copied root (excluding: ${[...EXCLUDE_ROOT].join(", ")})`);

// ---------------------------------------------------------------------------
// 2. Overwrite src/Stage.tsx with the example's stage
//    Rewrite "../../src/lib/" imports -> "./lib/" (path changes when the file
//    moves from examples/<name>/Stage.tsx to src/Stage.tsx).
//    Also inject a `export { XxxStage as Stage }` alias so App.tsx resolves.
// ---------------------------------------------------------------------------
{
  const src = readFileSync(join(exampleDir, "Stage.tsx"), "utf8");
  // Fix import paths
  let fixed = src.replace(/(['"])\.\.\/\.\.\/src\/lib\//g, "$1./lib/");

  // Detect named export class (e.g. `export class WorldPrimaryStage`) and add alias
  const classMatch = fixed.match(/export\s+class\s+(\w+)\s+extends\s+StageBase/);
  if (classMatch) {
    const className = classMatch[1];
    if (className !== "Stage") {
      fixed += `\n// Alias for App.tsx compatibility\nexport { ${className} as Stage };\n`;
      console.log(`[promote] added Stage alias for ${className}`);
    }
  }

  writeFileSync(join(out, "src", "Stage.tsx"), fixed, "utf8");
  copied++;
}
console.log(`[promote] src/Stage.tsx <- examples/${name}/Stage.tsx (paths rewritten)`);

// ---------------------------------------------------------------------------
// 3. Copy example root-level assets to out/ root
// ---------------------------------------------------------------------------
for (const asset of ["chub_meta.yaml", "scenario.yaml", "README.md", "test-init.json"]) {
  const src = join(exampleDir, asset);
  if (existsSync(src)) {
    cp(src, join(out, asset));
    console.log(`[promote] ${asset} <- examples/${name}/${asset}`);
  }
}
const charsDir = join(exampleDir, "characters");
if (existsSync(charsDir)) {
  cp(charsDir, join(out, "characters"));
  console.log(`[promote] characters/ <- examples/${name}/characters/`);
}

// ---------------------------------------------------------------------------
// 4. Remove factory-only directories and files from out/
// ---------------------------------------------------------------------------
del(join(out, "examples"));
console.log("[promote] removed out/examples/");

del(join(out, "src", "ExamplePicker.tsx"));
del(join(out, "src", "TestRunner.tsx"));
del(join(out, "src", "composition"));
del(join(out, "src", "lib", "ui", "CompositionLayout.tsx"));
del(join(out, "src", "lib", "design", "COMPOSITION.md"));
console.log("[promote] removed ExamplePicker.tsx, TestRunner.tsx, composition/, composition-only lib files");

del(join(out, "src", "runner"));
del(join(out, "runner"));
del(join(out, "scenarios"));
del(join(out, "scripts", "run-stage.mjs"));
console.log("[promote] removed src/runner/, runner/, scenarios/, scripts/run-stage.mjs");

// ---------------------------------------------------------------------------
// 5. Rewrite out/src/App.tsx — drop dev branching, just the single stage
// ---------------------------------------------------------------------------
const simplifiedApp = `import { ReactRunner } from "@chub-ai/stages-ts";
import { Stage } from "./Stage";

function App() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <ReactRunner factory={(data: any) => new Stage(data)} />;
}

export default App;
`;
writeFileSync(join(out, "src", "App.tsx"), simplifiedApp, "utf8");
console.log("[promote] rewrote src/App.tsx (single-stage, no dev branching)");

// ---------------------------------------------------------------------------
// 6. Rewrite out/package.json — drop factory scripts, add deploy
// ---------------------------------------------------------------------------
const pkgPath = join(out, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

pkg.name = `chub-stage-${name}`;

const REMOVE_SCRIPTS = new Set([
  "dev:example",
  "build:example",
  "build:examples",
  "deploy:example",
  "build:delegator",
  "deploy:delegator",
]);
for (const s of REMOVE_SCRIPTS) {
  delete pkg.scripts[s];
}
pkg.scripts["deploy"] = "node scripts/deploy.mjs";

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log("[promote] updated package.json (name, scripts)");

// ---------------------------------------------------------------------------
// 7. Delete factory-only scripts from out/scripts/
// ---------------------------------------------------------------------------
const REMOVE_SCRIPTS_FILES = [
  "build-example.mjs",
  "build-all-examples.mjs",
  "deploy-example.mjs",
  "build-delegator.mjs",
  "deploy-delegator.mjs",
];
for (const f of REMOVE_SCRIPTS_FILES) {
  del(join(out, "scripts", f));
}
console.log("[promote] removed factory scripts");

// ---------------------------------------------------------------------------
// 8. Write out/scripts/deploy.mjs — simple single-stage deploy
// ---------------------------------------------------------------------------
const deployScript = `#!/usr/bin/env node
/*
 * deploy.mjs — zip dist/ and POST it to the Chub extension API.
 *
 *   STAGE_ID=... CHUB_AUTH_TOKEN=... node scripts/deploy.mjs
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(fileURLToPath(import.meta.url), "..", "..");
const distDir = join(repo, "dist");

if (!existsSync(distDir)) {
  console.error(\`no build at \${distDir}; run "bun run build" first\`);
  process.exit(2);
}

const stageId = process.env.STAGE_ID;
const token = process.env.CHUB_AUTH_TOKEN;
if (!stageId) { console.error("STAGE_ID not set"); process.exit(2); }
if (!token) { console.error("CHUB_AUTH_TOKEN not set"); process.exit(2); }

const zip = join(repo, "build.zip");
execSync(\`rm -f \${zip} && cd \${distDir} && zip -r \${zip} *\`, { stdio: "inherit" });
execSync(
  \`curl -fsSL -H "CH-API-KEY: \${token}" -F "file=@\${zip}" https://api.chub.ai/extension/\${stageId}/upload\`,
  { stdio: "inherit" },
);
execSync(\`rm -f \${zip}\`, { stdio: "inherit" });
console.log(\`[deploy] -> \${stageId}: OK\`);
`;
mkdirSync(join(out, "scripts"), { recursive: true });
writeFileSync(join(out, "scripts", "deploy.mjs"), deployScript, "utf8");
console.log("[promote] wrote scripts/deploy.mjs");

// ---------------------------------------------------------------------------
// 9. --prune-lib: reachability walk on out/src/lib/
// ---------------------------------------------------------------------------
if (pruneLib) {
  console.log("[promote] --prune-lib: walking imports...");
  const libDir = join(out, "src", "lib");
  if (!existsSync(libDir)) {
    console.log("[promote] no src/lib/ found; skipping prune");
  } else {
    // Collect all .ts/.tsx in src/ (non-lib) as roots
    function collectFiles(dir, exts, result = []) {
      if (!existsSync(dir)) return result;
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) collectFiles(full, exts, result);
        else if (exts.some((e) => entry.endsWith(e))) result.push(full);
      }
      return result;
    }

    const srcDir = join(out, "src");
    const importRe = /from\s+['"]([^'"]+)['"]/g;
    const reached = new Set();

    function resolveLib(fromFile, importPath) {
      if (!importPath.startsWith(".") && !importPath.startsWith("/")) return null;
      const base = join(dirname(fromFile), importPath);
      for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
        const p = base + ext;
        if (existsSync(p) && p.includes(libDir)) return p;
      }
      return null;
    }

    function walk(file) {
      if (reached.has(file)) return;
      reached.add(file);
      let src;
      try { src = readFileSync(file, "utf8"); } catch { return; }
      let m;
      while ((m = importRe.exec(src)) !== null) {
        const resolved = resolveLib(file, m[1]);
        if (resolved) walk(resolved);
      }
    }

    // Walk from all non-lib source files
    const nonLibSrc = collectFiles(srcDir, [".ts", ".tsx"]).filter(
      (f) => !f.startsWith(libDir)
    );
    for (const f of nonLibSrc) walk(f);

    // Collect all lib files
    const allLib = collectFiles(libDir, [".ts", ".tsx"]);
    let pruned = 0;
    for (const f of allLib) {
      if (!reached.has(f)) {
        del(f);
        pruned++;
        // Also remove companion .md if the .ts(x) neighbor is gone
        for (const mdCandidate of [f.replace(/\.tsx?$/, ".md")]) {
          if (existsSync(mdCandidate)) del(mdCandidate);
        }
      }
    }
    console.log(
      `[promote] --prune-lib: ${allLib.length} total lib files, kept ${allLib.length - pruned}, pruned ${pruned}`
    );
  }
}

// ---------------------------------------------------------------------------
// 10. bun install + bun run build in out
// ---------------------------------------------------------------------------
console.log(`\n[promote] running bun install in ${out}...`);
try {
  execSync("bun install", { cwd: out, stdio: "inherit" });
} catch (err) {
  console.error("[promote] bun install FAILED — leaving output for inspection:", out);
  console.error(err.message ?? err);
  process.exit(1);
}

console.log(`[promote] running bun run build in ${out}...`);
try {
  execSync("bun run build", { cwd: out, stdio: "inherit" });
} catch (err) {
  console.error("[promote] bun run build FAILED — leaving output for inspection:", out);
  console.error(err.message ?? err);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`
[promote] done.
  name:     ${name}
  out:      ${out}
  copied:   ${copied} file(s)/dir(s)
  deleted:  ${deleted} file(s)/dir(s)
  prune-lib: ${pruneLib}
`);
