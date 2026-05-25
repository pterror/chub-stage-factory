/**
 * scenario.ts — JSON schema + parser + driver for stage smoke scenarios.
 *
 * Shape:
 *   {
 *     name: string,
 *     init?: InitData,
 *     steps: Step[],
 *     assertions?: Assertion[]
 *   }
 *
 * Steps:
 *   { type: "before", message: BeforeData }
 *   { type: "after",  message: AfterData }
 *   { type: "set",    state: unknown }
 *   { type: "call",   functionName: string, args?: unknown }
 *
 * Assertions:
 *   { kind: "messageState", path: string, expected: unknown, when?: "always"|"end" }
 *   { kind: "chatState",    path: string, expected: unknown, when?: "always"|"end" }
 *   { kind: "domContains",  selector: string,               when?: "always"|"end" }
 *   { kind: "domMatches",   selector: string, pattern: string, when?: "always"|"end" }
 *
 * Path uses dot-notation (e.g. "player.hp").
 */

import type { InitData, BeforeData, AfterData } from "./protocol.js";

// ---------------------------------------------------------------------------
// Step types
// ---------------------------------------------------------------------------

export type Step =
  | { type: "before"; message: BeforeData }
  | { type: "after"; message: AfterData }
  | { type: "set"; state: unknown }
  | { type: "call"; functionName: string; args?: unknown };

// ---------------------------------------------------------------------------
// Assertion types
// ---------------------------------------------------------------------------

export type AssertionWhen = "always" | "end";

export type Assertion =
  | { kind: "messageState"; path: string; expected: unknown; when?: AssertionWhen }
  | { kind: "chatState"; path: string; expected: unknown; when?: AssertionWhen }
  | { kind: "domContains"; selector: string; when?: AssertionWhen }
  | { kind: "domMatches"; selector: string; pattern: string; when?: AssertionWhen };

// ---------------------------------------------------------------------------
// Scenario schema
// ---------------------------------------------------------------------------

export interface Scenario {
  name: string;
  init?: InitData;
  steps: Step[];
  assertions?: Assertion[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ScenarioParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioParseError";
  }
}

function assertString(val: unknown, label: string): string {
  if (typeof val !== "string") throw new ScenarioParseError(`${label} must be a string`);
  return val;
}

