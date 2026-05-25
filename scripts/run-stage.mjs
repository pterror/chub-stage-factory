#!/usr/bin/env node
/**
 * run-stage.mjs — CLI smoke runner for Chub stage scenarios.
 *
 * Usage:
 *   node scripts/run-stage.mjs <example-name> --scenario <scenario.json> [options]
 *   node scripts/run-stage.mjs --all scenarios/*.smoke.json
 *
 * Options:
 *   --scenario <path>   Path to scenario JSON file (required unless --all)
 *   --turns N           Run only the first N steps
 *   --interactive       Pause between steps (press Enter)
 *   --print-html        Print rendered DOM HTML after each step
 *   --all <glob...>     Run all matching scenarios against the example named
 *                       in each scenario file's "exampleName" field, or
 *                       derive from the scenario filename prefix
 *
 * Requires: bun run build:headless (produces dist-headless/index.js)
 *
 * Exit 0 on success, 1 on assertion failure or error.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
const rawArgs = process.argv.slice(2);

const hasFlag = (flag) => rawArgs.includes(flag);
const getFlag = (flag) => {
  const i = rawArgs.indexOf(flag);
  return i !== -1 ? rawArgs[i + 1] : null;
};

const allMode = hasFlag("--all");
const interactive = hasFlag("--interactive");
const printHtml = hasFlag("--print-html");
const delegatorMode = hasFlag("--delegator");
const turnsArg = getFlag("--turns");
const maxTurns = turnsArg ? parseInt(turnsArg, 10) : Infinity;

// Collect positional + --all scenario file arguments
const positionals = rawArgs.filter((a) => !a.startsWith("--"));
const exampleName = !allMode ? (positionals[0] ?? null) : null;
const scenarioPaths = [];

if (allMode) {
  // All positional args after --all flag are scenario paths
  let collecting = false;
  for (const a of rawArgs) {
    if (a === "--all") { collecting = true; continue; }
    if (a.startsWith("--")) { collecting = false; continue; }
    if (collecting) scenarioPaths.push(resolve(a));
  }
  // Also try positionals (e.g. shell glob expansion passes them as args before flags)
  for (const a of positionals) {
    const p = resolve(a);
    if (!scenarioPaths.includes(p)) scenarioPaths.push(p);
  }
} else {
  const scenarioArg = getFlag("--scenario");
  if (!scenarioArg) {
    console.error("usage: node scripts/run-stage.mjs <example-name> --scenario <scenario.json>");
    console.error("   or: node scripts/run-stage.mjs --all scenarios/*.smoke.json");
    process.exit(2);
  }
  scenarioPaths.push(resolve(scenarioArg));
}

// ---------------------------------------------------------------------------
// Check headless build
// ---------------------------------------------------------------------------
const headlessBundlePath = resolve(repo, "dist-headless", "index.js");
if (!existsSync(headlessBundlePath)) {
  console.error(`[run-stage] dist-headless/index.js not found.`);
  console.error(`[run-stage] Run: bun run build:headless`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Import helpers (dynamic to allow top-level await check first)
// ---------------------------------------------------------------------------
let headlessModule;
try {
  headlessModule = await import(headlessBundlePath);
} catch (err) {
  console.error("[run-stage] failed to import dist-headless/index.js:", err.message);
  process.exit(1);
}

// Import scenario parser from src via tsx-friendly path (compiled ts not available;
// use a lightweight inline reimplementation for Node).
// We replicate only what we need from src/runner/scenario.ts.

function getPath(obj, path) {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(a[k], b[k]));
}

function parseScenario(raw) {
  if (!raw || typeof raw !== "object") throw new Error("scenario must be an object");
  if (typeof raw.name !== "string") throw new Error("scenario.name must be a string");
  if (!Array.isArray(raw.steps)) throw new Error("scenario.steps must be an array");
  return raw; // light validation; full validation in src/runner/scenario.ts
}

// ---------------------------------------------------------------------------
// Minimal mock objects (NullMocks — no I/O needed in CLI)
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
  textGen: () => Promise.resolve({ result: "A null mock text response." }),
};

const nullMessenger = {
  impersonate: () => Promise.resolve({ success: true, error: null, identity: "null-id" }),
  updateChatState: () => Promise.resolve({ success: true, error: null }),
  updateEnvironment: () => Promise.resolve({ success: true, error: null }),
  nudge: () => Promise.resolve({ success: true, error: null, identity: "null-id" }),
};

// ---------------------------------------------------------------------------
// jsdom setup
// ---------------------------------------------------------------------------
function setupJsdom() {
  const dom = new JSDOM("<!DOCTYPE html><html><body><div id='root'></div></body></html>", {
    url: "http://localhost",
    pretendToBeVisual: true,
  });
  // Polyfill globals that React needs
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
// Derive example name from scenario path/content
// ---------------------------------------------------------------------------
function deriveExampleName(scenarioPath, scenario) {
  // Prefer explicit field
  if (scenario.exampleName) return scenario.exampleName;
  // Derive from filename: "world-primary.smoke.json" -> "world-primary"
  const base = basename(scenarioPath, ".json");
  return base.split(".")[0];
}

// ---------------------------------------------------------------------------
// Interactive readline
// ---------------------------------------------------------------------------
async function pressEnterToContinue() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((res) => rl.question("  [press Enter for next step]", () => {
    rl.close();
    res();
  }));
}

// ---------------------------------------------------------------------------
// Run a single scenario
// ---------------------------------------------------------------------------
async function runScenario(scenarioPath, overrideExampleName) {
  console.log(`\n[run-stage] scenario: ${scenarioPath}`);

  let rawScenario;
  try {
    rawScenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
  } catch (err) {
    console.error(`[run-stage] failed to read scenario: ${err.message}`);
    return false;
  }

  let scenario;
  try {
    scenario = parseScenario(rawScenario);
  } catch (err) {
    console.error(`[run-stage] invalid scenario: ${err.message}`);
    return false;
  }

  const isDelegate = delegatorMode || scenario.delegator === true;
  const targetExample = overrideExampleName ?? deriveExampleName(scenarioPath, scenario);
  console.log(`[run-stage] example: ${targetExample}, scenario: ${scenario.name}${isDelegate ? " [delegator mode]" : ""}`);

  // Get factory from headless bundle
  // When --delegator is set, import src/Stage.tsx (the top-level delegator).
  // Otherwise, import examples/<name>/Stage.tsx directly.
  let factory;
  try {
    let stagePath;
    if (isDelegate) {
      stagePath = resolve(repo, "src", "Stage.tsx");
      if (!existsSync(stagePath)) {
        console.error(`[run-stage] delegator Stage not found at ${stagePath}`);
        return false;
      }
      console.log(`[run-stage] delegator mode: loading top-level Stage from ${stagePath}`);
    } else {
      stagePath = resolve(repo, "examples", targetExample, "Stage.tsx");
      if (!existsSync(stagePath)) {
        console.error(`[run-stage] no stage found at ${stagePath}`);
        console.error(`[run-stage] valid examples: inventory, effects, turn-combat, tits-body, cyber-slots, physics, realtime-combat, composite-showcase, world-primary`);
        return false;
      }
    }
    const stageModule = await import(stagePath);
    // Find any exported class with a load() method
    const StageClass = Object.values(stageModule).find(
      (v) => typeof v === "function" && v.prototype && typeof v.prototype.load === "function"
    );
    if (!StageClass) {
      console.error(`[run-stage] no StageBase subclass found in ${stagePath}`);
      return false;
    }
    factory = (data) => new StageClass(data);
  } catch (err) {
    console.error(`[run-stage] failed to load stage class: ${err.message}`);
    return false;
  }

  // Build InitialData
  const DEFAULT_INITIAL = {
    environment: "development",
    initState: null,
    characters: {},
    config: null,
    messageState: null,
    users: {},
    chatState: null,
  };

  const initData = { ...DEFAULT_INITIAL, ...(scenario.init ?? {}) };

  // Set up jsdom
  const dom = setupJsdom();

  // Inject mock services via data
  const data = {
    ...initData,
    generator: nullGenerator,
    messenger: nullMessenger,
  };

  // Construct stage — pass mocks; StageBase constructor will use environment
  // field to decide live vs mock, but our scenario sets environment=development
  // so MockGenerator/MockMessenger are constructed. We override them after.
  let stage;
  try {
    stage = factory(data);
    // Override with null mocks
    stage.generator = nullGenerator;
    stage.messenger = nullMessenger;
  } catch (err) {
    console.error(`[run-stage] stage constructor failed: ${err.message}`);
    return false;
  }

  // Serialize DOM — render stage to HTML via react-dom/server
  function getDom() {
    try {
      const rendered = stage.render();
      if (rendered == null) return "";
      return renderToStaticMarkup(rendered);
    } catch (err) {
      console.warn(`[run-stage] getDom() error: ${err.message}`);
      return "";
    }
  }

  // Track state
  let messageState = null;
  let chatState = null;

  // Run load()
  console.log(`[run-stage] calling load()...`);
  let loadResp;
  try {
    loadResp = await stage.load();
  } catch (err) {
    console.error(`[run-stage] load() threw: ${err.message}`);
    return false;
  }
  if (loadResp) {
    if (loadResp.messageState !== undefined) messageState = loadResp.messageState;
    if (loadResp.chatState !== undefined) chatState = loadResp.chatState;
  }
  console.log(`[run-stage] load() -> success: ${loadResp?.success ?? true}`);

  const DEFAULT_MESSAGE = {
    anonymizedId: "0",
    content: "",
    isBot: false,
    promptForId: "1",
    identity: "12345",
    isMain: true,
  };

  const steps = scenario.steps.slice(0, maxTurns === Infinity ? undefined : maxTurns);
  const assertions = scenario.assertions ?? [];

  let stepIndex = 0;
  for (const step of steps) {
    stepIndex++;
    console.log(`[run-stage] step ${stepIndex}/${steps.length}: ${step.type}`);

    if (interactive) {
      await pressEnterToContinue();
    }

    try {
      switch (step.type) {
        case "before": {
          const msg = { ...DEFAULT_MESSAGE, ...step.message };
          const resp = await stage.beforePrompt(msg);
          if (resp?.messageState !== undefined) messageState = resp.messageState;
          if (resp?.chatState !== undefined) chatState = resp.chatState;
          break;
        }
        case "after": {
          const msg = { ...DEFAULT_MESSAGE, ...step.message };
          const resp = await stage.afterResponse(msg);
          if (resp?.messageState !== undefined) messageState = resp.messageState;
          if (resp?.chatState !== undefined) chatState = resp.chatState;
          break;
        }
        case "set": {
          await stage.setState(step.state);
          break;
        }
        case "call": {
          if (typeof stage[step.functionName] === "function") {
            stage[step.functionName](step.args);
          } else {
            console.warn(`[run-stage] method ${step.functionName} not found on stage`);
          }
          break;
        }
      }
    } catch (err) {
      console.error(`[run-stage] step ${stepIndex} threw: ${err.message}`);
      return false;
    }

    const html = getDom();
    if (printHtml) {
      console.log(`[run-stage] DOM after step ${stepIndex}:`);
      console.log(html);
    }

    // Check "always" assertions
    for (const assertion of assertions) {
      if ((assertion.when ?? "end") === "always") {
        const result = evaluateAssertion(assertion, messageState, chatState, html, stepIndex);
        reportAssertion(result);
        if (!result.passed) return false;
      }
    }
  }

  // Check "end" assertions
  const finalHtml = getDom();
  if (printHtml) {
    console.log(`[run-stage] final DOM:`);
    console.log(finalHtml);
  }

  let allPassed = true;
  for (const assertion of assertions) {
    if ((assertion.when ?? "end") === "end") {
      const result = evaluateAssertion(assertion, messageState, chatState, finalHtml, stepIndex);
      reportAssertion(result);
      if (!result.passed) allPassed = false;
    }
  }

  if (allPassed) {
    console.log(`[run-stage] PASS: ${scenario.name}`);
  } else {
    console.error(`[run-stage] FAIL: ${scenario.name}`);
  }

  // Cleanup jsdom
  dom.window.close();

  return allPassed;
}

// ---------------------------------------------------------------------------
// Assertion evaluator
// ---------------------------------------------------------------------------
function evaluateAssertion(assertion, messageState, chatState, html, stepIndex) {
  const pass = (reason) => ({ assertion, stepIndex, passed: true, reason });
  const fail = (reason) => ({ assertion, stepIndex, passed: false, reason });

  switch (assertion.kind) {
    case "messageState": {
      const val = getPath(messageState, assertion.path);
      return deepEqual(val, assertion.expected)
        ? pass()
        : fail(`messageState.${assertion.path}: expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(val)}`);
    }
    case "chatState": {
      const val = getPath(chatState, assertion.path);
      return deepEqual(val, assertion.expected)
        ? pass()
        : fail(`chatState.${assertion.path}: expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(val)}`);
    }
    case "domContains": {
      if (html == null) return fail("domContains: no DOM available");
      return html.includes(assertion.selector)
        ? pass()
        : fail(`domContains: "${assertion.selector}" not found in DOM`);
    }
    case "domMatches": {
      if (html == null) return fail("domMatches: no DOM available");
      const pattern = new RegExp(assertion.pattern);
      return pattern.test(html)
        ? pass()
        : fail(`domMatches: /${assertion.pattern}/ did not match DOM`);
    }
    default:
      return fail(`unknown assertion kind: ${assertion.kind}`);
  }
}

function reportAssertion(result) {
  if (result.passed) {
    console.log(`  [PASS] ${result.assertion.kind}${result.reason ? `: ${result.reason}` : ""}`);
  } else {
    console.error(`  [FAIL] ${result.assertion.kind}: ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
let overallPass = true;

for (const scenarioPath of scenarioPaths) {
  const passed = await runScenario(scenarioPath, exampleName);
  if (!passed) overallPass = false;
}

if (scenarioPaths.length === 0) {
  console.error("[run-stage] no scenarios found");
  process.exit(2);
}

console.log(`\n[run-stage] ${overallPass ? "ALL PASS" : "SOME FAILED"}`);
process.exit(overallPass ? 0 : 1);
