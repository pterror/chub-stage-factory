#!/usr/bin/env node
/**
 * new-composer.mjs — scaffold a new pattern composer file + companion doc.
 *
 * Usage:
 *   node scripts/new-composer.mjs <name> --bucket <world|character|combat|lifecycle> [--shape bundle|subsystem|adhoc]
 *
 * Creates:
 *   src/lib/patterns/<bucket>/<name>.ts   — composer stub with WHAT/WHY/SHAPE header
 *   src/lib/patterns/<bucket>/<NAME>.md   — companion doc stub
 *
 * Then prints next steps.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, "..");

// ── Arg parsing ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function flag(name) {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : null;
}

const [name] = args;
const bucket = flag("--bucket");
const shape = flag("--shape") ?? "bundle";

const VALID_BUCKETS = ["world", "character", "combat", "lifecycle", "synergy"];
const VALID_SHAPES = ["bundle", "subsystem", "adhoc"];

if (!name || name.startsWith("--")) {
  console.error("Usage: node scripts/new-composer.mjs <name> --bucket <world|character|combat|lifecycle> [--shape bundle|subsystem|adhoc]");
  process.exit(1);
}
if (!bucket || !VALID_BUCKETS.includes(bucket)) {
  console.error(`--bucket must be one of: ${VALID_BUCKETS.join(", ")}`);
  process.exit(1);
}
if (!VALID_SHAPES.includes(shape)) {
  console.error(`--shape must be one of: ${VALID_SHAPES.join(", ")}`);
  process.exit(1);
}

// ── Path setup ────────────────────────────────────────────────────────────────

const bucketDir = resolve(repoRoot, "src/lib/patterns", bucket);
const tsFile = resolve(bucketDir, `${name}.ts`);
const mdFile = resolve(bucketDir, `${name.toUpperCase()}.md`);

if (existsSync(tsFile)) {
  console.error(`Already exists: ${tsFile}`);
  process.exit(1);
}

if (!existsSync(bucketDir)) {
  mkdirSync(bucketDir, { recursive: true });
}

// ── Pascal-case helpers ───────────────────────────────────────────────────────

const pascal = name.replace(/(^|-)([a-z])/g, (_, _sep, c) => c.toUpperCase());
const fnName = `${name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}Pattern`;

// ── Template selection ────────────────────────────────────────────────────────

function bundleTemplate() {
  return `/*
 * patterns/${bucket}/${name}.ts — TODO: one-line description
 *
 * WHAT: \`${fnName}(init)\` wires:
 *   1. TODO — primary surface
 *   2. TODO — secondary surface
 *   3. TODO — tick / buildBeforePrompt
 *
 * WHY: TODO — which game-shape(s) does this enable and why is it a
 *      pattern rather than inline stage code?
 *
 * SHAPE:
 *   interface ${pascal}Init { TODO }
 *   interface ${pascal}Bundle { TODO }
 *   function ${fnName}(init): ${pascal}Bundle
 */

// TODO: replace with real imports
// import { ... } from "../../...";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ${pascal}Init {
  // TODO: define init fields
}

export interface ${pascal}Bundle {
  // TODO: define bundle surface
  buildBeforePrompt(/* msg: Message, bound: PersistenceStore */): Promise<void>;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function ${fnName}(init: ${pascal}Init): ${pascal}Bundle {
  // TODO: set up state from init

  return {
    async buildBeforePrompt(/* msg, bound */) {
      // TODO: build context + stage directions
    },
  };
}
`;
}

function subsystemTemplate() {
  return `/*
 * patterns/${bucket}/${name}.ts — TODO: one-line description
 *
 * WHAT: \`${fnName}(opts)\` returns a \`ComposedSubsystem<${pascal}State>\` that:
 *   1. TODO — what state it owns
 *   2. TODO — what context it contributes
 *   3. TODO — what lifecycle hooks it registers
 *
 * WHY: TODO — which game-shape(s) does this enable, and why does it
 *      plug into an LlmPipelineRunner rather than being called
 *      directly by the stage?
 *
 * SHAPE:
 *   interface ${pascal}Options { TODO }
 *   interface ${pascal}State { TODO }
 *   function ${fnName}(opts): ComposedSubsystem<${pascal}State>
 */

import type { ContextContributor } from "../../context";
import { estimateTokens } from "../../context";
import type { ComposedSubsystem } from "./types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ${pascal}Options {
  // TODO: define option fields
  id?: string;
  priority?: number;
}