function parseStep(raw: unknown, idx: number): Step {
  if (!raw || typeof raw !== "object") {
    throw new ScenarioParseError(`step[${idx}] must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const type = assertString(r.type, `step[${idx}].type`);
  switch (type) {
    case "before":
      return { type: "before", message: (r.message as BeforeData) ?? {} };
    case "after":
      return { type: "after", message: (r.message as AfterData) ?? {} };
    case "set":
      return { type: "set", state: r.state };
    case "call": {
      const functionName = assertString(r.functionName, `step[${idx}].functionName`);
      return { type: "call", functionName, args: r.args };
    }
    default:
      throw new ScenarioParseError(`step[${idx}].type unknown: "${type}"`);
  }
}

function parseAssertion(raw: unknown, idx: number): Assertion {
  if (!raw || typeof raw !== "object") {
    throw new ScenarioParseError(`assertion[${idx}] must be an object`);
  }
  const r = raw as Record<string, unknown>;
  const kind = assertString(r.kind, `assertion[${idx}].kind`);
  const when = (r.when as AssertionWhen | undefined) ?? "end";
  if (when !== "always" && when !== "end") {
    throw new ScenarioParseError(`assertion[${idx}].when must be "always" or "end"`);
  }
  switch (kind) {
    case "messageState":
    case "chatState":
      return {
        kind: kind as "messageState" | "chatState",
        path: assertString(r.path, `assertion[${idx}].path`),
        expected: r.expected,
        when,
      };
    case "domContains":
      return {
        kind: "domContains",
        selector: assertString(r.selector, `assertion[${idx}].selector`),
        when,
      };
    case "domMatches":
      return {
        kind: "domMatches",
        selector: assertString(r.selector, `assertion[${idx}].selector`),
        pattern: assertString(r.pattern, `assertion[${idx}].pattern`),
        when,
      };
    default:
      throw new ScenarioParseError(`assertion[${idx}].kind unknown: "${kind}"`);
  }
}

export function parseScenario(raw: unknown): Scenario {
  if (!raw || typeof raw !== "object") {
    throw new ScenarioParseError("scenario must be an object");
  }
  const r = raw as Record<string, unknown>;
  const name = assertString(r.name, "scenario.name");
  const init = r.init as InitData | undefined;
  if (!Array.isArray(r.steps)) {
    throw new ScenarioParseError("scenario.steps must be an array");
  }
  const steps = (r.steps as unknown[]).map((s, i) => parseStep(s, i));
  const assertions = r.assertions
    ? (r.assertions as unknown[]).map((a, i) => parseAssertion(a, i))
    : [];
  return { name, init, steps, assertions };
}

// ---------------------------------------------------------------------------
// Dot-notation path accessor
// ---------------------------------------------------------------------------

export function getPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Stage interface (minimal — the driver only needs lifecycle methods)
// ---------------------------------------------------------------------------

export interface StageInterface {
  load(): Promise<unknown>;
  beforePrompt(message: BeforeData): Promise<unknown>;
  afterResponse(message: AfterData): Promise<unknown>;
  setState(state: unknown): Promise<void>;
  render(): unknown;
}

// ---------------------------------------------------------------------------
// Assertion result
// ---------------------------------------------------------------------------

export interface AssertionResult {
  assertion: Assertion;
  stepIndex: number;
  passed: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Driver state
// ---------------------------------------------------------------------------

export interface DriverState {
  messageState: unknown;
  chatState: unknown;
  initState: unknown;
  domHtml: string | null;
}

// ---------------------------------------------------------------------------
// DOM serializer — injected so we stay environment-agnostic
// ---------------------------------------------------------------------------

export type DomSerializer = () => string | null;

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class Driver {
  private scenario: Scenario;
  private results: AssertionResult[] = [];
  private stepIndex = 0;
  private state: DriverState = {
    messageState: null,
    chatState: null,
    initState: null,
    domHtml: null,
  };

  constructor(scenario: Scenario) {
    this.scenario = scenario;
  }

  /** Run the full scenario against a stage instance. */
  async run(
    stage: StageInterface,
    getDom?: DomSerializer,
  ): Promise<AssertionResult[]> {
    // Run INIT
    const loadResp = (await stage.load()) as Record<string, unknown> | null;
    if (loadResp) {
      if (loadResp.messageState !== undefined) this.state.messageState = loadResp.messageState;
      if (loadResp.chatState !== undefined) this.state.chatState = loadResp.chatState;
      if (loadResp.initState !== undefined) this.state.initState = loadResp.initState;
    }
    this.state.domHtml = getDom ? getDom() : null;

    const assertions = this.scenario.assertions ?? [];

    // Check "always" assertions after init
    for (const assertion of assertions) {
      if ((assertion.when ?? "end") === "always") {
        this.results.push(this.evaluate(assertion, -1, getDom));
      }
    }

    // Execute steps
    for (let i = 0; i < this.scenario.steps.length; i++) {
      this.stepIndex = i;
      const step = this.scenario.steps[i];
      await this.executeStep(stage, step);
      this.state.domHtml = getDom ? getDom() : null;

      // Check "always" assertions after each step
      for (const assertion of assertions) {
        if ((assertion.when ?? "end") === "always") {
          this.results.push(this.evaluate(assertion, i, getDom));
        }
      }
    }

    // Check "end" assertions (default)
    for (const assertion of assertions) {
      if ((assertion.when ?? "end") === "end") {
        this.results.push(this.evaluate(assertion, this.stepIndex, getDom));
      }
    }

    return this.results;
  }

  private async executeStep(stage: StageInterface, step: Step): Promise<void> {
    switch (step.type) {
      case "before": {
        const resp = (await stage.beforePrompt(step.message)) as Record<string, unknown> | null;
        if (resp) {
          if (resp.messageState !== undefined) this.state.messageState = resp.messageState;
          if (resp.chatState !== undefined) this.state.chatState = resp.chatState;
        }
        break;
      }
      case "after": {
        const resp = (await stage.afterResponse(step.message)) as Record<string, unknown> | null;
        if (resp) {
          if (resp.messageState !== undefined) this.state.messageState = resp.messageState;
          if (resp.chatState !== undefined) this.state.chatState = resp.chatState;
        }
        break;
      }
      case "set": {
        await stage.setState(step.state);
        break;
      }
      case "call": {
        // CALL is fire-and-forget in the driver; result not tracked
        const s = stage as unknown as Record<string, (args: unknown) => unknown>;
        if (typeof s[step.functionName] === "function") {
          s[step.functionName](step.args);
        }
        break;
      }
    }
  }

  private evaluate(
    assertion: Assertion,
    stepIndex: number,
    getDom?: DomSerializer,
  ): AssertionResult {
    const pass = (reason?: string): AssertionResult =>
      ({ assertion, stepIndex, passed: true, reason });
    const fail = (reason: string): AssertionResult =>
      ({ assertion, stepIndex, passed: false, reason });

    switch (assertion.kind) {
      case "messageState": {
        const val = getPath(this.state.messageState, assertion.path);
        const ok = deepEqual(val, assertion.expected);
        return ok
          ? pass()
          : fail(`messageState.${assertion.path}: expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(val)}`);
      }
      case "chatState": {
        const val = getPath(this.state.chatState, assertion.path);
        const ok = deepEqual(val, assertion.expected);
        return ok
          ? pass()
          : fail(`chatState.${assertion.path}: expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(val)}`);
      }
      case "domContains": {
        const html = getDom ? getDom() : this.state.domHtml;
        if (html == null) return fail("domContains: no DOM available");
        const contains = html.includes(assertion.selector);
        return contains
          ? pass()
          : fail(`domContains: "${assertion.selector}" not found in DOM`);
      }
      case "domMatches": {
        const html = getDom ? getDom() : this.state.domHtml;
        if (html == null) return fail("domMatches: no DOM available");
        const pattern = new RegExp(assertion.pattern);
        const matches = pattern.test(html);
        return matches
          ? pass()
          : fail(`domMatches: pattern /${assertion.pattern}/ did not match DOM`);
      }
    }
  }

  getState(): Readonly<DriverState> {
    return this.state;
  }
}

// ---------------------------------------------------------------------------
// Deep equality
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}
