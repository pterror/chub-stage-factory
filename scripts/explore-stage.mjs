#!/usr/bin/env node
/**
 * explore-stage.mjs — interactive REPL driver over StageIntrospect.
 *
 * Usage:
 *   node scripts/explore-stage.mjs <example-name> [options]
 *
 * Options:
 *   --json              Emit one JSON object per line; read JSON commands from
 *                       stdin. Suitable for agent-driven loops.
 *   --max-turns N       Exit after N successful invocations (interactive only).
 *   --no-color          Disable ANSI colors.
 *
 * Companion to scripts/run-stage.mjs. Where run-stage.mjs runs a scripted
 * scenario top-to-bottom, explore-stage.mjs is open-ended: it asks the
 * stage what verbs are available, lets you pick one, invokes it through
 * the stage's lifecycle, and loops.
 *
 * Requires a stage that implements StageIntrospect (see
 * src/lib/introspect/INTROSPECT.md). For composed stages, the runner
 * itself implements introspect with namespaced verbs.
 *
 * Exit 0 on clean quit, 1 on error, 2 on bad CLI usage.
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { JSDOM } from "jsdom";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);
const hasFlag = (f) => rawArgs.includes(f);
const getFlag = (f) => {
  const i = rawArgs.indexOf(f);
  return i !== -1 ? rawArgs[i + 1] : null;
};
const positionals = rawArgs.filter((a) => !a.startsWith("--"));
const exampleName = positionals[0] ?? null;
const jsonMode = hasFlag("--json");
const noColor = hasFlag("--no-color") || !process.stdout.isTTY;
const maxTurns = (() => {
  const v = getFlag("--max-turns");
  return v ? parseInt(v, 10) : Infinity;
})();

if (!exampleName) {
  console.error("usage: node scripts/explore-stage.mjs <example-name> [--json] [--max-turns N]");
  process.exit(2);
}

const c = (code, s) => (noColor ? s : `\x1b[${code}m${s}\x1b[0m`);
const dim = (s) => c("2", s);
const bold = (s) => c("1", s);
const cyan = (s) => c("36", s);
const yellow = (s) => c("33", s);
const red = (s) => c("31", s);
const green = (s) => c("32", s);

// ---------------------------------------------------------------------------
// jsdom polyfills (some primitives touch document at construction time)
// ---------------------------------------------------------------------------
function setupJsdom() {
  const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.HTMLElement = dom.window.HTMLElement;
  global.Element = dom.window.Element;
  global.Node = dom.window.Node;
  global.Event = dom.window.Event;
  global.CustomEvent = dom.window.CustomEvent;
  return dom;
}

// ---------------------------------------------------------------------------
// Null mocks (no I/O — text gen returns a placeholder)
// ---------------------------------------------------------------------------
const nullGenerator = {
  makeImage: () => Promise.resolve({ url: "", seed: 0 }),
  imageToImage: () => Promise.resolve({ url: "", seed: 0 }),
  animateImage: () => Promise.resolve({ url: "", seed: 0 }),
  inpaintImage: () => Promise.resolve({ url: "", seed: 0 }),
  removeBackground: () => Promise.resolve({ url: "", seed: 0 }),
  makeVideo: () => Promise.resolve({ url: "", seed: 0 }),
  makeMusic: () => Promise.resolve({ url: "", seed: 0 }),
  makeSound: () => Promise.resolve({ url: "", seed: 0 }),
  speak: () => Promise.resolve({ url: "", seed: 0 }),
  textGen: () => Promise.resolve({ result: "(null-mock prose)" }),
};
const nullMessenger = {
  impersonate: () => Promise.resolve({ success: true, error: null, identity: "null-id" }),
  updateChatState: () => Promise.resolve({ success: true, error: null }),
  updateEnvironment: () => Promise.resolve({ success: true, error: null }),
  nudge: () => Promise.resolve({ success: true, error: null, identity: "null-id" }),
};

// ---------------------------------------------------------------------------
// Load stage factory
// ---------------------------------------------------------------------------
const registryPath = resolve(repo, "examples", "registry.ts");
if (!existsSync(registryPath)) {
  console.error(`[explore-stage] examples/registry.ts not found at ${registryPath}`);
  process.exit(1);
}

let registryModule;
try {
  registryModule = await import(registryPath);
} catch (err) {
  console.error(`[explore-stage] failed to load registry: ${err.message}`);
  process.exit(1);
}

const entry = registryModule.getExample(exampleName);
if (!entry) {
  const valid = registryModule.EXAMPLES.map((e) => e.name).join(", ");
  console.error(`[explore-stage] unknown example "${exampleName}". valid: ${valid}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Construct stage
// ---------------------------------------------------------------------------
const dom = setupJsdom();

const DEFAULT_INITIAL = {
  environment: "development",
  initState: null,
  characters: {},
  config: null,
  messageState: null,
  users: {},
  chatState: null,
};

const initData = { ...DEFAULT_INITIAL, ...(entry.testInit ?? {}) };
const data = { ...initData, generator: nullGenerator, messenger: nullMessenger };

let stage;
try {
  stage = entry.factory(data);
  stage.generator = nullGenerator;
  stage.messenger = nullMessenger;
} catch (err) {
  console.error(`[explore-stage] stage constructor threw: ${err.message}`);
  process.exit(1);
}

// Check introspect support
function checkIntrospect(s) {
  return (
    s != null &&
    typeof s.availableVerbs === "function" &&
    typeof s.describe === "function" &&
    typeof s.invokeVerb === "function"
  );
}

if (!checkIntrospect(stage)) {
  console.error(red(`[explore-stage] "${exampleName}" does not implement StageIntrospect.`));
  console.error(dim("           See src/lib/introspect/INTROSPECT.md for the contract."));
  process.exit(1);
}

// Run load()
try {
  await stage.load();
} catch (err) {
  console.error(red(`[explore-stage] load() threw: ${err.message}`));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function printVerbs(verbs) {
  if (verbs.length === 0) {
    console.log(dim("  (no verbs available right now)"));
    return;
  }
  const w = String(verbs.length).length;
  verbs.forEach((v, i) => {
    const idx = String(i + 1).padStart(w, " ");
    const name = cyan(v.name);
    const label = v.label && v.label !== v.name ? ` — ${v.label}` : "";
    const enabled = v.enabled === false ? yellow(" [disabled]") : "";
    const argStr = v.args && v.args.length
      ? dim(" " + v.args.map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`)).join(" "))
      : "";
    console.log(`  ${idx}. ${name}${argStr}${label}${enabled}`);
    if (v.description) console.log(`     ${dim(v.description)}`);
  });
}

function printDescribe(d) {
  console.log(bold("\nstage:"));
  for (const line of d.summary.split("\n")) {
    console.log(`  ${line}`);
  }
  if (d.details && Object.keys(d.details).length) {
    console.log(dim(`  details: ${JSON.stringify(d.details)}`));
  }
}

function parseArgsString(str, schema) {
  // Permissive: comma- or space-separated; "k=v" pairs preferred.
  const out = {};
  if (!str) return out;
  const tokens = str.match(/\S+/g) ?? [];
  for (const t of tokens) {
    const eq = t.indexOf("=");
    if (eq > 0) {
      out[t.slice(0, eq)] = t.slice(eq + 1);
    }
  }
  // Positional fallback for first required arg.
  if (Object.keys(out).length === 0 && schema && schema.length > 0) {
    out[schema[0].name] = str.trim();
  }
  return out;
}

function prompt(rl, q) {
  return new Promise((res) => rl.question(q, res));
}

async function invoke(name, args) {
  try {
    const result = await stage.invokeVerb(name, args);
    return result;
  } catch (err) {
    return { ok: false, error: `invokeVerb threw: ${err.message}` };
  }
}

// ---------------------------------------------------------------------------
// JSON mode (line-protocol for agents)
// ---------------------------------------------------------------------------
async function runJsonMode() {
  function emit(obj) {
    process.stdout.write(JSON.stringify(obj) + "\n");
  }
  emit({ kind: "ready", example: exampleName, describe: stage.describe(), verbs: stage.availableVerbs() });

  const rl = createInterface({ input: process.stdin, output: null, terminal: false });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let cmd;
    try {
      cmd = JSON.parse(trimmed);
    } catch (err) {
      emit({ kind: "error", error: `bad json: ${err.message}` });
      continue;
    }
    switch (cmd.cmd) {
      case "verbs":
        emit({ kind: "verbs", verbs: stage.availableVerbs() });
        break;
      case "describe":
        emit({ kind: "describe", describe: stage.describe() });
        break;
      case "invoke": {
        const result = await invoke(cmd.name, cmd.args ?? {});
        emit({
          kind: "result",
          result,
          describe: stage.describe(),
          verbs: stage.availableVerbs(),
        });
        break;
      }
      case "quit":
        emit({ kind: "bye" });
        dom.window.close();
        process.exit(0);
        break;
      default:
        emit({ kind: "error", error: `unknown cmd: ${cmd.cmd}` });
    }
  }
  dom.window.close();
}

// ---------------------------------------------------------------------------
// Interactive mode
// ---------------------------------------------------------------------------
async function runInteractive() {
  console.log(bold(`\nexplore-stage: ${exampleName}`));
  console.log(dim("commands: <number>, <verb-name> [args], 'verbs', 'describe', 'quit'"));

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let turns = 0;

  while (true) {
    printDescribe(stage.describe());
    const verbs = stage.availableVerbs();
    console.log(bold(`\nverbs (${verbs.length}):`));
    printVerbs(verbs);

    const line = (await prompt(rl, "\n> ")).trim();
    if (!line) continue;

    if (line === "quit" || line === "exit" || line === "q") {
      console.log(dim("bye."));
      break;
    }
    if (line === "verbs") continue;
    if (line === "describe") continue;

    // Parse: first token is index or verb name; remainder is args.
    const space = line.indexOf(" ");
    const head = space === -1 ? line : line.slice(0, space);
    const tail = space === -1 ? "" : line.slice(space + 1);

    let verb;
    const asNum = parseInt(head, 10);
    if (!isNaN(asNum) && asNum >= 1 && asNum <= verbs.length) {
      verb = verbs[asNum - 1];
    } else {
      verb = verbs.find((v) => v.name === head);
    }
    if (!verb) {
      console.log(red(`unknown verb: ${head}`));
      continue;
    }
    if (verb.enabled === false) {
      console.log(yellow(`verb "${verb.name}" is disabled right now.`));
      continue;
    }

    const args = parseArgsString(tail, verb.args);
    console.log(dim(`[invoke ${verb.name}${Object.keys(args).length ? " " + JSON.stringify(args) : ""}]`));

    const result = await invoke(verb.name, args);
    if (result.ok) {
      console.log(green("ok") + (result.message ? `: ${result.message}` : ""));
      if (result.prose) {
        console.log(dim("prose:"));
        console.log(`  ${result.prose.replace(/\n/g, "\n  ")}`);
      }
    } else {
      console.log(red(`fail: ${result.error ?? "(no error message)"}`));
    }

    turns++;
    if (turns >= maxTurns) {
      console.log(dim(`reached max-turns (${maxTurns}); exiting.`));
      break;
    }
  }

  rl.close();
  dom.window.close();
}

if (jsonMode) {
  await runJsonMode();
} else {
  await runInteractive();
}