export interface ${pascal}State {
  // TODO: define state shape
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function ${fnName}(
  opts: ${pascal}Options,
): ComposedSubsystem<${pascal}State> {
  const id = opts.id ?? "${name}";
  const state: ${pascal}State = {
    // TODO: initialize state
  };

  const contributor: ContextContributor = {
    id,
    priority: opts.priority ?? 50,
    contribute() {
      // TODO: return a Section or null
      const content = \`<${name}>\n\${JSON.stringify(state)}\n</${name}>\`;
      return { id, content, tokens: estimateTokens(content), optional: true };
    },
  };

  return {
    state,
    contributors: [contributor],
    shards: [{ id, value: state }],
    hooks: {
      beforeAssemble() {
        // TODO: update state before context assembly
      },
    },
  };
}
`;
}

function adhocTemplate() {
  return `/*
 * patterns/${bucket}/${name}.ts — TODO: one-line description
 *
 * WHAT: \`${fnName}(init)\` returns a set of operation hooks with no
 *       turn-level lifecycle. Suitable for pure query/mutation APIs.
 *   1. TODO — primary hook
 *   2. TODO — secondary hook
 *
 * WHY: TODO — which game-shape(s) does this enable? Why is ad-hoc
 *      (stateless / no tick loop) the right shape here?
 *
 * SHAPE:
 *   interface ${pascal}Init { TODO }
 *   interface ${pascal}Hooks { TODO }
 *   interface ${pascal}Bundle { hooks: ${pascal}Hooks }
 *   function ${fnName}(init): ${pascal}Bundle
 */

// TODO: replace with real imports
// import { ... } from "../../...";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ${pascal}Init {
  // TODO: define init fields
}

export interface ${pascal}Hooks {
  // TODO: define operation hooks
}

export interface ${pascal}Bundle {
  hooks: ${pascal}Hooks;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export function ${fnName}(init: ${pascal}Init): ${pascal}Bundle {
  // TODO: implement hooks

  return {
    hooks: {
      // TODO: fill in hook implementations
    },
  };
}
`;
}

const templates = { bundle: bundleTemplate, subsystem: subsystemTemplate, adhoc: adhocTemplate };
const tsContent = templates[shape]();

// ── Companion doc ─────────────────────────────────────────────────────────────

const mdContent = `# \`${name}\` — ${pascal} pattern

## Purpose

TODO: one paragraph explaining what this composer does and which game-shape(s) it
enables. Reference the ROADMAP entry if applicable.

## API

\`\`\`ts
${fnName}(init: ${pascal}Init): ${pascal}${shape === "subsystem" ? `ComposedSubsystem<${pascal}State>` : `${pascal}Bundle`}
\`\`\`

### Init fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| TODO  | TODO | TODO     | TODO        |

### Bundle surface

| Method / field | Description |
|----------------|-------------|
| TODO           | TODO        |

## Example

\`\`\`ts
// TODO: minimal usage example
const p = ${fnName}({
  // TODO: fill in init
});
\`\`\`

## Gotchas

- TODO: note any non-obvious behaviour, persistence wiring, or interaction with
  other patterns.
`;

// ── Write files ───────────────────────────────────────────────────────────────

writeFileSync(tsFile, tsContent, "utf8");
writeFileSync(mdFile, mdContent, "utf8");

console.log(`\nCreated:`);
console.log(`  ${tsFile.replace(repoRoot + "/", "")}`);
console.log(`  ${mdFile.replace(repoRoot + "/", "")}`);

console.log(`\nNext steps:`);
console.log(`  1. Fill in the WHAT/WHY/SHAPE header comment in ${name}.ts`);
console.log(`  2. Implement ${fnName}() in ${name}.ts`);
console.log(`  3. Fill in ${name.toUpperCase()}.md (Purpose / API / Example / Gotchas)`);
console.log(`  4. Add a recipe entry to src/lib/PATTERNS.md`);
console.log(`  5. Mark the item ✅ in src/lib/ROADMAP.md`);
console.log(`  6. Wire a usage example in examples/ or an existing Stage.tsx`);
